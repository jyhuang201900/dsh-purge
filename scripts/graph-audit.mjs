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

// 度数只算「真实使用」类边。图谱里 contains/method 是结构边（文件 → 它自己的符号），
// 把它算进"被谁读"会让每个导出白得 1 条入边 —— 阳性对照（加一个没人用的导出）就是这么被糊过去的。
const USAGE_REL = new Set(["calls", "references", "imports", "imports_from", "indirect_call", "references_file"]);
const inbound = new Map();
for (const e of links) inbound.set(e.target, (inbound.get(e.target) || 0) + 1); // 文件级用全边（含结构边也无妨：contains 只在同文件内部）
// 文件级孤儿仍用全边（结构边不影响"有没有别的文件指向它"的判断，因为 contains 是同名 source_file 内部边）
const fileInbound = new Map();
for (const n of nodes) {
  const f = String(n.source_file || "");
  if (!/\.(js|mjs|cjs|ts)$/.test(f)) continue;
  fileInbound.set(f, (fileInbound.get(f) || 0) + (inbound.get(n.id) || 0));
}
const usageInbound = new Map();
for (const e of links) {
  if (!USAGE_REL.has(String(e.relation))) continue;
  usageInbound.set(e.target, (usageInbound.get(e.target) || 0) + 1);
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

// 2) 导出健康度：导出了却没人读的符号 = 「记了但没人读」的门版（MEMORY 里的老教训）。
//    覆盖率也要报：图谱认不出的导出（改名/动态用法）不算证据，只能算盲区。
const inboundByFile = new Map();
for (const n of nodes) {
  const f = String(n.source_file || "");
  if (!f) continue;
  if (!inboundByFile.has(f)) inboundByFile.set(f, []);
  inboundByFile.get(f).push(n);
}
const exportRe = /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_]\w*)/g;
let expTotal = 0;
let expMatched = 0;
const deadExports = [];
for (const [f, ns] of inboundByFile) {
  if (!/\.(js|mjs|cjs)$/.test(f)) continue;
  let txt = "";
  try { txt = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
  const names = [...txt.matchAll(exportRe)].map((m) => m[1]);
  for (const nm of names) {
    expTotal += 1;
    const hit = ns.find((n) => String(n.id).toLowerCase().endsWith("_" + nm.toLowerCase()));
    if (!hit) continue;
    expMatched += 1;
    if ((usageInbound.get(hit.id) || 0) === 0) deadExports.push(`${f} → ${nm}`);
  }
}
const coverage = expTotal ? Math.round((100 * expMatched) / expTotal) : 0;
// 假阳性测定：本项目大量用 `core.xxx()` / `updater.xxx()` 命名空间式调用，AST 边解析不到，
// 所以「零使用导出」只能当线索而不是判据。这里用源码文本反查，把图谱的盲区率量出来。
const repoText = new Map();
for (const f of fileInbound.keys()) {
  try { repoText.set(f, fs.readFileSync(path.join(root, f), "utf8")); } catch { }
}
const graphBlind = deadExports.filter((z) => {
  const own = z.split(" → ")[0];
  const nm = z.split(" → ")[1];
  const rx = new RegExp(`\\b[A-Za-z_$]\\w*\\.${nm}\\b|\\b${nm}\\s*\\(`);
  for (const [f, txt] of repoText) {
    if (f === own) continue;
    if (rx.test(txt)) return true;
  }
  return false;
});
const realDead = deadExports.filter((z) => !graphBlind.includes(z));
// 再分一类：只在本文件用到的 = 导出冗余（不是死代码）；连本文件都不用的 = 真没人用。
const redundant = [];
const unused = [];
for (const z of realDead) {
  const [f, nm] = z.split(" → ");
  const txt = repoText.get(f) || "";
  const ownCount = (txt.match(new RegExp(`\\b${nm}\\b`, "g")) || []).length;
  if (ownCount > 1) redundant.push(nm); else unused.push(nm);
}

if (asJson) {
  process.stdout.write(JSON.stringify({ files: fileInbound.size, orphanish: known, orphans, stale, expTotal, expMatched, coverage, deadExports }, null, 1) + "\n");
} else {
  console.log(`图谱审计：代码文件 ${fileInbound.size} 个｜零入边但有名分（手动 CLI/入口）${known.length} 个${known.length ? `：${known.join(", ")}` : ""}`);
  console.log(`  真孤儿（零入边且无人提名）: ${orphans.length ? orphans.join(", ") : "0 ✓"}`);
  console.log(`  导出健康度（线索，不判红）：${expTotal} 个导出、可匹配 ${expMatched}（覆盖 ${coverage}%）｜零使用边 ${deadExports.length} 个，其中 ${graphBlind.length} 个在别的文件里确有调用 → 图谱看不见 ns.fn() 式调用（盲区率 ${deadExports.length ? Math.round((100 * graphBlind.length) / deadExports.length) : 0}%）`);
  if (realDead.length) console.log(`    去掉盲区后无外部调用者 ${realDead.length} 个：其中「只在本文件用（导出冗余）」${redundant.length} 个 [${redundant.slice(0, 6).join(", ")}]${redundant.length > 6 ? " ..." : ""}｜「连本文件都不用（真没人用）」${unused.length} 个 [${unused.slice(0, 6).join(", ")}]${unused.length > 6 ? " ..." : ""}`);
  if (coverage < 80) console.log("  ⚠ 图谱对导出的识别率低于 80%，这项结论只是参考（先 npm run graphify）");
  if (stale) console.log("  ⚠ 图谱比源码旧：先 npm run graphify 再判（本轮只警告不判红）");
}
// 只有真孤儿判红；导出维度是线索（图谱对 ns.fn() 有盲区，判红会天天误报）。
process.exit(orphans.length > 0 && !stale ? 1 : 0);
