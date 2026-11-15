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
  /* 收集可执行性块里的 `- \`tool\`：说明` 条目，供「空话检测」逐条判出口。
     只拦**块内**的条目：那是生成器写的；技能正文自己的说明不受此闸门管。 */
  const vagueLines = [];
  const blk = /runnability:start[\s\S]*?runnability:end/.exec(text);
  if (blk) {
    for (const line of blk[0].split("\n")) {
      const m = /^-\s+`([a-z0-9_.-]+)`：(.+)$/.exec(line.trim());
      if (m) vagueLines.push({ tool: m[1], note: m[2] });
    }
  }
  rows.push({ id, blocks: blocks.length, linux, missing, vagueLines, hasWin: WIN_MARK.test(text), hasToolkitMark: TOOLKIT_MARK.test(text) });
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

/* 空话检测（1.1.119）。这一条**真的拦**，与上面「只报告」的部分不同。
   为什么必须拦：可执行性块的全部价值在于「告诉模型现在能干什么」。原先生成器对
   没有替代映射的工具统一写「先确认它是否必要，必要时找官方 Windows 构建」——
   实测 140 条工具落差里 **80 条（57%）是这种句子**，模型读到只会跳过，
   等于块存在但零信息量。这不是措辞问题，是「承诺了却给不出」的变体：
   块声称在解决落差，实际一条出口都没给。
   判据：块内每个 `- \`tool\`：` 条目，冒号后的说明必须**至少命中一类出口**：
     · 一条可复制的命令（反引号里含空格或 `-` 参数，如 `fscan -h ...`）
     · 明确的替代工具名（「用 `xxx` 替代」/「改用」）
     · 明确的「本机没有是对的」类说明（只能目标机跑 / 离线跑 / 本机不需要）
     · 一条安装命令（`pip install` / `npm run` / `apt` / 官方 zip 包名）
   四类都不命中 = 空话。 */
/* 判据从「猜自然语言」改成「看有没有具体标识」。
   原因：语义正则永远追不上真实写法 —— 第一版要求「用 X 替代」紧邻，
   把 nikto→nuclei 误判；第二版放宽后，bloodhound「可本机跑」、john「官方 run/ 里有 john.exe」、
   nc「用 ncat.exe」又都漏过。**改判据的方向错了**：应该问「这条说明有没有点到具体名字」，
   而不是「它属于哪类出口」。
   判据（可机器判、不依赖措辞）：
     a. 命中原始空话模板 → 空话
     b. 说明里**没有任何反引号**（没点任何工具名/命令/包名）→ 空话
     c. 有反引号，但反引号里只有 1-2 个字符 → 空话（不成其为标识）
   这样 nikto(`nuclei`)、bloodhound(`SharpHound.exe`)、john(`run/`)、nc(`ncat.exe`) 全部通过，
   而「先确认它是否必要，必要时找官方 Windows 构建」这种一句空话会被 a 拦下。 */
const VAGUE = /先确认它是否必要|必要时找官方 Windows 构建|本机无、也无已验证替代/;
const vague = [];
for (const r of rows) {
  for (const v of r.vagueLines || []) {
    if (VAGUE.test(v.note)) { vague.push({ id: r.id, tool: v.tool, note: v.note, why: "套话" }); continue; }
    const spans = [...v.note.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((x) => x.length >= 3);
    if (!spans.length) { vague.push({ id: r.id, tool: v.tool, note: v.note, why: "没点任何具体名字" }); continue; }
  }
}
if (vague.length) {
  console.log(`  ✗ 可执行性块里有 ${vague.length} 条空话（${[...new Set(vague.map((v) => v.why))].join("/")}）：`);
  for (const v of vague.slice(0, 6)) console.log(`      ${v.id} · \`${v.tool}\`（${v.why}）：${v.note.slice(0, 80)}`);
  console.log("  → 空话比没有更糟：块声称在解决落差，模型却拿不到任何可执行的出口。");
  console.log("    （判据：不许套话 + 说明里必须用反引号点到具体工具名/命令/包名）");
  process.exit(1);
}
console.log("  ✓ 可执行性块无空话（每条落差都点到了具体工具/命令/包名，或说明了为何本机不需要）");
process.exit(0);
