#!/usr/bin/env node
/**
 * 抓本机真实工具的 help 到 .cache/toolhelp/，供 check-semantic-flags 比对。
 *
 * 为什么不用文档/记忆：工具的 flag 会随版本变。实测 nuclei v3.11.1 把 `-json`
 * 改名成 `-jsonl`，而 -json 直接报 `flag provided but not defined`。
 * 记忆和文档都会滞后，只有本机二进制是准的。
 *
 * 用法：node scripts/fetch-toolhelp.mjs   （宿主换工具版本后重跑）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const TK = path.join(os.homedir(), ".dsh/redteam/toolkit");
const OUT = path.join(process.cwd(), ".cache/toolhelp");

const TOOLS = [
  "nmap", "nuclei", "httpx", "naabu", "ffuf", "fscan", "subfinder",
  "dnsx", "gobuster", "feroxbuster", "chisel", "ligolo", "suo5",
  "strings", "radare2",
];

fs.mkdirSync(OUT, { recursive: true });
let ok = 0, skip = 0;

for (const t of TOOLS) {
  const dir = path.join(TK, t);
  if (!fs.existsSync(dir)) { skip++; continue; }
  // 找主程序：同名 .exe 优先，其次任一 .exe
  const exes = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".exe"));
  const main = exes.find((f) => f.toLowerCase() === `${t}.exe`) || exes.find((f) => !/uninstall|setup|ncat/i.test(f));
  if (!main) { skip++; continue; }
  const exe = path.join(dir, main);
  /* 顺序很重要：有些工具把 `-h` 用作它义 —— fscan 的 `-h` 是「目标主机」，
     拿 `-h` 去问 help 会回 `flag needs an argument: -h`。
     所以先试 `--help`/`-help`，最后才试 `-h`。
     另外 Go 的 flag 包把 usage 打在 **stderr 且 exit 0** —— execFileSync 正常返回时
     拿不到 stderr（fscan 就是这样：stdout 605 字节、stderr 4454 字节）。
     所以必须用 spawnSync 一并收两路。 */
  let text = "";
  for (const flag of ["--help", "-help", "-h"]) {
    const r = spawnSync(exe, [flag], { encoding: "utf8", timeout: 15000 });
    const merged = `${r.stdout || ""}${r.stderr || ""}`;
    if (merged.length > 200) { text = merged; break; }
  }
  if (text.length < 200) { skip++; continue; }
  fs.writeFileSync(path.join(OUT, `${t}.txt`), text);
  ok++;
  console.log(`  ${t.padEnd(14)} ${String(text.length).padStart(6)} 字节  (${main})`);
}

console.log(`\n[fetch-toolhelp] ${ok} 个工具 help 已抓｜${skip} 个跳过（未装或无可用主程序）`);
console.log("  宿主升级工具后必须重跑，否则 check-semantic-flags 会拿旧 flag 表误判。");