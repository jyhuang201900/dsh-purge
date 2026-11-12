#!/usr/bin/env node
/**
 * 补丁锚点存活核对：把 lib/core.js 里每条补丁的 pattern 拿到
 * **已发布的宿主包构建产物**里逐字比对，输出破损清单。
 *
 * 为什么必须比构建产物、不比上游源码：
 *   插件打的是 node_modules/@deepseek-ai/dsh-…/lib/index.js（打包后的 JS），
 *   源码里的写法与产物不同构 —— 实测拿源码比会误报 50 条"破损"。
 *   桌面 asar 与 npm 产物只差 CSS region 路径注释与哈希类名，代码文本一致，
 *   所以拿 npm 包核对对桌面端同样成立。
 *
 * 用法：
 *   node scripts/check-anchors.mjs                          # 用 package.json 的 dshTarget 当新版，前一档当旧版
 *   node scripts/check-anchors.mjs --new 0.2.1-rc.2 --old 0.2.0-rc.2
 *   node scripts/check-anchors.mjs --offline                # 只用已缓存的包，不下载
 *   node scripts/check-anchors.mjs --pkg-list <file>        # 每行一个包名（不带 scope），默认从本机 asar 探测
 *
 * 退出码：0 = 无破损；1 = 有破损/部分破损；2 = 跑不起来（缺网络、缺包清单等）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.DSH_PURGE_PKG_CACHE || path.join(ROOT, ".cache", "dsh-pkgs");
const REG = "https://registry.npmjs.org";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : (argv.includes(`--${name}`) ? true : dflt);
};

// ---------- 0) 版本 ----------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const NEW = flag("new", pkg.dshTarget);
const OLD_FLAG = flag("old", process.env.DSH_PURGE_PREV_VERSION || "");
if (!NEW) { console.error("缺 --new 且 package.json 没有 dshTarget"); process.exit(2); }

// 版本三元组比较（含预发布次序：alpha < rc < 正式版），用来从 npm 已发布版本里挑「上一档」。
function verKey(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || ""));
  if (!m) return null;
  const pre = m[4];
  // 无预发布 = 正式版，排在同版号所有预发布之后（用 999 顶格表示）
  const preRank = pre === undefined ? 999 : (/^alpha/i.test(pre) ? 1 : /^beta/i.test(pre) ? 2 : /^rc/i.test(pre) ? 3 : 0);
  const preNum = pre === undefined ? 0 : Number((/(\d+)/.exec(pre) || [0, "0"])[1]) || 0;
  return [Number(m[1]), Number(m[2]), Number(m[3]), preRank, preNum];
}
const cmpVer = (a, b) => { for (let i = 0; i < 5; i += 1) { if (a[i] !== b[i]) return a[i] - b[i]; } return 0; };

async function derivePrevVersion(target) {
  const t = verKey(target);
  if (!t) return null;
  for (const ref of ["dsh-base", "dsh-tools", "dsh-web-app", "dsh-agent"]) {
    const full = "@deepseek-ai/" + ref;
    try {
      const r = await fetch(`${REG}/${full.replace("/", "%2F")}`, { signal: AbortSignal.timeout(25000) });
      if (!r.ok) continue;
      const info = await r.json();
      const cands = Object.keys(info.versions || {})
        .map((v) => ({ v, k: verKey(v) }))
        .filter((x) => x.k && cmpVer(x.k, t) < 0 && (x.k[0] !== t[0] || x.k[1] !== t[1] || x.k[2] !== t[2] || x.k[3] < t[3]))
        .sort((a, b) => cmpVer(b.k, a.k));
      if (cands.length) return { version: cands[0].v, from: full, pool: Object.keys(info.versions || {}).length };
    } catch { /* 换下一个参考包 */ }
  }
  return null;
}
let OLD = OLD_FLAG;
if (!OLD && flag("auto-old", true) !== false) {
  const derived = await derivePrevVersion(NEW);
  if (derived) { OLD = derived.version; console.log(`--old 自动推断：${OLD}（${derived.from} 共 ${derived.pool} 个已发布版本里小于 ${NEW} 的最大一档）`); }
}
if (!OLD) { console.error("缺 --old（上一档版本号），且自动推断失败（离线或参考包没取到）；例：--old 0.2.0-rc.2"); process.exit(2); }

