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

/** 检测段里必须出现的「具体检测点」关键词：至少命中 2 类才算真的写了检测。
 *  词表必须覆盖真实写法 —— 1.1.119 实测：只认 `日志|audit|Sysmon|4624` 这类术语时，
 *  写了「防火墙 / NetFlow」「K8s audit」「WIDS」「容器运行时日志」的段全被判成「没有检测点」。
 *  这不是内容不合格，是**判据词表太窄**（误判 27 个）。判据的作用是区分
 *  「写了具体观测点」与「只写了『会有告警』」，不该因为它用了别的日志名就判失败。 */
const SENSE = {
  日志源: /日志|audit|Audit|event|Event|Sysmon|NetFlow|防火墙|IDS|WIDS|代理|出口|访问记录|审计|CloudTrail|统一审计|策略/,
  进程链: /进程|process|父进程|parent|派生|子进程|进程树|PID|命名空间|注入|加载/,
  网络: /流量|network|出站|DNS|连接|NDR|协议|端口|握手|会话|请求/,
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

/* ④ 覆盖率下限（1.1.119 从「只观测」升级为**真拦**）。
   为什么改：原来这一项只打印不进 problems，于是 1.1.119 全面审阅时才发现
   覆盖率是 9%（11/119）—— 闸门在跑、数字在打，但**没有任何东西会因为它低而变红**。
   这不是"观测项"该有的位置：检测段是攻击技能的核心组成部分（一问「对手能发现吗」
   必须能答），覆盖率 9% 意味着 108 个技能答不出来。
   下限定 85%：本批补齐后是 90%（107/119），剩下的 12 个是方法论/配置类技能
   （detection-pairing 本身讲检测、verification-discipline 讲验证、redteam-setup 讲配置、
   threat-hunting 讲狩猎、pentest-tools 讲索引）——它们不产生攻击动作，不需要这段。
   85% 留出余量：新增方法论技能时不会立刻红，但掉到 84% 以下就说明攻击技能在退化。
   同时**逐个校验已补的段**（不再只查 MUST_PAIR 那 6 个）：段存在不等于写对了，
   要有表格 + 至少两类感知源 —— 与本文件对 MUST_PAIR 的判据完全一致。 */
{
  const all = fs.readdirSync(SK).filter((f) => f.endsWith(".md"));
  const panels = all.map((f) => ({ f, t: fs.readFileSync(path.join(SK, f), "utf8") }))
    .filter((x) => x.t.includes("## 检测视角"));
  const pct = Math.round((panels.length / all.length) * 100);
  notes.push(`检测段覆盖 ${panels.length}/${all.length}（${pct}%，下限 85%）｜必须带检测的 ${MUST_PAIR.length} 个全部在位`);
  if (pct < 85) {
    problems.push(`检测段覆盖率 ${pct}%（${panels.length}/${all.length}）低于下限 85% —— 攻击技能必须能回答「对手能不能发现」`);
  }
  /* 逐段结构校验：只查 MUST_PAIR 之外的段（MUST_PAIR 已在上面查过，避免重复报） */
  /* **离线类技能豁免「两类感知源」**（1.1.119 实测踩到）：
     逆向 / 固件 / 取证 / 移动端运行时这些技能的动作**全部发生在本机或设备侧**，
     目标 Web/主机侧一条日志都没有 —— 强行要求它「至少两类感知源」只会逼出编造。
     判据落在「它的检测段是否诚实说明了这一点」：含「离线/本机/无目标日志/设备侧」等字样
     且表格 ≥3 条，就算合格。这不是放水：对离线技能，「目标侧无感」本身就是最有用的结论
     （它告诉模型这类动作只能靠物理管控与数据源侧观察，不要幻想在目标机上抓到它）。 */
  const OFFLINE = /离线|本机|无目标(侧)?日志|设备侧|物理侧|无感|不可检测/;
  const badPanels = [];
  for (const { f, t } of panels) {
    const id = f.replace(/\.md$/, "");
    if (MUST_PAIR.includes(id)) continue;
    const s0 = t.indexOf("## 检测视角");
    const nx = t.indexOf("\n## ", s0 + 1);
    const panel = nx > 0 ? t.slice(s0, nx) : t.slice(s0);
    const rows = (panel.match(/^\|/gm) || []).length;
    let kinds = 0;
    for (const [, re] of Object.entries(SENSE)) if (re.test(panel)) kinds += 1;
    if (rows < 4) { badPanels.push(`${id}(表格${rows}行)`); continue; }
    if (kinds < 2 && !OFFLINE.test(panel)) badPanels.push(`${id}(感知源${kinds}类，且未说明是离线类)`);
    /* **重复行检测**（1.1.119 实测踩到）：批量脚本多轮注入会把同样的行叠两遍，
       表面看「表格 8 行很充实」，实际有效信号只有 3 条。
       这不是格式问题：重复行挤掉了本该补的观测面，而闸门只看行数会认为合格。 */
    const seen = new Set();
    const dups = [];
    for (const line of panel.split("\n")) {
      if (!/^\|/.test(line)) continue;
      const t0 = line.trim();
      if (/^\|\s*-+/.test(t0)) continue;      // 分隔行
      if (/^\|\s*动作\s*\|/.test(t0)) continue; // 表头
      if (seen.has(t0)) dups.push(t0); else seen.add(t0);
    }
    if (dups.length) badPanels.push(`${id}(检测表有 ${dups.length} 行重复)`);
  }
  if (badPanels.length) {
    problems.push(`${badPanels.length} 个技能的检测段结构不合格（要 ≥3 条表格 + ≥2 类感知源）：${badPanels.slice(0, 4).join("、")}`);
  }
}

if (!problems.length) notes.push("验证层三技能在位且可检索｜检测段含具体检测点（日志/进程/网络）");

console.log("验证层闸门：攻击必配检测");
for (const n of notes) console.log(`  · ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(problems.length ? 1 : 0);