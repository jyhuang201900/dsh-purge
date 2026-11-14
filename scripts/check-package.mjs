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
import { spawnSync } from "node:child_process";
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
const PLANE_BASELINE = { redteamTools: 56, scorePoints: 25, targetFileKeys: 57 };
// **只比数字会让「少一个 A、多一个 B」静默通过** —— 第 153 轮就栽在这：数字从 56 变 57，
// 没人知道进出的是哪个键，只能靠人工 dump 名单去猜。数字之外再钉名单，对不上就点名。
const TARGETFILE_KEYS_BASELINE = [
  "agent-instructions", "agent-loop", "agent-preset", "api-session-controller", "app-boot",
  "auto-review", "base", "base-package", "compaction-tool-result-pruner", "conversation-client",
  "deliverables-prompt", "desktop-shell", "dsh-tool-executor-ptc", "dsh-tools",
  "dsh-tools-pipeline", "dsh-tools-ptc", "dsh-tools-types", "escalation", "fs-observation-policy",
  "fs-sandbox", "headless", "llm-deepseek", "permission-presets", "permission-presets-types",
  "persona", "pi-ai-anthropic-messages", "pi-ai-completions", "pi-ai-responses-shared",
  "preset-acp-app", "preset-cordis", "preset-minimal", "preset-ptc", "preset-sdk-app",
  "preset-sdk-minimal", "preset-standard", "repeat-tool-reminder", "sandbox-local",
  "sandbox-policy", "session", "session-format-v0", "session-log-deepseek",
  "session-log-deepseek-types", "session-reference", "settings", "subagent", "subagent-types",
  "system-prompt", "tool-bash", "tool-fs", "tool-pwsh", "tool-subagent", "tool-todo", "tool-web",
  "user-approval", "user-approval-code", "web-app", "web-app-lib",
];
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
// **自动探测宿主**：不设 DSH_BASE 时，宿主装在本机却对不上账，等于白跑一次。
// 第 145 轮实测两件事：
//   ① DSH_BASE 指到 `resources/app.asar/dsh`（不存在）时，对账被静默跳过；
//   ② 真正的 aiBase 是 `resources/app/dsh/node_modules/@deepseek-ai` 这一层
//      （targetFiles 在里面找 dsh-* 子包，指到 dsh/ 或 app.asar 都找不到）；
//   ③ **宿主不一定装在 C 盘**——本机在 `E:\Program Files\harness`，
//      而 `%ProgramFiles%` 是 `C:\Program Files`，所以写死环境变量探不到。
// 所以先按「运行中的进程路径」推，再退到常见安装位置。
if (!process.env.DSH_BASE) {
  const cands = [];
  // ① 从正在运行的宿主进程推：<...>/harness/DeepSeek Harness.exe → <...>/harness/resources/app/dsh/node_modules/@deepseek-ai
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], { encoding: "utf8", timeout: 8000 });
    const exePath = String(out || "").trim();
    if (exePath) {
      const resDir = path.join(path.dirname(exePath), "resources");
      cands.push(path.join(resDir, "app", "dsh", "node_modules", "@deepseek-ai"));
      cands.push(path.join(resDir, "app.asar.unpacked", "node_modules", "@deepseek-ai"));
    }
  } catch { /* 进程查不到就走下面的常见位置 */ }
  for (const root of [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"), "E:\\Program Files", "D:\\Program Files"]) {
    if (!root) continue;
    cands.push(path.join(root, "harness", "resources", "app", "dsh", "node_modules", "@deepseek-ai"));
  }
  const hit = cands.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (hit) {
    process.env.DSH_BASE = hit;
    notes.push(`宿主自动探测：${hit.replace(/\\/g, "/").replace(/^.*?harness/, "…/harness")}`);
  }
}
const hostPresent = Boolean(process.env.DSH_BASE && fs.existsSync(process.env.DSH_BASE));
// **DSH_BASE 设了却指错 = 静默跳过**，这是最危险的一种绿：
// 第 145 轮实测，我把 DSH_BASE 指向 `resources/app.asar/dsh`（该路径根本不存在），
// 于是「平面基线」那一项从「映射 56」悄悄变成「映射 1（跳过）」，
// 而整体仍然报「问题 0」——**看起来通过了，实际一次都没对账**。
// 现在区分两种情况：
//   · 没设 DSH_BASE → 本机确实没装宿主，跳过是合理的（记 note）；
//   · 设了但路径不存在 → 是**指错了**，必须报问题，否则等于自己骗自己。
if (process.env.DSH_BASE && !fs.existsSync(process.env.DSH_BASE)) {
  problems.push(`DSH_BASE 指向不存在的路径：${process.env.DSH_BASE}（设了却指错会让对账静默跳过，必须修正或清空）`);
}
// **面（surface）也必须跟着宿主走** —— 第 148 轮实测：本关一直报「targetFiles 52 个键，基线 56」，
// 根因不是宿主少了文件，而是**闸门自己把目标筛掉了**：
//   在 `node` 子进程里 detectSurface() 认不出桌面安装 → pathZone 把这些文件判成 desktop-install
//   → allowTargetPath()（桌面面才允许 desktop-install）一律拒绝 → Object.keys 少 4~8 个。
// 证据：同一 DSH_BASE，加 DSH_SURFACE=desktop 后 56 键、问题 0（pi-ai 三件与 dsh-tools-ptc 全回来）。
// 所以先按 DSH_BASE 所在位置判定面，再对账；判不出来就保持默认面（不硬猜）。
if (hostPresent && !process.env.DSH_SURFACE) {
  try {
    const { adoptSurfaceForAiBase } = await import("../lib/surface.js");
    if (adoptSurfaceForAiBase(process.env.DSH_BASE)) {
      notes.push("宿主是桌面安装：按 desktop 面判定（否则 resources/app 下的目标会被自身白名单筛掉，映射假缩水）");
    }
  } catch (e) {
    // 空 catch 会把「模块读不到」伪装成「映射缩水」——审阅点名过，这里直接报红。
    problems.push(`读不到 lib/surface.js 的面判定：${String(e && e.message || e).slice(0, 90)}（导入失败只会退化成「映射 52 键，基线 56」的误导）`);
  }
}
const fileKeyList = (() => { if (!hostPresent) return -2; try { return Object.keys(targetFiles(process.env.DSH_BASE) || {}).sort(); } catch { return -1; } })();
if (fileKeyList === -2) notes.push("映射基线：本机未装宿主（DSH_BASE 不存在），跳过对账而非判红");
else if (fileKeyList < 0) problems.push("targetFiles 调用失败（基线无从对账）");
else {
  const added = fileKeyList.filter((k) => !TARGETFILE_KEYS_BASELINE.includes(k));
  const removed = TARGETFILE_KEYS_BASELINE.filter((k) => !fileKeyList.includes(k));
  if (added.length) problems.push(`targetFiles 多出键：${added.join(", ")}：新登记的文件映射要同步 TARGETFILE_KEYS_BASELINE 与文档`);
  if (removed.length) problems.push(`targetFiles 少了键：${removed.join(", ")}：宿主构建换了文件名/包，改映射或改基线，别让补丁静默落空`);
  if (fileKeyList.length !== PLANE_BASELINE.targetFileKeys) problems.push(`targetFiles ${fileKeyList.length} 个键，基线 ${PLANE_BASELINE.targetFileKeys}：文件映射增减要同步状态文案`);
}
const fileKeys = Array.isArray(fileKeyList) ? fileKeyList.length : fileKeyList;
notes.push(`平面基线 注册 ${regCount} / 得分点 ${scoreCount} / 映射 ${fileKeys === -2 ? "跳过" : fileKeys}（与文档一致）`);

