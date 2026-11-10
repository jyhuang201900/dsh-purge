/**
 * 用途：磁盘卫生扫描（第 70 轮从 bin 抽出）——「换装遗留的 prev 目录」与「官方原文快照的孤儿对」两类检查。
 * 用法：import { scanSwapBackups, scanSnapshotPairs, resolveResources } from "./hygiene.js";
 * 依赖：Node ≥18；全程只读，绝不删文件（删除是 lib/extract-asar.js 的 prunePreservedDirs 的职责）。
 * 验证：2026-11-10 抽出时验收标准是「--verify-live 输出逐行等值」；夹具行为见 scripts/hygiene-selftest.mjs。
 *
 * 为什么单独成模块：这两块原来直接内嵌在 bin 的 --verify-live 里（41 行、带栈遍历与 try/catch）。
 * 再往 bin 里塞第 7 项检查，它就是第二个 core.js —— 那正是我们反对的堆叠，不是能力。
 */
import fs from "node:fs";
import path from "node:path";

/** 递归算目录大小（MB，容错：读不动的文件跳过而不是整次失败）。 */
export function dirMb(root) {
  let mb = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const f = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(f);
      else { try { mb += fs.statSync(f).size / 1024 / 1024; } catch { } }
    }
  }
  return mb;
}

/** 只探 GET 安全的路由：POST-only 的 apply/restart/uninstall 探一次就真改一次状态，不能拿来点名。 */
export const ROUTE_PROBES = [
  "/dsh-purge/status",
  "/dsh-purge/last-user",
  "/dsh-purge/rewind/options",
  "/dsh-purge/update",
  "/dsh-purge/drill-grant",
  "/dsh-purge/override",
  "/dsh-purge/own-servers",
  "/dsh-purge/rules",
  "/dsh-purge/skills",
];

/**
 * 每条路由的探测超时：默认 20s，但**本身就要出网的路由单独放宽**。
 * 为什么不一刀切：`/dsh-purge/update` 会真去查上游（实测：fetch 20s 超时后回退 git ls-remote，
 * 合计 28.9s），用 20s 去卡它就会把「慢但可用」报成「超时」——界面上出现 `8/9 存活` 让人去查一个
 * 不存在的问题。**误报比漏报更糟**，所以：慢路由放宽、并把「慢」与「坏」分开报。
 */
const SLOW_ROUTE_TIMEOUT_MS = { "/dsh-purge/update": 60000 };
const SLOW_ROUTE_MS = 8000; // 超过这个就算「慢」，单独计数并在明细里点名

/**
 * 面板路由存活矩阵：把「重启后要人工点一遍」的清单变成一条命令的判定。
 * 分类刻意三分：200=在；404=这条路由不存在（说明我的声明吹了或注册没上）；405=注册了但方法不对；连不上=宿主没跑，不是待重启。
 */
