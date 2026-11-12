#!/usr/bin/env node
/**
 * 用途：在「宿主到底加载 app.asar 还是 resources/app 目录」之间安全切换，让补丁真正进运行时。
 * 用法：
 *   node scripts/asar-toggle.mjs --status    只读：报两种形态、宿主是否在跑、asar 是否被占用
 *   node scripts/asar-toggle.mjs --off       关闭加载源 asar（app.asar → app.asar.disabled），**要求宿主已退出**
 *   node scripts/asar-toggle.mjs --on        回滚（app.asar.disabled → app.asar）
 * 依赖：Node ≥18；只用 rename，不复制、不删改内容，回滚是把文件名改回来。
 *
 * 为什么必须退出宿主：Electron 在启动时决定加载 `resources/app.asar`（存在即优先），运行中改不了；
 * 且 Windows 下正被进程打开的文件不能改名（实测独占打开报「being used by another process」）。
 * 所以这不是「要不要关」，而是「关一次、改个名、再起来」。
 *
 * 判据（本机 2026-11-12 实测）：app.asar 203.3MB 且被宿主进程持有 → 它就是加载源；
 * 解开的 `resources/app` 只有补丁、没人加载。切换后宿主回落 app 目录，补丁才生效。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { findResourcesDir } from "../lib/surface.js";

const argv = process.argv.slice(2);
const mode = argv.includes("--off") ? "off" : argv.includes("--on") ? "on" : "status";

const res = findResourcesDir(argv);
if (!res) {
  console.log("找不到 resources 目录（设 DSH_BASE 或确认桌面端安装路径）");
  process.exit(2);
}
const asar = path.join(res, "app.asar");
const parked = path.join(res, "app.asar.disabled");
const appDir = path.join(res, "app");

const isRunning = () => {
  // 测试缝：夹具跑在真实宿主进程里（Agent 自己就住在宿主里），伪造不了「已退出」。
  // 只影响本脚本的判定，不碰任何文件；生产路径默认不设这个变量。
  if (process.env.DSH_PURGE_TOGGLE_ASSUME_STOPPED === "1") return false;
  try {
    const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq DeepSeek Harness.exe", "/NH"], { encoding: "utf8", timeout: 8000 });
    return /DeepSeek Harness\.exe/i.test(String(r.stdout || ""));
  } catch {
    return false;
  }
};

const sizeMB = (p) => { try { return Math.round(fs.statSync(p).size / 1048576); } catch { return -1; } };

if (mode === "status") {
  const running = isRunning();
  const hasAsar = fs.existsSync(asar);
  const hasApp = fs.existsSync(appDir);
  const hybrid = hasAsar && hasApp;
  console.log(`resources: ${res}`);
  console.log(`app.asar: ${hasAsar ? `在（${sizeMB(asar)}MB）` : "不在"}`);
  console.log(`app.asar.disabled: ${fs.existsSync(parked) ? `在（${sizeMB(parked)}MB）` : "不在"}`);
  console.log(`resources/app 目录: ${hasApp ? "在" : "不在"}`);
  console.log(`宿主进程: ${running ? "在跑" : "未运行"}`);
  // **两者并存 = 已知会崩的形态**（2026-11-12 实测：shell 与 host 子进程来自不同根，
  // 首个 IPC 事件不合 schema，三次启动全挂在这条上）。所以这一行必须是结论，不是提示。
  const verdict = hybrid
    ? "⚠ 混合态：app.asar 与 resources/app 同时存在 —— shell 与 host 子进程可能来自不同根，启动会报 invalid IPC event。先移走其中一个"
    : hasApp
      ? "当前加载源 = resources/app 目录（补丁生效形态）"
      : hasAsar
        ? "当前加载源 = app.asar（补丁只写在解开目录，不生效）"
        : "两种形态都不完整，别切";
  console.log(`判定: ${verdict}`);
  process.exit(hybrid ? 5 : 0);
}

if (mode === "off") {
  if (!fs.existsSync(asar)) {
    console.log(`已经是目录形态（app.asar 不在）${fs.existsSync(parked) ? "，回滚文件在 app.asar.disabled" : ""}`);
    process.exit(0);
  }
  // 关掉 asar 的前提是目录形态**已经完整存在**，否则关完两边都没有 → 宿主直接起不来。
  if (!fs.existsSync(path.join(appDir, "package.json"))) {
    console.log("resources/app 不完整（缺 package.json）：不能先关 asar，否则两种形态都不全。先跑一次应用/解包再切。");
    process.exit(6);
  }
  if (isRunning()) {
    console.log("宿主还在跑：请先退出 DeepSeek Harness（托盘退出或任务管理器结束进程），再执行 --off");
    console.log("  原因：Windows 下正被进程打开的文件不能改名；Electron 也只在启动时决定加载源。");
    process.exit(3);
  }
  if (fs.existsSync(parked)) {
    console.log("app.asar.disabled 已存在，先确认它是不是上一轮的残留再动");
    process.exit(4);
  }
  fs.renameSync(asar, parked);
  console.log(`已改名：app.asar → app.asar.disabled（${sizeMB(parked)}MB，内容未动）`);
  console.log("下一步：启动宿主。它会回落加载 resources/app 目录，补丁随之生效。");
  console.log(`回滚：node scripts/asar-toggle.mjs --on（或手动把 app.asar.disabled 改回 app.asar）`);
  process.exit(0);
}

// --on
// **混合态本身就是 --on 要消除的终局形态**：asar 与 resources/app 并存时，
// 以前的代码只判 parked，一看到没有 .disabled 就打印「无需回滚」exit 0 ——
// skip 当 pass，和同脚本 --status 的 exit 5 自相矛盾（审计 C1 实测复现）。
// 所以先解混合：把目录挪成 stale，让加载源只剩 asar。
if (fs.existsSync(asar) && fs.existsSync(appDir)) {
  if (isRunning()) {
    console.log("宿主还在跑：混合态只能在宿主退出后解（运行中改目录名会被文件锁拒绝）");
    process.exit(3);
  }
  const stale = path.join(res, `app.dshpurge-stale-${Date.now()}`);
  fs.renameSync(appDir, stale);
  console.log(`已把 resources/app 挪开 → ${path.basename(stale)}（混合态解除，加载源只剩 app.asar）`);
  console.log("混合态已消除：以 app.asar 为加载源启动即可（此时不启动也不崩）");
  if (fs.existsSync(parked)) {
    console.log("另：app.asar.disabled 还在 —— 先确认它是不是上一轮残留，别直接删（node scripts/prune-host-leftovers.mjs 默认只列）");
  }
  process.exit(0);
}

if (!fs.existsSync(parked)) {
  console.log("没有 app.asar.disabled，无需回滚");
  process.exit(0);
}
if (isRunning()) {
  console.log("宿主还在跑：回滚同样需要先退出宿主（asar 形态下运行中改文件名会被拒）");
  process.exit(3);
}
if (fs.existsSync(asar)) {
  console.log("app.asar 已经在了，先确认是否要覆盖");
  process.exit(4);
}
// **回滚必须同时把目录挪走**（2026-11-12 崩机教训）：只把 asar 改回来、留着 resources/app，
// 就造出「两种形态并存」的混合态 —— shell 与 host 子进程可能来自不同根，首个 IPC 事件对不上 schema，
// 三次启动全报 `invalid IPC event`。所以先给目录改名（复用插件自己的 stale 命名，便于追溯），再恢复 asar。
if (fs.existsSync(appDir)) {
  const stale = path.join(res, `app.dshpurge-stale-${Date.now()}`);
  fs.renameSync(appDir, stale);
  console.log(`已把 resources/app 挪开 → ${path.basename(stale)}（避免混合态）`);
}
fs.renameSync(parked, asar);
console.log(`已回滚：app.asar.disabled → app.asar（${sizeMB(asar)}MB）`);
console.log(`如需清理挪开的目录：node scripts/prune-host-leftovers.mjs（默认只列，--apply 才删）`);
process.exit(0);