// 19b) 运行时实效（只报不判红）：Electron 优先加载 `resources/app.asar`，而补丁写在解开目录
//      `resources/app/**`。asar 比补丁旧 = 补丁只存在于没人加载的那份里。
//      2026-11-12 实测：app.asar（203.3MB）里搜 `[dsh-purge]` 零命中，解开目录里 9 处命中。
//      只报不判红，是因为修它要拆 asar + 重启宿主（会断会话），不是一次提交能关掉的事；
//      但「闸门全绿而补丁没生效」这种认知不能继续藏着。
{
  const base = String(process.env.DSH_BASE || "").replace(/\\/g, "/");
  const at = base.toLowerCase().indexOf("/resources/");
  if (at > 0) {
    const resDir = base.slice(0, at + "/resources".length);
    const asar = path.join(resDir, "app.asar");
    try {
      if (fs.existsSync(asar)) {
        const asarTime = fs.statSync(asar).mtimeMs;
        let newest = 0;
        let newestFile = "";
        for (const [k, v] of Object.entries(targetFiles(process.env.DSH_BASE) || {})) {
          for (const f of (Array.isArray(v) ? v : [v]).filter(Boolean)) {
            try {
              const t = fs.statSync(f).mtimeMs;
              if (t > newest) { newest = t; newestFile = `${k}`; }
            } catch { /* 跳过 */ }
          }
        }
        if (newest && asarTime < newest) {
          notes.push(`运行时实效：app.asar（${Math.round(fs.statSync(asar).size / 1048576)}MB）早于最新补丁（${newestFile}）——Electron 优先加载 asar，补丁只写进解开目录，宿主读到的仍是原版。修它要拆 asar + 重启宿主`);
        } else {
          notes.push("运行时实效：app.asar 不比补丁旧（或不存在）——补丁与加载源一致");
        }
      }
    } catch { /* 读不到就不报 */ }
  }
}

