#!/usr/bin/env node
/**
 * 第 34 关：ATT&CK 编号检索排序（进程内实测）。
 *
 * 为什么必须有这一关：编号检索是 1.1.117 新开的通道，它的正确性完全取决于**排序**，
 * 而排序是多条规则叠加的结果（父/子技术、深度加成、参考表扣分、层级扣分）。
 * 静态扫索引只能看出"字段里有编号"，看不出"排出来对不对"。
 * 1.1.91 的教训就在这里：本地全绿、装到宿主就错，因为断言是「结果里有」而不是
 * 「第一条是它」。所以本关**一律卡首条**。
 *
 * 已验证的三个真实缺陷（写下它们是因为都曾经"看起来正常"）：
 *   ① 编号压根没进索引 → `q=T1059` 回「没有匹配」，但技能正文里明明写着
 *   ② attack-traceability 是映射参考表（正文列 23 个编号），不扣分时它是**每个**
 *      ATT&CK 查询的第一名 —— 答案全变成「怎么填映射表」
 *   ③ llm-security 只列一个顶层 T1059（提示注入的下游副作用），却靠字母序压过
 *      shell-handler（真把命令解释器拆成 PowerShell/cmd/Unix Shell）
 *
 * 判据（卡首条 + 卡"不该出现的"）：
 *   1. q=T1059 首条必须是 shell-handler（唯一列了 T1059 子技术、且以起 shell 为主业）
 *   2. q=T1003 首条必须是 credential-attack（列 9 个编号全是凭据转储子技术）
 *   3. q=T1059.001 首条必须是 shell-handler
 *   4. 参考表类技能（attack-traceability）在任何单编号查询里都不得排第一
 *   5. 大小写不敏感：t1059 / T1059 结果一致
 *   6. 查不存在的编号不得编造（回"没有"而不是给一堆无关技能）
 *
 * 为什么用 in-process 而不是打 HTTP：宿主端口每次启动都变，闸门不能依赖宿主在跑。
 */
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(process.argv[2] || ".");
/* loadSearchIndex 的候选顺序里 `$DSH_HOME/dsh-purge/skills-search.json` 优先于仓内 —— 
   闸门必须验**仓内的索引**（那是要发布的产物），所以把 DSH_HOME 指到一个空目录，
   逼它落到 `process.cwd()/lib/generated/`。这个坑不处理的话闸门会读宿主的旧索引，
   本地改完照样绿，装到宿主才发现排序没生效。 */
process.env.DSH_HOME = path.join(ROOT, ".cache", "gate-empty-home");
process.chdir(ROOT);

const { searchSkills } = await import("file://" + path.join(ROOT, "lib", "model-tools.js").replaceAll("\\", "/"));

const cases = [
  { q: "T1059", want: "shell-handler", why: "命令解释器专业户（列 T1059.001/.003/.004）" },
  { q: "t1059", want: "shell-handler", why: "大小写不敏感" },
  { q: "T1003", want: "credential-attack", why: "凭据转储专业户（列 9 个子技术）" },
  { q: "T1059.001", want: "shell-handler", why: "PowerShell 子技术精确命中" },
  { q: "T1003.001", want: "credential-attack", why: "LSASS 内存子技术" },
];

const problems = [];
const announce = [];

for (const c of cases) {
  const r = searchSkills(c.q, 3);
  const text = String(r?.text || "");
  if (r?.missing) {
    problems.push(`检索索引不可读（loadSearchIndex 返回 null）—— 先跑 build-skill-graph`);
    break;
  }
  /* 输出格式：首行标题，第二行起是 `· id｜阶段｜...`。取第一个 `· ` 后面的 id。 */
  const first = text.split("\n").find((l) => l.trim().startsWith("·"));
  if (!first) {
    problems.push(`q=${c.q} 没有任何结果（预期首条 ${c.want}）`);
    continue;
  }
  const got = first.replace(/^\s*·\s*/, "").split("｜")[0].trim();
  announce.push(`q=${c.q} → ${got}`);
  if (got !== c.want) {
    problems.push(`q=${c.q} 首条是 ${got}，应为 ${c.want}（${c.why}）`);
  }
  /* 参考表类不得抢首位：它在任何编号查询里都能"精确命中"，是排序的通用干扰源 */
  if (got === "attack-traceability") {
    problems.push(`q=${c.q} 首条是 attack-traceability —— 映射参考表抢了操作技能的首位（参考表必须扣分）`);
  }
}

/* 不存在的编号：必须明确说"没有"，不能拿一堆无关技能糊过去。
   防的是「查询侧兜底」把无效编号当普通词去模糊匹配 —— 那会让模型以为库里有这个技术。
   1.1.119 实测到的真实形态：`q=T9999` 零命中后降级成模糊查询，
   因为正文里 `vps-reverse-shell` 写了端口 `9999`，于是它成了唯一结果 ——
   模型查一个不存在的技术编号，却拿到「反弹 shell」技能，会误判它覆盖该技术。 */
