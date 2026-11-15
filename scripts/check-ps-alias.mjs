#!/usr/bin/env node
/**
 * 检查技能里「在 Windows 上会被别名劫持的命令」。
 *
 * 最典型：PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，`-o`/`-w`/`-s` 全不兼容。
 * 还有 `wget`（别名）、`ls`（别名到 Get-ChildItem）、`cat`（Get-Content）、
 * `rm`/`mv`/`cp`（Remove-Item/Move-Item/Copy-Item）、`ps`（Get-Process）、`kill`（Stop-Process）。
 *
 * 判据：出现在 `​```powershell` 块内，且用了别名 + 不兼容参数。
 * 在 bash 块里写 curl 是对的（那是 Linux/Kali 侧），不判。
 */
import fs from "node:fs";
import path from "node:path";

const D = path.join(process.cwd(), "skills/redteam");
const R = path.join(D, "references");

/** 别名 → 不兼容参数特征 */
const ALIAS_TRAPS = [
  { cmd: "curl", params: /\s-(o|O|w|s|k|X|H|d|F|i)\b/, fix: "curl.exe" },
  { cmd: "wget", params: /\s-(O|q|c|–)/, fix: "wget.exe" },
  { cmd: "rm", params: /\s-rf\b|\s-f\b/, fix: "Remove-Item" },
  { cmd: "cat", params: null, fix: "Get-Content" },
  { cmd: "ls", params: /\s-l[atr]?\b/, fix: "Get-ChildItem" },
  { cmd: "ps", params: /\s-ef\b|\s-aux\b/, fix: "Get-Process" },
  { cmd: "kill", params: /\s-9\b/, fix: "Stop-Process" },
  { cmd: "grep", params: /\s-[rv]+[ni]?\b/, fix: "Select-String" },
  { cmd: "head", params: null, fix: "Select-Object -First" },
  { cmd: "tail", params: null, fix: "Select-Object -Last" },
];

const problems = [];
const files = [];
for (const [dir, label] of [[D, "skills"], [R, "references"]]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) files.push({ p: path.join(dir, f), label: `${label}/${f}` });
}

const PS_LANGS = new Set(["powershell", "ps1", "pwsh"]);
for (const { p, label } of files) {
  const lines = fs.readFileSync(p, "utf8").split("\n");
  let lang = null, start = 0, body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*```(\w*)\s*$/.exec(lines[i]);
    if (m) {
      if (lang === null) { lang = (m[1] || "").toLowerCase(); start = i + 1; body = []; }
      else {
        if (PS_LANGS.has(lang)) {
          for (let k = 0; k < body.length; k++) {
            const ln = body[k];
            if (/^\s*#/.test(ln)) continue;
            for (const t of ALIAS_TRAPS) {
              // 必须命令出现在行首或管道/分号后，且不是 curl.exe 形式
              const re = new RegExp(`(?:^|[|;&]\\s*|\\s)${t.cmd}\\s`);
              if (!re.test(ln)) continue;
              if (new RegExp(`${t.cmd}\\.exe`).test(ln)) continue;
              if (t.params && !t.params.test(ln)) continue;
              problems.push({ file: label, line: start + k, cmd: t.cmd, fix: t.fix, sample: ln.trim().slice(0, 80) });
            }
          }
        }
        lang = null; body = [];
      }
      continue;
    }
    if (lang !== null) body.push(lines[i]);
  }
}

if (problems.length) {
  console.log(`[check-ps-alias] ✗ ${problems.length} 处在脚本块里用了会被别名劫持的命令：`);
  for (const p of problems.slice(0, 20)) {
    console.log(`   ${p.file}:${p.line}  ${p.cmd} → 用 ${p.fix}`);
    console.log(`      ${p.sample}`);
  }
  console.log("  → 别名版的参数不兼容，照抄会得到 'A parameter cannot be found that matches parameter name'。");
  process.exit(1);
}
console.log(`[check-ps-alias] ✓ ${files.length} 个文件里的脚本块没有别名劫持问题`);