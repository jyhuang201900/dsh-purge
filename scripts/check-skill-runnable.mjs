#!/usr/bin/env node
/**
 * 用途：纸面功夫体检——技能里写的命令，在本机到底跑不跑得起来。
 * 用法：node scripts/check-skill-runnable.mjs [--json] [--limit N]
 * 依赖：Node ≥18；只读技能文件 + 只探本机可执行性（where/which），不执行技能里的命令。
 *
 * 为什么需要它：技能有 114 个、60 万字体量，看着很厚；但「厚」不等于「打得出去」。
 * 技能正文里的命令是按 Linux/Kali 写的，而本机是 Windows；工具也只有 3/14 装上。
 * 没人量过这个落差，于是「最强进攻手」可能只是纸面最强。本闸门把落差量出来：
 *   · LinuxOnly  —— 命令里出现 sudo / apt / /usr/share / chmod +x 这类只有 Kali 能跑的形态
 *   · MissingTool—— 命令调用的工具在本机 PATH 与 toolkit 里都没有
 *   · NoWinPath  —— 该技能既没写 Windows 等价命令，也没标「本机未装/换等价工具」
 * 判据都来自实测（探测本机），不是照着记忆列名单。
 *
 * 注意：本闸门**只报告不拦**（exit 0）。它不是合格线，是雷达：
 * 工具按需装、平台靠人切换，都属正常；但**落差必须可见**——否则模型以为能打，一执行就撞空。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const asJson = process.argv.includes("--json");
const root = process.cwd();
const SKILLS = path.join(root, "skills", "redteam");
const argvLimit = process.argv.indexOf("--limit");
const limit = argvLimit > 0 ? Number(process.argv[argvLimit + 1]) || 0 : 0;

/** 技能里点名调用、且值得探本机的工具（含常见别名） */
const TOOLS = [
  "nmap", "masscan", "naabu", "subfinder", "dnsx", "httpx", "katana", "gau", "waybackurls",
  "nuclei", "ffuf", "feroxbuster", "gobuster", "dirsearch", "wfuzz", "whatweb", "wafw00f", "nikto", "dalfox",
  "sqlmap", "hydra", "hashcat", "john", "medusa",
  "msfconsole", "msfvenom", "impacket", "netexec", "nxc", "crackmapexec", "bloodhound", "rubeus", "mimikatz",
  "fscan", "gogo", "suo5", "chisel", "frpc", "frps", "ligolo", "proxychains", "responder", "bettercap",
  "frida", "objection", "apktool", "jadx", "ghidra", "radare2", "r2", "objdump", "readelf", "strings", "binwalk",
  "yara", "volatility", "tshark", "tcpdump", "aircrack-ng", "hashcat-utils",
  "curl", "wget", "nc", "ncat", "socat", "openssl", "python", "python3", "pip", "pip3", "node", "go",
];

/**
 * 本机是否有这个工具：**双探** —— PATH 或 $DSH_HOME/redteam/toolkit/<name>/<name>[.exe]。
 * 只探 PATH 会假阳性：toolkit 里装好的工具不在 PATH（实测 naabu 已装却被判缺失），
 * 那样闸门就会说谎。口径必须与 sync-tool-status.mjs 一致。
 */
const TK = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh"), "redteam", "toolkit");
const have = new Map();
function has(tool) {
  if (have.has(tool)) return have.get(tool);
  const base = tool.replace(/\.exe$/i, "");
  for (const cand of [path.join(TK, base, base + ".exe"), path.join(TK, base, base), path.join(TK, base + ".exe")]) {
    try { if (fs.statSync(cand).size > 0) { have.set(tool, true); return true; } } catch { /* 下一个 */ }
  }
  let ok = false;
  for (const probe of ["where.exe", "which"]) {
    try { execFileSync(probe, [tool], { stdio: "ignore", timeout: 3000 }); ok = true; break; } catch { /* 试下一个 */ }
  }
  have.set(tool, ok);
  return ok;
}

