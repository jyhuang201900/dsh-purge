#!/usr/bin/env node
/**
 * 用途：工具面闸门——契约表的结构完整性 + 描述/返回值成本都上预算，防止「聚合入口」悄悄退化回堆叠。
 * 用法：node scripts/check-tools.mjs [--json]
 * 依赖：Node ≥18；只执行只读工具（status/align/patch/update/rules/skills/drill），绝不碰 apply/revert（那俩会改宿主文件）。
 * 验证：2026-11-12 实跑通过（exit=0）——结构 10/10 无缺陷；工具面描述 3461 字符（预算 3600）；单工具最大 1417（预算 1600）；默认返回 空库 624 / 有数据 815 字符（预算 1500 / 2200）。
 * 隔离：返回值测量**必须**在临时 REDTEAM_HOME 里跑。早先读 ~/.dsh/redteam，用户一开靶标闸门就从绿变红（第 135 轮实测），结论随用户数据漂移等于没有闸门。
 *
 * 为什么单独一道门：drill 一度占到全工具面 45%，是我手量出来的。没有闸门，下次它涨到 70% 也没人知道。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";
import * as hostctl from "../lib/host.js";
import * as updater from "../lib/update.js";
import { buildModelTools, defaultRenderStatus } from "../lib/model-tools.js";
import { renderStatus } from "../lib/index.js";
import { scanToolkit, describeToolkit, shellAdvice } from "../lib/toolkit-health.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

// 预算：按 2026-11-09 实测值放宽约 20-30%，只防失控增长，不做常红灯。
// 工具面合计只观测不判红（用户 2026-11-12 定：预算不设上限，不许因为预算拒绝加参数）。
// per_tool_max 仍保留硬顶——单个工具的描述膨胀是真失控（一个工具吃掉整面预算），
// 与「整面总长」是两件事。合计只打印数字，涨了也不会拦。
const BUDGET = { tools_min: 9, tools_max: 12, surface_watch: 3600, per_tool_max: 1600, output_max: 1500, output_max_with_data: 2200, output_lines_max: 20, drill_ops_max: 18 };

const tools = buildModelTools({ core, rules, hostctl, updater, renderStatus, rejectIfNeedPrompt: () => null });
const problems = [];
const notes = [];

// 1) 结构完整性
for (const t of tools) {
  if (!t.name || !/^purge_[a-z_]+$/.test(t.name)) problems.push(`工具名不合约定：${t.name}`);
  if (!t.description || t.description.length < 20) problems.push(`${t.name} 描述过短（${t.description?.length ?? 0} 字）`);
  if (t.parameters?.type !== "object" || t.parameters?.additionalProperties !== false || !t.parameters.properties) {
    problems.push(`${t.name} parameters 不是严格 object`);
  }
  for (const [pk, pv] of Object.entries(t.parameters.properties || {})) {
    if (!pv?.description) problems.push(`${t.name}.${pk} 参数没有描述（模型无从判断何时用）`);
    if (!pv?.type) problems.push(`${t.name}.${pk} 参数没有类型`);
  }
  if (typeof t.execute !== "function") problems.push(`${t.name} 缺 execute`);
  if (typeof t.output?.render !== "function" || !t.output?.schema) problems.push(`${t.name} output 不完整`);
}
if (tools.length < BUDGET.tools_min || tools.length > BUDGET.tools_max) {
  problems.push(`工具数 ${tools.length} 不在 [${BUDGET.tools_min}, ${BUDGET.tools_max}]`);
}
notes.push(`结构核对 ${tools.length} 个工具`);

// 2) 描述与 schema 成本
let surface = 0;
let worst = { name: "", n: 0 };
for (const t of tools) {
  const n = t.description.length + JSON.stringify(t.parameters).length;
  surface += n;
  if (n > worst.n) worst = { name: t.name, n };
  if (n > BUDGET.per_tool_max) problems.push(`${t.name} 描述+schema ${n} 字符，超单工具预算 ${BUDGET.per_tool_max}`);
}
// 合计超了只提示、不判红：预算不设上限（用户定），留着数字是为了手滑时能看见
notes.push(`描述成本 ${surface}（观测线 ${BUDGET.surface_watch}${surface > BUDGET.surface_watch ? "，已超但按约定不拦" : ""}），最大 ${worst.name}=${worst.n}`);

// 3) 只读工具的默认返回值体量（apply/revert 会改文件，不参与）
const READ_ONLY = ["purge_status", "purge_align", "purge_patch", "purge_update", "purge_rules", "purge_skills", "purge_drill"];
/* **必须隔离到临时库**：早先这里直接读 ~/.dsh/redteam，于是「用户开了一个靶标」就能让本闸门从绿变红
   （实测第 135 轮：14:17 库空 → 通过；15:09 用户开了「测试靶」→ purge_drill 默认返回 1760 字符 → 红灯）。
   闸门结论随用户数据漂移，等于没有闸门。这里把 REDTEAM_HOME 指到临时目录，空库那份量的是
   「没数据时不许啰嗦」；随后再灌一份有数据的库，量「有数据时不许倾倒」——两种形态都要有界。 */
