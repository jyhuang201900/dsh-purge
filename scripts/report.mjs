#!/usr/bin/env node
/**
 * 用途：体检报告——把验收单第七节那七条命令按顺序跑一遍，汇总成一份 markdown（复用现有关，不是第十四个关）。
 * 用法：node scripts/report.mjs [--no-net] [--out <路径>]
 *      --no-net 跳过三条要联网的（check-anchors / check:upstream / sweep:market），留给断网或赶时间时用。
 * 依赖：Node ≥18；工作区内脚本；联网项失败只报「未查到」，不当成缺陷（与 check-upstream 同口径）。
 * 验证：2026-11-10 首跑：七条命令逐条 exit 码与摘要成表，实况数字（补丁 74/76、宿主枚举、宿主版本）从 --status 抓，
 *      报告写到 .cache/report-<日期>.md；反向验证用 --no-net 与一条故意改坏的门（见 changelog）。
 *
 * 为什么是封装而不是新关：新关要进 verify 的成本与 README 口径（第 10/19 项会强制同步），
 * 而这份东西是「按需出报告」，跑一次约 2 分钟——把它做成关会让每次 verify 都付 2 分钟，得不偿失。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const noNet = argv.includes("--no-net");
const outIdx = argv.indexOf("--out");
const day = new Date().toISOString().slice(0, 10);
const outFile = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(root, ".cache", `report-${day}.md`);

const run = (args, opts = {}) => {
  try {
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 300000, ...opts });
    const text = String((r.stdout || "") + (r.stderr || ""));
    return { exit: r.status === null ? "超时" : r.status, text };
  } catch (e) {
    return { exit: "崩", text: String((e && e.message) || e) };
  }
};

// 摘要行：优先取带结论字样的行，否则取最后一条非空行——报告里必须能看到「到底过没过」。
const pick = (text, marks) => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const m of marks) {
    const hit = lines.find((l) => l.includes(m));
    if (hit) return hit.slice(0, 150);
  }
  return (lines[lines.length - 1] || "（无输出）").slice(0, 150);
};

// pick() 的自测：第 92 轮真出过事——摘要取到表头行与「明细: …json」路径行，都是「形状完好的胡说」。
// 这四条用例钉住的是当时的具体错法，不是抽象覆盖率；默认随每次 report 一起跑（约 0 秒），
// 也可单独跑：node scripts/report.mjs --self-test。
const SELFTEST = [
  {
    name: "表头不许压过判决行",
    text: ["闸门反向探针总表：", "  ✓ 关 1 x", "探针总表：13 关，异常 0 关", ""].join("\n"),
    marks: ["关，异常", "探针总表"],
    want: "探针总表：13 关，异常 0 关",
  },
  {
    name: "路径行不许压过判决行",
    text: ["补丁条数：76", "", "汇总: {\"ok\":50}", "明细: E:/x/.cache/anchor-report.json", ""].join("\n"),
    marks: ["汇总", "补丁条数"],
    want: "汇总: {\"ok\":50}",
  },
  {
    name: "无标志时退回最后一条非空行",
    text: ["第一行", "第二行", "", "   "].join("\n"),
    marks: ["根本不存在"],
    want: "第二行",
  },
  {
    name: "空输出必须明说而不是空串",
    text: "   \n  ",
    marks: ["任意"],
    want: "（无输出）",
  },
];

function runSelfTest() {
  const bad = [];
  for (const c of SELFTEST) {
    const got = pick(c.text, c.marks);
    if (got !== c.want) bad.push(`${c.name}：取到 ${JSON.stringify(got.slice(0, 40))}，要 ${JSON.stringify(c.want.slice(0, 40))}`);
  }
  return bad;
}

if (argv.includes("--self-test")) {
  const bad = runSelfTest();
  console.log(`report 自测：${SELFTEST.length - bad.length}/${SELFTEST.length} 过`);
  for (const b of bad) console.log(`  ✗ ${b}`);
  process.exit(bad.length ? 1 : 0);
}
const selfTestBad = runSelfTest();

const steps = [
  { name: "十三关闸门", args: ["scripts/verify.mjs"], marks: ["[verify]", "未通过"], net: false },
  { name: "闸门反向探针", args: ["scripts/probe-gates.mjs"], marks: ["关，异常", "探针总表"], net: false },
  { name: "图谱审计", args: ["scripts/graph-audit.mjs"], marks: ["真孤儿", "图谱审计"], net: false },
  { name: "补丁锚点体检", args: ["scripts/check-anchors.mjs"], marks: ["汇总", "补丁条数"], net: true },
  { name: "宿主漂移", args: ["scripts/check-upstream.mjs"], marks: ["上游漂移", "✓"], net: true },
  { name: "生态漂移", args: ["scripts/market-sweep.mjs"], marks: ["生态漂移", "上次对照"], net: true },
  { name: "实时只读验收", args: ["bin/dsh-purge.js", "--verify-live"], marks: ["→ ", "实时验收"], net: false },
];

const tStart = Date.now();
const rows = [];
for (const s of steps) {
  if (s.net && noNet) {
    rows.push({ name: s.name, exit: "-", text: "本轮跳过（--no-net）" });
    continue;
  }
  const r = run(s.args);
  rows.push({ name: s.name, exit: r.exit, text: pick(r.text, s.marks) });
}

// 实况数字：从 --status 直接抓，不在报告里手写，免得又出现「声明与实测不符」。
const st = run(["bin/dsh-purge.js", "--status"]);
const want = ["补丁 ", "宿主版本", "宿主枚举", "注入状态", "宿主 / surface"];
const liveLines = st.text.split(/\r?\n/).map((l) => l.trim()).filter((l) => want.some((w) => l.startsWith(w) || l.includes(w)));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
// 挂账复查（--check-debt）：验收单第六节那些「还挂着的事」不该只靠我记着，能机器判的就当场判一次。
// 每条都必须带数字或形状，不写形容词——「仍待重启」要能指出是哪条路由回了什么，「偶发」要给出本轮实测。
const checkDebt = argv.includes("--check-debt");
let DB = null;
const dbPath = path.join(root, "docs", "debt-baseline.json");
try { DB = JSON.parse(fs.readFileSync(dbPath, "utf8")); } catch { DB = null; }
let debtNote = checkDebt && !DB ? "挂账复查：基线读不到（`docs/debt-baseline.json`）→ 退化为散文，不假装对过" : "";
const debtLines = [];
if (checkDebt) {
  // ① 路由是否接上（未重启时 in-host HTTP 面对 GET 回 400 非 JSON）
  const webUrl = String(process.env.DSH_WEB_URL || "").trim();
  if (!webUrl) debtLines.push("- 路由：未设 `DSH_WEB_URL` → **未查到**（不是已了）");
  else {
    try {
      const r = await fetch(webUrl + "/dsh-purge/mcp", { signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      let isJson = false;
      try { JSON.parse(t); isJson = true; } catch { isJson = false; }
      debtLines.push(`- 路由：HTTP ${r.status}｜响应${isJson ? "是 JSON → **已接上（说明重启过了）**" : `非 JSON（前 24 字：${JSON.stringify(t.slice(0, 24))}）→ **仍待重启**`}`);
    } catch (e) { debtLines.push(`- 路由：探测失败 ${String((e && e.message) || e).slice(0, 40)} → 未查到`); }
  }
  // ② 注入正文的选择
  const inj = liveLines.find((l) => l.includes("注入状态")) || "";
  let diskChars = 0;
  // 路径从 --status 输出里取真值；靠 DSH_HOME 拼会在这个 env 没设时静默变成 0 字（假数据比没数据更坏）。
  const injPath = /([A-Za-z]:[^\s|]*prompt-inject\.md)/.exec(st.text || "");
  try { if (injPath) diskChars = fs.readFileSync(injPath[1], "utf8").length; } catch { }
  debtLines.push(`- 注入正文：${inj.replace(/^注入状态\s*/, "") || "读不到"}｜磁盘 ${diskChars} 字` + (DB ? `｜基线默认 ${DB.injection.defaultChars} 字，差 ${diskChars - DB.injection.defaultChars}` : "｜无基线") + ` → 仍等你三选一（adopt / 面板保存 / reset）`);
  // ③ 关 12 本轮实测（残差数 + 是否幂等），与账上历史率并列
  const ws = run(["scripts/write-smoke.mjs"]);
  const res = /偏离官方原文的 (\d+) 个/.exec(ws.text);
  debtLines.push(`- 关 12：本轮残差 ${res ? res[1] : "?"} 个｜write-smoke exit=${ws.exit}${DB ? `｜基线残差 ${DB.gate12.residueExpected}、红样本 ${DB.gate12.redSample}：${String(res && res[1]) === String(DB.gate12.residueExpected) ? "一致" : "不符（要看是新缺陷还是量具变了）"}` : "｜无基线"}`);
  // ④ 双次 apply 污染在真宿主的现状（sidecar 取证）
  try {
    const m = /([A-Za-z]:[\\/][^\r\n]*@deepseek-ai)/.exec(st.text || "");
    const base = m ? m[1] : "";
    let side = 0, polluted = 0;
    const walk = (dir, depth) => {
      if (depth > 4) return;
      let es = [];
      try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) { walk(fp, depth + 1); continue; }
        if (!e.name.endsWith(".dshpurge.bak")) continue;
        side += 1;
        try { if (fs.readFileSync(fp, "utf8").includes("dsh-purge")) polluted += 1; } catch { }
      }
    };
    if (base) walk(base, 0);
  debtLines.push(`- 双次 apply 污染：真宿主 sidecar ${side} 份、被污染 ${polluted} 份${base ? "" : "（没取到插件根，这两个 0 不算数）"}${DB ? `｜基线 ${DB.sidecar.scanned}/${DB.sidecar.polluted}：${side === DB.sidecar.scanned && polluted === DB.sidecar.polluted ? "一致" : "漂移（备份库状态变了，要查）"}` : "｜无基线"}`);
  const missM = /(\d+) 锚点未命中/.exec(st.text || "");
  debtLines.push(`- 设计内 skipped：本轮报 ${missM ? missM[1] : "?"} 条${DB ? `｜基线列了 ${DB.skipped.ids.length} 条（#${DB.skipped.ids.join(" #")}）：${DB.skipped.ids.length === Number(missM && missM[1]) ? "一致" : "不符"}` : "｜无基线"}`);
  } catch { debtLines.push("- 双次 apply 污染：取证未跑成（从 `--status` 输出里取不到插件根路径）"); }
  // ⑤ 刻意没做的四项（非缺陷，列出来防止被当成漏做）
  debtLines.push(`- 刻意没做（基线清单）：${DB ? DB.deliberatelyNotDone.join("、") : "读不到"}${pkg["dsh.compatibility"] ? "｜dsh.compatibility 已接" : "｜其中 dsh.compatibility 仍未接"}`);
}

const failures = rows.filter((x) => typeof x.exit === "number" && x.exit !== 0);
const skipped = rows.filter((x) => x.exit === "-").length;

const md = [
`# dsh-purge 体检报告 · ${new Date().toISOString()}`,
"",
`插件 ${pkg.version}｜钉住 dsh ${pkg.dshTarget}｜npm 入口 ${Object.keys(pkg.scripts).length} 个｜范围 ${noNet ? "仅本地（--no-net）" : "全量（含联网项）"}`,
"",
"| 检查 | exit | 摘要 |",
"| --- | --- | --- |",
...rows.map((x) => `| ${x.name} | ${x.exit} | ${x.text.replace(/\|/g, "/")} |`),
"",
`**合计 ${rows.length} 项：失败 ${failures.length}｜跳过 ${skipped}**${failures.length ? "（" + failures.map((x) => `${x.name} exit=${x.exit}`).join("、") + "）" : "（全部通过）"}`,
"",
"## 实况数字（由 `--status` 当场抓取，不是手写）",
"",
...liveLines.map((l) => `- ${l}`),
"",
...(debtLines.length ? ["", "## 挂账复查（--check-debt）", "", ...debtLines] : []),
`摘要器自测（pick）：${SELFTEST.length - selfTestBad.length}/${SELFTEST.length} 过${selfTestBad.length ? " —— " + selfTestBad.join(" ; ") : ""}`,
...(debtNote ? [debtNote] : []),
`> 报告本身不是闸门：它复用现有十三关与探测器。本次耗时 ${Math.round((Date.now() - tStart) / 1000)} 秒${noNet ? "（--no-net，跳过外网三项）" : "（含外网项）"}。`,
"",
].join("\n");

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md, "utf8");
console.log(md.replace(/^/gm, "  ").replace(/\n {2}$/g, ""));
console.log(`  报告已写入：${path.relative(root, outFile)}`);
// 只有真失败才非 0；跳过联网项不算失败。
process.exit(failures.length + selfTestBad.length ? 1 : 0);
