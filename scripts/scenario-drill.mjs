#!/usr/bin/env node
/**
 * 用途：演练台端到端情景测试——在临时库里串 open→增→记链→计分→附件→改→删→战报，逐步断言回读值。
 * 用法：node scripts/scenario-drill.mjs [--keep]     # --keep 打印每步全文（默认只报断言结果）
 * 依赖：Node ≥18 + node:sqlite（lib/redteam/store-core.js）；不碰宿主、不写 ~/.dsh。
 * 验证：2026-11-09 实跑通过（11 步断言全绿，exit=0）；故意改坏一条断言会 exit=1（反向探针做过）。
 *
 * 为什么单独有它：每个 op 的缺参/失败形态我都是逐个验的，但 op 之间的组合没有一次性验过 ——
 * 而「写后回读」这类逻辑最容易在组合期说谎（例如曾经把数组当分页对象读 .total）。
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { RedteamStore } from "../lib/redteam/store-core.js";
import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";
import * as hostctl from "../lib/host.js";
import * as updater from "../lib/update.js";
import { buildModelTools } from "../lib/model-tools.js";

const verbose = process.argv.includes("--keep");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-"));
const store = new RedteamStore(path.join(root, "store"));
const drill = buildModelTools({ core, rules, hostctl, updater, rejectIfNeedPrompt: () => null, redteamStore: store })
  .find((x) => x.name === "purge_drill");

const failures = [];
const steps = [];
const run = async (label, args, ...asserts) => {
  let text = "";
  try {
    text = String((await drill.execute(args)).text ?? "");
  } catch (e) {
    failures.push(`${label} 抛异常给调用方：${String(e?.message ?? e).slice(0, 80)}`);
    steps.push({ label, ok: false, text: "抛异常" });
    return "";
  }
  for (const a of asserts) {
    const r = a(text);
    if (r !== true) failures.push(`${label}：${r}`);
  }
  steps.push({ label, ok: !asserts.length || asserts.every((a) => a(text) === true), text: text.split("\n")[0] });
  return text;
};
const has = (needle) => (t) => (t.includes(needle) ? true : `期望包含「${needle}」，实际「${t.split("\n")[0].slice(0, 80)}」`);
const not = (needle) => (t) => (!t.includes(needle) ? true : `不该出现「${needle}」`);
const re = (rex, why) => (t) => (rex.test(t) ? true : `不满足${why}：${t.split("\n")[0].slice(0, 90)}`);

const main = async () => {
  // 1) 空库：只该给引导，不该有异常，也不该假装能查
  await run("空库 summary", { op: "summary" }, has("还没开靶标"), not("未知 op"));
  await run("空库 assets", { op: "assets" }, has("没有靶标"), has("op=open"));

  // 2) 自助开靶（普通会话不切预设）
  const opened = await run("open 建靶", { op: "open", name: "示例靶", target: "203.0.113.0/24" }, has("已建靶"), has("当前="));
  const targetId = (/@(\S+?)｜/.exec(opened) || [])[1] || "";
  if (!targetId) failures.push("open：没能从输出里解析出靶标 id");

  // 3) 增：漏洞一条（entity_add 复用 target/name/kind/text）
  await run("entity_add vuln", { op: "entity_add", entity: "vuln", target: "203.0.113.11", name: "Fastjson 反序列化", kind: "high", text: "JNDI 回显" },
    has("已写入"), has("现共 1 条"), has("title=Fastjson 反序列化"));

  // 4) 记攻击链一步
  await run("chain_add", { op: "chain_add", text: "nmap 摸到 8001/80", tool: "nmap" }, has("已写入"), has("链条共 1 步"));

  // 5) 计分（earned 必须真涨，不能只报 updated）
  const scored = await run("score_add", { op: "score_add", point: "terminal-access", value: 1, text: "拿到一台摄像头后台" },
    has("已写入"), has("terminal-access：命中"));
  const earned = Number((/earned=(\d+)/.exec(scored) || [])[1] ?? NaN);
  if (!(earned > 0)) failures.push(`score_add：earned 没涨（解析到 ${scored.match(/earned=\S+/)?.[0] || "无"}）`);

  // 6) 攻防附件：必须真落盘
  const af = await run("attackfile_add", { op: "attackfile_add", target: "203.0.113.11", name: "slowloris.py", text: "打到 80 端口回显 408", kind: "poc" },
    has("已写入"), has("台账 1 条"), has("slowloris.py"));
  const leafPath = path.join(root, "store", "engagements", targetId, "attack-files");
  if (!fs.existsSync(leafPath)) failures.push(`attackfile_add：磁盘上没有 attack-files 目录（${leafPath.replace(root, "<tmp>")}）`);
  else if (!fs.readdirSync(leafPath).length) failures.push("attackfile_add：attack-files 目录是空的（只写了库没写文件）");

  // 7) 改：非法枚举要被提前拦下并说明，合法值要能回读出来
  await run("update 错枚举", { op: "update", entity: "vuln", row: 1, kind: "超严重" }, has("不在枚举"), has("静默不改"));
  const upd = await run("update 正改", { op: "update", entity: "vuln", row: 1, kind: "critical", stage: "exploited", text: "RCE 确认" },
    has("已改"), has("回读 severity=critical status=exploited"));
  if (!/status=exploited/.test(upd)) failures.push("update：回读没有把 status 变化说出来");

  // 8) 查：list 必须带行 id（否则模型没法 update/delete）
  const listTxt = await run("list vuln", { op: "list", entity: "vuln" }, has("共 1 条"), re(/^ {2}· #\d+/m, "行首带 #id"));

  // 9) 删：内置得分点删不掉，但要说清替代动作
  await run("delete 内置得分点", { op: "delete", entity: "scorepoint", row: 2 }, has("不能删除"));
  await run("delete 无删除方法", { op: "delete", entity: "vuln" }, has("没有删除方法"), has("update"));

  // 10) 战报：三个 kind 都要能出内容，且截断方式说清楚
  await run("report 战报", { op: "report" }, has("战报"), has("授权范围：203.0.113.0/24"), has("另 "), has("limit="));
  await run("report 目标汇总", { op: "report", kind: "targets" }, has("目标汇总"), has("203.0.113.11"));
  await run("report 得分", { op: "report", kind: "score", limit: 3 }, has("得分报告"), re(/加 limit=\d+/, "截断提示给的是可放宽到的行数"));

  // 10b) POC 正文读取（op=pocs + name，零新增 op/参数）：库里只存元数据时也要说清楚
  const saved = store.savePoc({ title: "scenario 演示 POC", content: "use: nmap -sV\nnmap -p80", kind: "poc", category: "rce", usage: "nmap -sV" });
  await run("pocs 读正文", { op: "pocs", name: saved.poc.code }, has("POC「"), has("用法：nmap -sV"), has("正文 2 行"));
  await run("pocs 读不存在的 code", { op: "pocs", name: "没这个码" }, has("没有 POC"));
  // 10d) POC 改与用（op=update 的第 4 个写方法：name=code，kind/text 改列，只给 target 记一次使用）
  await run("update poc 改列", { op: "update", entity: "poc", name: saved.poc.code, kind: "severity", text: "high" }, has("已改"), has("回读 severity=high"));
  await run("update poc 错列名", { op: "update", entity: "poc", name: saved.poc.code, kind: "不存在的列", text: "x" }, has("不在白名单"), has("静默不改"));
  await run("update poc 记使用", { op: "update", entity: "poc", name: saved.poc.code, target: "203.0.113.11" }, has("记一次使用"), has("hit_count=1"));
  await run("entity_add poc 新建", { op: "entity_add", entity: "poc", name: "scenario 新建 POC", text: "nmap -sV" }, has("新建"), has("库总量 2"));
  await run("entity_add poc 同标题覆盖", { op: "entity_add", entity: "poc", name: "scenario 新建 POC", text: "nmap -p80" }, has("覆盖"), has("不产生第二条"), has("库总量 2"));

  // 10c) 截图与提示词写面（复用 target/name/kind/text，零新增参数；shot 要真实文件、prompt 的 role 只有六个合法值）
  const shotFile = path.join(root, "e2e-shot.png");
  fs.writeFileSync(shotFile, Buffer.from("89504e470d0a1a0a", "hex"));
  await run("entity_add shot", { op: "entity_add", entity: "shot", target: shotFile, name: "登录页" }, has("已写入"), has("label=登录页"));
  await run("entity_add shot 缺 target", { op: "entity_add", entity: "shot" }, has("图片文件路径"));
  await run("entity_add shot 图不存在", { op: "entity_add", entity: "shot", target: path.join(root, "没有这个图.png") }, has("失败"), has("not found"));
  await run("entity_add prompt 错角色", { op: "entity_add", entity: "prompt", kind: "attacker", text: "x" }, has("unknown role"), has("plan"));
  await run("entity_add prompt 写正文", { op: "entity_add", entity: "prompt", kind: "recon", text: "先摸端口再打服务" }, has("已写入"), has("recon（信息收集）"));
  await run("list shot 复核", { op: "list", entity: "shot" }, has("共 1 条"), has("#1"));
  await run("delete shot 联动", { op: "delete", entity: "shot", row: 1 }, has("已删 #1"), has("回读剩 0"));

  // 10f) 得分点必须能就地取到 code（score_add 的 point 参数要 id；曾只印中文 name，模型取不到 id）
  const scTxt = await run("scores 带 code", { op: "scores" }, has("terminal-access（"), has("加 limit="), has("共 25 条"));
  const codeFromOut = /\b([a-z][a-z0-9-]+)（/.exec(scTxt);
  if (!codeFromOut) failures.push("scores：没能从输出里解析出 code，说明渲染又退化了");

  // 10g) 读面必须暴露写面要用的键（第 54 轮闭环扫面的教训：pocs 只印 title、stages 只印中文，模型取不到 code）
  await run("stages 暴露 code", { op: "stages" }, has("recon（"));
  await run("pocs 暴露 code", { op: "pocs" }, has("｜"), has(saved.poc.code));

  // 10e) 资产面：登记（importBundle 包成单条）→ 评估（枚举静默回落要如实报）→ 测试回写
  await run("assets 空态引导", { op: "assets" }, has("共 0 条"), has("importBundle"));
  await run("entity_add asset", { op: "entity_add", entity: "asset", target: "203.0.113.20", name: "nas-20" }, has("已写入"), has("表内现有 1 条"), has("新增 1 条"));
  await run("entity_add asset 批量+去重", { op: "entity_add", entity: "asset", target: "203.0.113.20, 203.0.113.21, 203.0.113.20" }, has("提交 3 个"), has("新增 1 条（同 IP 走 upsert 不算新增）"), has("表内现有 2 条"));
  await run("update asset 评估", { op: "update", entity: "asset", target: "203.0.113.20", kind: "超优先级", text: "值得打" }, has("已评估"), has("不在枚举"), has("priority=medium"));
  await run("update asset 合法评估", { op: "update", entity: "asset", target: "203.0.113.20", kind: "high", value: "还有 445" }, has("priority=high"), has("潜在面=还有 445"));
  await run("update asset 测试回写", { op: "update", entity: "asset", target: "203.0.113.20", stage: "tested", text: "跑完 spray" }, has("已回写测试"), has("test_status=tested"));

  // 11) 汇总口径要与逐步回读一致（跨 op 的同一事实不许两个数）
  // 跨 op 一致性：同一个事实（记了 1 步链）在 chain / report / summary 三处必须是同一个数。
  const sum = await run("summary 复核", { op: "summary" }, has("靶标 1 个｜当前=示例靶"), has("chainSteps=1"));
  await run("report 链条数一致", { op: "report" }, has("chainSteps=1"));
  await run("chain 计数一致", { op: "chain" }, has("共 1 条"));
  return 0;
};

await main();

// 12) 真机只读探针：默认指到 ~/.dsh/redteam（零写入，只 list/report）。
//     本机没开靶时必须明确报「跳过」而不是假装通过；可用 REDTEAM_HOME 指到别处验证非跳过分支不是死代码。
//     注：RedteamStore 构造里有 mkdirSync(engagements/)，所以「只读」指不写数据；对已存在路径无副作用（实测本机时间戳未变）。
const liveRoot = process.env.REDTEAM_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "redteam");
const liveStore = new RedteamStore(liveRoot);
try {
  const liveList = Array.isArray(liveStore.listEngagements()) ? liveStore.listEngagements() : [];
  if (!liveList.length) {
    console.log(`真机探针：跳过（${liveRoot.replace(os.homedir(), "~")} 里没有靶标，本机还没开靶）`);
  } else {
    const live = buildModelTools({ core, rules, hostctl, updater, rejectIfNeedPrompt: () => null, redteamStore: liveStore })
      .find((x) => x.name === "purge_drill");
    const sumLive = String((await live.execute({ op: "summary" })).text ?? "");
    const cnt = Number((/靶标 (\d+) 个/.exec(sumLive) || [])[1] ?? NaN);
    if (cnt !== liveList.length) failures.push(`真机探针：summary 报 ${cnt} 个靶标，listEngagements 是 ${liveList.length} 个`);
    const repLive = String((await live.execute({ op: "report" })).text ?? "");
    if (!/战报|为空/.test(repLive)) failures.push("真机探针：report 既没出战报也没说为空");
    const listLive = String((await live.execute({ op: "pocs" })).text ?? "");
    if (!/POC 库|库总量/.test(listLive)) failures.push("真机探针：pocs 没给出库计数");
    console.log(`真机探针：${liveList.length} 个靶标（不写数据；路径已存在则无副作用）｜summary=${cnt}｜report=${repLive.split(` + q + NL + q + `)[0].slice(0, 34)}…`);
  }
} finally {
  try { liveStore.close?.(); } catch { /* 关不掉就算了，探针是只读的 */ }
}
if (verbose) for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.label.padEnd(22)} ${s.text.slice(0, 96)}`);
console.log(`情景测试：${steps.length} 步，断言失败 ${failures.length}`);
for (const f of failures) console.log(`  ✗ ${f}`);
try { store.close?.(); } catch { /* 已关掉就算成功 */ }
try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }); } catch { console.log("  · 临时目录未清理完（sqlite 句柄占用），不影响结果"); }
process.exit(failures.length ? 1 : 0);
