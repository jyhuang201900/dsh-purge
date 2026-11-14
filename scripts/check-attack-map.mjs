/**
 * 第 30 关：ATT&CK 映射一致性。
 *
 * 为什么要有：ATT&CK 编号是**外部标准**，写错一个数字看不出来，但拿去和防守方核对就露馅。
 * 过去 119 个技能只有 3 个带编号（2.5%），而且沿用旧版 14 战术制（TA0005 还叫"防御规避"）。
 * 我第一版手工填表就编了 6 个不存在的编号、把 T1489 归错战术 —— 全靠这道闸才拦下来。
 *
 * 五项断言：
 *   1. 战术数是 15（v20.1），且含 TA0005=Stealth 与新增 TA0112=Defense Impairment
 *   2. 表里每个编号格式合法、tactic 都能在 TACTICS 里找到（无孤儿）
 *   3. **技能里出现的编号必须在表里**（防技能手写假编号）
 *   4. **表里的编号必须真的出现在某个技能里**（防表里塞了没人用的死数据）
 *   5. 技能不写旧战术名"防御规避"（v20 已拆分，混着写核对不上）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TECHNIQUES, TACTICS, ATTACK_VERSION, normalizeTechniqueId } from "../lib/redteam/attack-map.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "skills", "redteam");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md"));
const problems = [];

/* 1) 战术结构 */
if (TACTICS.length !== 15) problems.push(`战术数应为 15（v${ATTACK_VERSION}），实际 ${TACTICS.length}`);
const t5 = TACTICS.find((x) => x.id === "TA0005");
if (!t5 || t5.en !== "Stealth") problems.push("TA0005 应为 Stealth（v20 起 Defense Evasion 改名）");
if (!TACTICS.some((x) => x.id === "TA0112")) problems.push("缺少 TA0112 Defense Impairment（v20 新增战术）");

/* 2) 表内部一致性 */
const tacIds = new Set(TACTICS.map((x) => x.id));
const ids = Object.keys(TECHNIQUES);
for (const k of ids) {
  if (!/^T\d{4}(_\d{3})?$/.test(k)) problems.push(`编号格式不合法：${k}`);
  if (!tacIds.has(TECHNIQUES[k].tactic)) problems.push(`${k} 指向不存在的战术 ${TECHNIQUES[k].tactic}`);
}

/* 3) 技能里出现的编号必须在表里；同时收集"技能实际用到的"集合 */
const usedInSkills = new Set();
/* 只扫 `## ATT&CK 映射` 段里的表格（技能正文提到 T1xxx 不算标注，避免把示例当映射） */
for (const f of files) {
  const text = fs.readFileSync(path.join(DIR, f), "utf8");
  const i = text.indexOf("## ATT&CK 映射");
  if (i < 0) continue;
  const seg = text.slice(i);
  const end = seg.indexOf("\n## ", 3);
  const block = end === -1 ? seg : seg.slice(0, end);
  for (const m of block.matchAll(/\b(T\d{4}(?:\.\d{3})?)\b/g)) {
    const key = normalizeTechniqueId(m[1]);
    usedInSkills.add(key);
    if (TECHNIQUES[key] === undefined) {
      problems.push(`${f} 引用了表里不存在的编号 ${m[1]}（防编造：先核对 attack.mitre.org 再补表）`);
    }
  }
  /* 5) 旧战术名 */
  if (/防御规避|Defense Evasion/.test(block)) {
    problems.push(`${f} 的映射段仍在用旧战术名（v20 已拆成 Stealth + Defense Impairment）`);
  }
}

/* 4) 表里不能有死数据（列了却没有任何技能用的编号）。
   例外的注释里说明过——没例外，全部应该有归属；确实用不上的应当从表里删掉。 */
const dead = ids.filter((k) => !usedInSkills.has(k));
if (dead.length) {
  problems.push(`表里有 ${dead.length} 个编号没有任何技能使用（死数据）：${dead.slice(0, 8).join(", ")}${dead.length > 8 ? " …" : ""}`);
}

const covered = files.filter((f) => fs.readFileSync(path.join(DIR, f), "utf8").includes("## ATT&CK 映射")).length;
console.log(`[check-attack-map] ATT&CK v${ATTACK_VERSION}｜战术 ${TACTICS.length}｜技术 ${ids.length}｜技能标注 ${covered}/${files.length}｜用到的编号 ${usedInSkills.size}`);

if (problems.length) {
  for (const p of problems.slice(0, 12)) console.log(`  ✗ ${p}`);
  if (problems.length > 12) console.log(`  …另 ${problems.length - 12} 条`);
  process.exit(1);
}
console.log("  ✓ 战术结构与 v20.1 一致｜编号双向闭合（技能⊆表、表⊆技能）｜无旧战术名");
process.exit(0);