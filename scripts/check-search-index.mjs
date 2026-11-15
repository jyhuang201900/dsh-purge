#!/usr/bin/env node
/**
 * 第 24 关：检索索引质量。
 *
 * 为什么要有：索引质量差不会报错，只会让模型"找不到对的东西"，症状极隐蔽。
 * 实测踩过四层噪音，每修一层冒出下一层：
 *   ① 英文模板标题（Workflow 44 / Quick 43 / Start 42 / Reference 41）
 *      —— competition-* 从英文上游搬来，`## Quick Start` 被当关键词收进索引
 *   ② 生成块正文（本机工具实况表里的「表会过期」「命令不会」各 32 次）
 *      —— 只剥了注释标记没剥正文
 *   ③ 阶段名（漏洞发现 43 / 漏洞利用 31 / 内网渗透 29）
 *      —— stageName 进了 extra，同阶段技能全绑成一团
 *   ④ 普通英文词（surface 41 / Map 27 / Decisive 24 / Reduce 22）
 *      —— 抽取判据只有"长度≥2"，句子开头的词全被当专有名词
 *   最终靠「动态频次过滤」（≥15% 技能共有的词剔除）收口。
 *
 * 判据：
 *   1. 任何 key 在全部技能里的出现次数不得超过 15%（默认上限 18/119）
 *   2. summary 覆盖率必须 100%（缺了它，中文长词回退就在空串里找）
 *   3. 零关键词技能必须为 0
 *   4. 模板词不得出现（Workflow/Quick Start/Checklist 等文档结构词）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const searchPath = path.join(ROOT, "lib", "generated", "skills-search.json");

if (!fs.existsSync(searchPath)) {
  console.error("[check-search-index] ✗ 找不到 lib/generated/skills-search.json（先跑 build-skill-graph）");
  process.exit(1);
}

const idx = JSON.parse(fs.readFileSync(searchPath, "utf8"));
const skills = idx.skills || [];
const problems = [];

if (!skills.length) {
  console.error("[check-search-index] ✗ 索引为空");
  process.exit(1);
}

/* 1) 泛词频次 */
const freq = new Map();
for (const s of skills) for (const k of s.keys || []) freq.set(k, (freq.get(k) || 0) + 1);
const limit = Math.max(6, Math.round(skills.length * 0.15));
const overSpread = [...freq.entries()].filter(([, n]) => n >= limit).sort((a, b) => b[1] - a[1]);
if (overSpread.length) {
  problems.push(
    `${overSpread.length} 个词出现在 ≥${limit} 个技能里（零区分度）：` +
      overSpread.slice(0, 5).map(([k, n]) => `${k}×${n}`).join("、")
  );
}

/* 2) summary 覆盖 */
const noSummary = skills.filter((s) => !String(s.summary || "").trim());
if (noSummary.length) {
  problems.push(`${noSummary.length} 个技能缺 summary（中文长词回退会失效）：${noSummary.slice(0, 4).map((s) => s.id).join(", ")}`);
}

/* 3) 零关键词 */
const noKeys = skills.filter((s) => !(s.keys || []).length);
if (noKeys.length) {
  problems.push(`${noKeys.length} 个技能没有任何关键词：${noKeys.slice(0, 4).map((s) => s.id).join(", ")}`);
}

/* 4) 模板词残留 */
const TEMPLATE_WORDS = [
  "workflow", "quick", "quick start", "checklist", "reference", "references",
  "what to preserve", "read this reference", "overview", "introduction",
];
const leftover = [];
for (const s of skills) {
  for (const k of s.keys || []) {
    if (TEMPLATE_WORDS.includes(String(k).toLowerCase())) leftover.push(`${s.id}:${k}`);
  }
}
if (leftover.length) {
  problems.push(`模板词残留 ${leftover.length} 处：${leftover.slice(0, 4).join(", ")}`);
}

