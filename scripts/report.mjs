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
`> 报告本身不是闸门：它复用现有十三关与探测器。本次耗时 ${Math.round((Date.now() - tStart) / 1000)} 秒${noNet ? "（--no-net，跳过外网三项）" : "（含外网项）"}。`,
"",
].join("\n");

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, md, "utf8");
console.log(md.replace(/^/gm, "  ").replace(/\n {2}$/g, ""));
console.log(`  报告已写入：${path.relative(root, outFile)}`);
// 只有真失败才非 0；跳过联网项不算失败。
process.exit(failures.length ? 1 : 0);