// ---------- 1) 包清单 ----------
function discoverPkgs() {
  const given = flag("pkg-list", "");
  if (given && fs.existsSync(given)) {
    return fs.readFileSync(given, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  // 从本机桌面安装里读（asar header）
  const guesses = [
    process.env.DSH_PURGE_ASAR,
    "E:/Program Files/harness/resources/app.asar",
    path.join(process.env.ProgramFiles || "", "harness/resources/app.asar"),
  ].filter(Boolean);
  for (const a of guesses) {
    if (!fs.existsSync(a)) continue;
    try {
      const buf = fs.readFileSync(a);
      const len = buf.readUInt32LE(12);
      const head = JSON.parse(buf.slice(16, 16 + len).toString("utf8"));
      const ai = head.files?.dsh?.files?.node_modules?.files?.["@deepseek-ai"]?.files;
      if (!ai) continue;
      const names = Object.keys(ai).filter((n) => n.startsWith("dsh-"));
      if (names.length) { console.log(`包清单来自 asar：${a}（${names.length} 个）`); return names; }
    } catch { /* 继续试下一个 */ }
  }
  console.error("拿不到包清单：给 --pkg-list <file>，或设 DSH_PURGE_ASAR 指向 app.asar");
  process.exit(2);
}

// ---------- 2) 下载并解包 ----------
async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function ensure(rawName, ver, offline) {
  const full = rawName.startsWith("@") ? rawName : `@deepseek-ai/${rawName}`;
  const safe = full.replace(/[@/]/g, "_");
  const dir = path.join(CACHE, `${safe}@${ver}`);
  if (fs.existsSync(path.join(dir, ".done"))) return dir;
  if (offline) return null;
  const info = await fetch(`${REG}/${full.replace("/", "%2F")}`, { signal: AbortSignal.timeout(30000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const entry = info?.versions?.[ver];
  if (!entry) return null;
  const tgz = path.join(CACHE, `${safe}@${ver}.tgz`);
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    const buf = Buffer.from(await fetch(entry.dist.tarball, { signal: AbortSignal.timeout(180000) }).then((r) => r.arrayBuffer()));
    fs.writeFileSync(tgz, buf);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("tar", ["xf", tgz, "-C", dir], { stdio: "ignore" });
    fs.rmSync(tgz, { force: true });
    fs.writeFileSync(path.join(dir, ".done"), "");
    return dir;
  } catch { fs.rmSync(tgz, { force: true }); return null; }
}

function indexVersion(ver) {
  const map = new Map();
  if (!fs.existsSync(CACHE)) return map;
  for (const dir of fs.readdirSync(CACHE)) {
    if (!dir.endsWith(`@${ver}`)) continue;
    const pkgName = dir.replace("_deepseek-ai_", "").replace(`@${ver}`, "");
    const root = path.join(CACHE, dir, "package");
    if (!fs.existsSync(root)) continue;
    const list = [];
    (function walk(d) {
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|mjs|cjs|yml|yaml)$/.test(e.name)) {
          let st; try { st = fs.statSync(p); } catch { continue; }
          if (st.size < 8e6) list.push({ rel: path.relative(root, p).replace(/\\/g, "/"), t: fs.readFileSync(p, "utf8") });
        }
      }
    })(root);
    map.set(pkgName, list);
  }
  return map;
}

// ---------- 3) 从 core.js 抽 pattern ----------
function decodeLit(l) { return l.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\"); }
function decodeSgl(l) { return l.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\'/g, "'").replace(/\\\\/g, "\\"); }

function extractPatches() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "core.js"), "utf8");
  const consts = {};
  const cre = /^const ([A-Z_][A-Z_0-9]*) =\s*\r?\n?\s*"((?:[^"\\]|\\.)*)"/gm;
  let cm;
  while ((cm = cre.exec(src))) consts[cm[1]] = decodeLit(cm[2]);

  const headRe = /\n\s*id:\s*(\d+),\s*\r?\n?\s*name:\s*"([A-Za-z0-9_]+)"/g;
  const heads = [];
  let hm;
  while ((hm = headRe.exec(src))) heads.push({ pos: hm.index, id: Number(hm[1]), name: hm[2] });

  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const next = i + 1 < heads.length ? heads[i + 1].pos : heads[i].pos + 300000;
    const body = src.slice(heads[i].pos, Math.min(next, heads[i].pos + 30000));
    const fm = body.match(/file:\s*(\[[^\]]*\]|"[a-z0-9-]+")/);
    const files = fm ? (fm[1].match(/"([a-z0-9-]+)"/g) || []).map((s) => s.slice(1, -1)) : [];
    const patterns = [];
    const pRe = /pattern:\s*(?:\r?\n\s*\/\/[^\n]*)*\r?\n?\s*((?:(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(?:\s*\+)?\s*)+)/g;
    let pm;
    while ((pm = pRe.exec(body))) {
      const parts = [];
      const litRe = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Z_][A-Z_0-9]*)/g;
      let lm, ok = true;
      while ((lm = litRe.exec(pm[1]))) {
        if (lm[1] !== undefined) parts.push(decodeLit(lm[1]));
        else if (lm[2] !== undefined) parts.push(decodeSgl(lm[2]));
        else if (consts[lm[3]] !== undefined) parts.push(consts[lm[3]]);
        else { ok = false; break; }
      }
      if (ok && parts.join("").length > 8) patterns.push(parts.join(""));
    }
    // pRe 只吃字符串字面量：`pattern: /…/flags` 这种正则型锚点会被整支丢掉，
    // 于是补丁的 patterns 变空、被误判成 runtimeBuilt。这里补一轮正则字面量扫描。
    const rRe = /pattern:\s*(\/(?:\\.|[^\/\\\n])+\/[a-z]*)/g;
    let rm;
    while ((rm = rRe.exec(body))) patterns.push(rm[1]);
    out.push({ id: heads[i].id, name: heads[i].name, files, patterns });
  }
  return out;
}

