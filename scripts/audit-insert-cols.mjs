/* 系统审计：INSERT 的列 vs 表真实列。
 *
 * 起因：1.1.115 发现 `stage_code` 建了列、代码收了参数、**INSERT 漏了这列** ——
 * 悄悄全错、不报错、不缺字段名。这类问题必须系统扫，不能靠碰。
 *
 * 真值来源：**真实库的 PRAGMA table_info**，不解析 DDL 文本。
 * 踩过的坑：正则 `CREATE TABLE ... \n\);` 会被表体里的注释提前截断，
 * 于是把已有列误报成"表里没有"（asset.primary_name 就是这样），
 * 真问题反而被埋在噪音里。DDL 是给人看的，PRAGMA 才是事实。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RedteamStore } from "file:///E:/完成项目/dsh-purge/lib/redteam/store-core.js";

const ROOT = "E:/完成项目/dsh-purge";
const src = fs.readFileSync(path.join(ROOT, "lib/redteam/store-core.js"), "utf8");

/* 建一个真实库，读全部表的真实列 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-insert-"));
const s = new RedteamStore(tmp);
const eid = s.openEngagement("审计靶", "203.0.113.0/24").id;
const db = s.db(eid);
const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
const tables = {};
for (const t of tableNames) {
  try { tables[t] = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); } catch { /* 跳过 */ }
}

/* 从 store-core.js 抽 INSERT 语句 */
const inserts = [];
for (const m of src.matchAll(/INSERT INTO (\w+)\(([^)]*)\)/g)) {
  inserts.push({ table: m[1], cols: m[2].split(",").map((x) => x.trim()).filter(Boolean) });
}

/* 这些列"漏写"就是真缺陷：它们承载的是判定/归属信息，不是可选描述 */
const KEY = ["stage_code", "outcome", "vuln_id", "asset_id", "step_id", "point_id", "tool"];

console.log("=== ① INSERT 是否漏写关键列 ===");
let problem = 0;
for (const ins of inserts) {
  const real = tables[ins.table];
  if (!real) { console.log(`  · ${ins.table}: 是 FTS/虚拟表，跳过`); continue; }
  const missing = real.filter((c) => KEY.includes(c) && !ins.cols.includes(c));
  const unknown = ins.cols.filter((c) => !real.includes(c));
  if (unknown.length) {
    /* INSERT 写了表里没有的列 = 一定会运行时报错，属硬缺陷 */
    problem += 1;
    console.log(`  ✗ ${ins.table}: INSERT 写了表里不存在的列 → ${unknown.join(", ")}`);
  }
  if (missing.length) {
    problem += 1;
    console.log(`  ✗ ${ins.table}: 表有 ${missing.join(",")} 但 INSERT 没写（值永远是默认/null）`);
  }
}
if (!problem) console.log("  ✓ 全部 INSERT 的关键列都已覆盖，且没有写错列名");

console.log("\n=== ② 关键列有没有「有写入口但永远收不到值」 ===");
/* 表有列、有 INSERT 写它、但代码里没有任何地方给这个字段赋值 → 半死状态 */
let half = 0;
for (const col of ["stage_code", "outcome"]) {
  const tablesWith = Object.entries(tables).filter(([, cs]) => cs.includes(col)).map(([t]) => t);
  for (const t of tablesWith) {
    const ins = inserts.find((i) => i.table === t && i.cols.includes(col));
    if (!ins) { console.log(`  ✗ ${t}.${col}: 表有列但没有任何 INSERT 写它`); half += 1; }
  }
}
if (!half) console.log("  ✓ 有该列的表都写了它");

console.log("\n=== ③ 实跑一遍：写入后回读，值必须等于入参 ===");
{
  const s2 = new RedteamStore(fs.mkdtempSync(path.join(os.tmpdir(), "audit-rt-")));
  const e = s2.openEngagement("回读靶", "203.0.113.0/24").id;
  s2.importBundle(e, { scan: { tool: "g", argv: [] }, assets: [{ ip: "203.0.113.71", state: "live", provenance: "passive", tool: "g" }] });
  const a = s2.listAssets(e, { ip: "203.0.113.71", limit: 1 })?.items?.[0]?.id;
  const p = (s2.listScorePoints(e, {})?.items || []).find((x) => x.code === "server-host");
  const h = s2.addScoreHit(e, { point_id: p.id, evidence: "回读", asset_id: a, stage_code: "boundary" });
  const got = s2.db(e).prepare("SELECT stage_code FROM score_hit WHERE id=?").get(h.id)?.stage_code;
  console.log(`  score_hit.stage_code 入参 boundary → 回读 ${JSON.stringify(got)} ${got === "boundary" ? "✓" : "✗"}`);
  const st = s2.addChainStep(e, { stage_code: "boundary", title: "回读", tool: "x", outcome: "fail" });
  const got2 = s2.db(e).prepare("SELECT outcome FROM attack_step WHERE id=?").get(st.id)?.outcome;
  console.log(`  attack_step.outcome 入参 fail → 回读 ${JSON.stringify(got2)} ${got2 === "fail" ? "✓" : "✗"}`);
  if (got !== "boundary" || got2 !== "fail") process.exitCode = 1;
}

console.log(problem + half === 0 && !process.exitCode ? "\n审计通过" : "\n审计发现问题");