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
console.log(`  ✓ 无泛词（阈值 ${limit}）｜summary 全覆盖｜零关键词 0｜无模板词残留`);
process.exit(0);