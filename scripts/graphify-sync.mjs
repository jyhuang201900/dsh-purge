// graphify-sync.mjs — 把 graphify-out/semantic/*.json 语义层合进 AST 基线，重出 graph.json。
// 用法：node scripts/graphify-sync.mjs [--root PATH] [--no-fold-rationale] [--cluster] [--dry-run]
// 依赖：Node ≥18（零第三方包）；--cluster 需 PATH 上有 graphify 0.9.x。
// 验证：2026-11-09 在 dsh-purge 实跑通过 —— 1943 节点 / 5150 边（语义层 299），悬空边 0，
//       弱连语义节点 46 → 0，折叠 rationale 26 条、转移其边 11 条，重跑 graph.json MD5 不变。
//
// 职责单一：只做「语义层 → 抽取态 graph.json」的合并与守门，聚类/出图交给 graphify cluster-only。
// 幂等：AST 基线冻结在 graphify-out/ast-baseline.json，重跑不会累加语义边。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FILE_TYPES = new Set(["code", "document", "paper", "image", "rationale", "concept"]);
const INFERRED_OK = new Set([0.95, 0.85, 0.75, 0.65, 0.55]);
const ROOT_DEFAULT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const opts = { root: ROOT_DEFAULT, foldRationale: true, cluster: false, dryRun: false, refreshBaseline: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root") { opts.root = path.resolve(argv[i + 1] ?? "."); i += 1; }
    else if (a === "--no-fold-rationale") opts.foldRationale = false;
    else if (a === "--cluster") opts.cluster = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--refresh-baseline") opts.refreshBaseline = true;
    else { fail(`未知参数：${a}`); }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write(`[graphify-sync] ${msg}\n`);
  process.exit(1);
}

function warn(msg) {
  process.stderr.write(`[graphify-sync] warn: ${msg}\n`);
}

// graphify 有两种 schema：extract 后是 edges，cluster-only 后是 links。统一读成 edges。
function edgesOf(graph) {
  return Array.isArray(graph.edges) ? graph.edges : (Array.isArray(graph.links) ? graph.links : []);
}

function hyperEdgesOf(graph) {
  if (Array.isArray(graph.hyperedges)) return graph.hyperedges;
  if (graph.graph && Array.isArray(graph.graph.hyperedges)) return graph.graph.hyperedges;
  return [];
}

// 相对化 source_file：语义层写的是绝对路径，AST 侧是仓库相对路径；不统一会在增量重抽时配不上。
function relativize(value, root) {
  if (typeof value !== "string" || !value) return value;
  const norm = value.replace(/\\/g, "/");
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
  return norm.startsWith(base) ? norm.slice(base.length) : norm;
}

function isSemantic(obj) {
  return obj && obj._origin === "semantic";
}

function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`${path.basename(file)} 解析失败：${e.message}`);
  }
  return null;
}