// 20) 命令面对账：/purge 的每个非别名子命令都必须出现在它的 hint 里。
//     本轮补 align/update 时最容易漏的就是 hint 字符串 —— 漏了就是「命令存在但没人知道」。
{
  const idxSrc = fs.readFileSync(path.join(root, "lib", "index.js"), "utf8");
  const start = idxSrc.indexOf("export async function handlePurgeCommand");
  if (start < 0) {
    problems.push("找不到 handlePurgeCommand（改名或未导出：命令面对账无从下手）");
  } else {
    let depth = 0;
    let end = start;
    const lines = idxSrc.slice(start).split("\n");
    for (let k = 0; k < lines.length; k += 1) {
      for (const ch of lines[k]) { if (ch === "{") depth += 1; else if (ch === "}") depth -= 1; }
      if (depth === 0 && k > 0) { end = start + idxSrc.slice(start).split("\n").slice(0, k + 1).join("\n").length; break; }
    }
    const body = idxSrc.slice(start, end + 200);
    // 别名识别用规则不用手填清单：`case "X":` 紧跟 `case "Y":` 说明 Y 落到 X 的同一分支（fall-through），是别名。
    const caseLines = [...body.matchAll(/case "([a-zA-Z-]+)":/g)].map((m) => ({ name: m[1], at: m.index }));
    const aliases = new Set();
    for (let k = 1; k < caseLines.length; k += 1) {
      const gap = body.slice(caseLines[k - 1].at, caseLines[k].at);
      if (!/return|await|\{/.test(gap)) aliases.add(caseLines[k].name);
    }
    const cases = [...new Set(caseLines.map((c) => c.name))].filter((x) => x.length > 1 && !aliases.has(x));
    const reg = /name: "purge",[\s\S]{0,400}?hint: "([^"]+)"/.exec(idxSrc);
    if (!reg) problems.push("读不到 /purge 的 hint 字符串（注册写法变了？）");
    else {
      const missing = cases.filter((c) => !reg[1].includes(c));
      if (missing.length) problems.push(`/purge 有子命令 ${missing.join("/")} 没写进 hint（"${reg[1]}"）：命令存在但用户不知道${aliases.size ? `（别名 ${[...aliases].join("/")} 按 fall-through 规则豁免）` : ""}`);
      else notes.push(`命令面对账 ${cases.length} 个主名全在 hint 里（别名 ${aliases.size} 个按 fall-through 识别）`);
    }
  }
}

