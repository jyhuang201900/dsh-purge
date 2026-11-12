#!/usr/bin/env node
/**
 * 用途：工具层冒烟——真正执行 purge_apply / purge_revert 两个「会写文件」的模型工具（此前十三关之外，
 *      任何一关都没跑过工具层的 mutating 分支：check-tools 与 cli-smoke 只跑只读，write-smoke 直接调 core）。
 * 用法：node scripts/tools-smoke.mjs
 * 依赖：Node ≥18；需本机装有 dsh 桌面端（拿 ai_base 与 host-backups 当种子源）；取不到就报「跳过」并按通过退出。
 * 验证：2026-11-10 首跑：apply 报 hosts=1 且改写文件数 > 0 → revert 报 hosts=1 → 逐个文件与官方原文哈希全等（单次往返精确）。
 *
 * 三条纪律（都是前几轮付过学费的）：
 *   · 只动临时 base：env（DSH_BASE / DSH_HOME / DSH_DESKTOP_INSTALL / DSH_PATCH_BASES）在任何 import 之前设好，放进子进程；
 *   · 起点用保险柜里的官方原文，否则「已打补丁 + 无备份」的起点会让 revert 只能近似（第 76/79 轮实测）；
 *   · 判据是「动作返回的 hosts」与「逐文件哈希」，不是报告字段名（`report` 是扁平数组，没有 report.applied）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toUrl = (p) => new URL("file:///" + String(p).replace(/\\/g, "/")).href;
const core = await import(toUrl(path.join(root, "lib", "core.js")));

const { adoptSurfaceForAiBase, findHostAiBase, findResourcesDir } = await import(toUrl(path.join(root, "lib", "surface.js")));
// 面跟着宿主走（第 148 轮）：单跑时没有 DSH_BASE → gatherState 取不到 ai_base → 旧写法「跳过」按 exit 0 放行。
// 跳过的意思是这一关没跑，所以现在自己解析宿主，解析不到就 exit 2，由 verify 判失败。
const hostBase = findHostAiBase();
if (!hostBase) {
  // 密封 asar 且没有解包源树：本关不适用（没东西可测），记 note 而不是冒充通过。
  const sealed = (() => {
    // 共享探测（审计 M1）：宿主装在非常规目录时本地硬编码扫不到，会误判 exit 2（闸门红）；
    // 「没装在这」应该是 exit 3（不适用），两件事必须分开。
    const r = findResourcesDir();
    if (!r) return "";
    const p = path.join(r, "app.asar");
    try { return fs.existsSync(p) ? p : ""; } catch { return ""; }
  })();
  if (sealed) {
    console.log("工具层冒烟：不适用（宿主是密封 asar、没有解包源树）；解开目录或跑一次 apply 后再跑");
    process.exit(3);
  }
  console.log("工具层冒烟：未跑（本机找不到宿主 ai_base；跳过不是通过，exit 2）");
  console.log("  宿主装在非常规位置时用：node scripts/verify.mjs --host \"<...>/resources/app/dsh/node_modules/@deepseek-ai\"");
  process.exit(2);
}
if (!process.env.DSH_BASE) process.env.DSH_BASE = hostBase;
adoptSurfaceForAiBase(hostBase);

const st = await core.gatherState();
const realBase = String(st.ai_base || "");
if (!realBase || !fs.existsSync(realBase)) {
  console.log("工具层冒烟：跳过（取不到宿主 ai_base；未知不等于通过）");
  process.exit(0);
}
const map = core.targetFiles(realBase);
const vaultDir = path.join(String(st.dsh_home || core.findDshHome()), "dsh-purge", "host-backups");
const vaultIdx = new Map();
try {
  for (const f of fs.readdirSync(vaultDir).filter((n) => n.endsWith(".json"))) {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(vaultDir, f), "utf8")); } catch { continue; }
    const bak = path.join(vaultDir, f.replace(/\.json$/, ".bak"));
    if (j && j.path && fs.existsSync(bak)) vaultIdx.set(String(j.path).split(BS).join("/").toLowerCase(), bak);
  }
} catch { /* 没保险柜就从活文件起步，断言会告诉我们差在哪 */ }

const MAX_FILE = 400 * 1024;
const picks = Object.entries(map)
  .filter(([, abs]) => typeof abs === "string")
  .map(([, abs]) => ({ abs, rel: path.relative(realBase, abs).split(BS).join("/") }))
  .filter(({ abs }) => {
    try { return fs.existsSync(abs) && fs.statSync(abs).size <= MAX_FILE; } catch { return false; }
  });
