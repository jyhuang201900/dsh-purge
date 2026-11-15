#!/usr/bin/env node
/**
 * 第 41 关：ATT&CK 标注精度——父子技术不许同时列。
 *
 * 由来：1.1.122 子代理审阅（24 个技能，符号级核对）实测出 7 个技能同时列了
 * 父技术与它的子技术（如 T1003 + T1003.001/.002/.003）。这不是"编号写错"，
 * 前面的第 30 关（编号双向闭合）拦不住 —— 因为两条都在表里，都是合法的。
 *
 * 但后果是真的：报告里「本次覆盖 ATT&CK N 个技术」会把一件事算两遍。
 * T1003 已包含 LSASS/SAM/NTDS，再列子技术等于同一手法占两个名额。
 * **水位虚高的报告比漏报更坏** —— 它让客户以为覆盖得比实际广。
 *
 * 判据：表里有子技术的父技术，若某技能已列了它的任一子技术，就不许再列父技术。
 * 反向不成立（只列父技术是"标注粗"不是"重复"，可接受，仅输出提示）。
 *
 * 反向探针验过：给 credential-attack 加回一条父技术行 → 立刻报红。
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "skills/redteam");

/** 父技术 → 表里实际存在的子技术（与 lib/redteam/attack-map.js 一致，24 个子技术） */
const PARENT_SUBS = {
  T1003: ["T1003.001", "T1003.002", "T1003.003"],
  T1059: ["T1059.001", "T1059.003", "T1059.004"],
  T1070: ["T1070.004"],
  T1090: ["T1090.001", "T1090.003"],
  T1110: ["T1110.003"],
  T1021: ["T1021.001", "T1021.002", "T1021.004"],
  T1071: ["T1071.001"],
  T1505: ["T1505.003"],
  T1550: ["T1550.002"],
  T1552: ["T1552.001"],
  T1558: ["T1558.001", "T1558.002", "T1558.003", "T1558.004"],
  T1562: ["T1562.001", "T1562.008"],
  T1595: ["T1595.002"],
};

const files = fs.readdirSync(DIR).filter((x) => x.endsWith(".md"));
const problems = [];
const coarse = [];

for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), "utf8");
  const i = text.indexOf("## ATT&CK 映射");
  if (i < 0) continue;
  const seg = text.slice(i);
  const end = seg.indexOf("\n## ", 3);
  const block = end === -1 ? seg : seg.slice(0, end);
  const ids = new Set([...block.matchAll(/\b(T\d{4}(?:\.\d{3})?)\b/g)].map((m) => m[1]));
  if (!ids.size) continue;

  for (const [parent, subs] of Object.entries(PARENT_SUBS)) {
    if (!ids.has(parent)) continue;
    const hitSubs = subs.filter((s) => ids.has(s));
    if (hitSubs.length) {
      problems.push({ file: f, parent, subs: hitSubs });
    } else {
      coarse.push({ file: f, parent, available: subs });
    }
  }
}

if (problems.length) {
  console.log(`[check-attack-precision] ✗ ${problems.length} 处父子技术同时列出（同一手法被算两遍）：`);
  for (const p of problems) {
    console.log(`   ${p.file}：${p.parent} 与 ${p.subs.join(" / ")} 同时存在`);
  }
  console.log("  → 修法：删掉父技术那一行（子技术已表达同一件事），或用子技术替换父技术。");
  console.log("  → 后果：报告里「覆盖 N 个技术」会虚高，让客户以为覆盖面比实际大。");
  process.exit(1);
}

console.log(
  `[check-attack-precision] ✓ ${files.length} 个技能无父子重复标注｜` +
    `父技术标注偏粗的 ${coarse.length} 处（只在输出提示，不判红）`
);
if (coarse.length) {
  const byParent = {};
  for (const c of coarse) (byParent[c.parent] = byParent[c.parent] || []).push(c.file.replace(/\.md$/, ""));
  for (const [p, fl] of Object.entries(byParent)) {
    console.log(`    ${p}：${fl.length} 个技能只标了父技术（表里有子技术可用）`);
  }
}