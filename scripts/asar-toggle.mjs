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

const argv = process.argv.slice(2);
const mode = argv.includes("--off") ? "off" : argv.includes("--on") ? "on" : "status";

function resourcesDir() {
  const base = String(process.env.DSH_BASE || "").replace(/\\/g, "/");
  const at = base.toLowerCase().indexOf("/resources/");
  if (at > 0) return base.slice(0, at + "/resources".length);
  for (const root of [process.env.ProgramFiles, "E:\\Program Files", "D:\\Program Files"]) {
    if (!root) continue;
    const p = path.join(root, "harness", "resources");
    if (fs.existsSync(p)) return p;
  }
  return "";
}

const res = resourcesDir();
if (!res) {
  console.log("找不到 resources 目录（设 DSH_BASE 或确认桌面端安装路径）");
  process.exit(2);
}
const asar = path.join(res, "app.asar");
const parked = path.join(res, "app.asar.disabled");
const appDir = path.join(res, "app");

const isRunning = () => {
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
  console.log(`resources: ${res}`);
  console.log(`app.asar: ${fs.existsSync(asar) ? `在（${sizeMB(asar)}MB）` : "不在"}`);
  console.log(`app.asar.disabled: ${fs.existsSync(parked) ? `在（${sizeMB(parked)}MB）` : "不在"}`);
  console.log(`resources/app 目录: ${fs.existsSync(appDir) ? "在" : "不在"}`);
  console.log(`宿主进程: ${running ? "在跑" : "未运行"}`);
  // 注意：Node 的 fs.open 默认允许共享，用它测「被占用」会得到假阴性（实测本机报「否」，
  // 而 .NET FileShare.None 一开就报 being used）。这里不猜占用，只按 Electron 的加载规则判：
  // 启动时 app.asar 存在即优先加载——asr 在 = 加载源是 asar。
  const verdict = !fs.existsSync(asar) && fs.existsSync(appDir)
    ? "当前加载源 = resources/app 目录（补丁生效形态）"
    : fs.existsSync(asar)
      ? "当前加载源 = app.asar（补丁只写在解开目录，不生效）"
      : "两种形态都不完整，别切";
  console.log(`判定: ${verdict}`);
  process.exit(0);
}

if (mode === "off") {
  if (!fs.existsSync(asar)) {
    console.log(`已经是目录形态（app.asar 不在）${fs.existsSync(parked) ? "，回滚文件在 app.asar.disabled" : ""}`);
    process.exit(0);
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
fs.renameSync(parked, asar);
console.log(`已回滚：app.asar.disabled → app.asar（${sizeMB(asar)}MB）`);
process.exit(0);