// 21) 能力账对账：README 里写的 op 数 / 实体数 / 情景步数，必须等于运行时真值（每个文件里的每一处出现都查）。
//     本轮实测：第 47 轮把 engagements 降级成别名之后，README 矩阵里那两处「18 op」就一直没同步 —— 数字不进门就是会烂。
{
  const truth = {
    ops: new Set(JSON.parse(fs.readFileSync(path.join(root, "lib", "model-tools.js"), "utf8").length ? "[]" : "[]")),
  };
  const mtSrc2 = fs.readFileSync(path.join(root, "lib", "model-tools.js"), "utf8");
  const knownBlock = /const KNOWN = \[([\s\S]*?)\];/.exec(mtSrc2);
  const realOps = knownBlock ? (knownBlock[1].match(/"/g) || []).length / 2 : -1;
  const readEnt = (/(?:export const DRILL_ENTITIES = \{)([\s\S]*?)(?:\n\};)/.exec(mtSrc2) || [null, ""])[1];
  const writeEnt = (/(?:export const DRILL_WRITE_ENTITIES = \{)([\s\S]*?)(?:\n\};)/.exec(mtSrc2) || [null, ""])[1];
  const countKeys = (block) => [...new Set([...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]))].length;
  const realRead = countKeys(readEnt);
  const realWrite = countKeys(writeEnt);
  const scenSrc = fs.readFileSync(path.join(root, "scripts", "scenario-drill.mjs"), "utf8");
  /* 步数 = 所有「带断言的情景步」，不是只数 `await run(`。
     1.1.91 加了技能检索的 4 步，它们走 runQ(（purge_skills 与 purge_drill 是两个工具，
     没法共用同一个 runner），闸门只认 run( → 报「README 写 50 步、实际 46」。
     错的不是文档，是闸门把「步」定义成了一种实现细节。改为同时计 run( 与 runQ(。 */
  const realSteps = (scenSrc.match(/await run\(/g) || []).length + (scenSrc.match(/await runQ\(/g) || []).length;
  for (const rel of ["README.md", "README.en.md"]) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const body = fs.readFileSync(fp, "utf8");
    const opClaims = [...body.matchAll(/(\d+) ops?\b/g)].map((m) => Number(m[1]));
    if (!opClaims.length) problems.push(`${rel} 找不到「N op」的能力账口径（句子被改或删了）`);
    for (const c of opClaims) if (c !== realOps) problems.push(`${rel} 有「${c} op」的说法，运行时 KNOWN 是 ${realOps} 个：加/减 op 或做别名都要同步文档`);
    // 中英词序不同，分开配模式（用一条通吃会把 en 的 "22 entities (10 read + 12 write)" 漏掉）。
    const entClaims = [...body.matchAll(/(\d+)\s*(?:个)?实体[（(]读 (\d+) \+ 写 (\d+)[)）]/g)];
    const entClaimsEn = [...body.matchAll(/(\d+) entities \((\d+) read \+ (\d+) write\)/g)];
    if (!entClaims.length && !entClaimsEn.length) problems.push(`${rel} 找不到能力账的实体口径（中文「N 个实体（读 X + 写 Y）」或英文「N entities (X read + Y write)」）`);
    for (const m of [...entClaims, ...entClaimsEn]) {
      if (Number(m[2]) !== realRead || Number(m[3]) !== realWrite || Number(m[1]) !== realRead + realWrite) {
        problems.push(`${rel} 实体账写「${m[1]}（读 ${m[2]} + 写 ${m[3]}）」，运行时是 ${realRead + realWrite}（读 ${realRead} + 写 ${realWrite}）`);
      }
    }
    // 「N 步」必须限定在情景语境里，否则正文「回到第 1 步核对」也会被当成步数声明（本轮就误报过一次）。
    const stepClaims = [...[...body.matchAll(/情景\s*(\d+)\s*步/g)].map((m) => Number(m[1])), ...[...body.matchAll(/(\d+)\s*end-to-end scenario steps/g)].map((m) => Number(m[1]))].filter((x) => Number.isFinite(x));
    for (const c of stepClaims) if (c !== realSteps) problems.push(`${rel} 写「${c} 步」，scenario 实际有 ${realSteps} 个 run() 断言`);
    if (!stepClaims.length) problems.push(`${rel} 找不到「情景 N 步 / N end-to-end scenario steps」的能力账口径`);
    if (opClaims.length && (entClaims.length || entClaimsEn.length) && stepClaims.length) notes.push(`能力账对账（${realOps} op｜读 ${realRead} + 写 ${realWrite}｜${realSteps} 步）全对`);
  }
}

// 23) 发版守卫：README 三份里的 Version 行与 dsh:// 安装链接的 version= 必须等于 package.json 的 version。
//     本轮发 1.1.85 之前实测：这条一致性此前没有门管（三处只是碰巧一致）—— 发版漏改正是最容易犯的那种错。
{
  for (const rel of ["README.md", "README.zh-CN.md", "README.en.md"]) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const body = fs.readFileSync(fp, "utf8");
    const head = /Version (\d+\.\d+\.\d+)/.exec(body);
    const link = /version=(\d+\.\d+\.\d+)/.exec(body);
    if (!head || !link) { problems.push(`${rel} 找不到 Version 行或 dsh:// 的 version=（发版口径缺了）`); continue; }
    if (head[1] !== pkg.version || link[1] !== pkg.version) problems.push(`${rel} 写 Version ${head[1]}、链接 version=${link[1]}，而 package.json 是 ${pkg.version}：发版要一起改`);
  }
  notes.push(`发版口径一致（${pkg.version}）`);
}

// 22) 「设计内 skipped」清单不许烂掉：每条 id 必须真实存在于补丁表、名字对得上；
//     装了宿主的机器上还要求它当前确实是 skipped —— 一旦上游把这条补丁变成可打，清单就得重核（否则建议行会少喊一句）。
{
  const core22 = await import("../lib/core.js");
  const DESIGN_SKIPPED_VERIFIED = core22.DESIGN_SKIPPED_VERIFIED;
  const byId = new Map(ALL_PATCHES.map((x) => [x.id, x]));
  for (const pt of (DESIGN_SKIPPED_VERIFIED && DESIGN_SKIPPED_VERIFIED.points) || []) {
    const row = byId.get(pt.id);
    if (!row) { problems.push(`设计内 skipped 清单里的 #${pt.id} 在补丁表里不存在：清单要删条目`); continue; }
    if (row.name !== pt.name) problems.push(`设计内 skipped 清单 #${pt.id} 名字对不上（清单写 ${pt.name}，补丁表是 ${row.name}）`);
  }
  if (DESIGN_SKIPPED_VERIFIED && hostPresent) {
    const ps22 = ((await core22.gatherState()) || {}).patch_status || {};
    for (const pt of DESIGN_SKIPPED_VERIFIED.points) {
      if (ps22[pt.id] !== "skipped" && ps22[pt.id] !== undefined) problems.push(`#${pt.id} 现在状态是 ${ps22[pt.id]}，不再是 skipped：设计内清单要重核（建议行会少喊一句）`);
    }
    notes.push(`设计内 skipped 清单 ${DESIGN_SKIPPED_VERIFIED.points.length} 条可核对（宿主 ${DESIGN_SKIPPED_VERIFIED.checkedAgainst}）`);
  } else if (DESIGN_SKIPPED_VERIFIED) {
    notes.push(`设计内 skipped 清单 ${DESIGN_SKIPPED_VERIFIED.points.length} 条（未装宿主，状态核对跳过）`);
  }
}

// 19) 入口清单对账：package.json 里每个 npm script 都必须在两份 README 中出现。
//     本轮实测：加了 scenario / probe:gates 等命令后，README 只提到 14 个里的 7 个 —— 没人知道的门等于半个门。
{
  const scriptNames = Object.keys(pkg.scripts || {});
  for (const rel of ["README.md", "README.en.md"]) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) continue;
    const body = fs.readFileSync(fp, "utf8");
    const miss = scriptNames.filter((n) => !body.includes(n));
    if (miss.length) problems.push(`${rel} 漏写 ${miss.length} 个 npm 入口（${miss.slice(0, 4).join(", ")}${miss.length > 4 ? " …" : ""}）：新增命令要进文档，否则等于没有这道门`);
  }
  notes.push(`入口清单 ${scriptNames.length} 个（README 全覆盖）`);
}

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
//     2026-11-09 按实测 29,777 放宽到 33,000；2026-11-13 用户定 50,000（当时实际 32,030，占 64%）。
//     抬顶不等于鼓励堆叠：这条仍是「只防失控增长」的观察线，加条款前先想能不能折进现有段落、
//     或下沉成技能（技能按需加载，边际成本近零；注入正文是每轮固定成本）。
const INJECT_BUDGET = 50000;
let injectLen = 0;
try { injectLen = String(defaultOverrideText() || "").length; } catch (e) { problems.push(`读不到默认注入正文：${String(e.message).slice(0, 60)}`); }
if (!injectLen) problems.push("默认注入正文是空的（打包或 asset-table 出问题）");
else if (injectLen > INJECT_BUDGET) problems.push(`默认注入正文 ${injectLen} 字，超预算 ${INJECT_BUDGET}：加条款前先想能不能折进现有段落`);
if (injectLen) notes.push(`注入体积 ${injectLen} 字（预算 ${INJECT_BUDGET}，占 ${Math.round((100 * injectLen) / INJECT_BUDGET)}%）`);

