#!/usr/bin/env node
/**
 * 启动宿主（DeepSeek Harness）并在端口就绪后返回。
 *
 * 为什么需要它：手工启动踩过两个坑，都会让进程「秒退且无任何错误输出」，
 * 极难从现象反推原因：
 *
 * ① **ELECTRON_RUN_AS_NODE=1**
 *    这个环境变量会让 Electron 以纯 Node 模式运行：不建窗口、不加载 app.asar 主进程、
 *    不写 [boot] 日志、不开端口，把第一个参数当脚本路径。
 *    实测症状：启动后 EXIT=0 无输出；带 --no-sandbox 时打印 "bad option: --no-sandbox"
 *    （那是 Node 的参数解析在报错，不是 Electron）；带 --help 时打印的是 **Node 的用法**。
 *    这个变量常被 IDE/Agent 环境设置，从 shell 继承下来就会命中。
 *
 * ② 启动方式
 *    Start-Process / cmd start / ShellExecute 在受限环境下可能拿不到正确的桌面会话；
 *    直接 spawn 二进制并清掉环境变量最可靠。
 *
 * 用法：node scripts/start-host.mjs [--wait 秒数，默认 40]
 * 输出：就绪时打印 PORT=<端口> 并 exit 0；超时 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync } from "node:child_process";

const EXE_CANDIDATES = [
  "E:/Program Files/harness/DeepSeek Harness.exe",
  path.join(process.env.PROGRAMFILES || "C:/Program Files", "harness", "DeepSeek Harness.exe"),
];
const argWait = (() => {
  const i = process.argv.indexOf("--wait");
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 40;
})();

const exe = EXE_CANDIDATES.find((p) => { try { return fs.statSync(p).size > 0; } catch { return false; } });
if (!exe) {
  console.error("✗ 找不到 DeepSeek Harness.exe");
  process.exit(1);
}

/* 关键：删掉 ELECTRON_RUN_AS_NODE，否则启动出来的是 Node 不是应用 */
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

console.log(`启动 ${exe}`);
console.log(`  ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE === undefined ? "(未设置)" : process.env.ELECTRON_RUN_AS_NODE} → 已从子进程环境移除`);

const child = spawn(exe, [], {
  cwd: path.dirname(exe),
  env,
  stdio: "ignore",
  detached: true,
});
child.unref();

/* 端口发现：dsh-purge 的 status 端点回 JSON（含 plugin_version）。
   注意不能只判 HTTP 200 —— 127.0.0.1 上还有别的服务也回 200（有的是 HTML 页面）。 */
const probe = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/dsh-purge/status`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return null;
    const text = await res.text();
    const j = JSON.parse(text);
    return typeof j.plugin_version === "string" ? j : null;
  } catch { return null; }
};

/* 从 netstat 拿本地监听端口（Node 没有跨平台 API）。
   注意：ESM 里没有 require，必须用顶部 import 的 execSync。
   踩过：写成 require("node:child_process") 会抛 ReferenceError，
   被 catch 吞掉后返回空数组，症状是「端口明明开着却探测不到」——很难看出来。 */
const listeningPorts = () => {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", windowsHide: true });
    const set = new Set();
    for (const line of out.split("\n")) {
      const m = /127\.0\.0\.1:(\d+)\s+.*LISTENING/i.exec(line);
      if (m) set.add(Number(m[1]));
    }
    return [...set];
  } catch { return []; }
};

const deadline = Date.now() + argWait * 1000;
let found = null;
while (Date.now() < deadline) {
  for (const p of listeningPorts()) {
    const st = await probe(p);
    if (st) { found = { port: p, st }; break; }
  }
  if (found) break;
  await new Promise((r) => setTimeout(r, 1500));
}

if (!found) {
  console.error(`✗ ${argWait} 秒内未发现 dsh-purge 端口。排查顺序：`);
  console.error("  1) 是否还有旧实例占着（tasklist | grep -i harness）");
  console.error("  2) %TEMP%/dsh-purge-desktop.log 最后有没有新的 [boot] 行");
  console.error("  3) 确认启动时 ELECTRON_RUN_AS_NODE 已移除（本脚本已做）");
  process.exit(1);
}

console.log(`PORT=${found.port}`);
console.log(`  版本 ${found.st.plugin_version}｜ready=${found.st.ready}｜surface=${found.st.surface}`);
process.exit(0);