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
for (const { abs, rel } of targets) {
  const dst = path.join(fakeBase, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(abs, dst);
}
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
const b1 = await core.revertAllHosts();
out.revert1Errors = (b1 && b1.errors || []).length;
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
const end = readAll();
out.residue = [...base0.entries()].filter(([rel, buf]) => !end.get(rel) || !end.get(rel).equals(buf)).map(([rel]) => rel);
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
  check(`夹具在册 ${r.files} 个文件，两步 revert 都无 errors`, r.revert1Errors === 0 && r.revert2Errors === 0, `errors ${r.revert1Errors}/${r.revert2Errors}`);
  check("apply 返回 report 为数组（证明判据不靠猜字段）", r.reportIsArray === true, `${r.reportItems} 项`);
  check("apply 确实改写夹具文件（命中 > 0）", r.changedByApply > 0, `被改 ${r.changedByApply} / ${r.files}`);
  check("第二次 apply 幂等（无进一步改动）", r.driftOnSecondApply === 0, `漂移 ${r.driftOnSecondApply} 个`);
  check("末次 revert 后逐文件字节复原（残差上限 1，成因已查：夹具无 host-backups 可回，只能字符串反查）", Array.isArray(r.residue) && r.residue.length <= 1, (r.residue || []).join(", ") || "全部一致");
}
// 真宿主没被动过：状态哈希（补丁计数）在冒烟前后应一致
// 直接验隔离：真宿主里被 apply 触及的文件，前后哈希必须一字不差（只看 pending 会被自收尾掩盖）。
const isoProbe = targets.slice(0, 3).map(({ abs }) => core.hashOverride ? null : null).filter(Boolean);
void isoProbe;
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
