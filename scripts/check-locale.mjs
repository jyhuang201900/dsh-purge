#!/usr/bin/env node
/**
 * 用途：双语文案闸门——client.js 里中英两份字典的 key 集合必须一模一样（少一边就是缺胳膊少腿）。
 * 用法：node scripts/check-locale.mjs [--file client.js] [--expect-blocks 2] [--json]
 * 依赖：Node ≥18，零第三方包。字典块按「连续 `"a.b": "…"` 行」发现，不靠硬编码行号。
 * 验证：2026-11-09 实跑通过 —— 发现恰好 2 块 × 328 key，双向差集 0，块内无重复 key。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const file = path.resolve(root, arg("file", "client.js"));
const expectBlocks = Number(arg("expect-blocks", 2));
const asJson = argv.includes("--json");
const MIN_BLOCK = 20; // 小于这个数的是散落的对象字面量，不算字典块

function fail(msg) {
  process.stderr.write(`[check-locale] ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(file)) fail(`找不到文件：${path.relative(root, file)}`);

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
const entry = /^[\t ]+"([A-Za-z][A-Za-z0-9_.]*)":\s*["'`]/;
const blocks = [];
let cur = null;
for (let i = 0; i < lines.length; i += 1) {
  const m = entry.exec(lines[i]);
  if (m) {
    if (cur && i === cur.end + 1) {
      cur.end = i;
      cur.keys.push(m[1]);
    } else {
      if (cur) blocks.push(cur);
      cur = { start: i, end: i, keys: [m[1]] };
    }
  } else if (cur && lines[i].trim() !== "" && i > cur.end + 1) {
    blocks.push(cur);
    cur = null;
  }
}
if (cur) blocks.push(cur);

const dicts = blocks.filter((b) => b.keys.length >= MIN_BLOCK);
if (dicts.length !== expectBlocks) {
  fail(`字典块数 ${dicts.length}，期望 ${expectBlocks}（${dicts.map((d) => `L${d.start + 1}-${d.end + 1}:${d.keys.length}key`).join(", ") || "无"}）；结构变了要人工确认，别改期望值蒙过去`);
}

const problems = [];
const sets = dicts.map((d) => new Set(d.keys));
dicts.forEach((d, i) => {
  const seen = new Set();
  const dup = [];
  for (const k of d.keys) {
    if (seen.has(k)) dup.push(k);
    seen.add(k);
  }
  if (dup.length) problems.push(`块 ${i + 1}（L${d.start + 1}-${d.end + 1}）内重复 key: ${[...new Set(dup)].join(", ")}`);
});

const base = sets[0];
dicts.slice(1).forEach((d, idx) => {
  const i = idx + 1;
  const onlyBase = [...base].filter((k) => !sets[i].has(k));
  const onlyThis = [...sets[i]].filter((k) => !base.has(k));
  if (onlyBase.length) problems.push(`块 ${i + 1} 缺 key ${onlyBase.length} 个：${onlyBase.slice(0, 12).join(", ")}${onlyBase.length > 12 ? " …" : ""}`);
  if (onlyThis.length) problems.push(`块 ${i + 1} 多 key ${onlyThis.length} 个：${onlyThis.slice(0, 12).join(", ")}${onlyThis.length > 12 ? " …" : ""}`);
});

const summary = dicts.map((d, i) => `块${i + 1}=L${d.start + 1}-${d.end + 1}:${d.keys.length}key`).join(" ");
if (asJson) {
  process.stdout.write(`${JSON.stringify({ file: path.relative(root, file), blocks: dicts.length, keys: dicts.map((d) => d.keys.length), problems }, null, 2)}\n`);
} else {
  process.stdout.write(`双语闸门：${path.relative(root, file)}｜${summary}｜问题 ${problems.length}\n`);
  for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
}
process.exit(problems.length ? 1 : 0);
