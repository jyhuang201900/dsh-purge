#!/usr/bin/env node
/**
 * 第 37 关：技能正文里的 toolkit 路径与「本机是否真有」一致。
 *
 * 为什么单独成关：第 14 关只检查「有没有『本机可执行性』块」，块里有说明就算过。
 * 但**技能正文的工具表**是模型最先照抄的地方 —— 那里裸写
 * `~/.dsh/redteam/toolkit/gogo/gogo` 而本机没有，模型会直接复制这条路径去执行，
 * 撞空之后才发现块里说「本机未装」。**块在文末，路径在正文，读的顺序反了。**
 *
 * 1.1.119 实测：24 处缺失路径里 20 处已有侧别声明（`suo5-linux-amd64` 是目标机载荷、
 * `fscan_windows_x64.exe` 标注了「需自行补上」），只有 4 处是真裸写：
 * active-scan 的 gogo、recon-pipeline 的 ksubdomain / OneForAll、dir-bruteforce 的 dirsearch。
 * **不能一律报红** —— 目标机载荷本机没有是对的，全报会让闸门失去区分力。
 *
 * 判据（只卡「裸写」）：
 *   路径在本机不存在，且同一段落（前后 3 行）里没有任何一侧标注 → 缺陷
 *   标注词包括：本机未装 / 本机无 / 目标机 / VPS / 载荷 / 需自行 / 不下载 / 自行放 / 替代 ...
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const SKILLS = path.join(ROOT, "skills", "redteam");
const TK = path.join(process.env.DSH_HOME || path.join(process.env.HOME || process.env.USERPROFILE || "", ".dsh"), "redteam", "toolkit");

if (!fs.existsSync(SKILLS)) {
  console.log("[check-toolpaths] 跳过：找不到 skills/redteam");
  process.exit(0);
}

/* 侧别声明的搜索范围：**同一小节（最近一个 `## ` 标题之后）**，不是「前后 3 行」。
   实测踩到：`dir-bruteforce` 在 `## 三、dirsearch` 标题下先写了「本机未装 + 替代命令」，
   代码块在第 61 行，离标注 5 行 —— 按「前后 3 行」判就成了裸写。
   判据要匹配**人写文档的方式**：一个工具的选择说明与其命令总在同一节里，
   不可能每次都紧贴 3 行。反过来，只要同一节没说清侧别，就是真缺陷。 */
const SIDE_HINT = /本机未装|本机无|本机没有|目标机|目标上(\s|）|,|，)|VPS|载荷|需自行|不下载|自行放|替代：|用\s*`/;

function sectionOf(lines, i) {
  let start = 0;
  for (let k = i; k >= 0; k -= 1) if (/^##\s/.test(lines[k])) { start = k; break; }
  let end = lines.length;
  for (let k = i + 1; k < lines.length; k += 1) if (/^##\s/.test(lines[k])) { end = k; break; }
  return lines.slice(start, end).join("\n");
}

const problems = [];
const declared = [];
let checked = 0;

for (const f of fs.readdirSync(SKILLS).filter((x) => x.endsWith(".md"))) {
  const id = f.replace(/\.md$/, "");
  const lines = fs.readFileSync(path.join(SKILLS, f), "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(/toolkit\/([a-z0-9._-]+)\/([A-Za-z0-9._-]+)/g)) {
      checked += 1;
      const full = path.join(TK, m[1], m[2]);
      if (fs.existsSync(full) || fs.existsSync(full + ".exe")) continue;
      const ctx = sectionOf(lines, i);
      const rel = `${m[1]}/${m[2]}`;
      if (SIDE_HINT.test(ctx)) { declared.push(`${id}→${rel}`); continue; }
      problems.push({ id, rel, line: i + 1, text: lines[i].trim().slice(0, 90) });
    }
  }
}

console.log(`[check-toolpaths] toolkit 路径 ${checked} 处｜缺失但已声明侧别 ${declared.length}｜**裸写缺失 ${problems.length}**`);

if (problems.length) {
  const uniq = [...new Map(problems.map((p) => [p.rel, p])).values()];
  console.log("  ✗ 以下路径本机不存在，且同段没有任何侧别声明（模型会直接照抄撞空）：");
  for (const p of uniq.slice(0, 10)) {
    console.log(`      ${p.id}:${p.line}  ${p.rel}  —— ${p.text}`);
  }
  console.log("  → 两种修法：① 补「本机未装 + 用什么替代」；② 若本是目标机/VPS 侧载荷，标出它在哪一侧。");
  process.exit(1);
}
console.log("  ✓ 所有本机不存在的 toolkit 路径都已在同段说明它的侧别或替代方案");
process.exit(0);