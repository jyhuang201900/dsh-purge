#!/usr/bin/env node
/**
 * 拉取 Atomic Red Team 的原子测试索引（离线快照）。
 *
 * 为什么要做这一步：插件现在有 121 个 ATT&CK 技术编号，但**只有技能教"怎么做"**，
 * 没有"可以直接跑起来验证"的东西。AT 的 1700+ 原子测试正好补这个缺口 ——
 * 它把"这个技术长什么样"从文档变成可执行命令 + 预期输出。
 *
 * 通道：GitHub raw 在本机被 TLS 拦（curl exit 35/ECONNRESET），
 *       **jsdelivr CDN 可用**（https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>）。
 *       不要用 raw.githubusercontent.com，也不要走 data.jsdelivr.com 的 tree API（超时）。
 *
 * 覆盖不是全量的：AT 只覆盖它有的技术（T1190 这类常见 Web 技术没有）。所以：
 *   · 404 是**正常结果**，不是错误 —— 记录下来，索引里标明"本技术无原子测试"。
 *
 * 产物：lib/generated/atomics-index.json
 *   只存**元数据**（技术→测试名/平台/是否需要提权/依赖），不存完整命令 ——
 *   命令按需再拉单文件（体积大、且多数场景不需要全文）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TECHNIQUES, displayTechniqueId, normalizeTechniqueId } from "../lib/redteam/attack-map.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "lib", "generated", "atomics-index.json");
const CACHE = path.join(ROOT, ".cache", "atomics");
const CDN = "https://cdn.jsdelivr.net/gh/redcanaryco/atomic-red-team@master/atomics";

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

/* 并发抓：串行 121 个太慢（每个 1-20s），并发 6 大约 30 秒。 */
/* 并发 6 会稳定触发 CDN 403；3 是实测能跑完又不限流的档位。 */
const CONCURRENCY = 3;

function cdnPath(techId) {
  /* 子技术目录名带点：T1059.001/T1059.001.yaml；父技术：T1003/T1003.yaml */
  return `${techId}/${techId}.yaml`;
}

async function fetchOne(techId) {
  const file = path.join(CACHE, `${techId}.yaml`);
  if (fs.existsSync(file) && fs.statSync(file).size > 200) return { techId, status: "cache", raw: fs.readFileSync(file, "utf8") };
  /* 已确认过 404 的落一个标记，避免每次重建都重新猜一次限流/不存在。
     为什么要有：CDN 403 与 404 只差一个状态码，但含义完全相反 ——
     403 是"没取到（可能是限流）"，404 是"AT 确实没有"。重复请求既慢又容易被限流带偏。 */
  if (fs.existsSync(path.join(CACHE, `${techId}.404`))) return { techId, status: "none" };
  /* 403 = CDN 限流（不是"文件不存在"）。
     必须重试并退避：把限流当成"AT 无此技术"会在索引里留下假的"无覆盖"记录，
     后续按索引判断"这个技术能不能跑验证"就会错 —— 与静默降级同一类问题。 */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt + Math.random() * 400));
    try {
      const res = await fetch(`${CDN}/${cdnPath(techId)}`, { signal: AbortSignal.timeout(25000) });
      if (res.status === 404) return { techId, status: "none" };
      if (res.status === 403 || res.status === 429 || res.status >= 500) continue;  // 限流/网关：退避重试
      if (!res.ok) return { techId, status: `http${res.status}` };
      const raw = await res.text();
      if (raw.length < 100) return { techId, status: "empty" };
      fs.writeFileSync(file, raw, "utf8");
      return { techId, status: "ok", raw };
    } catch (e) {
      if (attempt === 3) return { techId, status: `err:${String(e && e.message || e).slice(0, 40)}` };
    }
  }
  return { techId, status: "http403-after-retry" };
}

/**
 * 极简 YAML 提取（不引第三方依赖）。
 * AT 的 schemas 很规整，用行扫描足够：只取我们需要的元数据，不解析全量 YAML。
 * 要的字段：attack_technique / display_name / - name: / supported_platforms / elevation_required / dependencies
 */
