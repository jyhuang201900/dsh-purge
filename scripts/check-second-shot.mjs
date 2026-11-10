#!/usr/bin/env node
/**
 * 用途：第二发覆盖率——军规要求「每发至少两条失败分支」，这关量技能里到底有几条。
 * 用法：node scripts/check-second-shot.mjs [--json] [--min N]
 * 依赖：Node ≥18；只读技能正文，不联网。
 *
 * 判据（量尺必须匹配契约，否则数字会说谎）：
 *   军规的「两条失败分支」= 打不出去时**能换的第二条、第三条路**，不是「出现两次『被拦』字样」。
 *   所以按**分支条目**数：在一个失败分支小节内，数带编号（1./2.）或项目符号（-/·/→）的条目，
 *   直到下一个同级标题为止。≥2 条即合格。
 *   第一版量尺只数「含被拦/无回显等关键词的行」，于是生成块里 3 条分支只被数成 1 条、
 *   合格数被压到 9（实测），与军规口径不符——量尺错了会让改进看起来没发生。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const asJson = process.argv.includes("--json");
const minIdx = process.argv.indexOf("--min");
const MIN = minIdx > 0 ? Number(process.argv[minIdx + 1]) || 2 : 2;
const root = process.cwd();
const SKILLS = path.join(root, "skills", "redteam");

import { countBranches } from "./lib/skill-quality.mjs";

const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
const rows = [];
for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(SKILLS, f), "utf8");
  const { branches, sawSection } = countBranches(text);
  rows.push({ id, branches, sawSection });
}

const qualified = rows.filter((r) => r.branches >= MIN);
const weak = rows.filter((r) => r.branches < MIN);
const noSection = rows.filter((r) => !r.sawSection);

if (asJson) {
  process.stdout.write(JSON.stringify({
    skills: rows.length, min: MIN, qualified: qualified.length, weak: weak.length, noSection: noSection.length,
    histogram: rows.reduce((m, r) => { const k = String(Math.min(r.branches, 6)); m[k] = (m[k] || 0) + 1; return m; }, {}),
    weakest: weak.sort((a, b) => a.branches - b.branches).slice(0, 20).map((r) => ({ id: r.id, branches: r.branches })),
  }, null, 1) + "\n");
} else {
  console.log(`第二发覆盖率：技能 ${rows.length} 个｜门槛 ≥${MIN} 条分支`);
  console.log(`  ★ 合格 ${qualified.length}｜偏弱 ${weak.length}｜连小节都没有 ${noSection.length}`);
  const hist = rows.reduce((m, r) => { const k = Math.min(r.branches, 6); m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`  分支数分布: ` + Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}${Number(k) === 6 ? "+" : ""}条:${v}`).join("  "));
  if (weak.length) console.log(`  最弱一批: ` + weak.sort((a, b) => a.branches - b.branches).slice(0, 10).map((r) => `${r.id}(${r.branches})`).join(", "));
}
process.exit(weak.length ? 1 : 0);
