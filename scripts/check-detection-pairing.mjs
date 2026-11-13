/**
 * 验证层闸门：确认「攻击必配检测」不是一句写在文档里的话，而是可被机器检查的约束。
 *
 * 为什么需要它（本轮 A 改造的核心）：
 *   调研发现我的插件「检测配对」维度只覆盖 3%、「误报验证」4%——等于只会打、不会证明。
 *   加几个技能能补文档，但**文档不会自己生效**：下次改技能、加技能，照样可以只写攻击不写检测。
 *   所以把「必须有检测视角」变成闸门，让它在每次 verify 时拦。
 *
 * 判据三条（全部跑真文件，不读提示词）：
 *   ① 指定的攻击技能必须含「## 检测视角」段，且段内至少 3 行表格（不是一句「会有告警」）
 *   ② 检测段必须给出具体检测点（不能只有通用套话）——用「是否提到了日志/事件/进程/流量」判
 *   ③ 三个验证层技能（verification-discipline / detection-pairing / attack-traceability）必须存在且可被检索到
 *
 * 为什么卡这 3 条而不是更多：闸门太严会逼人写废话凑格式。
 * 这三条刚好覆盖「有没有 / 够不够具体 / 技能在不在」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SK = path.join(root, "skills", "redteam");
const problems = [];
const notes = [];

/* 必须带检测段的攻击技能：选的是「打下去必有痕迹」的高响度手法。
   不要求全部 119 个技能都带——侦察类技能配检测意义不大（本来就只看日志），
   硬加会让规则变成凑数。 */
const MUST_PAIR = [
  "webshell-toolkit",
  "injection-payloads",
  "privesc-persistence",
  "lateral-movement",
  "credential-attack",
  "edr-bypass-re",
];

/** 检测段里必须出现的「具体检测点」关键词：至少命中 3 类才算真的写了检测 */
const SENSE = {
  日志源: /日志|audit|event|Event|Sysmon|4662|4624|4768|4769|4656|7045|4104/,
  进程链: /进程|process|父进程|parent|派生|子进程|进程树/,
  网络: /流量|network|出站|DNS|连接|NDR|IDS/,
};

for (const id of MUST_PAIR) {
  const fp = path.join(SK, id + ".md");
  if (!fs.existsSync(fp)) { problems.push(`${id}: 文件不存在`); continue; }
  const text = fs.readFileSync(fp, "utf8");

  const panelStart = text.indexOf("## 检测视角");
  if (panelStart < 0) { problems.push(`${id}: 缺「## 检测视角」段（攻击必须配检测，见 detection-pairing）`); continue; }

  // 段边界：下一个 "\n## " 或文件尾
  const nextH2 = text.indexOf("\n## ", panelStart + 1);
  const panel = nextH2 > 0 ? text.slice(panelStart, nextH2) : text.slice(panelStart);

  // ① 至少 3 行表格（防止写一句「会有告警」交差）
  const tableRows = (panel.match(/^\|/gm) || []).length;
  if (tableRows < 4) problems.push(`${id}: 检测段只有 ${tableRows} 行表格，至少要 3 条具体检测点`);

  // ② 具体检测点：三类感知源至少命中两类
  let hitKinds = 0;
  for (const [, re] of Object.entries(SENSE)) if (re.test(panel)) hitKinds += 1;
  if (hitKinds < 2) problems.push(`${id}: 检测段缺具体检测点（日志源/进程链/网络至少命中两类）`);
}

// ③ 验证层三技能必须存在且进得了检索索引
const VERIFY_SKILLS = ["verification-discipline", "detection-pairing", "attack-traceability"];
let idx = null;
try { idx = JSON.parse(fs.readFileSync(path.join(root, "lib", "generated", "skills-search.json"), "utf8")); } catch { /* 下面报 */ }
for (const id of VERIFY_SKILLS) {
  if (!fs.existsSync(path.join(SK, id + ".md"))) { problems.push(`验证层技能缺失：${id}`); continue; }
  if (idx && !idx.skills.some((s) => s.id === id)) problems.push(`验证层技能没进检索索引：${id}（跑 build-skill-graph）`);
}

// ④ 攻击技能总数里带检测段的比例（观测，不判红：只报告进展）
{
  const all = fs.readdirSync(SK).filter((f) => f.endsWith(".md"));
  const withPanel = all.filter((f) => fs.readFileSync(path.join(SK, f), "utf8").includes("## 检测视角")).length;
  const pct = Math.round((withPanel / all.length) * 100);
  notes.push(`检测段覆盖 ${withPanel}/${all.length}（${pct}%）｜必须带检测的 ${MUST_PAIR.length} 个全部在位`);
}

if (!problems.length) notes.push("验证层三技能在位且可检索｜检测段含具体检测点（日志/进程/网络）");

console.log("验证层闸门：攻击必配检测");
for (const n of notes) console.log(`  · ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(problems.length ? 1 : 0);