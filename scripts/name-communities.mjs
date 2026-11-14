/* 给兜底社区起语义名：读社区内节点（文件名 + 标签），用规则+LLM 混合命名。
   为什么不直接用 graphify label：它每次运行都**重新聚类**，社区 id 会变、手工命名被冲掉，
   实测连续两次跑，兜底名从 7 变 4 又变 7（id 全换）。这里只命名，不碰聚类。 */
import fs from "node:fs";
import path from "node:path";
const ROOT = "E:/完成项目/dsh-purge";
const gp = path.join(ROOT, "graphify-out/graph.json");
const lp = path.join(ROOT, "graphify-out/.graphify_labels.json");
const g = JSON.parse(fs.readFileSync(gp, "utf8"));
const labels = JSON.parse(fs.readFileSync(lp, "utf8"));
const isFallback = (s) => /\.(js|mjs|md|json|yml|sh)$/.test(String(s)) || /^Community \d+/.test(String(s));

const byComm = new Map();
for (const n of g.nodes) {
  if (n.community === undefined || n.community === null) continue;
  if (!byComm.has(n.community)) byComm.set(n.community, []);
  byComm.get(n.community).push(n);
}

/* 按目录聚类特征起名：这是最可靠的信号（同一社区的节点几乎总在同一子系统里） */
function inferName(nodes) {
  const files = nodes.map((n) => n.source_file || "").filter(Boolean);
  const dirs = files.map((f) => {
    const p = f.split("/");
    return p.slice(0, Math.min(p.length - 1, 2)).join("/");
  });
  const cnt = new Map();
  for (const d of dirs) cnt.set(d, (cnt.get(d) || 0) + 1);
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
  const labels2 = nodes.map((n) => String(n.label || "")).filter(Boolean);
  const sample = labels2.slice(0, 3).join(" / ");
  if (!top) return null;
  const d = top[0];
  const map = {
    "lib/redteam": "红队事实库",
    "lib": "插件运行时",
    "scripts": "构建与校验脚本",
    "skills/redteam/references": "技能深水区参考",
    "skills/redteam": "红队技能",
    "presets/redteam": "演练预设",
    "bin": "CLI 入口",
    "test": "测试夹具",
  };
  const base = map[d] || d;
  /* 同目录多个社区时用成员特征区分，避免全叫一个名 */
  if (d === "lib/redteam") {
    if (labels2.some((x) => /Tab\(|Panel|View/.test(x))) return "红队控制台面板";
    if (labels2.some((x) => /store|db|prepare|migrate/i.test(x))) return "红队事实库存储层";
    if (labels2.some((x) => /skill/i.test(x))) return "技能索引与可用性";
    if (labels2.some((x) => /report|score/i.test(x))) return "计分与报告生成";
    if (labels2.some((x) => /tunnel|proxy|scope|cidr/i.test(x))) return "范围闸与隧道";
  }
  if (d === "scripts") {
    if (labels2.some((x) => /check|verify|assert/i.test(x))) return "校验闸门脚本";
    if (labels2.some((x) => /build|sync|embed/i.test(x))) return "构建与同步脚本";
  }
  if (d === "skills/redteam") return "红队技能文档";
  return base;
}

let named = 0;
const still = [];
for (const [c, nodes] of byComm) {
  const cur = labels[String(c)] ?? nodes[0]?.community_name;
  if (!isFallback(cur)) continue;
  const nm = inferName(nodes);
  if (nm === null) { still.push(c); continue; }
  /* 重名必须加后缀区分，否则两个社区同名，按名查会串 */
  let final = nm;
  let k = 2;
  while (Object.entries(labels).some(([kk, vv]) => kk !== String(c) && vv === final)) final = `${nm}（${k++}）`;
  labels[String(c)] = final;
  for (const n of nodes) n.community_name = final;
  named += 1;
}
fs.writeFileSync(lp, JSON.stringify(labels, null, 1), "utf8");
fs.writeFileSync(gp, JSON.stringify(g, null, 1), "utf8");

/* 三产物必须一起改。graph.html 生成时就把 community_name 定死了，
   只改 graph.json 会让闸门报「graph.html 缺抽样社区名」。
   实测踩过：命名完 graph.json 全对，html 里还是 81 个旧兜底名 —— 三产物不一致。
   顺序纪律：**graphify cluster 先跑（出 html）→ 再命名 → 再把名字同步进 html**。 */
const hp = path.join(ROOT, "graphify-out/graph.html");
if (fs.existsSync(hp)) {
  const byComm = new Map();
  for (const n of g.nodes) {
    if (n.community !== undefined && n.community_name) byComm.set(String(n.community), n.community_name);
  }
  let html = fs.readFileSync(hp, "utf8");
  let replaced = 0;
  html = html.replace(/"community":\s*(\d+),\s*"community_name":\s*"([^"]*)"/g, (m, c, oldName) => {
    const want = byComm.get(String(c));
    if (want && want !== oldName) { replaced += 1; return `"community": ${c}, "community_name": ${JSON.stringify(want)}`; }
    return m;
  });
  if (replaced) { fs.writeFileSync(hp, html, "utf8"); }
  console.log(`  已同步 ${replaced} 处社区名进 graph.html`);
}
const bad = Object.values(labels).filter(isFallback).length;
console.log(`命名 ${named} 个社区｜仍兜底 ${bad}${still.length ? "｜无特征 " + still.join(",") : ""}`);