const bogus = searchSkills("T9999", 3);
const bogusText = String(bogus?.text || "");
if (/^\s*ATT&CK\s+T9999/.test(bogusText) || /命中.*技能/.test(bogusText.split("\n")[0])) {
  problems.push("q=T9999（不存在的编号）被当成有效 ATT&CK 查询或降级成模糊匹配 —— 会编造出无关技能");
}
if (!/没有|不存在/.test(bogusText)) {
  problems.push("q=T9999 没有明确说「没有这条技术」—— 沉默等于默认存在");
}

/* ── 中文语义查询的首条（1.1.122 加）──
   为什么单独一组：这三个查询都曾被**新增内容**污染过，而编号查询不覆盖这类污染。
   ① q=域控：`c2-framework-ops` 讲 domain fronting、`plc-controller-attack` 含 ControlLogix，
      同义词展开出裸 `domain` 与 `domain controller` → 后者被拆成 `controller` 命中
      plc 的 key `controller-level`，把 lateral-movement 挤后。
      修：展开词只留 AD 专有词（Active Directory / Kerberos / 域渗透 / 拿域）。
   ② q=提权：`graphql-testing` / `http-smuggling` / `race-conditions` 的章节标题
      都叫「利用提权 / 横向」（模板化章节名），于是它们的 key 里有「利用提权」。
      修：标题改成「从本类漏洞往下走」——它们本来就不做提权。
   ③ q=工控：新 OT 技能最初没在 description 写「工控」，查不到。
      修：三个 OT 技能 description 里加「工控(OT)」。
   **必须卡首条**：这三条都是「首条错 → 拿到的技能根本不对」的情形。 */
const semanticCases = [
  { q: "域控", want: "lateral-movement", why: "它的 key 就是「找域控路径」；被同义词展开的泛词抢占过" },
  { q: "提权", want: "privesc-persistence", why: "提权专业户；被模板化章节标题「利用提权」抢占过" },
  { q: "工控", want: "industrial-protocol-recon", why: "OT 侦察专项；新技能未写「工控」时查不到" },
  /* 多词英文查询：第一版「反含 close」判据（key 长度 ≤ 查询+3 给 62）在单实体中文上对，
     在多词英文上反噬 —— `active directory` 含 key `directory`，
     于是 dir-bruteforce（目录爆破）成了 AD 查询的首条。这条必须守住。 */
  { q: "active directory", want: "identity-federation", why: "多词查询不许被其中一个词的 key 抢首条（曾命中目录爆破）" },
];
for (const c of semanticCases) {
  const r = searchSkills(c.q, 3);
  const txt = String(r?.text || "");
  const first = txt.split("\n").find((l) => l.trim().startsWith("·"));
  if (!first) {
    problems.push(`q=${c.q} 没有任何结果（预期首条 ${c.want}）`);
    continue;
  }
  const got = first.replace(/^\s*·\s*/, "").split("｜")[0].trim();
  /* 语义查询的结果带阶段后缀（`privesc-persistence（4 漏洞利用）`），
     编号查询不带。所以这里剥掉全角括号部分再比对。
     用 indexOf 而不是正则：`（` 是全角字符，写进字符类容易因编码出问题（实测踩过）。 */
  const gutId = got.indexOf("（") >= 0 ? got.slice(0, got.indexOf("（")).trim() : got;
  announce.push(`q=${c.q} → ${gutId}`);
  if (gutId !== c.want) {
    problems.push(`q=${c.q} 首条是 ${gutId}，应为 ${c.want}（${c.why}）`);
  }
}

/* 过短查询必须拒答并给提法（1.1.119 实测：`q=a` 命中 95 个、`q=T` 命中 89 个）。
   这不是"结果不够准"，是**结果等于噪音**：一屏 95 个技能比没有结果更糟，
   模型无从取舍，往往挑第一个 —— 而第一个是字母序巧合。
   判据：首行必须说「太短」，且不能列出 · 开头的技能条目。 */
for (const short of ["a", "T", "域"]) {
  const r = searchSkills(short, 3);
  const txt = String(r?.text || "");
  const first = txt.split("\n")[0];
  /* 只认**真正的技能条目**：形如 `  · 技能名（4 漏洞利用）｜…`。
     不能只判「有 · 开头的行」—— 我的提法指导本身就用 · 列建议
     （「· 按技术名：…」），第一版这么判，把提示信息当成了违规列表。 */
  const hasSkillRow = txt.split("\n").some((l) => /^\s+·\s+[a-z][a-z0-9-]*（/.test(l));
  if (!/太短/.test(first)) {
    problems.push(`q=${JSON.stringify(short)}（过短）没有拒答 —— 首行是「${first.slice(0, 40)}」`);
  } else if (hasSkillRow) {
    problems.push(`q=${JSON.stringify(short)}（过短）虽然提示太短，但仍列出了技能条目（自相矛盾）`);
  }
}

console.log(`[check-search-rank] ATT&CK 编号检索（进程内实测，卡首条）`);
console.log(`  ${announce.join("｜")}`);

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 排序类是「本地绿、宿主错」的高发区，断言必须卡首条，不能只断言结果里有。");
  process.exit(1);
}
console.log(`  ✓ ${cases.length} 条编号查询首条全部正确｜大小写一致｜参考表未抢位｜无效编号不编造｜过短查询拒答`);
process.exit(0);