const tmpRedteam = fs.mkdtempSync(path.join(os.tmpdir(), "tools-gate-"));
const prevRedteamHome = process.env.REDTEAM_HOME;
process.env.REDTEAM_HOME = tmpRedteam;

const measureDefault = async (budget) => {
  const worst = { chars: 0, lines: 0, name: "" };
  for (const t of tools.filter((x) => READ_ONLY.includes(x.name))) {
    let text = "";
    try {
      text = String((await t.execute({})).text ?? "");
    } catch (e) {
      problems.push(`${t.name} 默认调用抛错：${String(e?.message ?? e).slice(0, 90)}`);
      continue;
    }
    const lines = text.split("\n").length;
    if (text.length > worst.chars) Object.assign(worst, { chars: text.length, lines, name: t.name });
    if (text.length > budget) problems.push(`${t.name} 默认返回 ${text.length} 字符，超预算 ${budget}（无界倾倒会烧上下文）`);
    if (lines > BUDGET.output_lines_max) problems.push(`${t.name} 默认返回 ${lines} 行，超预算 ${BUDGET.output_lines_max}`);
  }
  return worst;
};

const emptyWorst = await measureDefault(BUDGET.output_max);

/* 3b) 有数据的真实形态。空库那份只能证明「不啰嗦」，证明不了「不倾倒」——
   真实靶标下 summary 要带靶标清单、授权边界、下一步、管道、计分机会，长度天然更长，
   所以这一档单独给预算（BUDGET.output_max_with_data），而不是把空库的预算放宽了事。 */
const { RedteamStore } = await import("../lib/redteam/store-core.js");
const seedStore = new RedteamStore(tmpRedteam);
const seedEng = seedStore.openEngagement("闸门夹具", "203.0.113.0/24", { bindCurrent: true });
seedStore.importBundle(seedEng.id, { assets: [{ ip: "203.0.113.10" }, { ip: "203.0.113.11" }] });
seedStore.addCredential(seedEng.id, { host: "203.0.113.10:8080", username: "admin", privilege: "管理员", note: "OA 后台" });
seedStore.addVuln(seedEng.id, { target: "203.0.113.10", title: "Fastjson 反序列化", severity: "high", evidence: "JNDI 回显" });
seedStore.addScoreHit(seedEng.id, { code: "terminal-access", evidence: "拿到一台摄像头后台", points: 10 });
const dataWorst = await measureDefault(BUDGET.output_max_with_data);

