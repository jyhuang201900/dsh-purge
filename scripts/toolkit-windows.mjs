#!/usr/bin/env node
/**
 * 用途：把红队技能用到的二进制装到 $DSH_HOME/redteam/toolkit/（Windows 版装配器）。
 * 用法：node scripts/toolkit-windows.mjs [--check] [--only name,name] [--force]
 * 依赖：Node ≥18；网络可达 GitHub releases（走官方 latest API，不猜 URL）。
 * 验证：2026-11-10 首跑装 projectdiscovery 四件套，逐个 --version 验证可执行。
 *
 * 为什么需要它（不是造轮子）：仓里的 `$DSH_HOME/redteam/setup.sh` 是 **Linux/Kali 专用**，
 * 资产正则写死 `linux_amd64`，在 Windows 上每个都报「无匹配资产」——第 99 轮实测 14 个全失败。
 * 而这些上游**全部提供官方 Windows 构建**（实测 subfinder/dnsx/naabu/httpx/chisel/suo5/fscan/frp/ligolo 都有），
 * 所以这里只做一件事：把 setup.sh 的那张表按 OS 换成 windows_amd64 资产名，仍旧用它们的官方发布。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const NL = String.fromCharCode(10);
const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const toolkit = path.join(home, "redteam", "toolkit");
const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const force = argv.includes("--force");
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : [];

// 每项：repo、资产名正则（windows）、解压后二进制名、安装子目录、验证参数。
const TOOLS = [
  { name: "subfinder", repo: "projectdiscovery/subfinder", re: /windows_amd64\.zip$/, bin: "subfinder.exe", dir: "subfinder", ver: ["-version"] },
  { name: "dnsx", repo: "projectdiscovery/dnsx", re: /windows_amd64\.zip$/, bin: "dnsx.exe", dir: "dnsx", ver: ["-version"] },
  { name: "naabu", repo: "projectdiscovery/naabu", re: /windows_amd64\.zip$/, bin: "naabu.exe", dir: "naabu", ver: ["-version"] },
  { name: "httpx", repo: "projectdiscovery/httpx", re: /windows_amd64\.zip$/, bin: "httpx.exe", dir: "httpx", ver: ["-version"] },
  { name: "chisel", repo: "jpillora/chisel", re: /windows_amd64\.zip$/, bin: "chisel.exe", dir: "chisel", ver: ["--version"] },
  { name: "suo5", repo: "zema1/suo5", re: /suo5-windows-amd64\.exe$/, bin: "suo5.exe", dir: "suo5", ver: ["--help"] },
  { name: "fscan", repo: "shadow1ng/fscan", re: /fscan-nolocal_.*windows_x64\.exe$/, bin: "fscan.exe", dir: "fscan", ver: ["-h"] },
  { name: "frp", repo: "fatedier/frp", re: /windows_amd64\.zip$/, bin: "frpc.exe", dir: "frp", ver: ["--version"] },
  { name: "ligolo", repo: "nicocha30/ligolo-ng", re: /agent_.*windows_amd64\.zip$/, bin: "ligolo-agent.exe", dir: "ligolo", ver: ["--help"] },
];

const exists = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };
const target = (t) => path.join(toolkit, t.dir, t.bin);

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "dsh-purge-toolkit", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 第 99 轮实测：这台机器 github.com:443 连不上，但 api.github.com 与 objects.githubusercontent.com 可达。
// 所以不走 browser_download_url（它在 github.com 上），改走官方的资产端点 + Accept: application/octet-stream。
async function download(url, dest) {
  const r = await fetch(url, { headers: { "user-agent": "dsh-purge-toolkit", accept: "application/octet-stream" }, signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function unzip(zipPath, outDir) {
  // Windows 自带 tar 能解 zip（bsdtar）；失败再退回 PowerShell Expand-Archive。
  const r = spawnSync("tar", ["-xf", zipPath, "-C", outDir], { encoding: "utf8", timeout: 120000 });
  if (r.status === 0) return true;
  const ps = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${outDir}'`], { encoding: "utf8", timeout: 180000 });
  return ps.status === 0;
}

const picks = TOOLS.filter((t) => !only.length || only.includes(t.name));
if (!picks.length) { console.log(`  没有匹配的工具名；可选：${TOOLS.map((t) => t.name).join(", ")}`); process.exit(2); }

let ok = 0, skip = 0, fail = 0;
for (const t of picks) {
  const dst = target(t);
  if (exists(dst) && !force) {
    console.log(`  · ${t.name.padEnd(10)} 已就位（${fs.statSync(dst).size} 字节）`);
    skip += 1;
    continue;
  }
  if (checkOnly) {
    // 注意 spawnSync 找不到可执行文件时 status === null 且带 error —— 不能把 null 当成功（首版就踩过，显示成 ✓ 缺失）。
    const res = spawnSync(dst, t.ver, { encoding: "utf8", timeout: 6000 });
    const runnable = !res.error && (res.status === 0 || res.status === 1);
    console.log(`  ${runnable ? "✓" : "✗"} ${t.name.padEnd(10)} ${runnable ? "可执行" : "缺失或不可执行"}${res.error ? "（" + String(res.error.code || res.error.message).slice(0, 24) + "）" : ""}`);
    if (!runnable) fail += 1;
    continue;
  }
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${t.repo}/releases/latest`);
    const asset = (rel.assets || []).find((a) => t.re.test(a.name));
    if (!asset) throw new Error(`latest 里没有匹配 ${t.re} 的资产`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `tk-${t.name}-`));
    const tmpFile = path.join(tmpDir, asset.name);
    const size = await download(asset.url, tmpFile);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (/\.zip$/i.test(asset.name)) {
      if (!unzip(tmpFile, tmpDir)) throw new Error("解压失败（tar 与 Expand-Archive 都不成）");
      const found = [];
      const walk = (d, depth) => {
        if (depth > 3) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { walk(p, depth + 1); continue; }
          if (e.name.toLowerCase().endsWith(".exe")) found.push(p);
        }
      };
      walk(tmpDir, 0);
      const pick = found.find((p) => path.basename(p).toLowerCase() === t.bin.toLowerCase()) || found[0];
      if (!pick) throw new Error("解压后没找到 .exe");
      fs.copyFileSync(pick, dst);
    } else {
      fs.copyFileSync(tmpFile, dst);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const v = spawnSync(dst, t.ver, { encoding: "utf8", timeout: 8000 });
    const verText = String((v.stdout || "") + (v.stderr || "")).split(/\r?\n/).find((l) => l.trim()) || "";
    console.log(`  ✓ ${t.name.padEnd(10)} ${String(rel.tag_name).padEnd(10)} ${Math.round(size / 1024)}KB｜${verText.trim().slice(0, 56)}`);
    ok += 1;
  } catch (e) {
    console.log(`  ✗ ${t.name.padEnd(10)} ${String(e.message).slice(0, 70)}`);
    fail += 1;
  }
}
console.log(`  装好 ${ok}｜已存 ${skip}｜失败 ${fail}｜toolkit=${toolkit}`);
process.exit(fail ? 1 : 0);