export async function scanRouteMatrix(baseUrl, { routes = ROUTE_PROBES, timeoutMs = 20000 } = {}) {
  if (!baseUrl) return { level: "warn", label: "面板路由未探测", detail: "给 --verify-live <url> 或设 DSH_WEB_URL", live: 0, total: routes.length, codes: {} };
  const codes = {};
  let live = 0;
  let refused = 0;
  let timedOut = 0;
  let dead404 = 0;
  let notJson = 0;
  const slow = [];
  const t0 = Date.now();
  for (const p of routes) {
    let status = 0;
    const per = SLOW_ROUTE_TIMEOUT_MS[p] || timeoutMs;
    const t1 = Date.now();
    try {
      const r = await fetch(String(baseUrl).replace(/\/+$/, "") + p, { signal: AbortSignal.timeout(per) });
      status = r.status;
      // 200 还得看负载：宿主若有 SPA 兜底，200 + text/html 不能算路由存活（实测假路由返回的是 404，所以这里当真判据用）。
      if (status === 200 && !String(r.headers.get("content-type") || "").includes("json")) { notJson += 1; codes[p] = "200(非 JSON)"; try { await r.body?.cancel(); } catch { } continue; }
      try { await r.body?.cancel(); } catch { }
      const took = Date.now() - t1;
      if (took >= SLOW_ROUTE_MS) slow.push(`${p.replace("/dsh-purge/", "")} ${(took / 1000).toFixed(1)}s`);
    } catch (e) {
      // 超时要单独算：/dsh-purge/update 会真去查上游，把它当「宿主没跑」就是误判。
      if (String((e && e.name) || "") === "TimeoutError") { timedOut += 1; codes[p] = "超时"; }
      else { refused += 1; codes[p] = "连不上"; }
      continue;
    }
    codes[p] = status;
    if (status === 200) { live += 1; }
    else if (status === 404) dead404 += 1;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (refused === routes.length) {
    return { level: "warn", label: `面板路由：全部连不上（${routes.length} 条）`, detail: `宿主没在跑或 URL 不对，不是待重启｜${secs}s`, live, total: routes.length, codes };
  }
  const level = live === routes.length ? "ok" : (dead404 || notJson) ? "bad" : "warn";
  const slowNote = slow.length ? `｜慢（可用，非故障）：${slow.join("、")}` : "";
  const detail = live === routes.length
    ? `全部 200，面板与 HTTP 面都在｜耗时 ${secs}s${slowNote}`
    : `未全 200：200 ${live}｜404 ${dead404}｜200 非 JSON ${notJson}｜超时 ${timedOut}｜连不上 ${refused}｜其余 ${routes.length - live - dead404 - notJson - timedOut - refused}｜${secs}s${slowNote}`;
  return { level, label: `面板路由：${live}/${routes.length} 条存活`, detail, live, total: routes.length, codes, slow };
}

/** 从 gatherState 的结果里推宿主 resources 目录：优先被盯文件的路径，其次 ai_base。 */
export function resolveResources(st = {}) {
  const sample = Object.values(st.files || {})[0] || `${String(st.ai_base || "")}\\x`;
  const cut = String(sample).split(/[\\/]app[\\/]/)[0];
  return cut && cut !== String(sample) ? cut : "";
}

/** prev 备份目录：>keep 份说明清理没跑（历史上攒过 16 个 / 7.1 GB）。 */
export function scanSwapBackups(resources, { keep = 2 } = {}) {
  if (!resources || !fs.existsSync(resources)) {
    return { level: "warn", label: "换装遗留未定位", detail: "读不到宿主 resources 目录，不据此判失败" };
  }
  let names = [];
  try { names = fs.readdirSync(resources); } catch { return { level: "warn", label: "换装遗留：读目录失败", detail: "不据此判失败" }; }
  const prevs = names.filter((n) => String(n).startsWith("app.dshpurge-prev"));
  let mb = 0;
  for (const n of prevs) mb += dirMb(path.join(resources, n));
  const ok = prevs.length <= keep;
  return {
    level: ok ? "ok" : "warn",
    label: `换装遗留：${prevs.length} 个 prev 备份目录 / ${mb.toFixed(0)} MB`,
    detail: ok ? "在保留上限内（新代码已在换装后自动剪到 2 份）" : "升级脚本或官方更新路径未剪；跑一次换装即可自动清理，或手工删旧的",
    count: prevs.length,
    mb,
  };
}

/** 官方原文快照：命名按目标哈希覆盖式（有界）；孤儿 = 原件已被宿主挪走，revert 也救不回。 */
export function scanSnapshotPairs(dshHome, { warnOrphans = 5 } = {}) {
  const hb = path.join(String(dshHome || ""), "dsh-purge", "host-backups");
  if (!fs.existsSync(hb)) return null; // 目录不存在就少报一行，不编造
  let jsons = [];
  try { jsons = fs.readdirSync(hb).filter((n) => n.endsWith(".json")); } catch { return null; }
  let orphans = 0;
  let unreadable = 0; // 静默跳过会把问题读成 0，所以单独计数报出来
  let orphanMb = 0;
  for (const n of jsons) {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(hb, n), "utf8")); } catch { unreadable += 1; continue; }
    const orig = String((j && j.path) || "");
    if (!orig) { unreadable += 1; continue; }
    if (fs.existsSync(orig)) continue;
    orphans += 1;
    const bak = path.join(hb, n.replace(/\.json$/, ".bak"));
    for (const f of [bak, path.join(hb, n)]) {
      try { if (fs.existsSync(f)) orphanMb += fs.statSync(f).size / 1024 / 1024; } catch { }
    }
  }
  const warn = orphans > warnOrphans || unreadable > 0;
  return {
    level: warn ? "warn" : "ok",
    label: `原文快照：${jsons.length} 对（覆盖式命名，有界）｜孤儿 ${orphans} 对 / ${(orphanMb * 1024).toFixed(0)} KB${unreadable ? `｜不可解析 ${unreadable} 个（别当 0）` : ""}`,
    detail: orphans ? "原件已被宿主挪走，revert 也救不回；留着只为追溯，删了不心疼" : "全部对应现存原件",
    pairs: jsons.length,
    orphans,
    unreadable,
  };
}
