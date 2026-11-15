#!/usr/bin/env node
/**
 * 第 43 关：图谱新鲜度——`graph.json` 的 built_at_commit 必须与 HEAD 一致（或足够接近）。
 *
 * 由来：1.1.123 手动审计时发现图谱停在 6e4108e(1.1.118)，而当时已是 2e9d50d(1.1.122) ——
 * **6 个技能、9 篇参考、2 个闸门脚本全没进图谱**。而 `check-graph` 一直全绿，
 * 因为它只查结构（节点/边/社区/兜底名），从不问「这份图谱是什么时候建的」。
 *
 * 这类缺陷的性质：**结构完全正确，只是内容过期**。所有静态检查都会放它过去。
 * 唯一可靠的判据是比对 commit。
 *
 * 判据（三档，避免一刀切把人逼到每次都重跑 graphify）：
 *   · built_at_commit 等于 HEAD          → 绿
 *   · 落后 1-9 个提交，且期间只改 .md     → 黄（提示，不判红；内容变动小，可接受）
 *   · 落后 ≥10 个提交，或期间改了代码/闸门 → 红（必须刷新）
 *
 * 为什么区分「只改 .md」：技能内容改动会进图谱（技能节点、references 边），
 * 但极少改动 AST 结构；而改 lib/*.js、scripts/*.mjs 会让 AST 层失真 ——
 * 后者才必须重抽。这个区分让闸门在实际工作流里不至于天天报红。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const GRAPH = path.join(ROOT, "graphify-out", "graph.json");
const MAX_LAG = Number(process.env.GRAPH_MAX_LAG || 9);

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

if (!fs.existsSync(GRAPH)) {
  console.log("[check-graph-fresh] ✗ graphify-out/graph.json 不存在 —— 先跑 graphify extract");
  process.exit(1);
}

let built = "";
try {
  built = JSON.parse(fs.readFileSync(GRAPH, "utf8")).built_at_commit || "";
} catch {
  console.log("[check-graph-fresh] ✗ graph.json 无法解析（JSON 坏了，第 8 关之外的单点检查）");
  process.exit(1);
}

if (!built) {
  console.log("[check-graph-fresh] ✗ graph.json 没有 built_at_commit 字段 —— 无法判断新鲜度");
  process.exit(1);
}

let head = "";
try {
  head = git(["rev-parse", "HEAD"]);
} catch {
  console.log("[check-graph-fresh] git 不可用（打包环境？）—— 跳过新鲜度检查");
  process.exit(0);
}

if (built === head || head.startsWith(built) || built.startsWith(head)) {
  console.log(`[check-graph-fresh] ✓ 图谱与 HEAD 一致（${built.slice(0, 7)}）`);
  process.exit(0);
}

/* 落后多少提交？built 不在历史里（被 rebase 掉了）时 rev-list 会抛错，按「落后很多」处理。 */
let lag = 0;
let changed = [];
try {
  lag = Number(git(["rev-list", "--count", `${built}..HEAD`]));
  changed = git(["diff", "--name-only", `${built}..HEAD`]).split("\n").filter(Boolean);
} catch {
  console.log(`[check-graph-fresh] ✗ 图谱基线 ${built.slice(0, 7)} 不在当前分支历史上（rebase/重写？）`);
  console.log("  → 必须重新抽取：graphify extract . --code-only --no-cluster，再 refresh-baseline + cluster + label");
  process.exit(1);
}

/* **只有真产品代码改动才让 AST 失真**（1.1.125 修正）。
   排除三类：
   ① `lib/generated/*.json` —— 生成物（skills-index / skills-search / skills-agents），
      每次 build-skill-graph 都变；
   ② `graphify-out/` `presets/` —— 图谱产物与预设，都是生成物；
   ③ **`scripts/check-*.mjs` 等闸门脚本** —— 它们不进宿主、不进图谱，
      却被本闸门自己监控，形成**自指循环**：改了闸门 → 报图谱过期 → 重抽图谱 →
      生成物又变 → 再报…… 实测这一轮撞了两次。
   判据：会不会**改变宿主行为或技能内容**。不会的就不该触发重抽。 */
const GENERATED = /^(lib\/generated\/|graphify-out\/|presets\/|\.cache\/)/;
const GATE_SCRIPTS = /^scripts\/(check-|audit-|probe-|build-|graphify-|inject-|sync-|fetch-|embed-|name-|verify|market-sweep|scenario-drill)/;
const codeChanged = changed.filter(
  (f) =>
    /^(lib\/|scripts\/|bin\/).*\.(m?js|js)$/.test(f) &&
    !GENERATED.test(f) &&
    !GATE_SCRIPTS.test(f)
);
const sample = changed.slice(0, 5).join(", ");

if (lag >= MAX_LAG) {
  console.log(`[check-graph-fresh] ✗ 图谱落后 ${lag} 个提交（上限 ${MAX_LAG}）｜基线 ${built.slice(0, 7)}`);
  console.log(`  改动文件 ${changed.length} 个（例：${sample}）`);
  console.log("  → 刷新：graphify extract → sync --refresh-baseline → sync --cluster → graphify-label → check-graph");
  process.exit(1);
}

if (codeChanged.length) {
  console.log(`[check-graph-fresh] ✗ 图谱落后 ${lag} 个提交，且期间改了代码/AST（${codeChanged.length} 个）：`);
  console.log(`  ${codeChanged.slice(0, 6).join(", ")}`);
  console.log("  → 改代码必然让 AST 层失真，必须重抽（不能只等下次）");
  process.exit(1);
}

console.log(
  `[check-graph-fresh] ⚠ 图谱落后 ${lag} 个提交（上限 ${MAX_LAG}），但期间只改文档/技能，AST 未失真 —— 可下次一并刷新`
);
console.log(`  改动 ${changed.length} 个文件（例：${sample}）`);
process.exit(0);