#!/usr/bin/env node
/**
 * 用途：技能构建流水线——一条命令按**固定顺序**跑完所有技能生成器，避免它们互相打架。
 * 用法：node scripts/build-skills.mjs [--dry] [--check]
 *   --check  只校验（不写盘）；每步的 --check 都过才绿
 * 依赖：Node ≥18；只读写仓内文件，不联网。
 *
 * 为什么要有它：第 110 轮踩过「两个生成器互相打架」——build-skill-graph 剥离自己的块时
 * 一路截到文件尾，把 inject-runnability 追加在后的块一起删了，症状是「刚注入 37 个、
 * 闸门立刻报 37 个缺失」。根因是**各写各的、没人规定顺序**。现在顺序固定在这里：
 *
 *   ① normalize-skill-headings  先理结构（只在合并块内下沉标题，动的是标题层级）
 *   ② inject-runnability        本机可执行性（缺什么工具、怎么装/怎么替代）
 *   ③ inject-second-shot        第二发（打不出去时换哪条路，替代清单来自链路）
 *   ④ build-skill-graph         链路位置章节 + 索引/关系/角色档案 + 语义层 + 角色总表进预设
 *
 * 每个生成器都幂等且只动自己标记内的区间，所以这个顺序可重复跑、结果稳定。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dry = process.argv.includes("--dry");
const checkOnly = process.argv.includes("--check");
// 别用 URL.pathname 拼路径：Windows 上得到 "/E:/..."，dirname 之后会拼出坏路径
// （实测 4 步全报 requireStack）。fileURLToPath 才是跨平台写法。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STEPS = [
  { name: "标题规范化", script: "normalize-skill-headings.mjs", checkable: true },
  { name: "本机可执行性", script: "inject-runnability.mjs", checkable: true },
  { name: "第二发", script: "inject-second-shot.mjs", checkable: true },
  // build-skill-graph 没有 --check 模式（它只生成，不校验）；--check 模式下跳过并如实说明，
  // 它的产物一致性由 audit-skills 的「链路层」那一关负责。
  { name: "链路与档案", script: "build-skill-graph.mjs", checkable: false },
];

let bad = 0, skipped = 0;
for (const s of STEPS) {
  if (checkOnly && s.checkable === false) { console.log(`  · ${s.name.padEnd(12)} 跳过（该校验由 audit-skills 的链路层负责）`); skipped += 1; continue; }
  const p = path.join(root, "scripts", s.script);
  const args = [p, ...(s.args || []), ...(checkOnly ? ["--check"] : dry ? ["--dry"] : [])];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 180000 });
  const out = ((r.stdout || "") + (r.stderr || "")).trim().split(/[\r\n]+/).filter((l) => l.trim())
    .filter((l) => !/ExperimentalWarning|trace-warnings/.test(l));
  const status = r.status === 0 ? "✓" : "✗";
  if (r.status !== 0) bad += 1;
  console.log(`  ${status} ${s.name.padEnd(12)} ${(out[out.length - 1] || "").slice(0, 110)}`);
  if (r.status !== 0) for (const l of out.slice(-3)) console.log(`       ${l.slice(0, 118)}`);
}
console.log(`  流水线 ${STEPS.length} 步｜失败 ${bad}｜跳过 ${skipped}${checkOnly ? "（--check 模式，未写盘）" : dry ? "（--dry，未写盘）" : ""}`);
process.exit(bad ? 1 : 0);
