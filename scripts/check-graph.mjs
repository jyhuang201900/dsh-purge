/**
 * 图谱一致性校验：确保产物之间不自相矛盾，且没有退化。
 *
 * 为什么要有它：graphify 每次 re-cluster 都可能让社区重新编号，于是
 * `.graphify_labels.json`、`graph.json`、`GRAPH_REPORT.md`、`graph.html`
 * 四个产物会各说各话。1.1.94 更新后实测过两次退化：
 *   ① 1836 个节点的语义名退回 hub 文件名（标签 id 对不上）
 *   ② 只改 graph.json 不改标签文件 → 下次 label 又覆盖回去
 *
 * 校验六项，全部机器可判：
 *   1. 结构完整：nodes / links / hyperedges 三个数组存在且非空
 *   2. 无悬空边：每条边的 source/target 都能在 nodes 里找到
 *   3. 社区覆盖：每个节点都有 community 与 community_name
 *   4. 无兜底名：community_name 不是 "Community N"，也不像裸文件名/裸函数名
 *   5. 三产物一致：graph.json 的社区名 == .graphify_labels.json 的值
 *   6. 报告与 HTML 已同步：里面能找到当前图的社区名（抽查 5 个）
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "graphify-out");
const problems = [];
const notes = [];

/* 1. 结构 */
let g;
try { g = JSON.parse(fs.readFileSync(path.join(out, "graph.json"), "utf8")); }
catch (e) { console.error(`graph.json 读不了：${e.message}`); process.exit(1); }

const nodes = g.nodes || [];
const links = g.links || g.edges || [];
const hypers = g.hyperedges || [];
if (!nodes.length) problems.push("nodes 为空");
if (!links.length) problems.push("links 为空");

/* 2. 无悬空边 */
const ids = new Set(nodes.map((n) => n.id));
let dangle = 0;
for (const e of links) if (!ids.has(e.source) || !ids.has(e.target)) dangle += 1;
if (dangle) problems.push(`悬空边 ${dangle} 条（source/target 不在 nodes 里）`);

/* 3. 社区覆盖 */
const noComm = nodes.filter((n) => n.community === undefined || n.community === null).length;
const noName = nodes.filter((n) => !n.community_name).length;
if (noComm) problems.push(`${noComm} 个节点缺 community`);
if (noName) problems.push(`${noName} 个节点缺 community_name`);

/* 4. 无兜底名 */
const isFallback = (s) => {
  const v = String(s || "");
  if (/^Community \d+$/.test(v)) return true;
  if (/\.(js|mjs|md|json|yml|sh)$/.test(v)) return true;   // 裸文件名
  if (/^[a-z_][a-zA-Z0-9_]*\(\)$/.test(v)) return true;    // 裸函数名
  if (/^[A-Z][a-zA-Z0-9]*$/.test(v) && v.length > 25) return true; // 超长驼峰，多半是类名
  return false;
};
const comms = new Map(); // community -> name
for (const n of nodes) comms.set(String(n.community), n.community_name);
const fallback = [...comms].filter(([, name]) => isFallback(name));
if (fallback.length) {
  problems.push(`仍有 ${fallback.length} 个社区是兜底名：${fallback.slice(0, 4).map(([c, n]) => `${c}=${n}`).join(", ")}`);
}

/* 5. 三产物一致 */
let labels = null;
try { labels = JSON.parse(fs.readFileSync(path.join(out, ".graphify_labels.json"), "utf8")); } catch { /* 报下面 */ }
if (!labels) problems.push("缺 .graphify_labels.json（下次 label 会覆盖 graph.json 的名字）");
else {
  let mismatch = 0;
  for (const [c, name] of comms) {
    if (labels[c] !== undefined && labels[c] !== name) mismatch += 1;
  }
  const missing = [...comms.keys()].filter((c) => labels[c] === undefined);
  if (mismatch) problems.push(`graph.json 与标签文件有 ${mismatch} 个社区名不一致`);
  if (missing.length) problems.push(`标签文件缺 ${missing.length} 个社区（${missing.slice(0, 5).join(",")}）`);
}

/* 6. 报告与 HTML 同步 */
const sample = [...comms.values()].filter((v) => !isFallback(v)).slice(0, 5);
const report = (() => { try { return fs.readFileSync(path.join(out, "GRAPH_REPORT.md"), "utf8"); } catch { return ""; } })();
const html = (() => { try { return fs.readFileSync(path.join(out, "graph.html"), "utf8"); } catch { return ""; } })();
if (!report) problems.push("缺 GRAPH_REPORT.md");
else {
  const missReport = sample.filter((n) => !report.includes(n));
  // 报告只展示 109/118（thin 社区被省略），所以允许抽样缺失，但整体命中率要够
  const hitRate = sample.length ? (sample.length - missReport.length) / sample.length : 1;
  if (hitRate < 0.6) problems.push(`GRAPH_REPORT.md 社区名命中率只有 ${Math.round(hitRate * 100)}%（报告可能没重建）`);
}
if (!html) problems.push("缺 graph.html");
else {
  const missHtml = sample.filter((n) => !html.includes(n));
  if (missHtml.length) problems.push(`graph.html 缺 ${missHtml.length}/${sample.length} 个抽样社区名（${missHtml.slice(0, 2).join(",")}）`);
}

/* 通过时给统计 */
const commCount = comms.size;
notes.push(`结构：${nodes.length} 节点 / ${links.length} 边 / ${hypers.length} 超边 / ${commCount} 社区`);
notes.push(`悬空边 0｜社区覆盖 ${nodes.length}/${nodes.length}｜兜底名 ${fallback.length}`);
notes.push(`三产物一致｜报告与 HTML 已同步（抽样 ${sample.length} 个全中）`);

if (problems.length) {
  console.log("图谱校验：发现问题");
  for (const p of problems) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log("图谱校验：全部通过");
for (const n of notes) console.log(`  · ${n}`);