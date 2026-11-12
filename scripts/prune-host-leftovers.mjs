#!/usr/bin/env node
/**
 * 用途：清掉宿主 resources 里 dsh-purge 自己的历史残留目录（app.dshpurge-prev-* / app.dshpurge-next）。
 * 用法：node scripts/prune-host-leftovers.mjs [--apply] [--resources DIR] [--json]
 * 依赖：Node ≥18；只动 resources 下自己命名的目录，不碰 app / app.asar / app.asar.disabled。
 *
 * 为什么默认只列不删：
 *   `app.dshpurge-prev-<ms>` 是 apply 前的整目录备份，也是**回滚锚点**。删错一份就没有「回到原状」的路。
 *   所以永不删除 `app.dshpurge-recover.json` 里 `prev` 指向的那一份；其余才视为已失效的历史目录。
 *   实测（第 155 轮）：E:\Program Files\harness\resources 下挂着两份 444MB 孤儿备份，合计 888MB，
 *   recover.json 里记录的 prev（…-1794258746336）早已不存在且 prevRestored=true —— 这说明它们是
 *   之后几次 apply 留下的，不是当前锚点。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { findDesktopAppExecutable, resourcesDirForExecutable } from "../lib/desktop.js";

const asJson = process.argv.includes("--json");
const apply = process.argv.includes("--apply");
const resArg = (() => {
  const i = process.argv.indexOf("--resources");
  return i >= 0 ? String(process.argv[i + 1] || "") : "";
})();

function resolveResourcesDir() {
  if (resArg) return path.resolve(resArg);
  const exe = findDesktopAppExecutable({ discover: true });
  const dir = exe ? resourcesDirForExecutable(exe) : "";
  return dir || "";
}

function dirSizeBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const fp = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(fp);
      else {
        try {
          total += fs.statSync(fp).size;
        } catch {
          /* 读不到就不算，别让一个坏文件把整轮统计打停 */
        }
      }
    }
  }
  return total;
}

function readRecoverAnchor(resourcesDir) {
  const fp = path.join(resourcesDir, "app.dshpurge-recover.json");
  try {
    const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
    return { file: fp, prev: typeof raw?.prev === "string" ? path.resolve(raw.prev) : "", raw };
  } catch {
    return { file: fp, prev: "", raw: null };
  }
}

const resourcesDir = resolveResourcesDir();
if (!resourcesDir || !fs.existsSync(resourcesDir)) {
  const msg = `找不到宿主 resources 目录（用 --resources 指定）：${resourcesDir || "空"}`;
  if (asJson) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(msg);
  process.exit(2);
}

const anchor = readRecoverAnchor(resourcesDir);
// 保留最新的 N 份（默认 1）：`prev-<ms>` 里的 ms 是时间戳，等于「这份备份有多新」。
// 为什么留一份而不是全删：app.asar.disabled 是**密封原件**，还原要先解开；
// prev 目录是**已经解好的整份**，真要回滚时它是最省事的那条路。留最新一份＝花 444MB 买一条秒回滚的路。
const keepArg = (() => {
  const i = process.argv.indexOf("--keep");
  if (i < 0) return 1;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
})();
const entries = fs.readdirSync(resourcesDir, { withFileTypes: true });
const candidates = [];
for (const e of entries) {
  if (!e.isDirectory()) continue;
  if (!/^app\.dshpurge-(prev-\d+|next)$/.test(e.name)) continue;
  const fp = path.join(resourcesDir, e.name);
  const protectedByAnchor = Boolean(anchor.prev && path.resolve(fp) === anchor.prev);
  candidates.push({ name: e.name, path: fp, bytes: dirSizeBytes(fp), protected: protectedByAnchor });
}
const prevs = candidates
  .filter((c) => /^app\.dshpurge-prev-(\d+)$/.test(c.name))
  .sort((a, b) => Number(b.name.split("-").pop()) - Number(a.name.split("-").pop()));
for (const c of prevs.slice(0, keepArg)) c.protected = true;
candidates.sort((a, b) => a.name.localeCompare(b.name));

const removable = candidates.filter((c) => !c.protected);
const reclaim = removable.reduce((sum, c) => sum + c.bytes, 0);
const removed = [];

if (apply) {
  for (const c of removable) {
    try {
      fs.rmSync(c.path, { recursive: true, force: true });
      removed.push(c.name);
    } catch (err) {
      if (asJson) console.log(JSON.stringify({ ok: false, error: `删除 ${c.name} 失败：${err.message}` }, null, 2));
      else console.error(`删除 ${c.name} 失败：${err.message}`);
      process.exit(1);
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({
    ok: true,
    resources: resourcesDir,
    apply,
    anchor: anchor.prev || null,
    candidates,
    removed,
    reclaimedBytes: apply ? reclaim : 0,
    reclaimableBytes: reclaim,
  }, null, 2));
  process.exit(0);
}

console.log(`resources: ${resourcesDir}`);
console.log(`回滚锚点（永不删）: ${anchor.prev || "无（recover.json 未记录或已失效）"}`);
if (!candidates.length) {
  console.log("没有 app.dshpurge-prev-* / app.dshpurge-next 残留。");
  process.exit(0);
}
for (const c of candidates) {
  const tag = c.protected ? (anchor.prev === c.path ? "保留（recover.json 锚点）" : "保留（最新一份，最多 keep 份）") : apply ? "已删除" : "可删";
  console.log(`  ${c.name}  ${(c.bytes / 1048576).toFixed(1)} MB  ${tag}`);
}
console.log(apply
  ? `已清理 ${removed.length} 个目录，释放 ${(reclaim / 1048576).toFixed(1)} MB。`
  : `可释放 ${(reclaim / 1048576).toFixed(1)} MB。加 --apply 才真的删。`);
process.exit(0);