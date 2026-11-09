#!/usr/bin/env node
/**
 * 用途：发版前一键自检——语法、体积预算、双语文案、清单一致性、包自证、工具面、JSON 合法性七关一起过（替代 README 里那串手工 node --check）。
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
if (!skipSize) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-size.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").pop() || "";
  if (res.status !== 0) failures.push(`体积闸门未过：${tail}`);
  else notes.push(`体积：${tail}`);
}

// 关 3：双语文案——中英两份字典的 key 必须一模一样（交给 check-locale.mjs，规则不在这儿重写）。
if (!skipSize) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-locale.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`双语闸门未过：${(res.stderr || tail).trim().split("\n")[0]}`);
  else notes.push(`双语：${tail.replace(/^双语闸门：/, "")}`);
}

// 关 4：清单一致性——COPY_NAMES（自更新拷贝清单）与 files（发布白名单）不许分叉。
if (!skipSize) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-manifest.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`清单闸门未过：${(res.stderr || head).trim().split("\n")[0]}`);
  else notes.push(`清单：${head.replace(/^清单闸门：/, "")}`);
}

// 关 5：包自证——manifest 口径与全仓数量声明（交给 check-package.mjs，真相取自 lib/core.js）。
if (!skipSize) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-package.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`包自证未过：${(res.stderr || head).trim().split("\n").slice(-1)[0]}`);
  else notes.push(`包自证：${head.replace(/^包自证：/, "")}`);
}

// 关 6：工具面闸门——结构 + 描述成本 + 返回值成本 + op/entity 可发现性。
if (!skipSize) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-tools.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`工具面闸门未过：${(res.stderr || head).trim().split("\n").slice(-1)[0]}`);
  else notes.push(`工具面：${head.replace(/^工具面闸门：/, "")}`);
}

// 关 7：JSON 合法性——package.json / screenshots / locale 文案源 / 图谱语义层手写件。
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