// ---------- 4) 比对 ----------
function where(idx, pat) {
  // 有些锚点存的是正则字面量原文（如 /let renderedPrompt = renderPrompt\(assembly\);\r?\n…/），
  // 对它做子串包含永远不命中，会被误报成「两版都不存在」。两种都认：子串 或 正则。
  const s = String(pat);
  let rx = null;
  // 正则字面量可能是 `/src/` 或 `/src/gi`：按最后一段斜杠剥 flag，不能只判 endsWith("/")。
  const rm = /^\/([\s\S]+)\/([a-z]*)$/.exec(s);
  if (rm) {
    try { rx = new RegExp(rm[1], rm[2]); } catch { rx = null; }
  }
  const hits = [];
  for (const [pkgName, files] of idx) for (const f of files) if (f.t.includes(s) || (rx && rx.test(f.t))) hits.push(`${pkgName}/${f.rel}`);
  return hits;
}

const offline = flag("offline", false);
const names = discoverPkgs();
fs.mkdirSync(CACHE, { recursive: true });
console.log(`核对版本：${OLD} → ${NEW} | 包数 ${names.length}${offline ? " | 离线" : ""}`);

const fetched = { old: 0, new: 0 };
await mapLimit(
  names.flatMap((n) => [[n, OLD], [n, NEW]]),
  24,
  async ([n, v]) => { const d = await ensure(n, v, offline); if (d) fetched[v === OLD ? "old" : "new"]++; },
);
console.log(`产物就绪：${OLD} ${fetched.old} 个 | ${NEW} ${fetched.new} 个`);
if (!fetched.new) { console.error(`新版一个包都没拿到，检查版本号 ${NEW} 是否已发布`); process.exit(2); }

const idxOld = indexVersion(OLD);
const idxNew = indexVersion(NEW);
const patches = extractPatches();
console.log(`补丁条数：${patches.length}\n`);

const results = [];
for (const p of patches) {
  if (!p.patterns.length) { results.push({ ...p, status: "runtimeBuilt" }); continue; }
  const oldHits = p.patterns.map((pat) => where(idxOld, pat));
  const newHits = p.patterns.map((pat) => where(idxNew, pat));
  const dead = [];
  p.patterns.forEach((pat, i) => { if (oldHits[i].length && !newHits[i].length) dead.push({ where: oldHits[i][0], text: pat.replace(/\s+/g, " ").slice(0, 110) }); });
  const newOk = newHits.filter((h) => h.length).length;
  const oldOk = oldHits.filter((h) => h.length).length;
  /* 判定只看目标版本：
     - 旧版命中、新版全丢      = broken（升级后这条补丁再也打不上）
     - 旧版命中、新版部分丢    = partial
     - 新版至少有一条命中      = ok（含"只认新版"的有意不向后兼容）
     - 两版都不命中            = notInEither（多为打后形态 / 幂等链 / 未发布的包，需人工看一眼） */
  let status;
  if (dead.length && !newOk) status = "broken";
  else if (dead.length) status = "partial";
  else if (newOk) status = "ok";
  else if (!oldOk) status = "notInEither";
  else status = "ok";
  results.push({ ...p, status, oldOk, newOk, total: p.patterns.length, dead });
}

