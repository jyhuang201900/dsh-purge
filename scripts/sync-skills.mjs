#!/usr/bin/env node
/**
 * 用途：把仓库 skills/redteam 同步到运行时 ~/.dsh/redteam/skills（幂等，只补缺失+可选覆盖）。
 * 用法：node scripts/sync-skills.mjs           # 同步缺失的（不覆盖已有的运行时改动）
 *      node scripts/sync-skills.mjs --force   # 全量覆盖（仓源为准）
 *      node scripts/sync-skills.mjs --dry     # 只报告差异
 * 依赖：Node ≥18；只读写文件，不碰宿主。
 * 验证：2026-11-10 首跑：仓源 48 / 运行时 32 → 补 16 → 48 一致；--dry 不写盘。
 *
 * 为什么要有它：第 98 轮我把 16 个新技能写进了运行时目录，而 audit / check-package / verify 看的是**仓源**
 * skills/redteam —— 源与运行时各一份、没有同步机制，就是「改了一边另一边不知道」。这个入口把它变成一条命令。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "skills", "redteam");
const dstDir = path.join(os.homedir(), ".dsh", "redteam", "skills");
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dry = argv.includes("--dry");

const list = (d) => {
  try { return fs.readdirSync(d).filter((f) => f.endsWith(".md")); } catch { return []; }
};
const src = list(srcDir);
const dst = new Set(list(dstDir));

const missing = src.filter((f) => !dst.has(f));
const extra = [...dst].filter((f) => !src.includes(f));
const same = force ? src : missing;

if (dry) {
  console.log(`  仓源 ${src.length}｜运行时 ${dst.size}｜待补 ${missing.length}${force ? `（--force 将覆盖全部 ${src.length}）` : ""}｜运行时多余 ${extra.length}`);
  if (missing.length) console.log(`  待补: ${missing.join(", ")}`);
  if (extra.length) console.log(`  运行时多余（仓源已无）: ${extra.join(", ")}`);
  process.exit(0);
}

fs.mkdirSync(dstDir, { recursive: true });
let n = 0;
for (const f of same) {
  fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
  n += 1;
}
console.log(`  已同步 ${n} 个 → ${dstDir.replace(os.homedir(), "~")}｜仓源 ${src.length}｜运行时 ${list(dstDir).length}`);
// 多余的不自动删（可能是用户在运行时加的实验件），只提示——删不删由人定。
if (extra.length) console.log(`  提示：运行时另有 ${extra.length} 个仓源没有的技能（未删除，仅供你判断）：${extra.slice(0, 8).join(", ")}`);