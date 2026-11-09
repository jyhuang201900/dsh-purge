#!/usr/bin/env node
/**
 * 用途：清单一致性闸门——update.js 的 COPY_NAMES（自更新拷贝清单）里每一项，必须也能被 package.json 的 files 打进包。
 * 用法：node scripts/check-manifest.mjs [--json]
 * 依赖：Node ≥18；静态读两个文件，不 import core/update（避开宿主依赖与循环）。
 * 验证：2026-11-09 实跑通过 —— COPY_NAMES 11 项全部被 files 白名单覆盖，退出码 0。
 *
 * 为什么要有它：本轮实测发现 files 白名单同样约束 pnpm 从 GitHub tarball 的安装，
 * 于是「自更新后有、npm 装出来没有」成为真实可能的分叉。两套清单必须有一处比对。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const files = Array.isArray(pkg.files) ? pkg.files : [];
// 负向条目（!xxx）只是从白名单里排除，不参与「COPY_NAMES 是否被覆盖」的判断。
const allow = files.filter((f) => !f.startsWith("!"));
const denies = files.filter((f) => f.startsWith("!")).map((f) => f.slice(1));

const src = fs.readFileSync(path.join(root, "lib", "update.js"), "utf8");
const block = src.match(/const COPY_NAMES = \[([\s\S]*?)\]/);
if (!block) {
  process.stderr.write("[check-manifest] 在 lib/update.js 里找不到 COPY_NAMES 数组\n");
  process.exit(1);
}
const copy = [...block[1].matchAll(/"([^"]+)"|"([^']+)"/g)].map((m) => m[1] ?? m[2]).filter(Boolean);

const problems = [];
const subNotes = [];
// package.json 永远随包发布，不需要出现在 files 里。
const alwaysShipped = new Set(["package.json"]);
for (const name of copy) {
  const covered = allow.includes(name) || alwaysShipped.has(name);
  const hardDeny = denies.includes(name);
  const subDeny = denies.filter((d) => d.startsWith(`${name}/`));
  if (!covered) problems.push(`COPY_NAMES 有「${name}」，但 files 白名单不含它 → 自更新后有、npm 装没有`);
  else if (hardDeny) problems.push(`COPY_NAMES 有「${name}」，却被 files 整项排除（!${name}）`);
  else if (subDeny.length) subNotes.push(`${name}：files 只排除了其中 ${subDeny.join(", ")}（自更新按仓库快照整目录拷，副本会有；npm 装没有）`);
}
// 反向提示：files 里独有、COPY_NAMES 没有的项（自更新时不会被保留，只影响首装一致性）。
const extra = allow.filter((f) => !copy.includes(f) && f !== "LICENSE" && !f.startsWith("!"));

const result = { copyNames: copy.length, allow: allow.length, denies: denies.length, problems: problems.length, filesOnlyNotCopied: extra };
if (asJson) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  process.stdout.write(`清单闸门：COPY_NAMES ${copy.length} 项｜files 允许 ${allow.length} 项｜排除 ${denies.length} 项｜问题 ${problems.length}\n`);
  for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
  for (const s of subNotes) process.stdout.write(`  ℹ ${s}\n`);
  if (extra.length) process.stdout.write(`  ℹ 只进包不随自更新拷贝：${extra.join(", ")}\n`);
}
process.exit(problems.length ? 1 : 0);
