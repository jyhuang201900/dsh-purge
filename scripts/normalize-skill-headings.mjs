#!/usr/bin/env node
/**
 * 用途：把技能文件里「合并进来的上游参考」的标题层级下沉，保证一个技能只有一个 H1。
 * 用法：node scripts/normalize-skill-headings.mjs [--dry] [--check]
 * 依赖：Node ≥18；只改标题行，不动正文一字。
 *
 * 为什么需要它（实测）：114 个技能里 **77 个有多个 H1**（`ctf-sandbox-orchestrator` 有 9 个）。
 * 成因是合并上游参考时把上游自己的 `# 标题` 与 `## 小节` 原样铺了进来，于是：
 *   · 技能文件出现**第二个文档标题**，读的人分不清哪是技能本体、哪是附录；
 *   · 上游的 `##` 与技能自身的 `##`（Quick Start / Workflow…）**平级**，结构被压平；
 *   · 我后加的小节（本机可执行性 / 链路位置 / 第二发）夹在附录的 H2 之间，看不出归属。
 * 这不是内容问题（内容都在），是**结构问题**——结构乱了，模型读到的就是一团平铺文本。
 *
 * 做法：找到合并块（H2 里含「上游参考并入」或「上游深度参考」），把块内所有标题**整体下沉 2 级**
 * （封顶 H6），于是上游 `# 标题`→H3、`## 小节`→H4、`### 子节`→H5，稳稳挂在合并小节下面。
 * 块边界取「合并 H2 → 下一个生成块标记 / 已知尾部小节（本机可执行性 / 链路位置 / 第二发）或文末」——
 * 生成块都带 `<!--` 标记，边界可判；**不按「下一个 H2」判**，否则上游的 H2 会被当成块结束。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const dry = process.argv.includes("--dry");
const checkOnly = process.argv.includes("--check");
const root = process.cwd();
const SKILLS = path.join(root, "skills", "redteam");

const MERGE_H2 = /^##\s+.*(上游参考并入|上游深度参考)/;
const TAIL_OR_MARK = /^(<!--|##\s+(本机可执行性|链路位置|第二发)\b)/;
const HEAD = /^(#{1,6})(\s+.*)$/;

/** 把一个标题下沉 shift 级，封顶 6 */
const demote = (hashes, rest, shift) => "#".repeat(Math.min(6, hashes.length + shift)) + rest;

/** 合并块里的「参考文件名锚点」：H3 且是 kebab-case / 带扩展名的裸名字（我合并时写的 `### <文件名>`）。
 *  锚点**保持 H3 不动**，上游内容下沉到 H4 起；否则会出现锚点比它标注的内容还深的倒挂
 *  （第一版就踩了：`##### agent-cloud` 与 `### AI Agent...` 层级倒挂）。 */
const ANCHOR = /^###\s+[\w.-]+$/;

/** 摘要：去掉紧跟 front-matter 的**冗余 H1**。
 *  实测另一种多 H1 成因：文件开头是 `---` front-matter，紧接着一行 `# <id>`（与 front-matter 的
 *  name 完全重复，是导入时多写的一行），然后才是真标题（如 `# API 安全测试`）。
 *  去掉这行冗余后，真标题就成为全文唯一的 H1。 */
function dropRedundantH1(text, id) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return { text, dropped: 0 };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) if (lines[i] === "---") { end = i; break; }
  if (end < 0) return { text, dropped: 0 };
  let j = end + 1;
  while (j < lines.length && lines[j].trim() === "") j += 1;
  if (lines[j] !== "# " + id) return { text, dropped: 0 };
  const out = [...lines.slice(0, j), ...lines.slice(j + 1)];
  // 收掉可能留下的连续空行
  const tidy = [];
  for (let k = 0; k < out.length; k += 1) {
    if (out[k].trim() === "" && tidy.length && tidy[tidy.length - 1].trim() === "" && k > end) continue;
    tidy.push(out[k]);
  }
  return { text: tidy.join("\n"), dropped: 1 };
}

function normalize(text, id) {
  const { text: t2 } = dropRedundantH1(text, id);
  const lines = t2.split(/\r?\n/);
  const out = [];
  let inMerge = false;
  let changed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const mh = HEAD.exec(line);
    if (!inMerge) {
      if (MERGE_H2.test(line)) inMerge = true;
      out.push(line);
      continue;
    }
    // 块内遇到尾部小节或生成块标记 → 退出合并块
    if (TAIL_OR_MARK.test(line)) { inMerge = false; out.push(line); continue; }
    if (mh && ANCHOR.test(line)) { out.push(line); continue; }        // 锚点：原样保留
    if (mh) { out.push(demote(mh[1], mh[2], 3)); changed += 1; continue; } // 上游内容：H1→H4、H2→H5、H3→H6
    out.push(line);
  }
  return { text: out.join("\n"), changed };
}

const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
let touched = 0, totalDemoted = 0;
const remaining = [];
for (const f of files) {
  const p = path.join(SKILLS, f);
  const before = fs.readFileSync(p, "utf8");
  const { text: after, changed } = normalize(before, f.replace(/\.md$/, ""));
  // 排除代码块后统计 H1 个数（bash 注释 `# ...` 不是标题）
  const h1 = (t) => t.replace(/```[\s\S]*?```/g, "").split(/\r?\n/).filter((x) => /^#\s/.test(x)).length;
  if (checkOnly) { if (h1(after) > 1) remaining.push(`${f.replace(/\.md$/, "")}(${h1(after)} 个 H1)`); continue; }
  if (after !== before) { if (!dry) fs.writeFileSync(p, after, "utf8"); touched += 1; totalDemoted += changed; }
}

if (checkOnly) {
  if (remaining.length) { console.log(`  有 ${remaining.length} 个技能仍有多个 H1：${remaining.slice(0, 8).join(", ")}`); process.exit(1); }
  console.log("  所有技能都只有一个 H1 ✓");
  process.exit(0);
}
console.log(`标题规范化：改动 ${touched} 个技能｜下沉标题 ${totalDemoted} 行${dry ? "（--dry 未写盘）" : ""}`);
