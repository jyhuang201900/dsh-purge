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
const OLD = flag("old", process.env.DSH_PURGE_PREV_VERSION || "");
if (!NEW) { console.error("缺 --new 且 package.json 没有 dshTarget"); process.exit(2); }
if (!OLD) { console.error("缺 --old（上一档版本号），例：--old 0.2.0-rc.2"); process.exit(2); }

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
    out.push({ id: heads[i].id, name: heads[i].name, files, patterns });
  }
  return out;
}

// ---------- 4) 比对 ----------
function where(idx, pat) {
  const hits = [];
  for (const [pkgName, files] of idx) for (const f of files) if (f.t.includes(pat)) hits.push(`${pkgName}/${f.rel}`);
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

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] || 0) + 1;
console.log("\n汇总:", JSON.stringify(tally));
const reportPath = path.join(ROOT, ".cache", `anchor-report-${NEW}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ old: OLD, new: NEW, results }, null, 1));
console.log("明细:", reportPath.replace(/\\/g, "/"));

process.exit(tally.broken || tally.partial ? 1 : 0);