function parseMeta(techId, raw) {
  const lines = raw.split(/\r?\n/);
  const tests = [];
  let cur = null;
  let inPlatforms = false;
  let inDeps = false;
  for (const line of lines) {
    const top = /^attack_technique:\s*(\S+)/.exec(line);
    if (top) continue;
    /* 条目缩进不统一：74 个文件是 `- name:`（零缩进），T1176 是 `  - name:`（两空格）。
       写死零缩进会让 T1176 解析出 0 用例 —— 而 fetch_status=200，
       闸门按"200 必须有用例"当场报自相矛盾。这就是不要假设格式稳定的价值。 */
    const nm = /^\s*- name:\s*(.+)$/.exec(line);
    if (nm) {
      if (cur !== null) tests.push(cur);
      cur = { name: nm[1].replace(/^["']|["']$/g, "").trim(), guid: null, platforms: [], elevation: false, deps: 0, hasCleanup: false };
      inPlatforms = false; inDeps = false;
      continue;
    }
    if (cur === null) continue;
    const g = /^\s+auto_generated_guid:\s*(\S+)/.exec(line);
    if (g) { cur.guid = g[1]; continue; }
    /* supported_platforms 的缩进也随条目缩进变化（T1176 在 6 空格处）。
       不能写死 `^  supported_platforms:`——否则平台收集不到，
       索引里每条 platform 都是空，按「平台」筛就全失效。 */
    if (/^\s*supported_platforms:\s*$/.test(line)) { inPlatforms = true; inDeps = false; continue; }
    if (/^\s*-\s*\w+\s*$/.test(line) && inPlatforms) { cur.platforms.push(line.trim().replace(/^-\s*/, "")); continue; }
    if (/^  (dependencies|dependency_executor_name):/.test(line)) { inDeps = true; inPlatforms = false; cur.deps += 1; continue; }
    if (/^\s+elevation_required:\s*true/.test(line)) { cur.elevation = true; continue; }
    if (/^\s+cleanup_command:/.test(line)) { cur.hasCleanup = true; continue; }
    /* 退回非缩进块就结束 platforms/deps 收集 */
    if (/^[a-z_]+:/.test(line)) { inPlatforms = false; inDeps = false; }
  }
  if (cur !== null) tests.push(cur);
  return tests.filter((t) => t.name);
}

const ids = Object.keys(TECHNIQUES).map(displayTechniqueId);
console.log(`探测 ${ids.length} 个技术编号（AT 覆盖不全，404 属正常）…`);

const results = [];
let idx = 0;
async function worker() {
  while (idx < ids.length) {
    const my = ids[idx]; idx += 1;
    results.push(await fetchOne(my));
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const index = { generated_at: new Date().toISOString(), source: CDN, techniques: {} };
const stat = { ok: 0, none: 0, other: 0 };
for (const r of results.sort((a, b) => a.techId.localeCompare(b.techId))) {
  if (r.status === "ok" || r.status === "cache") {
    const tests = parseMeta(r.techId, r.raw);
    index.techniques[r.techId] = { tests: tests.length, items: tests, fetch_status: "200" };
    stat.ok += 1;
  } else if (r.status === "none") {
    /* fetch_status 是**机器可判的事实**（HTTP 404），note 只是给人看的解释。
       分开存的原因：只有 note 时，把抓取失败改写成"AT 无此技术"在数据上看不出区别
       （反向探针实测过：改完闸门仍绿）。有了 fetch_status，闸门就能断言
       "404 才算没有，其它一律算没取到"。 */
    index.techniques[r.techId] = { tests: 0, items: [], fetch_status: "404", note: "AT 无此技术" };
    stat.none += 1;
  } else {
    index.techniques[r.techId] = { tests: 0, items: [], fetch_status: r.status, note: `抓取失败：${r.status}` };
    stat.other += 1;
    console.log(`  ⚠ ${r.techId}: ${r.status}`);
  }
}

/* 慢速补拉：CDN 403 是限流，靠降并发+退避能补回大部分。
   实测教训：并发 6 稳定触发 403；并发 3 仍会漏；最后 10 个必须并发 1、间隔 1.5s 才过。
   补不回来的**如实标成抓取失败**，绝不写成"AT 无此技术"（那是把"没取到"伪装成"没有"）。 */
const retryTargets = Object.entries(index.techniques)
  .filter(([, v]) => v.fetch_status && v.fetch_status !== "200" && v.fetch_status !== "404")
  .map(([k]) => k);
if (retryTargets.length) {
  console.log(`  慢速补拉 ${retryTargets.length} 个限流项…`);
  let remaining = retryTargets;
  for (let round = 1; round <= 3 && remaining.length; round += 1) {
    const left = [];
    for (const t of remaining) {
      await new Promise((r) => setTimeout(r, 1500));
      let ok = false;
      for (let i = 0; i < 2 && !ok; i += 1) {
        try {
          const res = await fetch(`${CDN}/${cdnPath(t)}`, { signal: AbortSignal.timeout(30000) });
          if (res.status === 404) { index.techniques[t] = { tests: 0, items: [], fetch_status: "404", note: "AT 无此技术" }; ok = true; }
          else if (res.ok) {
            const raw = await res.text();
            if (raw.length > 100) {
              fs.writeFileSync(path.join(CACHE, `${t}.yaml`), raw, "utf8");
              const tests = parseMeta(t, raw);
              index.techniques[t] = { tests: tests.length, items: tests, fetch_status: "200" };
              ok = true;
            }
          }
        } catch { /* 重试 */ }
      }
      if (!ok) left.push(t);
    }
    remaining = left;
  }
  console.log(`  补拉后仍缺 ${remaining.length} 个：${remaining.join(", ") || "无"}`);
}

const totalTests = Object.values(index.techniques).reduce((n, x) => n + x.tests, 0);
fs.writeFileSync(OUT, JSON.stringify(index, null, 1) + "\n", "utf8");
console.log(`[build-atomics] 有原子测试 ${stat.ok} 个技术｜无 ${stat.none}｜其它 ${stat.other}｜用例合计 ${totalTests}`);
const failed = Object.entries(index.techniques).filter(([, v]) => v.note && /^http|^err/.test(v.note)).map(([k, v]) => `${k}(${v.note})`);
if (failed.length) {
  console.log(`  ⚠ 这些技术**没探到**（不是"AT 没有"，是抓取失败，重跑或人工确认）：`);
  console.log(`     ${failed.join(", ")}`);
}
console.log(`  产物 ${path.relative(ROOT, OUT)}`);