// 12b) 加密槽必须等于源文件：出厂默认是「源 → sealSlot → lib/asset-table.js」两步生成的，
//      而宿主读的是**槽**不是源。改了 lib/default-prompt-inject.md 却没跑 embed-prompt，
//      默认就会「悄悄停在旧版」——第 101 轮实测正是如此：源 30,725 字 vs 槽 29,777 字，
//      我在源里加的 4 行技能聚合压根没进出厂默认。这属于「生成物即资产」，得由闸门对齐而不是靠人记得。
try {
  const sealedText = String(defaultOverrideText() || "");
  const srcText = fs.readFileSync(path.join(root, "lib", "default-prompt-inject.md"), "utf8");
  const normLine = (s) => s.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).join("\n");
  if (sealedText && normLine(sealedText) !== normLine(srcText)) {
    problems.push(`加密槽与源不一致（槽 ${sealedText.length} 字 vs 源 ${srcText.length} 字）：改了默认注入正文要跑 npm run embed-prompt，否则出厂默认停在旧版`);
  } else if (sealedText) {
    notes.push("加密槽与源一致");
  }
} catch (e) {
  problems.push(`加密槽一致性检查失败：${String((e && e.message) || e).slice(0, 60)}`);
}

// 10) 闸门数自证：从 verify.mjs 读出实际关卡数，要求 README 中英两侧的说法与之一致。
//     （「五关/六关/七关」这种话是最容易漂的口径：加一道门却忘了改文档，本仓库已经发生过两轮。）
const ver = fs.readFileSync(path.join(root, "scripts", "verify.mjs"), "utf8");
const gateNums = [...ver.matchAll(/^\/\/ 关 (\d+)：/gm)].map((m) => Number(m[1]));
const gateCount = gateNums.length ? Math.max(...gateNums) : 0;
if (!gateCount) problems.push("verify.mjs 里读不到关卡编号（注释格式变了？门禁要跟着改）");
/* 中文数字：**按算法生成到 99**，不再手工列到 30。
   踩过的坑：表只写到 30，加到第 31 关时闸门自证假红（「README 没写「过undefined关」」），
   而文档其实已经写对了 —— 校验工具自己成了故障点。凡是"枚举到某个数"的表都会这样崩。 */
