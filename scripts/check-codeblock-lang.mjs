#!/usr/bin/env node
/**
 * 检查代码块的「语言标签与内容是否匹配」。
 *
 * 这类错误的典型形态（都真实存在于别人写的文档里）：
 *   ```powershell            # 标签是 powershell
 *   find / -perm -4000       # 内容却是 bash 命令 → 复制到 PS 里必报错
 *   ```
 * 模型会照代码块的语言标签选执行环境，标签错了就等于给错工具。
 *
 * 判据：只看「标签」与「内容特征」的强冲突，不做语义猜测。
 */
import fs from "node:fs";
import path from "node:path";

const D = path.join(process.cwd(), "skills/redteam");
const R = path.join(D, "references");

/** bash 强特征（在 PowerShell 里几乎必然报错） */
const BASH_ONLY = [
  /\bfind\s+\/\s/, /-perm\s+-?[0-9u]/, /\bsudo\s+/, /\bchmod\s+[0-7]{3}/,
  /^\s*export\s+[A-Z_]+=/, /\bgrep\s+-[a-zA-Z]*[rRlL]\b/, /\|\s*xargs\b/,
  /\bawk\s+'/, /\bsed\s+-i/, /\bcat\s+\/etc\//, /\.\/configure/,
  /\bsystemctl\s+/, /\bapt(-get)?\s+install/, /\byum\s+install/,
  /^\s*#!\/(bin|usr\/bin)\/(ba)?sh/,
];

/** PowerShell 强特征 */
const PS_ONLY = [
  /* 动词后面必须是驼峰名且不能紧跟 `-`：`Set-Cookie` / `Get-WinEvent` 只在前者
     不是 cmdlet 参数形态（HTTP 头、工具名），后者才是。
     不加 `(?!-)` 时 `Set-Cookie:` 会被当成 cmdlet —— 实测把 sso-flow-checklist
     里一段纯 curl 的块判成「标签是 bash 内容是 PowerShell」。 */
  /\b(Get|Set|New|Invoke|Remove|Add|Start|Stop|Write|Read|Test|Select|Where|ForEach)-[A-Z][a-z]+[A-Za-z]*(?=\s*[-|(\n]|$)/,
  /* 排除「协议/业务术语里长得像 cmdlet 的词」：DNP3 的 `Select-Before-Operate`、
       工业协议的 `Direct-Operate` 等。它们后面跟的是连字符再跟单词，不是 cmdlet 参数。 */
  /\bWrite-Host\b/, /\$env:[A-Z_]+/,
  /\bIEX\b|\bInvoke-Expression\b/, /-EncodedCommand/, /\bStart-Process\b/,
  /\[Convert\]::FromBase64String/, /\bAdd-Type\b/,
];

/** cmd 强特征 */
const CMD_ONLY = [/\bnet\s+user\s+\w+\s+\/add\b/, /\bsc\s+(query|create|config)\b/, /\breg\s+(add|query|delete)\b/, /\bschtasks\s+\/create\b/, /\bwmic\s+/];

const problems = [];
const files = [];
for (const [dir, label] of [[D, "skills"], [R, "references"]]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    files.push({ p: path.join(dir, f), label: `${label}/${f}` });
  }
}

for (const { p, label } of files) {
  const lines = fs.readFileSync(p, "utf8").split("\n");
  let lang = null;
  let start = 0;
  let body = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*```(\w*)\s*$/.exec(lines[i]);
    if (m) {
      if (lang === null) {
        lang = (m[1] || "").toLowerCase();
        start = i + 1;
        body = [];
      } else {
        // 收块
        const text0 = body.join("\n");
        const l = lang;
        /* 先剥掉「长得像 cmdlet 的业务术语」再判：DNP3 的 Select-Before-Operate、
           工业协议的 Direct-Operate。它们不可能是 cmdlet（cmdlet 是 Verb-Noun 驼峰，
           中间不会再有连字符）。不剥的话 `Select-Before` 会被当成 cmdlet 名。 */
        const text = text0.replace(/\b(Select|Direct|Class|Integrity|Operate|Before)-[A-Za-z]+(-[A-Za-z]+)?\b/g, "");
        /* 多环境并列块（`# Linux - bash` + `# Windows - powershell`）是**正确的写法**：
           一个块里放两条路，靠注释分区。标签只能填一个，不代表整块都是那个语言。
           实测踩过：shell-handler / vps-reverse-shell 等 5 处全被误判。
           判据：块内出现 ≥2 个不同平台的分区注释 → 豁免。 */
        const sections = (text.match(/^#\s*(Linux|Windows|macOS|Bash|PowerShell|cmd|sh)\b/gim) || []);
        const platforms = new Set(sections.map((s) => s.replace(/^#\s*/i, "").toLowerCase()));
        const multiPlatform = platforms.size >= 2;
        if ((l === "powershell" || l === "ps1" || l === "pwsh") && text.trim() && !multiPlatform) {
          const bashHits = BASH_ONLY.filter((re) => re.test(text));
          const psHits = PS_ONLY.filter((re) => re.test(text.replace(/(Select|Direct|Class)-[A-Z][a-z]+-[A-Z][a-z]+/g, "")));
          // 有 bash 特征但完全没有 PS 特征 → 强冲突
          if (bashHits.length && psHits.length === 0) {
            problems.push({ file: label, line: start, lang: l, why: "标签是 powershell 但内容是 bash", sample: text.trim().split("\n")[0].slice(0, 70) });
          }
        }
        if ((l === "bash" || l === "sh") && text.trim() && !multiPlatform) {
          const psHits = PS_ONLY.filter((re) => re.test(text));
          const bashHits = BASH_ONLY.filter((re) => re.test(text));
          if (psHits.length && bashHits.length === 0) {
            problems.push({ file: label, line: start, lang: l, why: "标签是 bash 但内容是 PowerShell", sample: text.trim().split("\n")[0].slice(0, 70) });
          }
        }
        lang = null;
        body = [];
      }
      continue;
    }
    if (lang !== null) body.push(lines[i]);
  }
}

if (problems.length) {
  console.log(`[check-codeblock-lang] ✗ ${problems.length} 处代码块语言标签与内容不符：`);
  for (const p of problems.slice(0, 20)) {
    console.log(`   ${p.file}:${p.line}  ${p.why}`);
    console.log(`      ${p.sample}`);
  }
  console.log("  → 模型按语言标签选执行环境，标签错 = 给错工具，照抄必报错。");
  process.exit(1);
}
console.log(`[check-codeblock-lang] ✓ ${files.length} 个文件的代码块语言标签与内容一致`);