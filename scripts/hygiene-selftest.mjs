#!/usr/bin/env node
/**
 * 用途：lib/hygiene.js 的夹具自测——不碰真宿主目录，全在临时目录里造场景。
 * 用法：node scripts/hygiene-selftest.mjs
 * 依赖：Node ≥18；只写临时目录。
 * 验证：2026-11-10 首跑全绿（5 场景断言）。它存在的理由：抽模块之后，"输出等值"只证明没改坏行为，
 *      而阈值边界（keep=2、孤儿>5、坏 JSON 不许静默跳过）这些判定得有人长期看着。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveResources, scanSwapBackups, scanSnapshotPairs } from "../lib/hygiene.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "hyg-"));
let fails = 0;
const check = (label, cond, extra = "") => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? `｜${extra}` : ""}`);
};

// --- A) 换装遗留：5 份 prev（含无时间戳那个）应报 warn；剪到 2 份后应报 ok
const resources = path.join(base, "resources");
fs.mkdirSync(resources, { recursive: true });
fs.mkdirSync(path.join(resources, "app"), { recursive: true });
const mkPrev = (name, ageMin) => {
  const d = path.join(resources, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "payload.bin"), Buffer.alloc(4096, 7));
  const t = new Date(Date.now() - ageMin * 60000);
  fs.utimesSync(d, t, t);
};
mkPrev("app.dshpurge-prev", 50);
for (let k = 1; k <= 4; k += 1) mkPrev(`app.dshpurge-prev-100${k}`, 40 - k * 5);
let s = scanSwapBackups(resources, { keep: 2 });
check("A 5 份 prev → warn 且计数为 5", s.level === "warn" && s.count === 5, `${s.count} 个 / ${s.mb.toFixed(0)} MB`);
for (const n of fs.readdirSync(resources).filter((x) => x.startsWith("app.dshpurge-prev")).slice(0, 3)) {
  fs.rmSync(path.join(resources, n), { recursive: true, force: true });
}
s = scanSwapBackups(resources, { keep: 2 });
check("B 剩 2 份 → ok", s.level === "ok" && s.count === 2, `${s.count} 个`);
check("C resources 不存在 → warn 未定位（不是崩）", scanSwapBackups(path.join(base, "nope")).level === "warn");

// --- D) 原文快照：3 对存活 + 2 对孤儿 + 1 个坏 JSON
const home = path.join(base, "home");
const hb = path.join(home, "dsh-purge", "host-backups");
fs.mkdirSync(hb, { recursive: true });
const alive = path.join(base, "alive.js");
fs.writeFileSync(alive, "x");
for (let k = 0; k < 3; k += 1) {
  fs.writeFileSync(path.join(hb, `a${k}.json`), JSON.stringify({ path: alive, at: "2026-11-10T00:00:00.000Z" }));
  fs.writeFileSync(path.join(hb, `a${k}.bak`), "old");
}
for (let k = 0; k < 2; k += 1) {
  fs.writeFileSync(path.join(hb, `o${k}.json`), JSON.stringify({ path: path.join(base, "gone.js") }));
  fs.writeFileSync(path.join(hb, `o${k}.bak`), "old");
}
// 反斜杠在 JSON 里是转义符：这类文件必须被数成「不可解析」，不许静默跳过
fs.writeFileSync(path.join(hb, "bad.json"), `{"path":"E:\\不存在\\转义.js"}`);
const sn = scanSnapshotPairs(home, { warnOrphans: 5 });
check("D 计数正确（6 对 / 孤儿 2 / 不可解析 1）", sn.pairs === 6 && sn.orphans === 2 && sn.unreadable === 1, `pairs=${sn.pairs} orphans=${sn.orphans} unreadable=${sn.unreadable}`);
check("E 有不可解析就转 warn（静默跳过会假绿）", sn.level === "warn" && sn.label.includes("不可解析 1 个"), sn.label.slice(0, 78));
check("F 无快照目录 → null（少报一行而不是编造）", scanSnapshotPairs(path.join(base, "nothing")) === null);

// --- G) resolveResources：从 ai_base 推 resources
const rr = resolveResources({ ai_base: "E:\\somewhere\\harness\\resources\\app\\dsh\\node_modules\\@deepseek-ai" });
check("G resolveResources 从 ai_base 推出 resources 目录", /resources$/i.test(rr.replace(/[\\/]+$/, "")), rr);

fs.rmSync(base, { recursive: true, force: true });
console.log(`卫生夹具：${fails === 0 ? "全部通过 ✓" : `${fails} 项失败 ✗`}`);
process.exit(fails ? 1 : 0);