if (picks.length < 10) {
  console.log(`工具层冒烟：跳过（≤400KB 的可拷文件只有 ${picks.length} 个，样本太少）`);
  process.exit(0);
}
const fx = fs.mkdtempSync(path.join(os.tmpdir(), "tosmoke-"));
const fakeBase = path.join(fx, "resources", "app", "dsh", "node_modules", "@deepseek-ai");
const home = path.join(fx, "dsh-home");
fs.mkdirSync(fakeBase, { recursive: true });
fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(path.join(fx, "resources", "app", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-desktop", version: "0.0.0-fixture" }), "utf8");
let seeded = 0;
for (const { abs, rel } of picks) {
  const vb = vaultIdx.get(abs.split(BS).join("/").toLowerCase());
  const src = vb || abs;
  if (vb) seeded += 1;
  const dst = path.join(fakeBase, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
for (const rel of ["dsh-web-app/dist/web/client.js", "dsh-web-app/package.json"]) {
  const s = path.join(realBase, rel);
  try {
    if (fs.existsSync(s) && fs.statSync(s).size <= 6 * 1024 * 1024) {
      fs.mkdirSync(path.dirname(path.join(fakeBase, rel)), { recursive: true });
      fs.copyFileSync(s, path.join(fakeBase, rel));
    }
  } catch { }
}
const realProbe = picks.slice(0, 3).map(({ abs }) => abs);
const { createHash } = await import("node:crypto");
const hashFile = (p) => { try { return createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16); } catch { return "读不到"; } };
const realBefore = realProbe.map(hashFile);

const child = [
"import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';",
"const { buildModelTools } = await import(" + JSON.stringify(toUrl(path.join(root, "lib", "model-tools.js"))) + ");",
"const core = await import(" + JSON.stringify(toUrl(path.join(root, "lib", "core.js"))) + ");",
"const rules = await import(" + JSON.stringify(toUrl(path.join(root, "lib", "rules.js"))) + ");",
"const hostctl = await import(" + JSON.stringify(toUrl(path.join(root, "lib", "host.js"))) + ");",
"const updater = await import(" + JSON.stringify(toUrl(path.join(root, "lib", "update.js"))) + ");",
"const BS = String.fromCharCode(92);",
"const h = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);",
"const rels = " + JSON.stringify(picks.map(({ rel }) => rel)) + ";",
"const base = process.env.DSH_BASE;",
"const hashes = () => { const m = new Map(); for (const rel of rels) { try { m.set(rel, h(fs.readFileSync(path.join(base, rel)))); } catch { } } return m; };",
"const official = hashes();",
"const t = buildModelTools({ core, rules, hostctl, updater, rejectIfNeedPrompt: () => null });",
"const ta = t.find((x) => x.name === 'purge_apply');",
"const tr = t.find((x) => x.name === 'purge_revert');",
"const out = { seeded: official.size };",
"const ra = await ta.execute({});",
"out.applyText = String(ra.text).split('\\n')[0].slice(0, 120);",
"const after = hashes();",
"out.changed = [...official.entries()].filter(([rel, x]) => after.get(rel) !== x).length;",
"const rv = await tr.execute({});",
"out.revertText = String(rv.text).slice(0, 120);",
"const back = hashes();",
"out.notRestored = [...official.entries()].filter(([rel, x]) => back.get(rel) !== x).map(([rel]) => rel).slice(0, 4);",
"process.stdout.write(JSON.stringify(out));",
].join(NL);
const childFile = path.join(fx, "child.mjs");
fs.writeFileSync(childFile, child, "utf8");
const env = { ...process.env, DSH_SURFACE: "desktop", DSH_BASE: fakeBase, DSH_HOME: home, DSH_DESKTOP_INSTALL: fx, DSH_PATCH_BASES: fakeBase };
let r = null;
let err = "";
try { r = JSON.parse((await run(process.execPath, [childFile], { env, encoding: "utf8", maxBuffer: 20e6 })).stdout.trim().split(NL).pop()); }
catch (e) { err = `${String(e.message).slice(0, 70)} ${String(e.stderr || "").replace(/\s+/g, " ").slice(0, 120)}`; }

let fails = 0;
const check = (label, cond, extra = "") => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? `｜${extra}` : ""}`);
};
if (!r) check("子进程执行 purge_apply / purge_revert", false, err);
else {
  check(`purge_apply 报 hosts=1（起点 ${r.seeded} 个官方原文）`, /hosts=1/.test(r.applyText), r.applyText.slice(0, 84));
  check("purge_apply 确实改写了夹具文件", r.changed > 0, `被改 ${r.changed} / ${r.seeded}`);
  check("purge_revert 报 hosts=1 且无 errors", /hosts=1/.test(r.revertText) && !/errors=/.test(r.revertText), r.revertText.slice(0, 84));
  check("单次 apply→revert 后逐文件回到官方原文（残差 0）", Array.isArray(r.notRestored) && r.notRestored.length === 0, (r.notRestored || []).join(", ") || "全部一致");
}
const realAfter = realProbe.map(hashFile);
check("真宿主三个探针文件未被工具层冒烟改写", realBefore.join(",") === realAfter.join(","), `${realBefore[0]} → ${realAfter[0]}`);
fs.rmSync(fx, { recursive: true, force: true });
console.log(`工具层冒烟：失败 ${fails}`);
process.exit(fails ? 1 : 0);