/* 5) whenToUse 不能是 summary 的复制。
   两者语义不同：summary 说"这个技能是干什么的"，whenToUse 说"什么情况下该加载它"。
   实测 windows-ad 的 whenToUse 被截断成 "...including Kerberos, AD CS"，
   丢掉了它实际覆盖的委派/DPAPI/ACL，于是查「域内委派怎么利用」时它排不上去 ——
   索引只能从描述抽词，描述没写的词永远抽不到。
   判据：完全相同 → 报；英文以逗号/介词结尾 → 报（截断特征）。 */
const sameDesc = skills.filter((s) => {
  const w = String(s.whenToUse || "").trim();
  const d = String(s.summary || "").trim();
  return w && d && w === d;
});
if (sameDesc.length) {
  problems.push(`${sameDesc.length} 个技能的 whenToUse 与 summary 完全相同（缺独立触发条件）：${sameDesc.slice(0, 4).map((s) => s.id).join(", ")}`);
}
const truncated = skills.filter((s) => {
  const w = String(s.whenToUse || "").trim();
  return /[,;]$/.test(w) || /\b(including|such as|e\.g\.)$/i.test(w);
});
if (truncated.length) {
  problems.push(`${truncated.length} 个技能的 whenToUse 疑似被截断（以逗号/介词结尾）：${truncated.slice(0, 4).map((s) => s.id).join(", ")}`);
}

/* 6) ATT&CK 编号必须可检索（1.1.117）。
   为什么单独守这条：1.1.113 给 77 个技能打了 ATT&CK 标签，但标签只写在正文表格里，
   而索引抽取只扫 id+summary+whenToUse+headings —— 编号一个都没进索引。
   实测 `purge_skills q=T1059` 回「技能库里没有匹配」。
   这是「加了等于白加」的第三次踩点：东西写进正文了，读路径没覆盖到。
   判据三条，缺一条就说明编号检索又断了：
     a. 有 attack 字段且非空的技能数 ≥ 全部技能的一半（打标是真做了）
     b. attack-traceability 这种**映射参考表**必须被压下去：它正文列 23 个编号，
        不扣分时它是每个 ATT&CK 查询的第一名（答案全变成「怎么填映射表」）
     c. 编号不得混进 keys（会撞上 15% 泛词过滤被剔除，且参与模糊打分互相污染） */
const noAttackField = skills.filter((s) => !Array.isArray(s.attack));
if (noAttackField.length) {
  problems.push(`${noAttackField.length} 个技能缺 attack 字段（ATT&CK 编号检索会整条失效）：${noAttackField.slice(0, 4).map((s) => s.id).join(", ")}`);
}
const withAttack = skills.filter((s) => (s.attack || []).length > 0);
if (withAttack.length < Math.ceil(skills.length / 2)) {
  problems.push(
    `只有 ${withAttack.length}/${skills.length} 个技能有 ATT&CK 编号 —— 低于一半，说明打标没做或正文被改掉了`
  );
}
/* 编号不能混在 keys 里：T1190 出现在 28 个技能中，会被 15% 泛词阈值（18）剔除；
   而 T1059 与 T1059.001 互相前缀包含，会让「查子技术」拿到父技术的技能。 */
const attackInKeys = skills.filter((s) => (s.keys || []).some((k) => /^T\d{4}(?:\.\d{3})?$/i.test(String(k))));
if (attackInKeys.length) {
  problems.push(
    `${attackInKeys.length} 个技能把 ATT&CK 编号写进了 keys（会被泛词过滤剔除 + 模糊打分互相污染）：`
      + attackInKeys.slice(0, 4).map((s) => s.id).join(", ")
  );
}
/* 参考表类技能（列编号极多的）不能用它在别的技术上的命中来抢首位。
   静态可判的部分：这些技能的编号数必须明显高于普通操作技能，闸门只验「确实被标记出来了」——
   排序是否真生效由 check-search-rank.mjs（进程内实测）守。 */
const refTables = withAttack.filter((s) => s.attack.length > 12).map((s) => s.id);
console.log(
  `[check-search-index] ATT&CK 覆盖 ${withAttack.length}/${skills.length}｜`
    + `去重编号 ${new Set(skills.flatMap((s) => s.attack || [])).size} 个｜`
    + `参考表类（编号>12）：${refTables.join(", ") || "无"}`
);

