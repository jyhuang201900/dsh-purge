#!/usr/bin/env node
/**
 * 用途：生态漂移探测（站点可用 DSH_MARKET_URL 覆盖，便于测「查不到」分支）——dshmp 目录规模、以及第 65 轮"重钉口径"下的 restart ∩ patch 交集与邻居版本。
 * 用法：node scripts/market-sweep.mjs [--json]
 * 依赖：Node ≥18（全局 fetch）；离线或站点不响应时明确报「未知」并按通过退出，绝不把「没查到」说成「一致」。
 * 验证：2026-11-10 首跑复现第 65/81 轮手打结果：采样 2000｜总数 10063｜restart 26｜口径 D 22｜交集 0。
 *
 * 为什么要成工具：这两组数我手打过六趟，第 49 轮正是手打时漏记「正则作用在哪些字段」，
 * 才让档案里的 36 变成无法复现的考古题。**口径写死在代码里，比写在文档里更不容易烂。**
 */
import process from "node:process";

const PAGES = 40;
const PAGE_SIZE = 50;
// 第 65 轮重钉的口径（改动这里就等于换量具，档案里的历史数要重新对）
const FIELDS = (p) => `${p.name} ${p.slug || ""} ${p.description || ""} ${(p.tags || []).join(" ")}`;
const RX_RESTART = /\brestart|重启|重新启用|reboot/i;
const RX_PATCH_D = /\bpatch|补丁|破甲|清洗/i;
const BASELINE = { total: 10063, sample: 2000, restart: 26, patchD: 22, intersect: 0 };
const NEIGHBOURS = ["dsh-fast", "dsh-mcp", "skills-management"];

async function fetchJson(url) {
  const base2 = process.env.DSH_MARKET_URL || "https://dshmp.com/api/plugins";
  url = url.replace("https://dshmp.com/api/plugins", base2);
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let total = 0;
const all = [];
let netError = "";
try {
  for (let page = 1; page <= PAGES; page += 1) {
    const j = await fetchJson(`https://dshmp.com/api/plugins?page=${page}&pageSize=${PAGE_SIZE}`);
    total = j.total ?? j.count ?? total;
    const items = j.items || j.plugins || [];
    all.push(...items);
    if (!items.length) break;
  }
  if (!all.length) netError = "目录返回空";
} catch (e) {
  netError = String((e && e.message) || e).slice(0, 50);
}

const neigh = [];
if (!netError) {
  for (const pkg of NEIGHBOURS) {
    try {
      const j = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
      const v = (j["dist-tags"] && j["dist-tags"].latest) || "";
      neigh.push({ pkg, version: v || "?", published: (j.time && j.time[v]) || "" });
    } catch (e) {
      neigh.push({ pkg, version: "查不到", published: "", err: String((e && e.message) || e).slice(0, 40) });
    }
  }
}

const hitR = all.filter((p) => RX_RESTART.test(FIELDS(p)));
const hitD = all.filter((p) => RX_PATCH_D.test(FIELDS(p)));
const both = hitD.filter((p) => RX_RESTART.test(FIELDS(p)));
const got = { total, sample: all.length, restart: hitR.length, patchD: hitD.length, intersect: both.length };

// 只有「交集 > 0」才算定位被吃进（有人同时做重启与补丁治理）；采样规模对不上是量具问题，报 warn 不判死。
let level = "ok";
let note = "交集仍为 0：restart ∩ patch 这条定位第三次以上复现";
if (netError) { level = "unknown"; note = `未查到（${netError}）—— 未知不等于一致`; }
else if (both.length > 0) { level = "warn"; note = `交集 ${both.length} 条，定位被吃进：${both.slice(0, 3).map((x) => x.name || x.slug).join(", ")}`; }
else if (all.length < BASELINE.sample || hitR.length !== BASELINE.restart || hitD.length !== BASELINE.patchD) {
  level = "warn";
  note = `与基线不符（采样 ${all.length}/${BASELINE.sample}，restart ${hitR.length}/${BASELINE.restart}，patchD ${hitD.length}/${BASELINE.patchD}）：量的不是同一件东西，先核对FIELDS与正则再谈结论`;
}

const asJson = process.argv.includes("--json");
if (asJson) {
  process.stdout.write(JSON.stringify({ baseline: BASELINE, got, neighbours: neigh, verdict: { level, note } }, null, 1) + "\n");
} else {
  console.log(`生态漂移：目录总数 ${total || "?"}｜采样 ${all.length} 条｜restart ${hitR.length}｜口径 D ${hitD.length}｜交集 ${both.length}`);
  console.log(`  ${level === "ok" ? "✓" : level === "warn" ? "⚠" : "·"} ${note}`);
  if (neigh.length) console.log(`  邻居版本：${neigh.map((x) => `${x.pkg} ${x.version}${x.published ? `（${x.published.slice(0, 10)}）` : ""}`).join("｜")}`);
}
// 只有「定位被吃进」（交集 > 0）判失败；量具与基线不符是 ⚠ 提醒（可能是目录变了），离线是未知——都不该天天红。
process.exit(level === "bad" || (level === "warn" && both.length > 0) ? 1 : 0);