const CN = (() => {
  const d = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const out = { 1: "一", 2: "两" };
  for (let n = 3; n <= 99; n += 1) {
    if (n < 10) { out[n] = d[n]; continue; }
    const t = Math.floor(n / 10), u = n % 10;
    if (t === 1) out[n] = u === 0 ? "十" : "十" + d[u];
    else out[n] = d[t] + "十" + (u === 0 ? "" : d[u]);
  }
  return out;
})();
/* 英文同理：生成到 99，避免"加到 31 就假红"。 */
const EN = (() => {
  const one = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const ten = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const out = {};
  for (let n = 1; n <= 99; n += 1) {
    if (n < 20) out[n] = one[n];
    else {
      const t = Math.floor(n / 10), u = n % 10;
      out[n] = ten[t] + (u === 0 ? "" : "-" + one[u]);
    }
  }
  return out;
})();
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

// 13) 判据自测：hostPromptKeepsInject 决定「reapply 算不算成功」和「看门脚本允不允许拉起宿主」，
//     它 2026-11-12 在 0.2.2-rc.1 上恒 false（判据要一条没有任何补丁写的标记），reapply 因此永远报
//     「清洗没有完成」、换装后看门脚本会拒绝启动。这里钉住三种形态的结论，防止再退回「拿原厂特征当脏」。
try {
  const hostCleanUrl = "file:///" + path.join(root, "lib", "host-clean.js").replace(/\\/g, "/");
  const { hostPromptKeepsInject, hostCleanFnSource } = await import(hostCleanUrl);
  const stockBody = [
    'import x from "./foo";',
    "// system-prompt/assemble",
    'if (config.includeHarnessIdentity ?? true) text: "You are an AI agent powered by DeepSeek Harness."',
    "sections: completeSection === void 0 ? transformed.sections : [completeSection],",
  ].join("\n");
  const washedBody = stockBody
    .replace('text: "You are an AI agent powered by DeepSeek Harness."', 'text: "" // [dsh-purge] identity stripped');
  const cases = [
    ["实机已洗（有 identity stripped 标记、无 keeps 标记、含原厂 drops 行）", washedBody, true],
    ["原厂未洗", stockBody, false],
    ["空文件", "", false],
  ];
  for (const [label, body, want] of cases) {
    const got = hostPromptKeepsInject(body);
    if (got !== want) problems.push(`清洗判据自测失败：${label} 期望 ${want} 实得 ${got}`);
  }
  // 看门脚本内嵌的那份必须是同一份判据（单一来源）。桌面面没有 JScript 运行时就没法在这里跑，
  // 只能钉住「生成源码里出现三条关键判据」，防止有人把它手改成另一套。
  const src = hostCleanFnSource();
  for (const needle of ["[dsh-purge] identity stripped", "system-prompt/assemble", "You are an AI agent powered by DeepSeek Harness."]) {
    if (!src.includes(needle)) problems.push(`看门脚本判据缺关键判据片段：${needle}`);
  }
  if (/transformed\.sections : \[completeSection\]/.test(src)) problems.push("看门脚本判据又把原厂 drops 行当脏判据了（0.2.2-rc.1 恒 false）");
  notes.push("清洗判据自测（3 形态 + 看门脚本同源）✓");
} catch (e) {
  problems.push(`清洗判据自测跑不起来：${String((e && e.message) || e).slice(0, 80)}`);
}

