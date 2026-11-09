#!/usr/bin/env node
/**
 * 用途：包自证闸门（对标社区市场的 bundle manifest 校验）——一条命令回答「purge 这个包自己说没说谎」。
 * 用法：node scripts/check-package.mjs [--json]
 * 依赖：Node ≥18 + lib/core.js（取运行时真相，不正则数数组）；只读仓库文件，不碰宿主。
 * 验证：2026-11-09 实跑 —— 见下方 notes；任一不符退出码 1。
 *
 * 为什么要它：市场用 manifest 判定插件可信，purge 的 npm 侧此前没有等价自检。
 * 更要紧的是本仓库反复出现的「数字过期」（banner 曾写 25 patches、description 与 en 变体曾写 23 技能，实为 76/32）：
 * 靠人记必然过期，所以把所有对用户可见文件里的数量声明都纳入同一道门。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ALL_PATCHES } from "../lib/core.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
const problems = [];
const notes = [];
const has = (rel) => fs.existsSync(path.join(root, rel));

// 1) 必需字段
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
for (const k of ["name", "version", "description", "license"]) {
  if (!pkg[k]) problems.push(`package.json 缺 ${k}`);
}
notes.push(`name=${pkg.name} version=${pkg.version}`);

// 2) dshTarget 必须落在 engines.dsh 的 [>=A, <B) 区间内（区间是左闭右开）
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const trip = (s) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s || "")); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const t3 = trip(pkg.dshTarget);
const range = String(pkg.engines?.dsh || "");
const ge3 = trip(/(?:^|\s)>=\s*([0-9.]+[-\w.]*)/.exec(range)?.[1]);
const lt3 = trip(/<\s*([0-9.]+[-\w.]*)/.exec(range)?.[1]);
if (!t3) problems.push(`dshTarget「${pkg.dshTarget || "(空)"}」不是 x.y.z 形式`);
if (!ge3 || !lt3) problems.push(`engines.dsh「${range || "(空)"}」不是 ">=A.B.C <D.E.F" 形状`);
if (t3 && ge3 && lt3) {
  if (cmp(t3, ge3) < 0) problems.push(`dshTarget ${pkg.dshTarget} 低于 engines.dsh 下界`);
  if (cmp(t3, lt3) >= 0) problems.push(`dshTarget ${pkg.dshTarget} 没落在 engines.dsh 右开区间内`);
  if (!problems.some((p) => p.includes("engines.dsh") || p.includes("dshTarget"))) notes.push(`engines.dsh=${range} 覆盖 dshTarget=${pkg.dshTarget} ✓`);
}

// 3) files 白名单每一项都要真的存在（写错不报错，只会静默不发布）
for (const f of pkg.files || []) {
  if (!f.startsWith("!") && !has(f)) problems.push(`files 列了不存在的条目：${f}`);
}
notes.push(`files ${(pkg.files || []).filter((f) => !f.startsWith("!")).length} 项存在`);

// 4) exports 的目标必须存在（带 * 的模式取其目录）
let exportsOk = 0;
for (const [spec, dest] of Object.entries(pkg.exports || {})) {
  const target0 = typeof dest === "string" ? dest : (dest?.import || Object.values(dest || {})[0]);
  if (typeof target0 !== "string") { problems.push(`exports ${spec} 目标不是字符串`); continue; }
  const clean = target0.replace(/^\.\//, "");
  if (!has(clean.includes("*") ? path.dirname(clean) : clean)) problems.push(`exports ${spec} → ${target0} 不存在`);
  else exportsOk += 1;
}
notes.push(`exports ${exportsOk}/${Object.keys(pkg.exports || {}).length} 命中`);

// 5) screenshots.json 列出的图必须都在（市场展示的门面）
const shots = JSON.parse(fs.readFileSync(path.join(root, "screenshots.json"), "utf8"));
const missingShots = (Array.isArray(shots) ? shots : []).filter((s) => !has(String(s)));
if (missingShots.length) problems.push(`screenshots.json 里 ${missingShots.length} 个文件不存在`);
notes.push(`screenshots ${Array.isArray(shots) ? shots.length : 0} 张齐全`);

// 6) 三语镜像纪律：README.md 与 README.zh-CN.md 必须逐字节一致
if (has("README.md") && has("README.zh-CN.md") && fs.readFileSync(path.join(root, "README.md"), "utf8") !== fs.readFileSync(path.join(root, "README.zh-CN.md"), "utf8")) {
  problems.push("README.md 与 README.zh-CN.md 不一致（要么忘了同步，要么不该双写）");
}

// 7) 全仓数量声明必须等于运行时真相（补丁数 / 技能数）
const REAL = { patches: ALL_PATCHES.length, skills: fs.readdirSync(path.join(root, "skills", "redteam")).filter((f) => f.endsWith(".md")).length };
// 只扫「当前口径」文件；release-notes.md 是 changelog，里面的旧数字（如上游 3 个技能、84 条补丁）是历史事实，不算过期。
const CLAIM_FILES = ["package.json", "README.md", "README.en.md", "docs/banner.svg", "lib/default-prompt-inject.md", "lib/default-prompt-inject.en.md", "presets/redteam/agent.cordis.yml", "presets/redteam/preset.yml", "docs/graphify-语义层规范.md"];
const PATTERNS = [
  { key: "patches", re: /(\d+)\s*(?:条补丁|patches\b|patch\b)/g },
  { key: "skills", re: /(\d+)\s*(?:个演练技能|drill skills)/g },
];
let claims = 0;
const stale = [];
for (const rel of CLAIM_FILES) {
  if (!has(rel)) continue;
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  for (const { key, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      claims += 1;
      if (Number(m[1]) !== REAL[key]) stale.push(`${rel} 写「${m[0].trim()}」，实况 ${REAL[key]}`);
    }
  }
}
if (!claims) problems.push("一个数量声明都没扫到（说明门禁空转，检查 CLAIM_FILES/PATTERNS 是否失效）");
notes.push(`声明 ${claims} 处，过期 ${stale.length} 处`);
for (const s of stale.slice(0, 8)) problems.push(s);
if (stale.length > 8) problems.push(`…另有 ${stale.length - 8} 处过期声明`);

// 11) 目录站三级证据自查（借 dsh-plugin.net 的收录判据，但每条都按本机实测的写法来）
//     tier1 README 写安装命令：真实措辞是 `dsh plugin --profile web add`（不是 `dsh plugin add`，
//           我用 7 个已装插件的 README 验过：精确串 dsh plugin add 对它们全部不成立）
//     tier2 package.json 有 dsh.bundle（官方 hub 把它当布尔标记：client.js L15679「Whether the version declares a `dsh.bundle`」）
//     tier3 包元数据声明 dsh 依赖（peerDependencies 里的 @deepseek-ai/*）
const INSTALL_RE = /dsh\s+plugin\s+(--[^\s]+\s+\S+\s+)?add\b/;
const readmes = ["README.md", "README.zh-CN.md", "README.en.md"];
const noInstall = readmes.filter((rel) => has(rel) && !INSTALL_RE.test(fs.readFileSync(path.join(root, rel), "utf8")));
if (!readmes.some((rel) => has(rel))) problems.push("README 一个都不在");
else if (noInstall.length) problems.push(`README 缺安装命令（tier1）：${noInstall.join(", ")}`);
const bundle = pkg.dsh && pkg.dsh.bundle;
if (!bundle) problems.push("package.json 没有 dsh.bundle（tier2：官方 hub 用它判定 bundle manifest）");
else {
  if (bundle.patch && !has(String(bundle.patch).replace(/^\.\//, ""))) problems.push(`dsh.bundle.patch 指向的文件不存在：${bundle.patch}`);
  if (bundle.entry && !has(String(bundle.entry).replace(/^\.\//, ""))) problems.push(`dsh.bundle.entry 指向的文件不存在：${bundle.entry}`);
  const plats = bundle.platforms;
  if (plats !== undefined && (!Array.isArray(plats) || !plats.length || plats.some((v) => typeof v !== "string"))) {
    problems.push("dsh.bundle.platforms 形状不合宿主校验（非空字符串数组，见 dsh-client-modules index.js L1065）");
  }
}
const dshDep = Object.keys(pkg.peerDependencies || {}).some((k) => k.startsWith("@deepseek-ai/")) || Object.keys(pkg.dependencies || {}).some((k) => k.startsWith("@deepseek-ai/"));
if (!dshDep) problems.push("包元数据没声明 @deepseek-ai/* 依赖（tier3）");
notes.push(`目录站三级证据：tier1 README 安装命令 ${readmes.length - noInstall.length}/${readmes.length}、tier2 dsh.bundle=${bundle ? "有" : "无"}、tier3 dsh 依赖=${dshDep ? "有" : "无"}`);

// 10) 闸门数自证：从 verify.mjs 读出实际关卡数，要求 README 中英两侧的说法与之一致。
//     （「五关/六关/七关」这种话是最容易漂的口径：加一道门却忘了改文档，本仓库已经发生过两轮。）
const ver = fs.readFileSync(path.join(root, "scripts", "verify.mjs"), "utf8");
const gateNums = [...ver.matchAll(/^\/\/ 关 (\d+)：/gm)].map((m) => Number(m[1]));
const gateCount = gateNums.length ? Math.max(...gateNums) : 0;
if (!gateCount) problems.push("verify.mjs 里读不到关卡编号（注释格式变了？门禁要跟着改）");
const CN = { 1: "一", 2: "两", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七", 8: "八", 9: "九", 10: "十" };
const EN = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };
if (gateCount) {
  const zh = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const en = fs.readFileSync(path.join(root, "README.en.md"), "utf8");
  const zhWant = `过${CN[gateCount] || gateCount}关`;
  const enWant = `${EN[gateCount] || gateCount} gates`;
  if (!zh.includes(zhWant)) problems.push(`README.md 没写「${zhWant}」（verify 实际 ${gateCount} 关，文档口径过期）`);
  if (!en.toLowerCase().includes(enWant)) problems.push(`README.en.md 没写「${enWant}」（verify 实际 ${gateCount} 关）`);
  notes.push(`闸门数自证：verify 实际 ${gateCount} 关，README 中英口径一致 ✓`);
}

// 9) 生态 tag 口径：这几个 tag 是目录站在用的主流 tag，且 purge 确实具备该能力（2026-11-09 用 /api/plugins 实测：
//    deepseek-harness 36/50、cordis 6/50、mcp 5/50）。写进门禁是防止以后编辑 keywords 时被顺手删掉。
const WANT_TAGS = ["deepseek-harness", "dsh-plugin", "mcp", "cordis", "skill", "skills", "security"];
const kw = Array.isArray(pkg.keywords) ? pkg.keywords : [];
const lost = WANT_TAGS.filter((k) => !kw.includes(k));
if (lost.length) problems.push(`keywords 丢了生态主流 tag：${lost.join(", ")}（目录站在用，且 purge 确实具备）`);
notes.push(`生态 tag ${WANT_TAGS.length - lost.length}/${WANT_TAGS.length} 在位`);

if (asJson) process.stdout.write(`${JSON.stringify({ real: REAL, claims, problems, notes }, null, 2)}\n`);
else {
  process.stdout.write(`包自证：实况 补丁 ${REAL.patches} 条 / 技能 ${REAL.skills} 个｜${notes.length} 项核对，问题 ${problems.length}\n`);
  for (const n of notes) process.stdout.write(`  · ${n}\n`);
  for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
}
process.exit(problems.length ? 1 : 0);