/** Linux 专属形态：拆成数组逐条测，避免在正则里写 '/' 把字面量截断 */
const LINUX_MARKS = [
  [/\bsudo\b/g, "sudo"],
  [/\bapt(-get)?\s+(install|update|upgrade)\b/g, "apt"],
  [/\bsystemctl\b/g, "systemctl"],
  [/\/usr\/bin\//g, "/usr/bin"],
  [/\/usr\/share\//g, "/usr/share"],
  [/\/etc\/passwd\b/g, "/etc/passwd"],
  [/\bchmod\s+\+x\b/g, "chmod +x"],
  [/\bcat\s+\/etc\//g, "cat /etc"],
  [/~\//g, "~/"],
  [/\|\s*tee\s/g, "| tee"],
  [/\.\/\w+/g, "./本地脚本"],
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WIN_MARK = /windows|powershell|\.exe\b/i;
// 「该技能已经告诉模型本机缺什么」的标记：既认手写的「本机工具实况」表，
// 也认 inject-runnability.mjs 生成的「本机可执行性」块。
const TOOLKIT_MARK = /本机工具实况|本机可执行性|toolkit:check|toolkit:windows|未装|换等价|不适用/;

const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
const rows = [];
let cmdSkills = 0, cmdBlocks = 0;

for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(SKILLS, f), "utf8");
  const blocks = [...text.matchAll(/```(?:bash|sh|shell|powershell|ps1)?\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const body = blocks.join("\n");
  if (blocks.length) cmdSkills += 1;
  cmdBlocks += blocks.length;
  if (!body.trim()) { rows.push({ id, blocks: 0, linux: [], missing: [], hasWin: WIN_MARK.test(text), hasToolkitMark: TOOLKIT_MARK.test(text) }); continue; }

  const linux = [];
  for (const [re, label] of LINUX_MARKS) {
    const n = (body.match(re) || []).length;
    if (n) linux.push(`${label}×${n}`);
  }
  const missing = TOOLS.filter((t) => {
    const re = new RegExp("(?:^|[\\s|&;($`])" + esc(t) + "(?=[\\s|&;)$`\\\\]|$)", "m");
    return re.test(body) && !has(t);
  });
  rows.push({ id, blocks: blocks.length, linux, missing, hasWin: WIN_MARK.test(text), hasToolkitMark: TOOLKIT_MARK.test(text) });
}

const withCmd = rows.filter((r) => r.blocks > 0);
const linuxRows = rows.filter((r) => r.linux.length);
const missRows = rows.filter((r) => r.missing.length);
// 关键落差：命令调了本机没有的工具，却没写 Windows 等价 / 没标未装 → 模型会直接照抄撞空
const silent = rows.filter((r) => r.missing.length && !r.hasWin && !r.hasToolkitMark);

const toolAgg = new Map();
for (const r of missRows) for (const t of r.missing) toolAgg.set(t, (toolAgg.get(t) || 0) + 1);

if (asJson) {
  process.stdout.write(JSON.stringify({
    skills: rows.length, withCommands: withCmd.length, commandBlocks: cmdBlocks,
    linuxOnly: linuxRows.length, missingTool: missRows.length, silentGap: silent.length,
    topMissingTools: [...toolAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t, n]) => ({ tool: t, skills: n })),
    silent: silent.slice(0, limit || 20).map((r) => ({ id: r.id, missing: r.missing.slice(0, 6) })),
    linuxHeaviest: linuxRows.sort((a, b) => b.linux.length - a.linux.length).slice(0, limit || 10).map((r) => ({ id: r.id, marks: r.linux.length })),
  }, null, 1) + "\n");
} else {
  console.log(`纸面功夫体检：技能 ${rows.length} 个｜含命令块 ${withCmd.length}｜命令块 ${cmdBlocks}`);
  console.log(`  Linux 专属形态的技能: ${linuxRows.length}`);
  console.log(`  调了本机没有的工具的技能: ${missRows.length}`);
  console.log(`  ★ 静默落差（缺工具又没写 Windows 等价/未装标注）: ${silent.length}`);
  if (silent.length) {
    console.log(`    最该补的（前 ${Math.min(limit || 8, silent.length)}）:`);
    for (const r of silent.slice(0, limit || 8)) console.log(`      ${r.id}：缺 ${r.missing.slice(0, 5).join(", ")}`);
  }
  console.log(`  被引用最多的缺失工具: ` + [...toolAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t}(${n})`).join("  "));
  console.log(`  Linux 形态最多的技能: ` + linuxRows.sort((a, b) => b.linux.length - a.linux.length).slice(0, 8).map((r) => `${r.id}(${r.linux.length})`).join("  "));
  console.log("  （本闸门只报告不拦：工具按需装、平台靠人切换都属正常，但落差必须可见）");
}
process.exit(0);