// ---- 第 14 项：profile patch 自愈判据（1.1.87 的病灶：模型显示名被当包名 → 自愈恒不执行）----
try {
  const { pathToFileURL } = await import("node:url");
  const guard = await import(pathToFileURL(path.join(root, "lib", "profile-guard.js")).href);
  const tmpRoot = path.join(root, "runs", ".tmp-guard-selftest");
  const RESET = "# 由宿主重置\n[]\n";
  const withDisplayNames = [
    "plugins:",
    '  - name: "@deepseek-ai/dsh-llm-pi-ai"',
    "models:",
    "  - provider: pi-ai",
    "    name: DeepSeek V4.1 Flash",
    "presets:",
    "  - name: Super Code 模式",
    "",
  ].join("\n");
  const withGhostPlugin = `${withDisplayNames}  - name: dsh-ghost-plugin/tool\n`;
  const fixture = (backup) => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpRoot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "cordis.patch.yml"), RESET, "utf8");
    if (backup) fs.writeFileSync(path.join(tmpRoot, "cordis.patch.yml.bak-x"), backup, "utf8");
    return tmpRoot;
  };
  // ① 显示名不是包名
  if (guard.missingPackages(withDisplayNames, fixture()).length) {
    problems.push("profile 自愈判据：把模型/预设显示名当成了缺失包（自愈会因此永远不执行）");
  }
  // ② 干净备份要真恢复
  const okDir = fixture(withDisplayNames);
  if (guard.guardProfilePatch(okDir, () => {}).action !== "restored") {
    problems.push("profile 自愈判据：干净备份没有被恢复");
  }
  // ③ 脏备份：删掉缺失条目后恢复，且不再残留
  const dirtyDir = fixture(withGhostPlugin);
  const dirtyRes = guard.guardProfilePatch(dirtyDir, () => {});
  if (dirtyRes.action !== "sanitized") problems.push(`profile 自愈判据：脏备份应删块后恢复，实得 ${dirtyRes.action}`);
  else if (guard.missingPackages(fs.readFileSync(path.join(dirtyDir, "cordis.patch.yml"), "utf8"), dirtyDir).length) {
    problems.push("profile 自愈判据：删块后仍残留缺失包引用");
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  notes.push("profile 自愈判据自测（显示名不算包 / 干净恢复 / 脏备份删块恢复）✓");
} catch (e) {
  problems.push(`profile 自愈判据自测跑不起来：${String((e && e.message) || e).slice(0, 80)}`);
}

