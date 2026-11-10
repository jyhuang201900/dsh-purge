#!/usr/bin/env node
/**
 * 用途：字典装配器——把技能里引用的 Linux 字典路径在 Windows 上落地，让 ffuf/feroxbuster/gobuster 真能跑。
 * 用法：node scripts/wordlists-windows.mjs [--check] [--only NAME] [--force]
 *   --check  只报状态（有/缺/大小），不下载
 *   --only   只处理指定名字（逗号分隔）
 *   --force  已存在也重下
 * 依赖：Node ≥18；下载走 curl（与 toolkit-windows 同一套代理回退）。
 *
 * 为什么需要（第 126 轮实测）：
 *   技能里所有字典路径都是 `/usr/share/seclists/...`，而本机一个字典都没有。
 *   真跑 `ffuf -w /usr/share/seclists/Discovery/Web-Content/common.txt` 报
 *   `GetFileAttributesEx E:\usr\share\seclists\... : The system cannot find the path specified`
 *   ——**Windows 把绝对路径当相对路径拼到盘符后面**，所以这条命令不是「可能失败」而是**必然失败**。
 *   与第 125 轮 nuclei 模板同一类问题：**工具装好了 ≠ 能用**。
 *
 * 落点：`$DSH_HOME/redteam/wordlists/<名字>.txt`（与 toolkit 并列，进白名单时一起加）。
 * 每个字典都记来源 URL 与大小，`--check` 能看出「装了但被删」与「从没装过」的区别。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");
const onlyArg = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? String(process.argv[i + 1] || "") : ""; })();
const only = onlyArg.split(",").map((x) => x.trim()).filter(Boolean);

const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const dir = path.join(home, "redteam", "wordlists");

/**
 * 字典清单：全部指向 SecLists 的原始文件（raw.githubusercontent），
 * 名字与技能里引用的文件名保持一致，便于把技能里的路径直接映射过来。
 *
 * 第 126 轮实测：`directory-list-2.3-medium.txt` 与 `directory-list-lowercase-2.3-medium.txt`
 * 在 SecLists 的 master 上**都是 404**（已移除或改名），而 `raft-small-*` 是 200。
 * 所以清单只收**实测存在**的文件——列一条 404 的进去，用户会看到「下载失败」却不知道为什么。
 */
const LISTS = [
  { name: "common", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/common.txt", min: 4000 },
  { name: "raft-medium-directories", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/raft-medium-directories.txt", min: 20000 },
  { name: "raft-large-directories", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/raft-large-directories.txt", min: 50000 },
  { name: "raft-small-directories", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/raft-small-directories.txt", min: 5000 },
  { name: "raft-small-words", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/raft-small-words.txt", min: 5000 },
  { name: "quickhits", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/Web-Content/quickhits.txt", min: 2000 },
  { name: "subdomains-top1million-20000", url: "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Discovery/DNS/subdomains-top1million-20000.txt", min: 20000 },
];

/** 只读系统代理（不改它——用户的代理归用户管） */
function systemProxy() {
  try {
    const out = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"], { encoding: "utf8", timeout: 5000 });
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(String(out.stdout || ""));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const targetOf = (t) => path.join(dir, `${t.name}.txt`);

/** 下载：curl 代理 → curl 直连（与 toolkit-windows 同一条路，实测代理可通） */
function fetchList(url, dest) {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || systemProxy();
  const tries = [];
  if (proxy) tries.push(["--proxy", proxy]);
  tries.push([]);
  for (const extra of tries) {
    try { fs.rmSync(dest, { force: true }); } catch { /* 忽略 */ }
    const r = spawnSync("curl", ["-sS", "-L", ...extra, "--ssl-no-revoke", "-m", "180", "-o", dest, "-w", "%{http_code}", url], { encoding: "utf8", timeout: 200000 });
    const code = String(r.stdout || "").trim();
    if (r.status === 0 && code.startsWith("2") && sizeOf(dest) > 1024) return { ok: true, via: extra.length ? "proxy" : "direct" };
    tries.push;
  }
  try { fs.rmSync(dest, { force: true }); } catch { /* 忽略 */ }
  return { ok: false, via: "" };
}

const picks = LISTS.filter((t) => !only.length || only.includes(t.name));
if (!picks.length) {
  console.log(`  没有匹配的字典名；可选：${LISTS.map((t) => t.name).join(", ")}`);
  process.exit(2);
}

if (!checkOnly) fs.mkdirSync(dir, { recursive: true });

let ok = 0, skip = 0, fail = 0;
for (const t of picks) {
  const dst = targetOf(t);
  const have = sizeOf(dst);
  if (have >= t.min && !force) {
    console.log(`  · ${t.name.padEnd(30)} 已就位（${Math.round(have / 1024)}KB）`);
    skip += 1;
    continue;
  }
  if (checkOnly) {
    // 「目录在但文件小/不在」与「从没装过」要分开说——与工具那边同一判据
    const dirExists = fs.existsSync(dir);
    const tag = have > 0 && have < t.min ? `不完整（${have}B < ${t.min}B）` : dirExists ? "缺失（目录在，文件不在）" : "缺失（目录都没有）";
    console.log(`  ✗ ${t.name.padEnd(30)} ${tag}`);
    fail += 1;
    continue;
  }
  const r = fetchList(t.url, dst);
  const got = sizeOf(dst);
  if (r.ok && got >= t.min) {
    console.log(`  ✓ ${t.name.padEnd(30)} ${Math.round(got / 1024)}KB｜${r.via}`);
    ok += 1;
  } else {
    console.log(`  ✗ ${t.name.padEnd(30)} 下载失败或过小（${got}B，要求 ≥ ${t.min}B）`);
    fail += 1;
  }
}

console.log(`  ${checkOnly ? "字典检查" : "装好"} ${checkOnly ? `缺失 ${fail}` : `${ok}｜已存 ${skip}｜失败 ${fail}`}｜目录=${dir}`);
process.exit(fail ? 1 : 0);
