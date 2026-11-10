#!/usr/bin/env node
/**
 * 用途：CLI 冒烟——真正执行 bin/dsh-purge.js 的各只读模式，验证参数分发与输出标志（十关此前没有一关跑过 bin）。
 * 用法：node scripts/cli-smoke.mjs
 * 依赖：Node ≥18；只跑只读模式（不碰 --apply/--revert/--mcp），并把 DSH_WEB_URL 清空以保持快与确定。
 * 验证：2026-11-10 首跑 7 组全过；反向探针见 scripts/probe-gates.mjs 的关 11 条目。
 */
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(root, "bin", "dsh-purge.js");
const MODES = ["--apply", "--revert", "--uninstall", "--status", "--align", "--tools", "--drill", "--mcp", "--mcp-probe", "--verify-live", "--edit", "--help"];

const cases = [
  { label: "--status 出状态表（含宿主枚举）", args: ["--status"], codes: [0], marks: [/dsh-purge 状态/, /宿主枚举\s+\d+ 个/] },
  { label: "--align 出对齐体检", args: ["--align"], codes: [0], marks: [/宿主 host=/] },
  { label: "--tools 列全 10 个工具", args: ["--tools"], codes: [0], marks: [/共 10 个工具/, /purge_drill/] },
  { label: "--help 列全每个可用旗标", args: ["--help"], codes: [0], marks: [/dsh-purge 用法/, ...MODES.map((m) => new RegExp(m.replace(/-/g, "-")))] },
  { label: "--drill 默认读面（summary）", args: ["--drill"], codes: [0], marks: [/靶标/] },
  { label: "--verify-live 打印各行判定", args: ["--verify-live"], codes: [0, 1], marks: [/实时验收（只读探测）/, /契约表 10 个工具/, /(^|\n)\s+[✓⚠✗].*\n\s+[✓⚠✗].*\n\s+[✓⚠✗]/] },
  { label: "未知参数必须报错（不许静默当 status）", args: ["--nonsense"], codes: [2], marks: [/未知参数/, /可用：/] },
];

let fails = 0;
for (const c of cases) {
  let code = 0;
  let out = "";
  try {
    const r = await run(process.execPath, [BIN, ...c.args], {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, DSH_WEB_URL: "", DSH_SURFACE: process.env.DSH_SURFACE || "", DSH_BASE: process.env.DSH_BASE || "" },
    });
    out = String(r.stdout || "");
  } catch (e) {
    code = typeof e.code === "number" ? e.code : 1;
    out = `${String(e.stdout || "")}${String(e.stderr || "")}${String(e.message || "")}`;
  }
  const codeOk = c.codes.includes(code);
  const missing = c.marks.filter((re) => !re.test(out));
  if (!codeOk || missing.length) fails += 1;
  const detail = !codeOk ? `exit=${code}（要 ${c.codes.join("/")}）` : missing.length ? `缺标志：${missing.map((r) => String(r).slice(0, 30)).join(" ")}` : "";
  console.log(`  ${!codeOk || missing.length ? "✗" : "✓"} ${c.label}${detail ? `｜${detail}` : ""}`);
}
console.log(`CLI 冒烟：${cases.length} 组，失败 ${fails}`);
process.exit(fails ? 1 : 0);
