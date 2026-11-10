#!/usr/bin/env node
/**
 * 用途：把技能里的「本机工具实况」表与真实环境对齐（PATH + $DSH_HOME/redteam/toolkit 双探）。
 * 用法：node scripts/sync-tool-status.mjs [--dry]
 * 依赖：Node ≥18；只改 skills/redteam 下的工具表行，不动正文。
 * 验证：2026-11-10 首跑：装了 subfinder/dnsx/naabu 后，表里仍是 ❌ —— 因为它们不在 PATH 而在 toolkit 目录，
 *      导入时的探测只查了 PATH。本脚本双探并把表头改成「以实测为准」。
 *
 * 为什么要有它：工具表是导入时的**快照**，装了工具它不会自己变；而一张会说谎的工具表比没有更坏——
 * 模型会照着「未装」去找替代方案，或者按「已装」去调用不存在的东西。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";

const NL = String.fromCharCode(10);
const dir = path.join(process.cwd(), "skills", "redteam");
const tk = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "redteam", "toolkit");
const dry = process.argv.includes("--dry");

/** 双探：PATH 里的命令，或 toolkit/<name>/<name>.exe（Windows）/ <name>（POSIX）。 */
function probe(tool) {
  const base = tool.replace(/\.exe$/i, "");
  for (const cand of [
    path.join(tk, base, base + ".exe"),
    path.join(tk, base, base),
  ]) {
    try { if (fs.statSync(cand).size > 0) return { ok: true, where: "toolkit" }; } catch { /* 下一个 */ }
  }
  const r = spawnSync("where.exe", [tool], { encoding: "utf8", timeout: 3000 });
  if (r.status === 0) return { ok: true, where: "PATH" };
  const r2 = spawnSync("which", [base], { encoding: "utf8", timeout: 3000 });
  if (r2.status === 0) return { ok: true, where: "PATH" };
  return { ok: false, where: "" };
}

let files = 0, flipped = 0, checked = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
  const p = path.join(dir, f);
  const before = fs.readFileSync(p, "utf8");
  if (!before.includes("本机工具实况")) continue;
  let t = before;
  // 表头加「以实测为准」，只加一次
  if (!t.includes("以实测为准")) {
    t = t.replace("## 本机工具实况（自动探测，非猜测）", "## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）");
  }
  t = t.replace(/^\| `([^`]+)` \| (✓ 已装|❌ 未装[^|]*) \|$/gm, (m, tool, state) => {
    checked += 1;
    const now = probe(tool);
    const want = now.ok ? `✓ 已装${now.where === "toolkit" ? "（toolkit 内，非 PATH）" : ""}` : "❌ 未装（用前先装，或改用等价工具）";
    if (state.trim() === want.trim()) return m;
    flipped += 1;
    return `| \`${tool}\` | ${want} |`;
  });
  if (t !== before) {
    if (!dry) fs.writeFileSync(p, t, "utf8");
    files += 1;
  }
}
console.log(`  扫描 ${checked} 条工具行｜状态更正 ${flipped} 条｜改动文件 ${files} 个${dry ? "（--dry 未写盘）" : ""}`);
console.log(`  探测口径：PATH 或 ${tk.replace(os.homedir(), "~")}/<tool>/<tool>[.exe]`);