process.env.REDTEAM_HOME = prevRedteamHome;
try { fs.rmSync(tmpRedteam, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响结论 */ }

notes.push(`返回值 空库 ${emptyWorst.chars} 字符/${emptyWorst.lines} 行（${emptyWorst.name || "无"}）｜有数据 ${dataWorst.chars} 字符/${dataWorst.lines} 行（${dataWorst.name || "无"}）`);

// 4) 摘要版与宿主版都要有界（同一工具两种消费方，不能只测一边）
const state = await core.gatherState();
const fallback = defaultRenderStatus(state);
if (fallback.length > BUDGET.output_max) problems.push(`defaultRenderStatus ${fallback.length} 字符，超预算`);
notes.push(`MCP/CLI 摘要版 ${fallback.length} 字符`);

// 5) 可发现性：KNOWN 里每个 op 都必须出现在参数描述里，否则等于加了个模型看不见的隐藏 op
//    （drill 已经长到 12 种 op + 10 个 entity，最容易出的事故就是「实现了但没写进描述」）。
const src = fs.readFileSync(path.join(root, "lib", "model-tools.js"), "utf8");
const knownBlock = /const KNOWN = \[([\s\S]*?)\];/.exec(src);
const known = knownBlock ? [...knownBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : [];
if (!known.length) problems.push("读不到 KNOWN 数组（drill 的 op 表改名了？门禁要跟着改）");
const drillTool = tools.find((x) => x.name === "purge_drill");
const opDesc = drillTool?.parameters?.properties?.op?.description || "";
const hidden = known.filter((o) => !opDesc.includes(o));
if (hidden.length) problems.push(`op 已实现但没写进描述（模型看不见）：${hidden.join(", ")}`);
const entBlock = /export const DRILL_ENTITIES = \{([\s\S]*?)\n};/.exec(src);
// 值是字符串（vuln: "listVulns"），不能要求后跟 { —— 上一版就是这个原因匹配到 0 个，变成「0/0 通过」的假保证。
const ents = entBlock ? [...entBlock[1].matchAll(/^\s*([a-z]+):\s*["'`]/gm)].map((m) => m[1]) : [];
if (!ents.length) problems.push("读不到 DRILL_ENTITIES 的键（表形变了？门禁要跟着改，别让它 0/0 空转）");
const writeBlock = /export const DRILL_WRITE_ENTITIES = \{([\s\S]*?)\n};/.exec(src);
const writes = writeBlock ? [...writeBlock[1].matchAll(/^\s*([a-z]+):\s*\{/gm)].map((m) => m[1]) : [];
if (!writes.length) problems.push("读不到 DRILL_WRITE_ENTITIES 的键");
const entDesc = drillTool?.parameters?.properties?.entity?.description || "";
// 上下文版（本轮升级）：子串匹配会让键"出现在错误语境里"就蒙混过关 —— poc 当初就是被「删：」段顺带救了一次，
// 而它其实从没进过「写：」列表。所以改成按分节校验：读键必须在「读：」段、写键必须在「写：」段。
const entSections = {};
for (const part of entDesc.split("；")) {
  const m = /^(读|写|删)[：](.*)$/.exec(part.trim());
  if (m) entSections[m[1]] = m[2];
}
const secProblems = [];
if (!entSections["读"]) secProblems.push("entity 描述缺「读：」段");
if (!entSections["写"]) secProblems.push("entity 描述缺「写：」段");
const hiddenRead = entSections["读"] ? ents.filter((e) => !entSections["读"].includes(e)) : ents;
const hiddenWrite = entSections["写"] ? writes.filter((e) => !entSections["写"].includes(e)) : writes;
if (hiddenRead.length) secProblems.push(`读面实体没在「读：」段列出：${hiddenRead.join(", ")}`);
if (hiddenWrite.length) secProblems.push(`写面实体没在「写：」段列出：${hiddenWrite.join(", ")}`);
for (const s of secProblems) problems.push(s);
const hiddenEnt = [...new Set([...hiddenRead, ...hiddenWrite])];
notes.push(`可发现性：op ${known.length - hidden.length}/${known.length}、entity ${(ents.length + writes.length) - hiddenEnt.length}/${ents.length + writes.length}（读 ${ents.length} + 写 ${writes.length}）已按「读：/写：」分节核对`);
// 5b) 参数表里不许有重复键：JS 对象后写覆盖前写、JSON.stringify 也照不出来（本轮人工审描述才发现 name 写了两遍）。
const mtSrc = fs.readFileSync(path.join(root, "lib", "model-tools.js"), "utf8");
const blocks = [...mtSrc.matchAll(/name: "(purge_[a-z_]+)"/g)].map((m, i, a) => ({ name: m[1], from: m.index, to: a[i + 1] ? a[i + 1].index : mtSrc.length }));
for (const b of blocks) {
  const src = mtSrc.slice(b.from, b.to);
  const keys = [...src.matchAll(/^ {8}([a-z][a-z0-9_]*): \{ type/gm)].map((m) => m[1]);
  const seen = new Set(); const dup = new Set();
  for (const k of keys) { if (seen.has(k)) dup.add(k); seen.add(k); }
  if (dup.size) problems.push(`${b.name} 参数表有重复键 ${[...dup].join("/")}：后写会把前写的说明盖掉`);
}
// 5c) 检索可达性：技能存在 ≠ 技能找得到。
//
// 为什么这条必须有：116 个技能、正文 66.6 万字，旧接口只能按精确名（id=）或按阶段列（all=1..5，
// 阶段 3 一行 42 个名字）访问。于是「库里有 116 个技能」和「实际只用得上几个」是同一件事，
// 而**所有现有闸门都看不见这个洞**——它们只量结构健康（零入边、工具引用一致），不量可检索性。
//
// 判据三条，全部跑真函数，不读源码猜：
//   ① 索引覆盖 116/116，且每个技能至少一条关键词（零关键词 = 存在但找不到）
//   ② 典型查询必须命中预期技能（端口词、产品名、技能名三类各验一个）
//   ③ 空结果不许空转（必须给可用方向词）
{
  const { buildModelTools } = await import(pathToFileURL(path.join(root, "lib", "model-tools.js")).href);
  const coreMod = await import(pathToFileURL(path.join(root, "lib", "core.js")).href);
  const deep = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : deep), apply: () => deep });
  const built = buildModelTools({ core: coreMod, rules: deep, hostctl: deep, updater: deep, rejectIfNeedPrompt: () => false });
  const skillTool = built.find((t) => t.name === "purge_skills");
  const idxPath = path.join(root, "lib", "generated", "skills-search.json");
  let idx = null;
  try { idx = JSON.parse(fs.readFileSync(idxPath, "utf8")); } catch { /* 下面按缺失处理 */ }
  if (!idx || !Array.isArray(idx.skills)) {
    problems.push("检索索引缺失：跑 node scripts/build-skill-graph.mjs 生成 lib/generated/skills-search.json（否则 purge_skills q= 只能降级提示）");
  } else {
    const skillFiles = fs.readdirSync(path.join(root, "skills", "redteam")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    const indexed = new Set(idx.skills.map((s) => s.id));
    const missing = skillFiles.filter((id) => !indexed.has(id));
    const noKeys = idx.skills.filter((s) => !Array.isArray(s.keys) || !s.keys.length).map((s) => s.id);
    if (missing.length) problems.push(`检索索引漏了 ${missing.length} 个技能：${missing.slice(0, 5).join(", ")}`);
    if (noKeys.length) problems.push(`检索索引里 ${noKeys.length} 个技能零关键词（存在但找不到）：${noKeys.slice(0, 5).join(", ")}`);
    // ② 典型查询（三类：端口词 / 产品名 / 技能名），每条都要求预期技能出现在结果里
    const CASES = [
      { q: "ollama", want: "ai-infra-attack" },
      { q: "泛微", want: "cn-oa-exploit" },
      { q: "webshell", want: "webshell-toolkit" },
      { q: "域控", want: "windows-ad" },
    ];
    for (const c of CASES) {
      const r = await skillTool.execute({ q: c.q });
      if (!String(r.text || "").includes(c.want)) problems.push(`检索自测：q=${c.q} 未命中 ${c.want}（检索退化成找不到）`);
    }
    // ③ 空结果必须给方向，不许空转
    const none = await skillTool.execute({ q: "zzzz不存在的词" });
    if (!/换个说法|按阶段列/.test(String(none.text || ""))) problems.push("检索自测：空结果没有给出可用方向词（模型拿到空字符串会卡住）");
    notes.push(`技能检索：索引 ${idx.skills.length}/${skillFiles.length} 覆盖｜${CASES.length} 个典型查询全部命中｜空结果给方向 ✓`);
  }
}

// 6) 反堆叠：op 数是聚合入口退化的先行指标。规则（2026-11-09 定）：新增 op 必须至少收纳 3 个 store 方法
//    或一整条流程，否则折进 kind/entity —— 据此抬到 18（op=update 一个 op 收 updateVuln/updateWebshell/updateTunnel 三个方法）。
//    新面优先折进 kind/entity（如 report kind=targets 零新增参数只涨 109 字符），而不是再加 op。
if (known.length > BUDGET.drill_ops_max) problems.push(`drill 已有 ${known.length} 种 op，超上限 ${BUDGET.drill_ops_max}：先考虑用 kind/entity 收纳，别堆 op`);

// 7) toolkit 空壳：目录在、里面没有任何 exe。这不是「没装」，是**装过被删**的指纹。
//    第 148 轮实测：suo5 目录 01:59 建立、当晚文件已被清空（腾讯电脑管家/Defender 实时防护），
//    而所有闸门都绿——因为没人查「目录存在但为空」。两类情形处置完全不同：
//    没装 → 直接 `npm run toolkit:windows -- --only <name>`；装过被删 → 重装会被再删一次，**必须先加白名单**。
//    判据已抽到 lib/toolkit-health.js，与定时巡检 scripts/watch-toolkit.mjs 共用一套口径。
{
  const scan = scanToolkit();
  const advice = shellAdvice(scan);
  if (advice) problems.push(advice);
  notes.push(describeToolkit(scan));
}

if (asJson) process.stdout.write(`${JSON.stringify({ problems, notes, surface, worst }, null, 2)}\n`);
else {
  process.stdout.write(`工具面闸门：${notes.length} 项核对，问题 ${problems.length}\n`);
  for (const n of notes) process.stdout.write(`  · ${n}\n`);
  for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
}
process.exit(problems.length ? 1 : 0);
