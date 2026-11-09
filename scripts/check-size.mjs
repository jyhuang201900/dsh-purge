#!/usr/bin/env node
/**
 * 用途：单文件体积闸门——防止 core.js / client.js 无约束长胖（借鉴 dsh-ops 的 check:size）。
 * 用法：node scripts/check-size.mjs [--max-default 200] [--json]   # 预算见 BUDGETS，单位 KB
 * 依赖：Node ≥18，零第三方包。
 * 验证：2026-11-09 在 dsh-purge 实跑通过 —— client.js 509KB / core.js 342KB 全在预算内，退出码 0。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// 已知大文件给显式预算（KB），其余文件用默认值。预算按「现状 + 增长余量」定，不是理想值。
const BUDGETS = {
  "client.js": 560,
  "lib/core.js": 420,
  "lib/index.js": 176,
  "lib/desktop.js": 96,
  "lib/redteam/store-core.js": 400,
  "lib/redteam/client.js": 320,
  "lib/redteam/ui.js": 200,
  "lib/redteam/tools.js": 160,
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argNum = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const maxDefault = argNum("max-default", 200);
const asJson = argv.includes("--json");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rows = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const kb = fs.statSync(file).size / 1024;
  const limit = BUDGETS[rel] ?? maxDefault;
  rows.push({ file: rel, kb: Math.round(kb * 10) / 10, limit, over: kb > limit });
}
rows.sort((a, b) => b.kb - a.kb);
const over = rows.filter((r) => r.over);

if (asJson) {
  process.stdout.write(`${JSON.stringify({ checked: rows.length, over }, null, 2)}\n`);
} else {
  for (const r of over) process.stdout.write(`超预算 ${r.file}: ${r.kb}KB > ${r.limit}KB\n`);
  process.stdout.write(`体积闸门：${rows.length} 个文件，超预算 ${over.length} 个（默认上限 ${maxDefault}KB）\n`);
}
process.exit(over.length ? 1 : 0);
