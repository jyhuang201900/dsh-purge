#!/usr/bin/env node
/**
 * 用途：上游漂移探测——npm 上 @deepseek-ai/dsh 的最新版本，是否还是我钉的 dshTarget。
 * 用法：node scripts/check-upstream.mjs [--json]
 *      注册表可用 DSH_UPSTREAM_URL 覆盖（测「未查到」分支时用得上）。
 * 依赖：Node ≥18（全局 fetch）；离线时明确报「未知」并按通过退出——绝不把「没查到」说成「一致」。
 * 验证：2026-11-10 四态实测：ok（现状 latest=0.2.2-rc.1＝dshTarget）/ warn（dshTarget 改 0.2.1-rc.5）/
 *      bad（engines 上界压到 <0.2.2-0）/ unknown（URL 指到没人听的端口）。
 *
 * 为什么要这条：整套适配（76 条补丁、锚点表）都钉在宿主的某一个预发布版本上，而第 22 轮那次官方升版
 * 曾让破甲面「静默缩水」——面板照旧报 0 待清洗。漂移必须可查，不能靠我记得。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const target = String(pkg.dshTarget || "");
const range = String((pkg.engines && pkg.engines.dsh) || "");

/** 取 [major,minor,patch] 用于和上下界粗比；预发布后缀不参与比较，只在文案里露出来。 */
function core3(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
function inRange(v) {
  const up = /<\s*(\d+\.\d+\.\d+)/.exec(range);
  const low = />=\s*(\d+\.\d+\.\d+)/.exec(range);
  const c = core3(v);
  if (!c) return { ok: false, why: "版本号读不出 major.minor.patch" };
  if (up && cmp(c, core3(up[1])) >= 0) return { ok: false, why: `已达/超过上界 ${up[1]}`, bound: true };
  if (low && cmp(c, core3(low[1])) < 0) return { ok: false, why: `低于下界 ${low[1]}`, bound: true };
  return { ok: true, why: `在 ${range || "(未声明)"} 内` };
}

let latest = "";
let published = "";
let netError = "";
try {
  const url = process.env.DSH_UPSTREAM_URL || "https://registry.npmjs.org/@deepseek-ai%2Fdsh";
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) netError = `HTTP ${res.status}`;
  else {
    const j = await res.json();
    latest = String((j && j["dist-tags"] && j["dist-tags"].latest) || "");
    published = String((j && j.time && j.time[latest]) || "");
    if (!latest) netError = "registry 没有 dist-tags.latest";
  }
} catch (e) {
  netError = `连不上注册表：${String((e && e.message) || e).slice(0, 50)}`;
}

const verdict = (() => {
  if (netError) return { level: "unknown", text: `未查到（${netError}）—— 未知不等于一致，不据此判失败` };
  if (!target) return { level: "unknown", text: `package.json 没声明 dshTarget，无法比对（latest ${latest}）` };
  const bound = inRange(latest);
  // 越界先判：否则「latest == dshTarget 但 engines 已把它排除」会被上面的等值分支吞成 ok（本轮实测就踩了这个顺序 bug）。
  if (!bound.ok) return { level: "bad", text: `engines 已容不下上游 ${latest}（${published ? published.slice(0, 10) : "时间未知"}）：${bound.why}；我钉 ${target}${latest === target ? "（版本没变，是声明范围太窄）" : "，且上游已出新版"} —— 必须显式抬界并重核锚点` };
  if (latest === target) return { level: "ok", text: `上游最新就是我钉的 ${target}｜${bound.why}` };
  return { level: "warn", text: `上游已出 ${latest}（${published ? published.slice(0, 10) : "时间未知"}），我仍钉 ${target}：该跑 npm run check-anchors 重核锚点，再决定要不要 re-anchor` };
})();

const mark = verdict.level === "ok" ? "✓" : verdict.level === "warn" ? "⚠" : verdict.level === "bad" ? "✗" : "·";
if (asJson) {
  process.stdout.write(JSON.stringify({ target, range, latest, published, verdict }, null, 1) + "\n");
} else {
  console.log(`上游漂移：dshTarget=${target || "(无)"}｜npm latest=${latest || "(未取到)"}｜发布 ${published ? published.slice(0, 10) : "?"}`);
  console.log(`  ${mark} ${verdict.text}`);
}
// 只有「越界」算不通过；漂移是提醒、离线是未知 —— 都不该把这条探测变成天天红的负担。
process.exit(verdict.level === "bad" ? 1 : 0);