const rank = { broken: 0, partial: 1, notInEither: 2, ok: 3, runtimeBuilt: 4 };
results.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.id - b.id));
let last = null;
for (const r of results) {
  if (r.status !== last) { console.log(`\n=== ${r.status.toUpperCase()} ===`); last = r.status; }
  const f = r.files.length ? ` file=${r.files.join("|")}` : "";
  if (r.status === "broken" || r.status === "partial") {
    console.log(`  #${String(r.id).padStart(2)} ${r.name}${f}  [${OLD} ${r.oldOk}/${r.total} → ${NEW} ${r.newOk}/${r.total}]`);
    for (const d of r.dead.slice(0, 3)) console.log(`        DEAD @ ${d.where}\n          ${JSON.stringify(d.text)}`);
  } else console.log(`  #${String(r.id).padStart(2)} ${r.name}${f}`);
}

// notInEither 有两种成因：补丁目标压根不在这个核对面内（桌面壳 main.js、YAML 预设、非 npm 包路径），
// 或者锚点在哪一版都不存在（可疑，要人判）。分不清这两类，17 条噪音会淹没 5 条信号。
// 分桶在下面用严格划分一次算清（每条只进一个桶），这里不再单独维护 structuralRaw，避免两处口径打架。
// core 的 file 键→路径映射直接 import 来用（不 import 就会自己猜一套，猜错就误判面外）。
const coreMod = await import("../lib/core.js").catch(() => null);
const TF = (coreMod && coreMod.targetFiles(process.env.DSH_BASE || "E:/Program Files/harness/resources/app/dsh/node_modules/@deepseek-ai")) || {};
const pathOf = (k) => {
  const v = TF[k];
  // 反斜杠路径统一成正斜杠，免得正则里再套转义。
  return String(Array.isArray(v) ? v[0] : (v || "")).split(String.fromCharCode(92)).join("/");
};
const outOfScope = (keys) => {
  const k0 = String((Array.isArray(keys) ? keys : [keys])[0] || "").trim();
  if (!k0 || TF[k0] === undefined) return null;
  const sp = pathOf(k0);
  if (/main\.js$/.test(sp) && sp.includes("/lib/")) return "桌面壳 main.js";
  if (/\.ya?ml$/i.test(sp)) return "YAML 预设";
  if (!sp.includes("@deepseek-ai/") && !sp.includes("@earendil-works/")) return "非 npm 包路径";
  return null;
};
// 剩下几支靠证据自动归类，别留给人肉：
//   · 打后形态：锚点文本本身就是我们注入的那段话（特征串 dsh-purge/dshPurge/DSH_PURGE，
//     以及 scope 段的自有句式 "ACTIVE and MANDATORY"）——pristine 里当然没有，不是破损。
//     写新的注入句时如果没带这些特征，会落到「真待判」，这是有意的保守失败：宁可多报一条也不漏判。
//   · 空白不同构：两侧折叠空白后能命中 —— 文本在，只是官方重排了缩进（#67 实测如此）。
const OURS = /dsh-purge|dshPurge|DSH_PURGE|ACTIVE and MANDATORY/;
const collapse = (s) => String(s).replace(/\s+/g, " ");
let COLLAPSED = null;
const collapsedIdx = () => {
  if (COLLAPSED) return COLLAPSED;
  // indexVersion 返回 Map（for...of 能过、.map 不能），所以先展开成数组再折叠空白。
  const build = (idx) => [...idx].map(([n, list]) => [n, list.map((f) => ({ t: collapse(f.t) }))]);
  COLLAPSED = { old: build(idxOld), new: build(idxNew) };
  return COLLAPSED;
};
const presentLoose = (pat) => {
  const needle = collapse(String(pat).replace(/^\/(.*)\/[a-z]*$/, "$1"));
  if (needle.length < 12) return false;
  const ci = collapsedIdx();
  return ci.old.some(([, fs]) => fs.some((f) => f.t.includes(needle)))
    || ci.new.some(([, fs]) => fs.some((f) => f.t.includes(needle)));
};
const postPatch = (r) => (r.patterns || []).some((p) => OURS.test(String(p)));
const whitespaceOnly = (r) => !postPatch(r) && (r.patterns || []).some((p) => presentLoose(p));
// **第五支：已打补丁（文件里真有我们的标记）** —— 第 150 轮补的判据。
// 旧逻辑只问「锚点文本在不在」，于是所有「纯替换型」补丁在打完之后必然 notInEither：
// 原文被我们换掉了，old/new 两版当然都不命中，于是全堆进「真待判」，看上去像升级破损。
// 实测 6 条（#45 #46 #47 #49 #82 #83 #84）全属此类：宿主文件里 dshPurgeHandoffDesktopUpdate(this);
// / dshPurgeWshLiteral / [dsh-purge-82] / [dsh-purge] OAuth… / signal kill 标记一个不少。
// 判据：目标文件存在且含 [dsh-purge 标记；若标记里带该补丁编号（[dsh-purge-<id>）则更强。
const fileCache = new Map();
const readTarget = (p) => {
  if (fileCache.has(p)) return fileCache.get(p);
  let t = "";
  try { t = fs.readFileSync(p, "utf8"); } catch { t = ""; }
  fileCache.set(p, t);
  return t;
};
const patchedFile = (r) => {
  const keys = Array.isArray(r.files) ? r.files : [r.files];
  for (const k of keys) {
    const v = TF[k];
    for (const p of (Array.isArray(v) ? v : [v]).filter(Boolean)) {
      const t = readTarget(p);
      if (!t) continue;
      if (t.includes(`[dsh-purge-${r.id}]`)) return `已打补丁（[dsh-purge-${r.id}] 在文件里）`;
      if (t.includes("[dsh-purge")) return "已打补丁（文件含 [dsh-purge 标记）";
    }
  }
  return "";
};
// 分桶必须是**严格划分**：每条 notInEither 只进一个桶，所有桶加起来必须等于 notInEither 总数。
// 上一版条件互相排斥得不干净（structural 排除了 patchedFile，asWhitespace 又排除了 outOfScope），
// 三条（#21 #46 #80）掉进桶与桶的缝里：分类行合计 15，汇总却写 18。**数字对不上比分类错更糟。**
const notInEitherAll = results.filter((r) => r.status === "notInEither");
const asPostPatch = [];
const asPatched = [];
const asWhitespace = [];
const structural = [];
const suspect = [];
for (const r of notInEitherAll) {
  if (postPatch(r)) { asPostPatch.push(r); continue; }
  // 「已打补丁」先于「结构性面外」：桌面壳 main.js 既在面外、也真的被我们改过（#45 #46 #82-84
  // 的标记都在）。先判面外会把「已经落地」说成「压根不在核对面上」，等于把证据丢掉。
  if (patchedFile(r)) { asPatched.push(r); continue; }
  if (whitespaceOnly(r)) { asWhitespace.push(r); continue; }
  if (outOfScope(r.files)) { structural.push(r); continue; }
  suspect.push(r);
}
if (structural.length || asPostPatch.length || asWhitespace.length || suspect.length) {
  const seg = (label, list) => (list.length ? `${label} ${list.length}${list.length && list.length < 8 ? `（${list.map((r) => `#${r.id}`).join(" ")}）` : ""}` : null);
  const parts = [seg("结构性面外", structural), seg("打后形态", asPostPatch), seg("已打补丁", asPatched), seg("空白不同构", asWhitespace)].filter(Boolean);
  console.log(`\n分类：notInEither ${notInEitherAll.length} 条 = ${parts.join(" + ") || "0"} + 真待判 ${suspect.length}${suspect.length ? `：${suspect.map((r) => `#${r.id}`).join(" ")}` : ""}`);
  if (!suspect.length) console.log("  → 真待判为 0：这些 notInEither 全部有可复核的成因，不是升级破损。");
}

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1;
console.log("\n汇总:", JSON.stringify(tally));
const reportPath = path.join(ROOT, ".cache", `anchor-report-${NEW}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ old: OLD, new: NEW, results }, null, 1));
console.log("明细:", reportPath.replace(/\\/g, "/"));

process.exit(tally.broken || tally.partial ? 1 : 0);
