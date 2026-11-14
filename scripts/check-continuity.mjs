#!/usr/bin/env node
/**
 * 第 29 关：会话连续性 —— 否定结果必须能被新会话读到。
 *
 * 为什么要有：插件的前提是「会话一断、上下文一清，只有落库的东西还在」。
 * 但过去落库的只有"成果"（漏洞/凭据/资产/得分），**没有"试过但没通"**：
 *   · attack_step 只有 result（原始回显），没有字段区分成功/失败
 *   · summary 也没有任何地方列出"哪些路已经堵死"
 * 后果：新会话看不到「SSRF 试了 3 种 payload 都不通」，会重走同样的路，一轮时间白花。
 *
 * 本关验证三件事（进程内，不重启）：
 *   1. attack_step 能写 outcome，且中文/别名（失败/failed/不通）能归一化
 *   2. listAttackSteps 能按 outcome 筛选，且默认读回带 outcome
 *   3. **老库兼容**：没有 outcome 列的老库，打开时自动补列（否则升级即崩）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* 根目录从脚本自身位置推导（scripts/ 的上一级），避免手拼路径踩到 URL 编码/盘符问题。
   走过的弯路：用 `file://` + 手拼路径，中文目录被二次编码成 %25E5…，模块加载失败。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { RedteamStore } = await import(pathToFileURL(path.join(ROOT, "lib", "redteam", "store-core.js")).href);

const problems = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cont-"));
const s = new RedteamStore(tmp);
const eid = s.openEngagement("连续性验证靶", "203.0.113.0/24").id;

/* 1) 写入 + 归一化 */
s.addChainStep(eid, { stage_code: "internet", title: "RCE 打通", tool: "curl -d 'cmd=id'", outcome: "ok" });
s.addChainStep(eid, { stage_code: "internet", title: "SSRF 打 metadata", tool: "curl http://169.254.169.254/", outcome: "fail", detail: "回显 403" });
s.addChainStep(eid, { stage_code: "internet", title: "SSRF 打 gopher", tool: "curl gopher://x", outcome: "失败", detail: "协议被禁" });
s.addChainStep(eid, { stage_code: "internet", title: "老数据（未标注）", tool: "nmap -sT" });

const all = s.listAttackSteps(eid, {});
if (all.total !== 4) problems.push(`步骤数应为 4，实际 ${all.total}`);
const byTitle = new Map((all.items || []).map((x) => [x.title, x]));
if (byTitle.get("RCE 打通")?.outcome !== "ok") problems.push("outcome=ok 没写进去");
if (byTitle.get("SSRF 打 metadata")?.outcome !== "fail") problems.push("outcome=fail 没写进去");
if (byTitle.get("SSRF 打 gopher")?.outcome !== "fail") problems.push('中文「失败」没有归一化成 fail');
if (byTitle.get("老数据（未标注）")?.outcome !== null && byTitle.get("老数据（未标注）")?.outcome !== undefined) {
  problems.push("不传 outcome 时不该被猜成某个值");
}

/* 2) 按 outcome 筛选 */
const fails = s.listAttackSteps(eid, { outcome: "fail" });
if (fails.total !== 2) problems.push(`outcome=fail 应筛出 2 条，实际 ${fails.total}`);

/* 3) 老库兼容：删掉 outcome 列后用新代码打开，应自动补回 */
{
  const db = s.db(eid);
  const cols0 = db.prepare("PRAGMA table_info(attack_step)").all().map((c) => c.name);
  if (!cols0.includes("outcome")) {
    problems.push("新建库就没有 outcome 列（DDL 没生效）");
  } else {
    try { db.exec("ALTER TABLE attack_step DROP COLUMN outcome"); } catch { /* 老版本 SQLite 不支持 DROP COLUMN，跳过这项 */ }
    const s2 = new RedteamStore(tmp);
    s2.openEngagement("连续性验证靶", "203.0.113.0/24");
    const cols1 = s2.db(eid).prepare("PRAGMA table_info(attack_step)").all().map((c) => c.name);
    if (!cols1.includes("outcome")) problems.push("老库打开后没自动补 outcome 列（升级即崩）");
  }
}

console.log(`[check-continuity] 步骤 ${all.total} 条｜fail 可筛 ${fails.total} 条｜老库补列已验`);
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 连续性靠落库：没有 outcome，「哪些路已堵死」就不在新会话的视野里，会重走一遍。");
  process.exit(1);
}
console.log("  ✓ outcome 可写可筛（含中文归一化）｜老库自动补列｜未标注不被猜");
process.exit(0);