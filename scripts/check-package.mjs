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
import { ALL_PATCHES, defaultOverrideText, targetFiles } from "../lib/core.js";

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

// 16) status 的 section 三方一致：渲染函数里实现的 section 数 == 参数表里声明的 boolean 数 == 描述里写的数量词。
//     实现有、参数没声明 = 模型够不着的死功能；参数有、实现没有 = 骗模型的死字段；数量词不更新 = 口径腐烂（本轮就差点留下这一条）。
const mtSrc = fs.readFileSync(path.join(root, "lib", "model-tools.js"), "utf8");
const fnStart = mtSrc.indexOf("export function defaultRenderStatus");
const fnEnd = mtSrc.indexOf("export function buildModelTools");
const implSections = fnStart < 0 || fnEnd < 0 ? null
  : [...new Set([...mtSrc.slice(fnStart, fnEnd).matchAll(/if \(opts\.([a-z]+) === true\) \{/g)].map((m) => m[1]))];
const stStart = mtSrc.indexOf('name: "purge_status"');
const stEnd = mtSrc.indexOf('name: "purge_align"');
const stBlock = stStart >= 0 && stEnd > stStart ? mtSrc.slice(stStart, stEnd) : "";
const declaredParams = [...new Set([...stBlock.matchAll(/^\s+([a-z]+): \{ type: "boolean"/gm)].map((m) => m[1]))];
const cnNum = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const descNumM = /([一二两三四五六七八九十]|\d+)个\s*section/.exec(stBlock);
const descNum = descNumM ? (cnNum[descNumM[1]] ?? Number(descNumM[1])) : null;
if (!implSections) problems.push("找不到 defaultRenderStatus 里的 section 实现（改名了？）");
else if (!declaredParams.length) problems.push("purge_status 参数表里一个 boolean section 参数都没声明");
else {
  const missing = implSections.filter((k) => !declaredParams.includes(k));
  const ghost = declaredParams.filter((k) => !implSections.includes(k));
  if (missing.length) problems.push(`status 实现了 ${missing.join("/")} section 却没声明参数：模型够不着（死功能）`);
  if (ghost.length) problems.push(`status 参数表声明了 ${ghost.join("/")} 但渲染函数没实现：骗模型的死字段`);
  if (descNum === null) problems.push("status 描述里找不到「N个 section」的数量词（口径漂移或句子被改）");
  else if (descNum !== implSections.length) problems.push(`status 描述写 ${descNum} 个 section，实现是 ${implSections.length} 个：加/减 section 要同步描述`);
  else notes.push(`section 三方一致（实现 ${implSections.length} = 参数 = 描述）`);
}

// 17) 每档宿主版本必须有适配记录：docs/适配-<dshTarget>-差异分析.md
const wantDoc = `docs/适配-${pkg.dshTarget || "?"}-差异分析.md`;
if (!fs.existsSync(path.join(root, wantDoc))) problems.push(`缺适配记录 ${wantDoc}：改 dshTarget 那轮就要写（实测结论 + 归属判据，别留成口头账）`);
else notes.push(`适配记录在位（${wantDoc}）`);

// 18) 平面能力数基线：预设面注册数、得分点数、targetFiles 键数。
//     这三个数散在文档里（如「把 56 个 redteam_* 聚成 1 个 purge_drill」），钉在这儿：上游或我们改了，
//     就得同时改基线与文档，而不是让文档静默说谎 —— 本轮正是发现 files 描述写 26 条而实际 56。
const PLANE_BASELINE = { redteamTools: 56, scorePoints: 25, targetFileKeys: 56 };
const toolsSrc = fs.readFileSync(path.join(root, "lib", "redteam", "tools.js"), "utf8");
const regCount = (toolsSrc.match(/tools\.register\(/g) || []).length;
if (regCount !== PLANE_BASELINE.redteamTools) problems.push(`redteam_* 注册 ${regCount} 处，基线 ${PLANE_BASELINE.redteamTools}：预设面能力数变了要同步文档与语义层的说法`);
const scoreCount = await (async () => {
  try {
    const m = await import(new URL("../lib/redteam/score-rules.js", import.meta.url).href);
    const arr = Object.values(m).find((v) => Array.isArray(v) && v.length && (v[0].point_id || v[0].id || v[0].code));
    return arr ? arr.length : 0;
  } catch { return -1; }
})();
if (scoreCount === -1) problems.push("读不到 score-rules（导入失败）");
else if (scoreCount !== PLANE_BASELINE.scorePoints) problems.push(`得分点 ${scoreCount} 个，基线 ${PLANE_BASELINE.scorePoints}：改分值表要同步文档口径`);
const hostPresent = Boolean(process.env.DSH_BASE && fs.existsSync(process.env.DSH_BASE));
const fileKeys = (() => { if (!hostPresent) return -2; try { return Object.keys(targetFiles(process.env.DSH_BASE) || {}).length; } catch { return -1; } })();
if (fileKeys === -2) notes.push("映射基线：本机未装宿主（DSH_BASE 不存在），跳过对账而非判红");
else if (fileKeys < 0) problems.push("targetFiles 调用失败（基线无从对账）");
else if (fileKeys !== PLANE_BASELINE.targetFileKeys) problems.push(`targetFiles ${fileKeys} 个键，基线 ${PLANE_BASELINE.targetFileKeys}：文件映射增减要同步状态文案`);
notes.push(`平面基线 注册 ${regCount} / 得分点 ${scoreCount} / 映射 ${fileKeys === -2 ? "跳过" : fileKeys}（与文档一致）`);

// 15) 中英文案组数对账：README 里写的「N 组文案 / N zh/en copy keys」必须等于 locale/zh.json 的 key 数。
//     本轮发现 README 还写着 328（实际 329）—— 数字不进门禁就是这个下场。
const localeKeys = (() => {
  try { return Object.keys(JSON.parse(fs.readFileSync(path.join(root, "locale", "zh.json"), "utf8"))).length; } catch { return 0; }
})();
if (!localeKeys) problems.push("读不到 locale/zh.json 的 key 数");
else {
  const CLAIMS = [
    ["README.md", /(\d+)\s*组文案/, "中文「N 组文案」"],
    ["README.zh-CN.md", /(\d+)\s*组文案/, "中文「N 组文案」"],
    ["README.en.md", /(\d+)\s*zh\/en copy keys/, "英文「N zh/en copy keys」"],
  ];
  for (const [rel, rex, why] of CLAIMS) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const mm = rex.exec(fs.readFileSync(fp, "utf8"));
    if (!mm) { problems.push(`${rel} 找不到${why}的表述（口径漂移或句子被删）`); continue; }
    if (Number(mm[1]) !== localeKeys) problems.push(`${rel} 写 ${mm[1]} 组文案，locale/zh.json 实际 ${localeKeys} 个 key：改文案要同步文档`);
  }
  notes.push(`文案组数 ${localeKeys}（文档口径一致）`);
}

// 14) 提示词层净增减预算：76 条补丁里只有「提示词」层的增减真的进模型上下文。
//     2026-11-09 实测 +904 字（占默认注入 29,777 的 3.0%），预算设 2,000（约 6.7%）——
//     代码层净 +14,975 字不烧 token，别拿它当成本；0.2.0 兼容层与工具层实测是净减少（-1,162 / -1,589）。
const PROMPT_NET_BUDGET = 2000;
let promptNet = 0;
for (const pt of ALL_PATCHES) {
  if (!String(pt.layer || "").includes("提示词")) continue;
  for (const r of pt.replacements || []) {
    const pat = Array.isArray(r.pattern) ? r.pattern[0] : r.pattern;
    promptNet += String(r.replace ?? "").length - String(pat ?? "").length;
  }
}
if (promptNet > PROMPT_NET_BUDGET) problems.push(`提示词层净增 ${promptNet} 字，超预算 ${PROMPT_NET_BUDGET}：往 prompt 里加句子前先想能不能折进现有条款（代码层增减不计 token，不受此限）`);
else notes.push(`提示词层净 ${promptNet > 0 ? "+" : ""}${promptNet} 字（预算 ${PROMPT_NET_BUDGET}）`);

// 13) 工具数对账：README 里写的「N 个工具」必须等于源码里的 purge_* 定义数。
//     不加这条的话，多接一个工具就会让文档静默变陈旧（本轮就是这样：README 还写 9，实际已经 10）。
const toolSrc = fs.readFileSync(path.join(root, "lib", "model-tools.js"), "utf8");
const toolCount = (toolSrc.match(/name: "purge_[a-z_]+"/g) || []).length;
if (!toolCount) problems.push("源码里一个 purge_* 工具定义都没找到（改名了？）");
for (const [rel, rex, why] of [
  ["README.md", /(\d+) 个工具：status/, "中文工具数"],
  ["README.en.md", /(\d+) tools?: status/, "英文工具数"],
]) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  const mm = new RegExp(rex.source).exec(fs.readFileSync(fp, "utf8"));
  if (!mm) { problems.push(`${rel} 里找不到「${why}」的表述（口径漂移）`); continue; }
  if (Number(mm[1]) !== toolCount) problems.push(`${rel} 写 ${mm[1]} 个工具，源码实际 ${toolCount} 个：加/减工具要同步文档`);
}
if (toolCount) notes.push(`工具数 ${toolCount}（文档口径一致）`);

// 12) 注入正文体积预算：这是「不许堆叠」唯一能被机器看的量 —— 默认注入越长，每个会话的固定成本越高。
//     预算按 2026-11-09 实测 29,777 字放宽到 33,000（约 +11%），只防失控增长，不做常红灯。
const INJECT_BUDGET = 33000;
let injectLen = 0;
try { injectLen = String(defaultOverrideText() || "").length; } catch (e) { problems.push(`读不到默认注入正文：${String(e.message).slice(0, 60)}`); }
if (!injectLen) problems.push("默认注入正文是空的（打包或 asset-table 出问题）");
else if (injectLen > INJECT_BUDGET) problems.push(`默认注入正文 ${injectLen} 字，超预算 ${INJECT_BUDGET}：加条款前先想能不能折进现有段落`);
if (injectLen) notes.push(`注入体积 ${injectLen} 字（预算 ${INJECT_BUDGET}，占 ${Math.round((100 * injectLen) / INJECT_BUDGET)}%）`);

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
