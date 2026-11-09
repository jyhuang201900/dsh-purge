#!/usr/bin/env node
/**
 * 用途：图谱孤儿审计——用 graphify-out/graph.json 找「没有任何入边、且文档/清单也没点过名」的代码文件。
 * 用法：node scripts/graph-audit.mjs [--json]
 * 依赖：Node ≥18；只读图谱与仓库文本，不跑 graphify、不碰宿主。
 * 验证：2026-11-09 首跑：74 个代码文件、零入边 1 个（lib/reapply-cli.js），按"名分规则"它当时未进文档 → 报孤儿；补进 README 后归零。
 *
 * 规则要讲清楚，否则这道门自己就是玄学：
 *   · 入边 > 0            → 有人引用，活文件；
 *   · 入边 = 0 但被 README / package.json 点名 → 有名分（手动 CLI、入口壳）；
 *   · 入边 = 0 且无人提名 → 孤儿，报出来（要么删，要么给名分）。
 * 新鲜度守卫：图谱是我手动 `npm run graphify` 刷的，比源码旧就只警告不判红 —— 门不许拿过期数据说谎。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
const graphPath = path.join(root, "graphify-out", "graph.json");
if (!fs.existsSync(graphPath)) {
  console.log("图谱审计：没有 graphify-out/graph.json（先 npm run graphify）");
  process.exit(1);
}
const g = JSON.parse(fs.readFileSync(graphPath, "utf8"));
const nodes = g.nodes || [];
const links = g.links || g.edges || [];

// 新鲜度：图谱 mtime vs 最近修改的源码文件
const graphMtime = fs.statSync(graphPath).mtimeMs;
const srcMtimes = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(js|mjs|cjs|ts)$/.test(e.name)) srcMtimes.push(fs.statSync(f).mtimeMs);
  }
};
walk(root);
const newestSrc = srcMtimes.length ? Math.max(...srcMtimes) : 0;
const stale = newestSrc > graphMtime;

const inbound = new Map();
for (const e of links) inbound.set(e.target, (inbound.get(e.target) || 0) + 1);
const fileInbound = new Map();
for (const n of nodes) {
  const f = String(n.source_file || "");
  if (!/\.(js|mjs|cjs|ts)$/.test(f)) continue;
  fileInbound.set(f, (fileInbound.get(f) || 0) + (inbound.get(n.id) || 0));
}
// 名分来源：README（三语）+ package.json 全文
const namedIn = ["README.md", "README.zh-CN.md", "README.en.md", "package.json"].filter((rel) => fs.existsSync(path.join(root, rel)))
  .map((rel) => fs.readFileSync(path.join(root, rel), "utf8"));
const hasName = (f) => {
  const base = path.basename(f);
  const stem = base.replace(/\.[^.]+$/, "");
  return namedIn.some((txt) => txt.includes(base) || txt.includes(stem));
};
const orphans = [...fileInbound.entries()]
  .filter(([f, deg]) => deg === 0 && !hasName(f))
  .map(([f]) => f)
  .sort();
const known = [...fileInbound.entries()].filter(([f, deg]) => deg === 0 && hasName(f)).map(([f]) => f).sort();

if (asJson) {
  process.stdout.write(JSON.stringify({ files: fileInbound.size, orphanish: known, orphans, stale }, null, 1) + "\n");
} else {
  console.log(`图谱审计：代码文件 ${fileInbound.size} 个｜零入边但有名分（手动 CLI/入口）${known.length} 个${known.length ? `：${known.join(", ")}` : ""}`);
  console.log(`  真孤儿（零入边且无人提名）: ${orphans.length ? orphans.join(", ") : "0 ✓"}`);
  if (stale) console.log("  ⚠ 图谱比源码旧：先 npm run graphify 再判（本轮只警告不判红）");
}
process.exit(orphans.length > 0 && !stale ? 1 : 0);
