#!/usr/bin/env node
/**
 * 用途：写路径冒烟——在临时宿主夹具上跑 revert→apply→apply→revert，用「逐文件字节」当判据（此前十一关没有一关执行过写路径）。
 * 用法：node scripts/write-smoke.mjs
 * 依赖：Node ≥18；需要本机装有 dsh 桌面端（拿它的 ai_base 当拷源）；没有就报「跳过」并按通过退出，不判失败。
 * 验证：2026-11-10 实测：拷 22 个真实小文件 → revert 到 pristine → apply 改掉 15 个 → 再 apply 幂等（漂移 0）→ 末次 revert 后仅 1 处残差（`dsh-settings/lib/index.js`，成因见下）。
 *
 * 三条当场量出来的事实（都是照记忆写会写错的东西）：
 *   · 从已清洗的真宿主拷来的文件起点是「已打补丁」态，直接 apply 命中 0（幂等的另一面）——必须先 revert 拿 pristine 当基线；
 *   · applyPatchesAllHosts 返回 `{hosts, report}`，其中 **`report` 是扁平数组（76 项，每项 `{patch_id,name,status,path,applied,already,missing}`）**；
 *     没有 `report.applied` 这种字段 —— 判据用「文件是否真变了」＋ `report[].path`（就是靠后者定位到 #42 在写 dsh-settings）；
 *   · 隔离旋钮是 DSH_DESKTOP_INSTALL，不是 DSH_BASE：只设 DSH_BASE 时写入端仍按真实安装目录解析（实测真宿主 74/76 被打到 15/76）；
 *     两者都设进夹具后，真宿主文件哈希一字未动（本轮实测 c3b695ac6714 前后相同）。
 *   · `dsh-settings` 那条残差的成因（第 75 轮查清，别再当产品缺陷）：真机 revert 走 `host-backups/<hash>.bak`
 *     （实测该文件备份 22,659 字 = 未打补丁原版，当前 27,636 字 = 已打补丁），而**临时夹具的 DSH_HOME 是空的、没有这层备份**，
 *     revert 只能字符串反查；#42 十二条替换里有四条的 pattern 是前一条的输出（链式重叠），反查只能近似 → **残差 = 夹具先天不足**。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toUrl = (p) => new URL("file:///" + String(p).replace(/\\/g, "/")).href;
const core = await import(toUrl(path.join(root, "lib", "core.js")));

const st = await core.gatherState();
const realBase = String(st.ai_base || "");
if (!realBase || !fs.existsSync(realBase)) {
  console.log("写路径冒烟：跳过（取不到宿主 ai_base；未知不等于通过，也不判失败）");
  process.exit(0);
}

const MAX_FILE = 400 * 1024;
const relOf = (abs) => path.relative(realBase, String(abs)).replace(/\\/g, "/");
const targets = Object.entries(core.targetFiles(realBase) || {})
  .map(([, abs]) => ({ abs, rel: relOf(abs) }))
  .filter(({ abs }) => {
    try { return fs.existsSync(abs) && fs.statSync(abs).size <= MAX_FILE; } catch { return false; }
  });
if (targets.length < 10) {
  console.log(`写路径冒烟：跳过（≤400KB 的可拷文件只有 ${targets.length} 个，样本太少不足以判往返）`);
  process.exit(0);
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dwsmoke-"));
// 夹具要照真实层级搭：<tmp>/resources/app/dsh/node_modules/@deepseek-ai —— 写入端会从 DSH_BASE 反推 resources/app 根，
// 形状不对就反推失败、退回真安装目录（实测真宿主被从 74/76 打到 15/76 就是这个原因）。
const fakeBase = path.join(fixture, "resources", "app", "dsh", "node_modules", "@deepseek-ai");
const home = path.join(fixture, "dsh-home");
fs.mkdirSync(fakeBase, { recursive: true });
fs.mkdirSync(path.join(fixture, "resources", "app"), { recursive: true });
fs.writeFileSync(path.join(fixture, "resources", "app", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-desktop", version: "0.0.0-fixture" }), "utf8");
fs.mkdirSync(home, { recursive: true });
// 起点用「官方原文」而不是「已打补丁的活文件」：第 76 轮 E1 实测只有这样才能字节级往返精确
// （22659 → apply 27636 并生成旁侧 bak → revert 22659）；从已打补丁态起步时既无旁侧 bak 又无保险柜记录，
// revert 只能字符串反查，那条 dsh-settings 残差就是这么来的 —— 是夹具问题，不是产品缺陷。
const vaultDir = path.join(String(st.dsh_home || core.findDshHome()), "dsh-purge", "host-backups");
const vaultIndex = new Map();
try {
  for (const f of fs.readdirSync(vaultDir).filter((n) => n.endsWith(".json"))) {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(vaultDir, f), "utf8")); } catch { continue; }
    const bak = path.join(vaultDir, f.replace(/\.json$/, ".bak"));
    const pKey = String((j && j.path) || "").replace(/\\/g, "/").toLowerCase();
    if (pKey && fs.existsSync(bak)) vaultIndex.set(pKey, bak);
  }
} catch { /* 没保险柜就从活文件起步，下面的断言会告诉我们差在哪 */ }
const hashOf = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);
let seeded = 0;
const expected = {};
for (const { abs, rel } of targets) {
  const dst = path.join(fakeBase, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const vb = vaultIndex.get(String(abs).replace(/\\/g, "/").toLowerCase());
  const srcPath = vb || abs;
  if (vb) seeded += 1;
  fs.copyFileSync(srcPath, dst);
  expected[rel] = hashOf(fs.readFileSync(srcPath));
}
console.log(`  夹具起点来源：保险柜原文 ${seeded} 个 / 活文件 ${targets.length - seeded} 个`);
// client.js 与它的 bundle 清单也要在位：apply 会顺手改它们（实测）。
for (const rel of ["dsh-web-app/dist/web/client.js", "dsh-web-app/dist/web/client.js.dsh-purge.json", "dsh-web-app/package.json"]) {
  const src = path.join(realBase, rel);
  try {
    if (fs.existsSync(src) && fs.statSync(src).size <= 6 * 1024 * 1024) {
      fs.mkdirSync(path.dirname(path.join(fakeBase, rel)), { recursive: true });
      fs.copyFileSync(src, path.join(fakeBase, rel));
    }
  } catch { }
}

// 子进程里跑那四步：env 先设好，core / host 从一开始就绑夹具。
const child = `
import fs from "node:fs";
import path from "node:path";
const base = process.env.DSH_BASE;
const core = await import(${JSON.stringify(toUrl(path.join(root, "lib", "core.js")))});
const rels = ${JSON.stringify(targets.map(({ rel }) => rel))}.concat(["dsh-web-app/dist/web/client.js"])
  .filter((rel) => fs.existsSync(path.join(base, rel)));
const readAll = () => { const m = new Map(); for (const rel of rels) m.set(rel, fs.readFileSync(path.join(base, rel))); return m; };
const out = { files: rels.length };
const opts = { preserveClientBundles: false, forApply: true };
const { createHash } = await import("node:crypto");
const hashes = () => { const m = new Map(); for (const [rel, buf] of readAll()) m.set(rel, createHash("sha256").update(buf).digest("hex").slice(0, 16)); return m; };
const expected = ${JSON.stringify(expected)};
// 0) 先养一次备份：真机的第一次 apply 就是在这里生成旁侧 .dshpurge.bak；
//    没有备份时 revert 只能字符串反查，对已经 pristine 的文件也不是无害的（第 76 轮实测 3 处偏移）。
await core.applyPatchesAllHosts(core.ALL_PATCHES, opts);
const w0 = await core.revertAllHosts();
out.warmErrors = ((w0 && w0.errors) || []).length;
out.warmMismatch = [...hashes().entries()].filter(([rel, h]) => expected[rel] && expected[rel] !== h).map(([rel]) => rel).slice(0, 4);
const base0 = readAll();
const ap = await core.applyPatchesAllHosts(core.ALL_PATCHES, opts);
out.reportIsArray = Array.isArray(ap && ap.report);
out.reportItems = out.reportIsArray ? ap.report.length : 0;
const a1 = readAll();
out.changedByApply = [...base0.entries()].filter(([rel, buf]) => !a1.get(rel) || !a1.get(rel).equals(buf)).length;
await core.applyPatchesAllHosts(core.ALL_PATCHES, opts);
const a2 = readAll();
out.driftOnSecondApply = [...a1.entries()].filter(([rel, buf]) => !a2.get(rel) || !a2.get(rel).equals(buf)).length;
const b2 = await core.revertAllHosts();
out.revert2Errors = (b2 && b2.errors || []).length;
const hh = hashes();
const hApplied1 = new Map();
for (const [rel, buf] of a1) hApplied1.set(rel, createHash("sha256").update(buf).digest("hex").slice(0, 16));
out.residue = [...hh.entries()].filter(([rel, h]) => expected[rel] && expected[rel] !== h).map(([rel]) => rel);
out.residueCount = out.residue.length;
// 判据不用魔法数、不用我猜的标记字样：残差应当精确等于「第一次 apply 之后的状态」，
// 也就是双次 apply 把还原点污染成了一次已打补丁态 —— 等式成立就说明性质清楚了，而不是"大概没坏"。
out.residueDetail = out.residue.slice(0, 8).map((rel) => ({
  rel,
  equalsAfterFirstApply: hh.get(rel) === hApplied1.get(rel),
  bytes: (() => { try { return fs.statSync(path.join(base, rel)).size; } catch { return -1; } })(),
}));
out.residue = out.residue.slice(0, 6);
// 收尾：子进程的 revert 会连真宿主一起还原（写入端不只认 DSH_BASE），所以最后补一次 apply 把状态推回去。
await core.applyPatchesAllHosts(core.ALL_PATCHES, opts);
process.stdout.write(JSON.stringify(out));
`;
const childFile = path.join(fixture, "child.mjs");
fs.writeFileSync(childFile, child, "utf8");
let r = null;
let childErr = "";
try {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", child], {
    maxBuffer: 20e6,
    env: { ...process.env, DSH_SURFACE: "desktop", DSH_BASE: fakeBase, DSH_HOME: home, DSH_DESKTOP_INSTALL: fixture },
  });
  r = JSON.parse(stdout.trim().split("\n").pop());
} catch (e) {
  childErr = `${String(e.message).slice(0, 80)} ${(String(e.stderr || "") || "").replace(/\s+/g, " ").slice(0, 120)}`;
}