// 基线 = 纯 AST。第一次没有基线时，从当前 graph.json 剔掉语义层冻结出来并**落盘**。
function ensureBaseline(outDir, root) {
  const baseFile = path.join(outDir, "ast-baseline.json");
  if (fs.existsSync(baseFile)) return { baseline: loadJson(baseFile), created: false };

  const current = loadJson(path.join(outDir, "graph.json"));
  if (!current) fail(`${baseFile} 与 graph.json 都不存在；先跑 graphify extract . --code-only --no-cluster`);

  const semanticIds = new Set(current.nodes.filter(isSemantic).map((n) => n.id));
  const baseline = {
    // 基线只留抽取态字段：社区与 community_name 属于聚类产物，带进来会逐轮漂移
    nodes: current.nodes.filter((n) => !isSemantic(n)).map((n) => {
      const { community, community_name, ...rest } = n;
      void community; void community_name;
      return rest;
    }),
    edges: edgesOf(current).filter((e) => !isSemantic(e)),
    hyperedges: hyperEdgesOf(current).filter((h) => !(h.nodes || []).some((id) => semanticIds.has(id))),
    input_tokens: 0,
    output_tokens: 0,
  };
  fs.writeFileSync(baseFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  return { baseline, created: true, dropped: semanticIds.size };
}

/**
 * 把 `skills/redteam/references/*.md` 作为节点注入，并连上「技能 → 它引用的 references」边。
 *
 * 为什么必须补这一步：graphify 的抽取只到**第 3 层路径**（`lib/redteam/x.js`、`skills/redteam/x.md`），
 * 而 references 在第 4 层（`skills/redteam/references/x.md`）。实测 117 篇、93.7 万字**一篇都没进图** ——
 * 技能 md 119/119 全在，references 0/117。
 *
 * 后果不是"少几个节点"，而是**技能与深水区的逻辑联系在图谱上不存在**：
 * 问"这个技能的依据在哪"、按图谱找"改了 references 会影响谁"，全都查不到。
 *
 * 只在图里补**结构关系**（节点+边），不读正文 —— 正文抽取仍交给 graphify，
 * 这里不重复它的职责，只把它漏掉的那层接回来。
 */
function injectReferenceEdges(graph, root) {
  const skillsDir = path.join(root, "skills", "redteam");
  const refDir = path.join(skillsDir, "references");
  if (!fs.existsSync(refDir)) return { nodes: 0, edges: 0 };
  const byId = graph.byId || new Map(graph.nodes.map((n) => [n.id, n]));
  let addedNodes = 0;
  let addedEdges = 0;

  /* references 文件名 → 节点（标题取一级标题或文件名） */
  const refNodes = new Map();
  for (const f of fs.readdirSync(refDir).filter((x) => x.endsWith(".md"))) {
    const rel = `skills/redteam/references/${f}`;
    const id = `ref:${f.replace(/\.md$/, "")}`;
    if (byId.has(id)) { refNodes.set(f.replace(/\.md$/, ""), id); continue; }
    let title = f.replace(/\.md$/, "");
    try {
      const head = fs.readFileSync(path.join(refDir, f), "utf8").split(/\r?\n/).find((l) => /^#\s+/.test(l));
      if (head) title = head.replace(/^#\s+/, "").trim().slice(0, 60);
    } catch { /* 读不到就用文件名 */ }
    const node = {
      id, label: title, community: undefined, community_name: undefined,
      file_type: "markdown", source_file: rel, source_location: "1",
      _origin: "reference", norm_label: title.toLowerCase(),
    };
    graph.nodes.push(node);
    byId.set(id, node);
    refNodes.set(f.replace(/\.md$/, ""), id);
    addedNodes += 1;
  }

  /* 技能 md → 扫正文里的 `references/<x>.md` 或 `<refs>/<skill>/<x>.md` 引用 */
  for (const n of graph.nodes) {
    if (!n.source_file || !n.source_file.startsWith("skills/redteam/") || !n.source_file.endsWith(".md")) continue;
    if (n.source_file.includes("/references/")) continue;
    let body = "";
    try { body = fs.readFileSync(path.join(root, n.source_file), "utf8"); } catch { continue; }
    const seen = new Set();
    /* 两种布局都要认（闸门 check-references 两种都收，这里必须一致）：
         扁平   references/<file>.md
         独立   references/<skill-id>/<file>.md
       实测踩过：正则只写 `references/([A-Za-z0-9._-]+)\.md`（不含斜杠），
       `references/http-smuggling/payload-library.md` 这类 2 处引用一条边都建不出来 ——
       图上看就是"这个技能没有深水区"，而实际有。 */
    for (const m of body.matchAll(/references\/([A-Za-z0-9._/-]+)\.md/g)) {
      const rel = m[1];
      const base = rel.includes("/") ? rel.split("/").pop() : rel;
      const tid = refNodes.get(base) ?? refNodes.get(rel.replace(/\//g, "-"));
      if (tid === undefined || seen.has(tid)) continue;
      seen.add(tid);
      graph.edges.push({ source: n.id, target: tid, relation: "references", _origin: "reference", source_file: n.source_file });
      addedEdges += 1;
    }
  }
  return { nodes: addedNodes, edges: addedEdges };
}

function merge(baseline, semanticFiles, root) {
  const nodes = baseline.nodes.slice();
  const edges = baseline.edges.slice();
  const hyperedges = baseline.hyperedges.slice();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seenHyper = new Set(hyperedges.map((h) => h.id));
  const stats = { nodes: 0, edges: 0, hyper: 0, dupNode: 0, dupHyper: 0 };

  for (const file of semanticFiles) {
    const doc = loadJson(file);
    if (!doc) { warn(`读不到 ${file}，跳过`); continue; }
    for (const n of doc.nodes ?? []) {
      n._origin = "semantic";
      n.source_file = relativize(n.source_file, root);
      if (byId.has(n.id)) {
        // 同名节点：语义层覆盖 AST 之外的字段，但绝不静默丢弃
        const prev = byId.get(n.id);
        if (prev._origin === "semantic") { stats.dupNode += 1; continue; }
        warn(`节点 id ${n.id} 与 AST 节点撞名，保留 AST 侧`);
        stats.dupNode += 1;
        continue;
      }
      byId.set(n.id, n);
      nodes.push(n);
      stats.nodes += 1;
    }
    for (const e of doc.edges ?? []) {
      e._origin = "semantic";
      e.source_file = relativize(e.source_file, root);
      edges.push(e);
      stats.edges += 1;
    }
    for (const h of doc.hyperedges ?? []) {
      h._origin = "semantic";
      h.source_file = relativize(h.source_file, root);
      h.nodes = (h.nodes ?? []).map((id) => id);
      if (seenHyper.has(h.id)) { stats.dupHyper += 1; continue; }
      seenHyper.add(h.id);
      hyperedges.push(h);
      stats.hyper += 1;
    }
  }
  return { nodes, edges, hyperedges, byId, stats };
}

// 上游规范：rationale 是节点属性，不是独立节点。把只挂一条 rationale_for 边的 rationale 折回父节点。
// 折叠不是删除：该节点身上的其它边一律转移给父节点，超边成员同理，去重后不丢语义。
function foldRationale(merged) {
  const out = { folded: 0, kept: 0, orphans: [], redirected: 0, deduped: 0, hyperFixed: 0 };
  const parentOf = new Map();
  for (const e of merged.edges) {
    if (e.relation === "rationale_for") parentOf.set(e.source, e.target);
  }
  const byId = merged.byId;
  const foldMap = new Map();
  for (const n of merged.nodes) {
    if (n.file_type !== "rationale") continue;
    const parentId = parentOf.get(n.id);
    const parent = parentId ? byId.get(parentId) : null;
    if (!parent || parent.file_type === "rationale") { out.orphans.push(n.id); out.kept += 1; continue; }
    parent.rationale = parent.rationale ? `${parent.rationale} 另注：${n.label}` : n.label;
    foldMap.set(n.id, parentId);
    out.folded += 1;
  }

  merged.nodes = merged.nodes.filter((n) => !foldMap.has(n.id));
  for (const id of foldMap.keys()) byId.delete(id);

  const keep = [];
  const seen = new Map();
  for (const e of merged.edges) {
    const source = foldMap.get(e.source) ?? e.source;
    const target = foldMap.get(e.target) ?? e.target;
    if (foldMap.has(e.source) && e.relation === "rationale_for" && target === foldMap.get(e.source)) continue;
    const touched = foldMap.has(e.source) || foldMap.has(e.target);
    const key = `${source}|${target}|${e.relation}`;
    if (!touched) {
      // 与折叠无关的边（含 AST 平行边）原样保留，只登记 key 供折叠边去重
      if (!seen.has(key)) seen.set(key, keep.length);
      keep.push(e);
      continue;
    }
    if (source === target) continue;
    if (source !== e.source || target !== e.target) out.redirected += 1;
    const prev = seen.get(key);
    if (prev !== undefined && prev !== null) {
      out.deduped += 1;
      const cur = keep[prev];
      if (foldMap.has(cur.source) || foldMap.has(cur.target) || cur.source === source) {
        if ((e.confidence_score ?? 0) > (cur.confidence_score ?? 0)) keep[prev] = { ...e, source, target };
      } else {
        keep.push({ ...e, source, target });
        seen.set(key, keep.length - 1);
      }
      continue;
    }
    seen.set(key, keep.length);
    keep.push({ ...e, source, target });
  }
  merged.edges = keep;

  const hyper = [];
  for (const h of merged.hyperedges) {
    const ids = (h.nodes ?? []).map((id) => foldMap.get(id) ?? id);
    const uniq = [...new Set(ids)];
    if (uniq.length !== (h.nodes ?? []).length) out.hyperFixed += 1;
    if (uniq.length < 2) { warn(`超边 ${h.id} 折叠后只剩 ${uniq.length} 个成员，丢弃`); continue; }
    hyper.push({ ...h, nodes: uniq });
  }
  merged.hyperedges = hyper;
  return out;
}

function validate(merged) {
  const ids = new Set(merged.nodes.map((n) => n.id));
  const errors = [];
  const dangle = merged.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  for (const e of dangle.slice(0, 10)) errors.push(`悬空边 ${e.source} -[${e.relation}]-> ${e.target}`);
  if (dangle.length > 10) errors.push(`…另有 ${dangle.length - 10} 条悬空边`);

  const badType = merged.nodes.filter((n) => n._origin === "semantic" && !FILE_TYPES.has(n.file_type));
  for (const n of badType.slice(0, 5)) errors.push(`非法 file_type "${n.file_type}" @ ${n.id}`);

  const semEdges = merged.edges.filter((e) => e._origin === "semantic");
  const noScore = semEdges.filter((e) => typeof e.confidence_score !== "number");
  if (noScore.length) errors.push(`${noScore.length} 条语义边缺 confidence_score`);

  const lazyInferred = semEdges.filter(
    (e) => e.confidence === "INFERRED" && !INFERRED_OK.has(e.confidence_score),
  );
  if (lazyInferred.length) errors.push(`${lazyInferred.length} 条 INFERRED 边不在离散档位（0.95/0.85/0.75/0.65/0.55）`);

  const noCoverage = [];
  for (const n of merged.nodes) {
    if (n._origin !== "semantic") continue;
    if (!n.source_file) noCoverage.push(n.id);
  }
  if (noCoverage.length) errors.push(`${noCoverage.length} 个语义节点缺 source_file`);

  const danglingHyper = merged.hyperedges.filter((h) => (h.nodes ?? []).some((id) => !ids.has(id)));
  if (danglingHyper.length) errors.push(`${danglingHyper.length} 条超边引用了不存在的节点`);

  return { errors, dangle: dangle.length };
}

/* --refresh-baseline：把「删基线 → 全量重抽 AST → 用新基线合并」这条手工流程固化。
 *
 * 为什么需要它（2026-11-13 实测踩过）：
 *   基线只在**不存在时**冻结一次（见 ensureBaseline 的 fs.existsSync 提前返回）。
 *   代码改了好几轮之后直接跑 `graphify update` 或 `npm run graphify`，合并出来的
 *   还是**旧代码**的图谱——节点数只会在原地打转（实测 2726 → 2932 → 2728 → 2861，
 *   数字变来变去但没有一次真正吃到新代码）。
 *
 * 正确姿势原本是三条命令手工串：
 *   rm graphify-out/ast-baseline.json
 *   graphify extract . --code-only --no-cluster --force
 *   npm run graphify
 * 串错一步就会出现「语义层标签被 AST hub 名覆盖」这种退化——我中途就遇到过
 * （`default-prompt-inject.md（当前生效的注入正文）` 被覆盖成 `default-prompt-inject.md`），
 * 因为直接跑 `graphify update` 绕过了语义层合并。
 *
 * 现在一条命令做对：先删基线 → 调 graphify extract --force 重抽 → 再走正常合并。
 */
function refreshBaselineIfAsked(outDir, root, opts) {
  if (!opts.refreshBaseline) return;
  const baseFile = path.join(outDir, "ast-baseline.json");
  if (fs.existsSync(baseFile)) {
    fs.rmSync(baseFile, { force: true });
    warn("已删除旧 AST 基线：接下来会用新抽取结果重冻");
  }
  const res = spawnSync("graphify", ["extract", root, "--code-only", "--no-cluster", "--force"], {
    encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    fail(`重抽 AST 失败（exit ${res.status}）：${(res.stderr || res.stdout || "").trim().split("\n").slice(-2).join(" / ")}`);
  }
  const tail = (res.stdout || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "";
  warn(`AST 已全量重抽：${tail.replace(/^\[graphify extract\] /, "")}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.join(opts.root, "graphify-out");
  const semDir = path.join(outDir, "semantic");
  if (!fs.existsSync(semDir)) fail(`语义层目录不存在：${semDir}`);

  const files = fs.readdirSync(semDir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) fail(`${semDir} 下没有 *.json`);

  refreshBaselineIfAsked(outDir, opts.root, opts);

  const { baseline, created, dropped } = ensureBaseline(outDir, opts.root);
  if (created) warn(`已冻结 AST 基线 ast-baseline.json（从 graph.json 剔除 ${dropped ?? 0} 个语义节点）`);

  const merged = merge(baseline, files.map((f) => path.join(semDir, f)), opts.root);
  /* 补第 4 层：graphify 抽取只到 3 层深，references 全被漏掉（117 篇 0 入图）。 */
  const refStat = injectReferenceEdges(merged, opts.root);
  if (refStat.nodes || refStat.edges) {
    console.log(`[graphify] 补 references 层：+${refStat.nodes} 节点 / +${refStat.edges} 边`);
  }
  const folded = opts.foldRationale ? foldRationale(merged) : { folded: 0, kept: 0, orphans: [], redirected: 0, deduped: 0, hyperFixed: 0 };
  if (!opts.foldRationale) warn("已按要求跳过 rationale 折叠");
  const { errors } = validate(merged);

  const report = {
    semanticFiles: files,
    addedNodes: merged.stats.nodes,
    addedEdges: merged.stats.edges,
    addedHyperEdges: merged.stats.hyper,
    duplicateNodeIds: merged.stats.dupNode,
    duplicateHyperIds: merged.stats.dupHyper,
    rationaleFolded: folded.folded,
    rationaleKept: folded.kept,
    rationaleOrphans: folded.orphans,
    edgesRedirectedToParent: folded.redirected,
    edgesDeduped: folded.deduped,
    hyperEdgesFixed: folded.hyperFixed,
    totalNodes: merged.nodes.length,
    totalEdges: merged.edges.length,
    validationErrors: errors,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const hard = errors.filter((e) => e.startsWith("悬空边") || e.startsWith("非法") || e.includes("…另有"));
  if (opts.dryRun) {
    process.stdout.write("[graphify-sync] dry-run：未写盘\n");
    return hard.length ? 0 : 0;
  }

  const graph = {
    nodes: merged.nodes,
    edges: merged.edges,
    hyperedges: merged.hyperedges,
    input_tokens: 0,
    output_tokens: 0,
  };
  fs.writeFileSync(path.join(outDir, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");

  if (opts.cluster) {
    const res = spawnSync("graphify", ["cluster-only", opts.root], { stdio: "inherit", shell: process.platform === "win32" });
    if (res.error) fail(`graphify cluster-only 调用失败：${res.error.message}`);
    if (res.status !== 0) fail(`graphify cluster-only 退出码 ${res.status}`);
  }
  if (hard.length) {
    process.stderr.write(`[graphify-sync] ${hard.length} 条硬问题待修\n`);
    return 1;
  }
  return 0;
}

process.exit(main());
