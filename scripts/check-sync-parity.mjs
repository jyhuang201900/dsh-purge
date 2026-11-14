#!/usr/bin/env node
/**
 * 第 25 关：技能 / 预设的三重同步一致性。
 *
 * 为什么要有：技能有**三个落点**，而宿主只读其中两个，且启动时会用第三个覆盖第二个：
 *
 *   仓源 skills/redteam/*.md
 *     ├─→ $DSH_HOME/redteam/skills/              （预设 customSkillDirs 发现，直接读）
 *     └─→ node_modules/dsh-purge/skills/redteam/  （包内副本）
 *           └─→ $DSH_HOME/redteam/skills/        （宿主每次启动 lib/redteam/index.js:155 铺开）
 *
 * 于是「只同步第一段」会得到一个极隐蔽的假成功：
 *   改完技能 → 同步到 ~/.dsh/redteam/skills/ → grep 得到新内容 → 看起来生效了
 *   → 宿主重启 → 包内旧文件把宿主目录覆盖回去 → 新内容消失，且没有任何报错
 *
 * 实测 2026-11-14：包内与仓源 **120/120 文件不一致**，而同步脚本一直报「已补齐」
 * （因为 onDiff 策略是 "add"，只补缺失文件，已存在的不比对内容）。
 * 预设同样：`agent.cordis.yml` 里的「阶段→技能」清单运行时是 21 个、仓源 23 个。
 *
 * 判据（全部实测，不看脚本自述）：
 *   1. 仓源每个技能文件都能在包内副本找到且内容一致
 *   2. 仓源每个技能文件都能在 $DSH_HOME/redteam/skills 找到且内容一致
 *   3. 预设 agent.cordis.yml 三处一致
 *   4. 预设里的技能计数与技能库实际数一致（防止清单过期）
 *
 * 用规范化内容比较（统一行尾、去行尾空白），不按字节 hash ——
 * CRLF/LF 差异会被误判成内容不一致，本项目实测踩过一次。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(process.argv[2] || ".");
const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const SRC = path.join(ROOT, "skills", "redteam");

const norm = (s) => String(s).replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\s+$/, "");
const read = (p) => {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
};

if (!fs.existsSync(SRC)) {
  console.error("[check-sync-parity] ✗ 找不到 skills/redteam");
  process.exit(1);
}

const srcFiles = fs.readdirSync(SRC).filter((f) => f.endsWith(".md"));
const problems = [];

/* 发现所有 profile 下的包内技能副本 */
const copies = [];
const profilesRoot = path.join(HOME, "profiles");
try {
  for (const name of fs.readdirSync(profilesRoot)) {
    const d = path.join(profilesRoot, name, "node_modules", "dsh-purge", "skills", "redteam");
    if (fs.existsSync(d)) copies.push({ label: `包内副本(${name})`, dir: d });
  }
} catch { /* 没有 profiles 目录就跳过包内检查 */ }
copies.push({ label: "运行时", dir: path.join(HOME, "redteam", "skills") });

const stats = [];
for (const c of copies) {
  let missing = 0, differ = 0;
  const differList = [];
  for (const f of srcFiles) {
    const s = read(path.join(SRC, f));
    if (s === null) continue;
    const d = read(path.join(c.dir, f));
    if (d === null) { missing += 1; continue; }
    if (norm(s) !== norm(d)) { differ += 1; if (differList.length < 3) differList.push(f); }
  }
  stats.push({ ...c, missing, differ, total: srcFiles.length });
  if (missing) problems.push(`${c.label} 缺 ${missing} 个技能文件（例：${srcFiles.slice(0, 3).join(", ")}）`);
  if (differ) problems.push(`${c.label} 有 ${differ} 个技能内容落后仓源（例：${differList.join(", ")}）→ 宿主重启会被它覆盖回去`);
}

/* 预设一致性 + 技能计数 */
const presets = [
  { label: "仓源", p: path.join(ROOT, "presets", "redteam", "agent.cordis.yml") },
  { label: "运行时", p: path.join(HOME, ".agent-presets", "redteam", "agent.cordis.yml") },
];
const presetContents = presets.map((x) => ({ ...x, text: read(x.p) }));
for (const x of presetContents) {
  if (x.text === null) problems.push(`${x.label} 预设 agent.cordis.yml 缺失`);
}
const [a, b] = presetContents;
if (a?.text && b?.text && norm(a.text) !== norm(b.text)) {
  problems.push("预设 agent.cordis.yml 仓源与运行时不一致（阶段→技能清单可能过期，新技能运行时看不到）");
}
/* 清单里的数字要与**生成器实际用的口径**对账，不能自己另算一套。
   踩过两次：
     ① 按 stage 比 → flow 写 9 实际 12（那 3 个的 role 是 aux，预设列的是角色数）
     ② 按 role 字段比 → recon 写 13 实际 5（生成器用的是 role ∪ 角色提示词里提及的技能）
   正解：直接读 skills-agents.json —— 那是生成器的中间产物，预设就是从它渲染的。
   两边同源，才能真校验「预设有没有过期」。 */
if (a?.text) {
  const declared = [...a.text.matchAll(/\|\s*`([a-z0-9-]+)`\s*[^|]*\|\s*(\d+)\s*\|/g)].map((m) => ({ code: m[1], n: Number(m[2]) }));
  const agentsPath = path.join(ROOT, "lib", "generated", "skills-agents.json");
  const agentsRaw = read(agentsPath);
  if (agentsRaw && declared.length) {
    const roleMap = JSON.parse(agentsRaw).roles || {};
    const bad = declared.filter((d) => roleMap[d.code] && (roleMap[d.code].skills || []).length !== d.n);
    if (bad.length) {
      problems.push(
        `预设里的角色技能数过期 ${bad.length} 处：` +
          bad.slice(0, 3).map((d) => `${d.code} 写 ${d.n} 实际 ${(roleMap[d.code].skills || []).length}`).join("、")
      );
    }
  }
}

const line = stats.map((s) => `${s.label} 缺${s.missing}/差${s.differ}`).join("｜");
console.log(`[check-sync-parity] 仓源 ${srcFiles.length} 个技能｜${line}`);

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 修法：node scripts/sync-bundled.mjs（它已按三重路径同步，技能与预设都覆盖）");
  console.log("  → 别手工只同步 ~/.dsh/redteam/skills/：宿主重启时包内旧文件会覆盖回去。");
  process.exit(1);
}
console.log("  ✓ 仓源 / 包内副本 / 运行时 三处一致｜预设一致｜阶段计数与技能库对得上");
process.exit(0);