// 15) asar 切换形态：混合态是 2026-11-12 连崩三次的根因，工具缝隙里最容易再犯。
// 闸门不读源码猜，直接在夹具上跑一遍（真磁盘三态 + 退出码）——README 里那行 npm run check:asar 就是它。
try {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "check-asar-switch.mjs")], { encoding: "utf8", timeout: 120000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status !== 0) {
    const last = out.trim().split("\n").filter((l) => l.includes("✗")).slice(0, 3).join(" / ") || out.trim().slice(-120);
    problems.push(`asar 切换形态闸门报红：${last}`);
  } else {
    notes.push("asar 切换形态闸门（混合态解混合 / skip 不动文件 / 不完整目录拒绝 / 健康快照认混合态）✓");
  }
} catch (e) {
  problems.push(`asar 切换形态闸门跑不起来：${String((e && e.message) || e).slice(0, 80)}`);
}

// 16) 雷达「指纹 → 技能」指向：1.1.90 给国产 OA 单开一条与 web-app 共用 code 的规则时踩过——
// 取值处按 code 反查规则，共用 code 就会拿到排在前面的那条，普通 nginx 也被指到 cn-oa-exploit。
// 技能名必须跟着**实际命中的规则**走。这里用假状态直接跑真函数，正向与反向都断言。
try {
  const { pathToFileURL } = await import("node:url");
  const radar = await import(pathToFileURL(path.join(root, "lib", "redteam", "score-radar.js")).href);
  const rulesMod = await import(pathToFileURL(path.join(root, "lib", "redteam", "score-rules.js")).href);
  const pts = (rulesMod.DEFAULT_SCORE_POINTS || []).map((p) => ({ ...p, enabled: 1 }));
  const one = (port) => radar.scoreRadar({
    assets: [{ id: 1, ip: port.ip, hostname: "" }],
    ports: [{ ...port }],
    vulns: [], credentials: [], accesses: [], webshells: [], tunnels: [], webs: [], hits: [],
  }, pts, { top: 8 });
  // gap 里取「指纹点名」的那条（todo 以「已经看到」开头），技能名从反引号里取
  const skillOf = (r) => {
    const g = (r.gap || []).find((x) => /^已经看到/.test(String(x.todo)));
    return g ? ((String(g.todo).match(/技能 `([^`]+)`/) || [])[1] || "") : "";
  };
  const CASES = [
    { label: "泛微 OA", port: { ip: "10.0.0.2", port: 80, service: "http", title: "泛微协同管理平台 e-cology" }, want: "cn-oa-exploit" },
    { label: "致远 A8", port: { ip: "10.0.0.4", port: 8080, service: "http", title: "致远A8 协同管理" }, want: "cn-oa-exploit" },
    { label: "Ollama", port: { ip: "10.0.0.1", port: 11434, service: "http", banner: "Ollama is running" }, want: "ai-infra-attack" },
    { label: "Langflow", port: { ip: "10.0.0.10", port: 7860, service: "http", title: "Langflow" }, want: "ai-infra-attack" },
    // 反向：共用 code 的普通 Web 站**不许**被指到 OA 技能
    { label: "普通 nginx", port: { ip: "10.0.0.3", port: 80, service: "http", title: "Welcome to nginx!" }, want: "" },
  ];
  const bad = [];
  for (const c of CASES) {
    const got = skillOf(one(c.port));
    if (got !== c.want) bad.push(`${c.label} 期望「${c.want || "无"}」实得「${got || "无"}」`);
  }
  if (bad.length) problems.push(`雷达技能指向自测失败：${bad.join("；")}`);
  else notes.push("雷达技能指向自测（OA→cn-oa-exploit / AI→ai-infra-attack / 普通 Web 不串技能）✓");
} catch (e) {
  problems.push(`雷达技能指向自测跑不起来：${String((e && e.message) || e).slice(0, 80)}`);
}

if (asJson) process.stdout.write(`${JSON.stringify({ real: REAL, claims, problems, notes }, null, 2)}\n`);
else {
  process.stdout.write(`包自证：实况 补丁 ${REAL.patches} 条 / 技能 ${REAL.skills} 个｜绿项 ${notes.length} 条（条数随实况增减，不是固定项数），问题 ${problems.length}\n`);
  for (const n of notes) process.stdout.write(`  · ${n}\n`);
  for (const p of problems) process.stdout.write(`  ✗ ${p}\n`);
}
process.exit(problems.length ? 1 : 0);
