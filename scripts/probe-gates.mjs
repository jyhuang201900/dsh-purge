#!/usr/bin/env node
/**
 * 用途：闸门反向探针总表——逐条证明每道门「改坏就会红」，没咬过的门等于不知道真假的门。
 * 用法：node scripts/probe-gates.mjs [--keep]     # 默认跑完自动复原；--keep 打印每条命令输出首行
 * 依赖：Node ≥18；只改工作区里的临时内容（改完即还原），不碰宿主、不写 ~/.dsh。
 * 验证：2026-11-09 首跑，8 关全部报红（探针有效），复原后归零。
 *
 * 两类证据要分清：
 *   · mutated-now —— 本轮现场改坏再复原，实测能红；
 *   · bitten —— 本会话之前已被真实缺陷咬过（记在 release-notes），不再重复改坏。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 中文目录用 new URL().pathname 会被百分号编码（E:\完成项目 → %E5%AE%8C…），必须 fileURLToPath。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--keep");
const run = (args, cwd = root) => spawnSync(process.execPath, args, { encoding: "utf8", cwd });
const head = (r) => ((r.stdout || "") + (r.stderr || "")).trim().split("\n").find(Boolean) || "(无输出)";

// 探针定义：mutate 返回还原函数；restore 必须幂等。
const probes = [
  {
    gate: "关 1 语法（node --check 扫全仓 JS）",
    how: "mutated-now",
    cmd: ["scripts/verify.mjs"],
    mutate() {
      const f = path.join(root, "scripts", "probe-bad.tmp.js"); // verify 的 walk() 跳过点开头文件，名字不能带前导点
      fs.writeFileSync(f, "const x = ;\n");
      return () => fs.rmSync(f, { force: true });
    },
  },
  {
    gate: "关 2 体积预算（check-size）",
    how: "mutated-now",
    cmd: ["scripts/check-size.mjs", "--max-default", "0"],
    cleanCmd: ["scripts/check-size.mjs"],
    noMutate: true,
  },
  {
    gate: "关 3 双语 + locale 源↔内联一致（check-locale + build-locale --check）",
    how: "mutated-now",
    cmd: ["scripts/build-locale.mjs", "--check"], // 对账已接进 verify 关 3；这里直接跑那条判据
    mutate() {
      const f = path.join(root, "locale", "en.json");
      const old = fs.readFileSync(f, "utf8");
      fs.writeFileSync(f, old.replace(/\}\s*$/, ',"__probe_extra_key__": "x"}'));
      return () => fs.writeFileSync(f, old);
    },
  },
  {
    gate: "关 4 清单一致性（check-manifest）",
    how: "mutated-now",
    cmd: ["scripts/check-manifest.mjs"],
    mutate() {
      const f = path.join(root, "lib", "update.js");
      const old = fs.readFileSync(f, "utf8");
      const m = /const COPY_NAMES = \[/.exec(old);
      if (!m) throw new Error("找不到 COPY_NAMES 声明");
      fs.writeFileSync(f, old.replace(m[0], "const COPY_NAMES = [\"__probe_ghost__\", "));
      return () => fs.writeFileSync(f, old);
    },
  },
  {
    gate: "关 5 包自证（check-package，17 项）",
    how: "mutated-now",
    cmd: ["scripts/check-package.mjs"],
    mutate() {
      const f = path.join(root, "package.json");
      const old = fs.readFileSync(f, "utf8");
      const j = JSON.parse(old);
      j.files = [...(j.files || []), "__probe_missing_dir__"];
      fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
      return () => fs.writeFileSync(f, old);
    },
  },
  {
    gate: "关 6 工具面预算（check-tools）",
    how: "bitten",
    detail: "本会话真实咬过两次：drill 描述 1695>1600（削文案回 1564）、未文档化的 ghost_op 被抓（op 14/14→17 触发双报）。",
    cmd: ["scripts/check-tools.mjs"],
  },
  {
    gate: "关 7 端到端情景（scenario-drill）",
    how: "bitten",
    detail: "真实咬过三次：把断言改成「链条共 99 步」立刻红；改文案没同步断言（资产共→表内现有）红；期望算错（新增 2 实为 1）也红。",
    cmd: ["scripts/scenario-drill.mjs"],
  },
  {
    gate: "关 9 弹药层一致性（audit-skills）",
    how: "bitten",
    detail: "本轮两条现场探针：① 往 passive-recon.md 塞不存在的 redteam_asset_upsert（当年真踩过的错）→ 立刻报幽灵引用 exit=1；② 往注入源点一个假技能 recon-ghost → 条令点名缺失 exit=1。均复原归零。",
    cmd: ["scripts/audit-skills.mjs"],
  },
  {
    gate: "关 10 磁盘卫生夹具（hygiene-selftest）",
    how: "bitten",
    detail: "抽出 lib/hygiene.js 时的验收标准是「--verify-live 输出逐行等值」（实测 0 差异）。夹具本身咬过真问题：fixture 写 E:\\... 时反斜杠在 JSON 里是转义符 → JSON.parse 抛错 → 原本 catch{continue} 静默跳过，孤儿数看着正常其实是假绿；改成单独计数并显示「不可解析 N 个（别当 0）」后才转 warn。",
    cmd: ["scripts/hygiene-selftest.mjs"],
  },
  {
    gate: "关 11 CLI 冒烟（cli-smoke）",
    how: "bitten",
    detail: "本轮实测：把 bin 的 MODES 里 --align 改成 --algn（模拟 CLI 分发被改坏），冒烟立刻报 ✗ --align 出对齐体检｜exit=2（要 0），smoke exit=1、verify 报「CLI 冒烟未过」并退出非 0。反向探针第一次是空转的——我在 PowerShell 里用了 bash 的 \\' 引号把戏，突变根本没发生。",
    cmd: ["scripts/cli-smoke.mjs"],
  },
  {
    gate: "关 12 写路径冒烟（write-smoke）",
    how: "bitten",
    detail: "本轮抓到两件真事：① 夹具隔离假设错了——只用 ?t= 重导 core.js 时 host.js 仍是同一实例、路径已绑真宿主，跑一次冒烟把真宿主从 74/76 打到 15/76；改子进程 + 真实层级夹具后仍证明写入端不只认 DSH_BASE，于是脚本改为自收尾（末次补一次 apply）。② 残差被追到底（第 76/77 轮）：单次 apply→revert 与官方原文逐文件哈希全等（0 不符），但第二次 apply 会把旁侧 bak 与保险柜两份一起改写成已打补丁内容，于是其后 revert 停在一次已打补丁态（实测 5 个文件，判据已改成「必须精确等于第一次 apply 之后的状态」这条等式而非魔法数）；真宿主 55 个 sidecar 备份取证 0 污染。③ 精确判据只对「起点取自保险柜原文」的文件生效，从活文件起步的单列报告——因为 write-smoke 曾在全机 1 条待清洗时报失败，属状态依赖而非产品问题。",
    cmd: ["scripts/write-smoke.mjs"],
  },
  {
    gate: "关 8 JSON 合法性",
    how: "mutated-now",
    cmd: ["scripts/verify.mjs"],
    mutate() {
      const f = path.join(root, "locale", "zh.json");
      const old = fs.readFileSync(f, "utf8");
      fs.writeFileSync(f, old.replace(/\}\s*$/, "} trailing-junk"));
      return () => fs.writeFileSync(f, old);
    },
  },
];

const rows = [];
for (const p of probes) {
  let restored = null;
  let badExit = null;
  let badOut = "";
  try {
    if (!p.noMutate && p.mutate) restored = p.mutate();
    const r = run(p.cmd);
    badExit = r.status;
    badOut = head(r);
  } catch (e) {
    badExit = -99;
    badOut = String(e.message).slice(0, 70);
  } finally {
    if (typeof restored === "function") restored();
  }
  const clean = run(p.cleanCmd || p.cmd).status;
  const bites = typeof badExit === "number" && badExit !== 0;
  const cleanOk = clean === 0;
  rows.push({ gate: p.gate, how: p.how, badExit, clean, bites, cleanOk, out: badOut, detail: p.detail || "" });
}

console.log("闸门反向探针总表：");
for (const r of rows) {
  const mark = r.how === "bitten" ? "已咬过" : (r.bites ? "改坏即红 ✓" : "改坏不红 ✗（门是假的）");
  console.log(`  ${(r.bites || r.how === "bitten") && r.cleanOk ? "✓" : "✗"} ${r.gate.padEnd(34)} ${mark}${r.how === "mutated-now" ? `｜坏态 exit=${r.badExit} → 复原 exit=${r.clean}` : ""}`);
  if (verbose && r.out) console.log(`      坏态首行: ${r.out.slice(0, 96)}`);
  if (r.detail) console.log(`      证据: ${r.detail}`);
}
const bad = rows.filter((r) => !((r.bites || r.how === "bitten") && r.cleanOk));
console.log(`探针总表：${rows.length} 关，异常 ${bad.length} 关`);
process.exit(bad.length ? 1 : 0);
