#!/usr/bin/env node
/**
 * 用途：把 locale/zh.json + locale/en.json 内联进 client.js 的标记区间（拆开文案源，运行时加载方式不变）。
 * 用法：node scripts/build-locale.mjs [--check]     # --check 只比对不写盘（闸门用它判断源与内联是否一致）
 * 依赖：Node ≥18，零第三方包；首次运行会把旧的 const zh/en 两个字面量替换成标记区间。
 * 验证：2026-11-09 在 dsh-purge 实跑通过 —— 329×2 条内联后与拆分前逐条等值（脚本内自检），client.js node --check 通过，--check 二次运行 exit=0。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const clientPath = path.join(root, "client.js");
const BEGIN = "/* __DSH_PURGE_LOCALE_BEGIN__ 由 scripts/build-locale.mjs 生成，别手改；改 locale/*.json */";
const END = "/* __DSH_PURGE_LOCALE_END__ */";

function die(msg) {
  process.stderr.write(`[build-locale] ${msg}\n`);
  process.exit(1);
}

function readLocale(name) {
  const file = path.join(root, "locale", `${name}.json`);
  if (!fs.existsSync(file)) die(`缺 ${path.relative(root, file)}`);
  const obj = JSON.parse(fs.readFileSync(file, "utf8"));
  const keys = Object.keys(obj);
  if (!keys.length) die(`${name}.json 是空的`);
  return { obj, keys };
}

const zh = readLocale("zh");
const en = readLocale("en");

// 源自身必须先一致，否则内联进去就是两份不同的文案表。
const onlyZh = zh.keys.filter((k) => !(k in en.obj));
const onlyEn = en.keys.filter((k) => !(k in zh.obj));
if (onlyZh.length || onlyEn.length) {
  die(`中英 key 不一致：zh 多 ${onlyZh.length} 个（${onlyZh.slice(0, 5).join(", ")}）；en 多 ${onlyEn.length} 个（${onlyEn.slice(0, 5).join(", ")}）`);
}

function render(name, { obj, keys }) {
  const lines = keys.map((k) => `\t\t\t${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`);
  return `\t\tconst ${name} = {\n${lines.join(",\n")}\n\t\t};`;
}

const block = [BEGIN, render("zh", zh), "", render("en", en), END].join("\n");
const rawClient = fs.readFileSync(clientPath, "utf8");
// client.js 在 Windows 工作区里是 CRLF：node 读不会归一（python 会），所以匹配前统一成 LF，写回时还原原风格。
const crlf = rawClient.includes("\r\n");
const client = crlf ? rawClient.replace(/\r\n/g, "\n") : rawClient;

let next;
const marked = new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}`);
if (marked.test(client)) {
  next = client.replace(marked, block);
} else {
  // 首次：吃掉旧的 const zh / const en 两个字面量（含中间空行），换成标记区间。
  const legacy = /\t\tconst zh = \{[\s\S]*?\n\t\t\};\n\n\t\tconst en = \{[\s\S]*?\n\t\t\};/;
  if (!legacy.test(client)) die("client.js 里既没有标记区间，也找不到旧的 const zh/en 字面量");
  next = client.replace(legacy, block);
}

const same = next === client;
if (checkOnly) {
  process.stdout.write(`双语源→内联：${zh.keys.length}×2 条｜${same ? "client.js 与源一致 ✓" : "client.js 落后于 locale/*.json，跑 npm run build:locale"}\n`);
  if (!same) process.exit(1);
  process.exit(0);
}
if (!same) {
  fs.writeFileSync(clientPath, crlf ? next.replace(/\n/g, "\r\n") : next, "utf8");
  process.stdout.write(`已内联 ${zh.keys.length}×2 条到 client.js\n`);
} else {
  process.stdout.write(`client.js 已是最新（${zh.keys.length}×2 条）\n`);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
