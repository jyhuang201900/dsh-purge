#!/usr/bin/env node
/**
 * 用途：发版前一键自检——语法、体积预算、双语文案、清单一致性、包自证、工具面、端到端情景、弹药层审计、JSON 合法性九关一起过（替代 README 里那串手工 node --check）。
 * 用法：node scripts/verify.mjs [--root PATH] [--skip-size]     # 默认跑全部三关
 * 依赖：Node ≥18；内部调用 node --check 与 scripts/check-size.mjs，零第三方包。
 * 验证：2026-11-09 在 dsh-purge 实跑通过（exit=0，五关全绿：语法 / 体积 / 双语 2×328 key 零漂移 / 清单 COPY_NAMES 全覆盖 / JSON 全合法）。各关计数以实跑输出为准，不写死在注释里。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipSize = argv.includes("--skip-size");
// 按名点跳：--skip write,cli（名字取自下面各关的短名）。
// 为什么需要它：实测 22.1 秒里 write-smoke 一门占 14.4 秒（65%），迭代时想只看其余关就得有这个旋钮；
// 而旧参数 --skip-size 其实是「除语法外全跳」，名字说一件事、做另一件 —— 保留兼容，但新用法以 --skip 为准。
const skipSet = new Set((argv[argv.indexOf("--skip") + 1] || process.env.DSH_VERIFY_SKIP || "").split(",").map((x) => String(x).trim().toLowerCase()).filter(Boolean));
const skip = (name) => skipSize || skipSet.has(name);
if (argv.includes("--skip") && !argv[argv.indexOf("--skip") + 1]) {
  console.log("--skip 需要名单，例如：node scripts/verify.mjs --skip write,cli（可用：size,locale,manifest,package,tools,scenario,ammo,hygiene,cli,write,json）");
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const failures = [];
const notes = [];

// 关 1：语法。逐个 node --check，失败即记文件名（不中断，一次看全）。
const files = walk(root);
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failures.push(`语法 ${path.relative(root, file)}: ${(res.stderr || "").split("\n")[0]}`);
  }
}
notes.push(`语法：${files.length} 个文件，失败 ${failures.length}`);

// 关 2：体积预算（交给 check-size.mjs，单一来源，不在这儿重写规则）。
if (!skip("size")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-size.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").pop() || "";
  if (res.status !== 0) failures.push(`体积闸门未过：${tail}`);
  else notes.push(`体积：${tail}`);
}

// 关 3：双语文案——① client.js 里中英两块 key 必须一模一样；② locale 源 JSON 与内联块不许静默分叉。
// 第 ② 条是探针总表（scripts/probe-gates.mjs）发现的洞：build-locale --check 早就存在，但没接进闸门，
// 改了 locale/zh.json 忘了 npm run build:locale 时，八关照样全绿 —— 门禁在管的东西必须被调用才算数。
if (!skip("locale")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-locale.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`双语闸门未过：${(res.stderr || tail).trim().split("\n")[0]}`);
  else notes.push(`双语：${tail.replace(/^双语闸门：/, "")}`);
  const res2 = spawnSync(process.execPath, [path.join(root, "scripts", "build-locale.mjs"), "--check"], { encoding: "utf8" });
  const tail2 = (res2.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res2.status !== 0) failures.push(`locale 源与内联块分叉：${(res2.stderr || tail2).trim().split("\n")[0]}｜跑 npm run build:locale`);
  else notes.push(`源↔内联：${tail2.replace(/^双语源→内联：/, "")}`);
}

// 关 4：清单一致性——COPY_NAMES（自更新拷贝清单）与 files（发布白名单）不许分叉。
if (!skip("manifest")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-manifest.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`清单闸门未过：${(res.stderr || head).trim().split("\n")[0]}`);
  else notes.push(`清单：${head.replace(/^清单闸门：/, "")}`);
}

// 关 5：包自证——manifest 口径与全仓数量声明（交给 check-package.mjs，真相取自 lib/core.js）。
if (!skip("package")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-package.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`包自证未过：${(res.stderr || head).trim().split("\n").slice(-1)[0]}`);
  else notes.push(`包自证：${head.replace(/^包自证：/, "")}`);
}

// 关 6：工具面闸门——结构 + 描述成本 + 返回值成本 + op/entity 可发现性。
if (!skip("tools")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-tools.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`工具面闸门未过：${(res.stderr || head).trim().split("\n").slice(-1)[0]}`);
  else notes.push(`工具面：${head.replace(/^工具面闸门：/, "")}`);
}

// 关 7：端到端情景——把 drill 的 18 个 op 串成一条真实流程逐步断言回读（组合期最容易出「说谎的回读」）。
if (!skip("scenario")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "scenario-drill.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").filter(Boolean).slice(-1)[0] || "";
  if (res.status !== 0) {
    const bad = (res.stdout || "").split("\n").filter((l) => l.includes("✗")).slice(0, 3).join(" / ");
    failures.push(`情景测试未过：${bad || tail || (res.stderr || "").trim().split("\n")[0]}`);
  } else notes.push(`情景：${tail.replace(/^情景测试：/, "")}`);
}

// 关 9：弹药层一致性——技能正文引用的工具名、条令点名的技能，都必须真实存在（引用不存在的名字 = 模型照做就撞空）。
if (!skip("ammo")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "audit-skills.mjs")], { encoding: "utf8" });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split("\n");
  if (res.status !== 0) {
    failures.push(`弹药层审计未过：${out.slice(1, 3).map((l) => l.trim()).join(" / ").slice(0, 160) || out[0]}`);
  } else notes.push(`弹药层：${(out[0] || "").replace(/^弹药层审计：/, "")}｜${(out[1] || "").trim()}｜${(out[2] || "").trim()}`);
}

// 关 10：磁盘卫生模块的夹具自测（阈值边界得有人看着：保留 2 份、孤儿 >5、坏 JSON 不许静默跳过）。
if (!skip("hygiene")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "hygiene-selftest.mjs")], { encoding: "utf8" });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split("\n");
  if (res.status !== 0) {
    failures.push(`卫生夹具未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}

// 关 11：CLI 冒烟——真跑 bin 的只读模式（此前十关没有一关执行过 CLI 分发，改坏 bin 也可能全绿）。
if (!skip("cli")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "cli-smoke.mjs")], { encoding: "utf8" });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  if (res.status !== 0) {
    failures.push(`CLI 冒烟未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}
// 关 12：写路径冒烟——apply/revert 往返（此前没有任何一关执行过写路径；它也是唯一能抓到 revert 不对称的关）。
if (!skip("write")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "write-smoke.mjs")], { encoding: "utf8", timeout: 180000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  if (res.status !== 0) {
    failures.push(`写路径冒烟未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}
// 关 13：工具层冒烟——真跑 purge_apply / purge_revert（mutating 的工具分支此前没有一关执行过）。
if (!skip("tools")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "tools-smoke.mjs")], { encoding: "utf8", timeout: 180000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  if (res.status !== 0) {
    failures.push(`工具层冒烟未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}

// 关 8：JSON 合法性——package.json / screenshots / locale 文案源 / 图谱语义层手写件。
const jsons = ["package.json", "screenshots.json", "locale/zh.json", "locale/en.json"]
  .filter((f) => fs.existsSync(path.join(root, f)))
  .concat(fs.readdirSync(path.join(root, "graphify-out", "semantic")).filter((f) => f.endsWith(".json")).map((f) => `graphify-out/semantic/${f}`));
let parsed = 0;
for (const rel of jsons) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    parsed += 1;
  } catch (e) {
    failures.push(`JSON ${rel}: ${e.message}`);
  }
}
notes.push(`JSON：${parsed}/${jsons.length} 合法`);

for (const line of notes) process.stdout.write(`  ${line}\n`);
for (const line of failures) process.stderr.write(`  ✗ ${line}\n`);
process.stdout.write(failures.length ? `[verify] 未通过：${failures.length} 项\n` : "[verify] 全部通过 ✓\n");
process.exit(failures.length ? 1 : 0);
