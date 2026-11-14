#!/usr/bin/env node
/**
 * 第 31 关：原子测试索引一致性。
 *
 * 索引是「能不能跑验证」的唯一依据，错一条就会误导：
 *   · 把抓取失败（403/超时）记成"AT 无此技术" → 调用方以为这技术不可验证，改走手工；
 *   · 索引里有攻击表里没有的编号 → 编造；
 *   · 攻击表里的编号索引里没有 → 查不到（调用时报"索引无记录"）；
 *   · 用例数写错（tests 与实际 items 长度不符）→ 显示 14 个实际 3 个。
 *
 * 五项断言（都不联网，纯本地校验）：
 *   1. 索引覆盖攻击表全部编号（每个都有记录，哪怕 note="AT 无此技术"）
 *   2. 索引里没有攻击表外的编号（防编造）
 *   3. `tests` 与 `items.length` 一致（防计数漂移）
 *   4. 抓取失败要有显式 note（不能静默记成 0 用例，那是"没有"和"没取到"的混淆）
 *   5. 每条 item 至少要有名称；有平台信息就不许空
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TECHNIQUES, displayTechniqueId } from "../lib/redteam/attack-map.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDX = path.join(ROOT, "lib", "generated", "atomics-index.json");
if (!fs.existsSync(IDX)) {
  console.error("✗ 索引不存在：跑 node scripts/build-atomics.mjs");
  process.exit(1);
}
const idx = JSON.parse(fs.readFileSync(IDX, "utf8"));
const problems = [];

const attackIds = new Set(Object.keys(TECHNIQUES).map(displayTechniqueId));
const idxIds = new Set(Object.keys(idx.techniques || {}));

/* 1) 攻击表 → 索引 */
for (const id of attackIds) {
  if (!idxIds.has(id)) problems.push(`攻击表有 ${id}，索引里没有记录（查它会报"无记录"）`);
}
/* 2) 索引 → 攻击表 */
for (const id of idxIds) {
  if (!attackIds.has(id)) problems.push(`索引里有 ${id}，但攻击表没有（防编造）`);
}
/* 4) "AT 没有"与"没取到"必须由**机器可判的 fetch_status** 区分，不能只看 note。
   踩过的坑：反向探针把某条 http403 的 note 改写成"AT 无此技术"，
   闸门仍绿 —— 因为只检查 note 非空。note 是人写的解释，可以被改得看起来合理。
   fetch_status 是抓取事实（200/404/403…），闸门按它断言：
     200 → 必须有用例（至少 1 条）
     404 → 允许 0 用例（AT 确实没收录）
     其它 → 算抓取失败，单列告警（**不代表 AT 没有**） */
let total = 0;
for (const [id, rec] of Object.entries(idx.techniques || {})) {
  const items = Array.isArray(rec.items) ? rec.items : [];
  const fs2 = String(rec.fetch_status || "");
  if (fs2 === "") problems.push(`${id}: 缺 fetch_status（无法区分"AT 没有"与"没取到"）`);
  if (Number(rec.tests) !== items.length) {
    problems.push(`${id}: tests=${rec.tests} 但 items 有 ${items.length} 条（计数漂移）`);
  }
  if (fs2 === "200" && items.length === 0) problems.push(`${id}: fetch_status=200 却 0 用例（自相矛盾）`);
  if (fs2 === "404" && items.length > 0) problems.push(`${id}: fetch_status=404 却有用例（自相矛盾）`);
  if (fs2 === "404" && String(rec.note || "") !== "AT 无此技术") {
    problems.push(`${id}: 404 的 note 应写"AT 无此技术"，实际「${rec.note}」（note 与事实不一致）`);
  }
  if (fs2 !== "" && fs2 !== "200" && fs2 !== "404" && String(rec.note || "").includes("AT 无此技术")) {
    problems.push(`${id}: 抓取失败(${fs2}) 却标成"AT 无此技术" —— 这是把"没取到"伪装成"没有"`);
  }
  total += items.length;
  for (const it of items) {
    if (!it || !String(it.name || "").trim()) problems.push(`${id}: 有条目缺 name`);
    if (it && it.platforms !== undefined && !Array.isArray(it.platforms)) problems.push(`${id}: platforms 不是数组`);
  }
}

/* 抓取失败单列（不算闸门失败——CDN 限流是外部因素，但必须显式可见） */
/* 失败判定必须用 **fetch_status**（机器可判），不能用 note。
   踩过：note 改成「抓取失败：http403-after-retry」后，正则 /^http/ 匹配不上（开头是中文），
   统计显示"抓取失败 0"而实际有 5 个 —— 校验器自己把问题藏了。
   同一条纪律：**能被机器判的事实，就按事实判，不要按人写的解释判。** */
const failed = Object.entries(idx.techniques || {})
  .filter(([, v]) => {
    const f = String(v.fetch_status || "");
    return f !== "" && f !== "200" && f !== "404";
  })
  .map(([k, v]) => `${k}(${v.fetch_status})`);
const noTech = Object.values(idx.techniques || {}).filter((v) => v.fetch_status === "404").length;
const covered = Object.values(idx.techniques || {}).filter((v) => v.tests > 0).length;

console.log(`[check-atomics] 索引 ${idxIds.size} 技术｜有用例 ${covered}｜AT未收录 ${noTech}｜抓取失败 ${failed.length}｜用例合计 ${total}`);

if (failed.length) {
  console.log(`  ⚠ 抓取失败（**不代表 AT 没有**，重跑 build-atomics 或人工确认）：${failed.join(", ")}`);
}
if (problems.length) {
  for (const p of problems.slice(0, 12)) console.log(`  ✗ ${p}`);
  if (problems.length > 12) console.log(`  …另 ${problems.length - 12} 条`);
  process.exit(1);
}
console.log("  ✓ 与攻击表双向闭合｜计数一致｜「AT 没有」与「没取到」已分开表达");
process.exit(0);