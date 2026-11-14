#!/usr/bin/env node
/**
 * 第 26 关：工具 schema 与宿主校验器一致。
 *
 * 为什么要有：宿主 `defineTool` 在每次 execute 前**强制** validate(args)
 * （见 dsh-tools/lib/index.js:335 `const violations = validate(args); if (violations.length > 0) throw new ToolArgsError(violations)`），
 * 而它只支持这一个 JSON Schema 子集：
 *   type / enum / required / additionalProperties / items / properties / description / default / oneOf
 * 用了别的关键字（minLength、pattern、minimum、anyOf、type 数组…）会让**整个工具注册失败**，
 * 症状是"这个工具突然不见了"，而代码看起来完全正常。
 *
 * 做法：直接从 app.asar 里提取宿主自己的校验器（`assertSupportedJsonSchema` +
 * `validateJsonSchemaValue`），用它验证我们全部工具的 parameters。
 * 这样**不用重启宿主**就能知道 schema 合不合法 —— 比"改完重启看报错"快得多，
 * 而且发现的是同一类错误（同一个校验器，不是自己另写一套规则）。
 *
 * 依赖：app.asar 存在（官方宿主密封时在）。找不到就跳过（exit 0 + 说明），不误判。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(process.argv[2] || ".");
const CACHE = path.join(ROOT, ".cache", "host-validator");
const ASAR_CANDIDATES = [
  "E:/Program Files/harness/resources/app.asar",
  path.join(process.env.PROGRAMFILES || "C:/Program Files", "harness/resources/app.asar"),
];
const ASAR = ASAR_CANDIDATES.find((p) => { try { return fs.statSync(p).size > 0; } catch { return false; } });

if (!ASAR) {
  console.log("[check-tool-schema] 跳过：找不到 app.asar（非桌面宿主或未安装），无法取宿主校验器");
  process.exit(0);
}

/* 定位 @electron/asar（npx 缓存里通常有；没有就跳过，不因为工具链缺失判失败） */
function findAsarLib() {
  const roots = [
    path.join(os.homedir(), "AppData/Local/npm-cache/_npx"),
    path.join(os.homedir(), ".npm/_npx"),
  ];
  for (const r of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(r); } catch { continue; }
    for (const d of dirs) {
      const p = path.join(r, d, "node_modules", "@electron", "asar", "lib", "asar.js");
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const asarLib = findAsarLib();
if (!asarLib) {
  console.log("[check-tool-schema] 跳过：找不到 @electron/asar（先 npx --yes @electron/asar --version 一次）");
  process.exit(0);
}

const build = async () => {
  fs.mkdirSync(CACHE, { recursive: true });
  const { extractFile } = await import(pathToFileURL(asarLib).href);
  const shared = extractFile(ASAR, "dsh\\node_modules\\@deepseek-ai\\dsh-tools\\lib\\shared-DTdn5dXO.js").toString("utf8");
  /* 只替换两条外部 import：HarnessError 仅用于抛错，assertNever/isJsonValue 是纯判定。
     换掉这两条就能本地跑，校验逻辑一个字不改 —— 这才是"与宿主同源"。 */
  const stub = `class HarnessError extends Error { constructor(m, c) { super(m); this.name = "HarnessError"; this.code = c; } }
const assertNever = (x) => { throw new Error("unexpected: " + String(x)); };
const isJsonValue = (v) => {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (typeof v === "object") return Object.values(v).every(isJsonValue);
  return false;
};
export { HarnessError, assertNever, isJsonValue };
`;
  fs.writeFileSync(path.join(CACHE, "stub.mjs"), stub, "utf8");
  const v = shared
    .replace(/from "@deepseek-ai\/dsh-llm"/g, 'from "./stub.mjs"')
    .replace(/from "@deepseek-ai\/dsh-util-values"/g, 'from "./stub.mjs"');
  fs.writeFileSync(path.join(CACHE, "validator.mjs"), v, "utf8");
  return import(pathToFileURL(path.join(CACHE, "validator.mjs")).href + `?t=${Date.now()}`);
};

const mod = await build();
const assertSupported = mod.l; // assertSupportedJsonSchema
const validate = mod.p;        // validateJsonSchemaValue
if (typeof assertSupported !== "function" || typeof validate !== "function") {
  console.log("[check-tool-schema] 跳过：宿主校验器导出结构变了（拿不到 l/p），需要更新本脚本");
  process.exit(0);
}

/* 从源码里抽工具定义：name + parameters（配对大括号，不靠正则猜边界） */
const srcFile = path.join(ROOT, "lib", "model-tools.js");
const src = fs.readFileSync(srcFile, "utf8");
const names = [...src.matchAll(/name: "(purge_[a-z_]+)"/g)].map((m) => m[1]);

const problems = [];
let checked = 0;
for (const n of names) {
  const i = src.indexOf(`name: "${n}"`);
  const nextIdx = src.indexOf('name: "purge_', i + 10);
  const seg = src.slice(i, nextIdx < 0 ? src.length : nextIdx);
  const ps = seg.indexOf("parameters: {");
  if (ps < 0) continue;
  let depth = 0;
  let end = -1;
  for (let k = seg.indexOf("{", ps); k < seg.length; k += 1) {
    if (seg[k] === "{") depth += 1;
    else if (seg[k] === "}") { depth -= 1; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) { problems.push(`${n}: 参数块括号不配对（源码结构问题）`); continue; }
  const raw = seg.slice(seg.indexOf("{", ps), end + 1);
  let params;
  try {
    params = Function(`"use strict"; return (${raw})`)();
  } catch (e) {
    problems.push(`${n}: 参数无法在静态上下文求值（${String(e.message).slice(0, 40)}）`);
    continue;
  }
  try {
    assertSupported(params);
    validate(params, {}, "");
    checked += 1;
  } catch (e) {
    problems.push(`${n}: ${String(e.message).slice(0, 120)}`);
  }
}

console.log(`[check-tool-schema] 工具 ${names.length} 个｜经宿主校验器确认 ${checked} 个｜问题 ${problems.length} 个`);
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 宿主只支持 type/enum/required/additionalProperties/items/properties/description/default/oneOf。");
  console.log("  → 用别的关键字会让整个工具注册失败，症状是「工具突然不见了」而代码看着正常。");
  process.exit(1);
}
console.log("  ✓ 全部落在宿主支持的 schema 子集内｜空参调用不会报 schema 错误");
process.exit(0);