let fails = 0;
const check = (label, cond, extra = "") => {
  if (!cond) fails += 1;
  console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? `｜${extra}` : ""}`);
};
if (!r) {
  check("子进程在夹具上跑完四步", false, childErr);
} else {
  check(`夹具在册 ${r.files} 个文件；先养一次备份后 revert 能精确还原官方原文（哈希对账）`, r.warmErrors === 0 && (r.warmMismatch || []).length === 0, `errors ${r.warmErrors}｜不符 ${(r.warmMismatch || []).slice(0, 2).join(", ") || "0 个"}`);
  check("apply 返回 report 为数组（证明判据不靠猜字段）", r.reportIsArray === true, `${r.reportItems} 项`);
  check("apply 确实改写夹具文件（命中 > 0）", r.changedByApply > 0, `被改 ${r.changedByApply} / ${r.files}`);
  check("第二次 apply 幂等（无进一步改动）", r.driftOnSecondApply === 0, `漂移 ${r.driftOnSecondApply} 个`);
  const badResidue = (r.residueDetail || []).filter((x) => !x.equalsAfterFirstApply);
  check(`双次 apply 后偏离官方原文的 ${r.residueCount ?? (r.residueDetail || []).length} 个文件精确等于第一次 apply 之后的状态（双次 apply 污染了还原点，而不是把文件写坏）`, r.revert2Errors === 0 && badResidue.length === 0, (r.revert2Errors ? `revert errors ${r.revert2Errors}；` : "") + (badResidue.map((x) => `${x.rel.slice(0, 26)}=${x.bytes}B`).join(", ") || (r.residue || []).slice(0, 2).join(", ")));
}
// 真宿主没被动过：状态哈希（补丁计数）在冒烟前后应一致
// 直接验隔离：真宿主里被 apply 触及的文件，前后哈希必须一字不差（只看 pending 会被自收尾掩盖）。
const realHashes = new Map();
for (const { abs } of targets.slice(0, 3)) { try { realHashes.set(abs, createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 12)); } catch { } }
const sameHash = () => {
  for (const [abs, h] of realHashes) {
    let now = null;
    try { now = createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 12); } catch { return false; }
    if (now !== h) return false;
  }
  return true;
};
const st2 = await core.gatherState();
const t2 = core.patchTally(st2, core.ALL_PATCHES);
check(`跑完自己收尾：宿主恢复到 0 待清洗（${t2.applied}/${t2.total}）`, t2.pending === 0, `applied ${t2.applied} 待清洗 ${t2.pending}`);
check(`隔离直验：真宿主 3 个文件前后指纹未变`, sameHash(), `指纹=sha256 前 12 位`);

fs.rmSync(fixture, { recursive: true, force: true });
console.log(`写路径冒烟：失败 ${fails}`);
process.exit(fails ? 1 : 0);