/* 7) 深水区技术名必须可检索（1.1.118）。
   为什么单独守这条 —— 这是「加了等于白加」的**第四次**踩点，也是代价最大的一次：
   references 是深水区（115 篇 / 93.7 万字），技术名全写在它们的 H2/H3 标题与正文表格里
   （`ESC1`~`ESC15`、`Kerberoast`、`PrintSpoofer`、`jku`、`HS256`、`modbus`…），
   而索引原先只扫技能正文的 `id+summary+whenToUse+headings` + 反引号 + ATT&CK 编号。
   实测：references 标题里 399 个技术名，**260 个（65%）在索引里完全没有**；
   查 `potato`/`sebackup`/`jku`/`hs256` 全回「没有匹配」，尽管这些词就在眼前。

   判据（卡具体词，不卡"有没有"）：
     ① 一组**代表性技术名**必须都能精确命中到正确技能 —— 这些词覆盖了四个通道
        （references 标题 / 正文表格 / 反引号 / 小写缩写），少任何一个通道就有一批词掉线；
     ② 每个词的期望技能必须**出现在结果里**（不卡首条：这里验的是"能不能找到"，
        不是"排得对不对"——排序由 check-search-rank.mjs 管）。 */
const PROBES = [
  { q: "esc1", want: "windows-ad", via: "references 标题（ADCS 模板）" },
  { q: "kerberoast", want: "credential-attack", via: "references 标题 + 表格" },
  { q: "sebackup", want: "privesc-persistence", via: "正文表格 + 反引号" },
  { q: "godpotato", want: "privesc-persistence", via: "正文表格（无引号）" },
  { q: "jku", want: "web-vuln-payloads", via: "小写 3 字母缩写" },
  { q: "modbus", want: "ot-ics", via: "references 标题（工控协议）" },
  { q: "amsi", want: "edr-bypass-re", via: "反引号（安全机制名）" },
];
const keySets = skills.map((s) => ({
  id: s.id,
  set: new Set((s.keys || []).map((k) => String(k).toLowerCase())),
}));
for (const p of PROBES) {
  const hit = keySets.filter((x) => x.set.has(p.q.toLowerCase()));
  if (!hit.length) {
    problems.push(
      `技术名「${p.q}」不在任何技能的 keys 里（应能命中 ${p.want}，来自${p.via}）—— 该通道的抽取又断了`
    );
  } else if (!hit.some((x) => x.id === p.want)) {
    problems.push(
      `技术名「${p.q}」能命中 ${hit.slice(0, 3).map((x) => x.id).join("/")}，但缺了 ${p.want}（${p.via}）`
    );
  }
}
const keyTotal = skills.reduce((n, s) => n + (s.keys || []).length, 0);
const avgKeys = Math.round(keyTotal / skills.length);
/* 平均关键词的下降是抽取退化的早期信号：1.1.117 是 29 条，补上 references/表格/缩写后是 51 条。
   跌破 40 基本可以断定某一通道掉了（实测：去掉 references 通道立刻掉到 48，再去掉表格掉到 46）。 */
if (avgKeys < 40) {
  problems.push(`平均关键词只有 ${avgKeys} 条（<40）—— 某一个抽取通道很可能掉了（references 标题/表格/反引号/缩写）`);
}
console.log(
  `[check-search-index] 技术名探针 ${PROBES.length} 个全中｜平均 ${avgKeys} 条关键词（下限 40）`
);

const total = skills.reduce((n, s) => n + (s.keys || []).length, 0);
const avg = Math.round(total / skills.length);
console.log(
  `[check-search-index] 技能 ${skills.length}｜平均 ${avg} 关键词｜最高频 ${overSpread.length ? overSpread[0][0] + "×" + overSpread[0][1] : freq.size ? [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0] + "×" + [...freq.entries()].sort((a, b) => b[1] - a[1])[0][1] : "-"}`
);

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 索引质量差不报错，只会让模型找不到对的东西。必须守住。");
  process.exit(1);
}
console.log(`  ✓ 无泛词（阈值 ${limit}）｜summary 全覆盖｜零关键词 0｜无模板词残留｜ATT&CK ${withAttack.length}/${skills.length} 可检索`);
process.exit(0);