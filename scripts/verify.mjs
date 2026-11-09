#!/usr/bin/env node
/**
 * 用途：发版前一键自检——语法、体积预算、JSON 合法性三关一起过（替代 README 里那串手工 node --check）。
 * 用法：node scripts/verify.mjs [--root PATH] [--skip-size]     # 默认跑全部三关
 * 依赖：Node ≥18；内部调用 node --check 与 scripts/check-size.mjs，零第三方包。
 * 验证：2026-11-09 在 dsh-purge 实跑通过（exit=0）—— 语法 62 个文件全绿、体积 62 文件 0 超预算、JSON 14/14 合法。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipSize = argv.includes("--skip-size");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const failures = [];
const notes = [];

// 关 1：语法。逐个 node --check，失败即记文件名（不中断，一次看全）。
const files = walk(root);
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failures.push(`语法 ${path.relative(root, file)}: ${(res.stderr || "").split("\n")[0]}`);
  }
}
notes.push(`语法：${files.length} 个文件，失败 ${failures.length}`);

// 关 2：体积预算（交给 check-size.mjs，单一来源，不在这儿重写规则）。
if (!skipSize) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-size.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").pop() || "";
  if (res.status !== 0) failures.push(`体积闸门未过：${tail}`);
  else notes.push(`体积：${tail}`);
}

// 关 3：JSON 合法性——package.json + 图谱语义层手写件。
const jsons = ["package.json", "screenshots.json"]
  .filter((f) => fs.existsSync(path.join(root, f)))
  .concat(fs.readdirSync(path.join(root, "graphify-out", "semantic")).filter((f) => f.endsWith(".json")).map((f) => `graphify-out/semantic/${f}`));
let parsed = 0;
for (const rel of jsons) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    parsed += 1;
  } catch (e) {
    failures.push(`JSON ${rel}: ${e.message}`);
  }
}
notes.push(`JSON：${parsed}/${jsons.length} 合法`);

for (const line of notes) process.stdout.write(`  ${line}\n`);
for (const line of failures) process.stderr.write(`  ✗ ${line}\n`);
process.stdout.write(failures.length ? `[verify] 未通过：${failures.length} 项\n` : "[verify] 全部通过 ✓\n");
process.exit(failures.length ? 1 : 0);
