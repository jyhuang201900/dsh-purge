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
