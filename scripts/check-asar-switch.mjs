#!/usr/bin/env node
/**
 * check-asar-switch.mjs — asar 切换脚本的形态闸门（闸门第 15 项）。
 *
 * 为什么要有它：2026-11-12 12:55 宿主连崩三次，崩因是**混合态**（app.asar 与 resources/app 并存，
 * shell 与 host 子进程来自不同根 → `dsh desktop host sent an invalid IPC event`）。
 * 造出混合态的正是我们自己的回滚脚本：`--on` 只恢复 asar、不挪目录；失败分支还会打印
 * 「什么都没变」而实际两边都没有。所以这里不测「有没有这段代码」，而是**在夹具上真跑**，
 * 断言磁盘上的三态与退出码：
 *   ① 混合态跑 --on：目录必须被挪成 app.dshpurge-stale-*，asar 留下，exit 0；
 *   ② 只剩 asar、无 .disabled：--on 报「无需回滚」exit 0（不能把 skip 当成功去动文件）；
 *   ③ resources/app 缺 package.json：--off 拒绝，exit 6；
 *   ④ 正常目录形态：--off 把 asar 改成 .disabled，exit 0。
 *
 * 用法：node scripts/check-asar-switch.mjs   （0 全绿 / 1 有红项）
 * 依赖：Node ≥18；夹具建在 os.tmpdir()，跑完删除；只用 rename，不碰真实安装目录。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toggle = path.join(root, "scripts", "asar-toggle.mjs");
const problems = [];
const checks = [];

function mkVariant(name, { asar = false, parked = false, app = true, complete = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-purge-asar-${name}-`));
  const res = path.join(dir, "resources");
  fs.mkdirSync(res, { recursive: true });
  if (asar) fs.writeFileSync(path.join(res, "app.asar"), "asar-bytes");
  if (parked) fs.writeFileSync(path.join(res, "app.asar.disabled"), "asar-bytes");
  if (app) {
    fs.mkdirSync(path.join(res, "app"), { recursive: true });
    if (complete) fs.writeFileSync(path.join(res, "app", "package.json"), '{"name":"fixture"}');
  }
  return { dir, res, asar: path.join(res, "app.asar"), parked: path.join(res, "app.asar.disabled"), appDir: path.join(res, "app") };
}

function run(mode, res, extraEnv = {}) {
  const r = spawnSync(process.execPath, [toggle, mode, "--resources", res], {
    encoding: "utf8",
    env: { ...process.env, DSH_PURGE_TOGGLE_ASSUME_STOPPED: "1", ...extraEnv },
    timeout: 30000,
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

const staleDirs = (res) => fs.readdirSync(res).filter((n) => n.startsWith("app.dshpurge-stale-"));

// ① 混合态 → --on 必须解混合
{
  const f = mkVariant("hybrid", { asar: true, app: true });
  const r = run("--on", f.res);
  const stale = staleDirs(f.res);
  const ok = r.code === 0 && stale.length === 1 && fs.existsSync(f.asar) && !fs.existsSync(f.appDir) && !fs.existsSync(f.parked);
  checks.push(`① 混合态 --on：exit ${r.code}｜asar=${fs.existsSync(f.asar)}｜目录=${fs.existsSync(f.appDir)}｜stale=${stale.length}`);
  if (!ok) problems.push(`混合态跑 --on 没有解混合（exit ${r.code}，stale ${stale.length} 个）`);
  fs.rmSync(f.dir, { recursive: true, force: true });
}

// ② 只剩 asar → --on 什么都不做（exit 0，且不造出 .disabled）
{
  const f = mkVariant("asar-only", { asar: true, app: false });
  const r = run("--on", f.res);
  const ok = r.code === 0 && fs.existsSync(f.asar) && !fs.existsSync(f.parked) && !fs.existsSync(f.appDir);
  checks.push(`② 无回滚点 --on：exit ${r.code}｜asar=${fs.existsSync(f.asar)}｜disabled=${fs.existsSync(f.parked)}`);
  if (!ok) problems.push(`无回滚点跑 --on 动了不该动的东西（exit ${r.code}）`);
  fs.rmSync(f.dir, { recursive: true, force: true });
}

// ③ 目录不完整 → --off 必须拒绝（否则关完两边都没有，宿主起不来）
{
  const f = mkVariant("partial", { asar: true, app: true, complete: false });
  const r = run("--off", f.res);
  const ok = r.code === 6 && fs.existsSync(f.asar) && !fs.existsSync(f.parked);
  checks.push(`③ 目录不完整 --off：exit ${r.code}｜asar=${fs.existsSync(f.asar)}｜disabled=${fs.existsSync(f.parked)}`);
  if (!ok) problems.push(`目录缺 package.json 时 --off 没有被拒（exit ${r.code}）`);
  fs.rmSync(f.dir, { recursive: true, force: true });
}

// ④ 正常目录形态 → --off 改名
{
  const f = mkVariant("ok", { asar: true, app: true });
  const r = run("--off", f.res);
  const ok = r.code === 0 && !fs.existsSync(f.asar) && fs.existsSync(f.parked) && fs.existsSync(path.join(f.appDir, "package.json"));
  checks.push(`④ 正常形态 --off：exit ${r.code}｜asar=${fs.existsSync(f.asar)}｜disabled=${fs.existsSync(f.parked)}`);
  if (!ok) problems.push(`正常形态 --off 没把 asar 改成 .disabled（exit ${r.code}）`);
  fs.rmSync(f.dir, { recursive: true, force: true });
}

// ⑤ 健康快照必须认混合态（审计 I2）：asar 与目录并存时报 asar=ok / notes 空，
// 和 asar-toggle --status 的 exit 5 自相矛盾 —— 崩机后翻 health.json 会看到「健康」。
{
  const f = mkVariant("health-hybrid", { asar: true, app: true });
  Object.defineProperty(process, "resourcesPath", { value: f.res, configurable: true, writable: true });
  const { inspectHostHealth } = await import(new URL("file:///" + path.join(root, "lib", "profile-guard.js").replace(/\\/g, "/")).href);
  const report = inspectHostHealth(path.join(f.dir, "profile"));
  const hybridSeen = report.extract === "hybrid(archive+dir)" && (report.notes || []).some((n) => n.includes("混合态"));
  checks.push(`⑤ 健康快照（混合态）：extract=${report.extract}｜notes=${(report.notes || []).length} 条`);
  if (!hybridSeen) problems.push(`混合态下健康快照没报出来（extract=${report.extract}，notes=${(report.notes || []).length} 条）`);
  fs.rmSync(f.dir, { recursive: true, force: true });
}

for (const line of checks) console.log(`  · ${line}`);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`[check-asar-switch] 失败 ${problems.length} 项`);
  process.exit(1);
}
console.log("[check-asar-switch] 全部通过 ✓（混合态解混合 / skip 不动文件 / 不完整目录拒绝 / 正常切换）");