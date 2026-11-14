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

/* 4) 阶段进度必须从事实推导，而不是"只列 5 个名字"。
   过去 op=stages 只回 code+name，新会话看不出做到哪了 —— 与「已试过但不通」是同一类空白。
   断言：
     a) 空库时全 pending
     b) 有得分 → done；只有步骤（哪怕是失败）→ active；只有资产 → started
     c) next 不能退回到"已被越过"的阶段（实测踩过：internet=done 却建议回去做 recon） */
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-stage-"));
  const s2 = new RedteamStore(tmp2);
  const e2 = s2.openEngagement("阶段验证靶", "203.0.113.0/24").id;

  const empty = s2.stageProgress(e2);
  if (!empty.items.length) problems.push("stageProgress 返回空（阶段没播种）");
  if (empty.items.some((x) => x.status !== "pending")) problems.push("空库时阶段状态应全部 pending");

  /* 外部资产 + 得分 → internet 应为 done */
  s2.importBundle(e2, { scan: { tool: "gate", argv: [] }, assets: [{ ip: "203.0.113.91", state: "live", provenance: "passive", tool: "gate" }] });
  const a2 = s2.listAssets(e2, { ip: "203.0.113.91", limit: 1 })?.items?.[0]?.id;
  s2.addVuln(e2, { asset_id: a2, title: "SQLi", severity: "high", target: "203.0.113.91/api", evidence: "x" });
  const v2 = (s2.listVulns(e2, {})?.items || [])[0]?.id;
  const p2 = (s2.listScorePoints(e2, {})?.items || []).find((x) => String(x.code) === "server-host");
  s2.addScoreHit(e2, { point_id: p2.id, evidence: "拿到主机", vuln_id: v2, asset_id: a2 });
  /* 边界阶段只记一条失败步骤 → 应为 active（失败也算进展，且要能看见） */
  s2.addChainStep(e2, { stage_code: "boundary", title: "打隧道失败", tool: "chisel", outcome: "fail" });

  const prog = s2.stageProgress(e2);
  const byCode = new Map(prog.items.map((x) => [x.code, x]));
  if (byCode.get("internet")?.status !== "done") problems.push("有得分的阶段应为 done");
  if (byCode.get("boundary")?.status !== "active") problems.push("只有失败步骤的阶段应为 active（失败也算进展）");
  if (byCode.get("boundary")?.fails !== 1) problems.push("阶段应统计失败条数");
  /* next 不能退回被越过的阶段：internet 已完成，不该建议回去 recon */
  if (prog.next && prog.next.code === "recon") {
    problems.push("next 退回到 recon —— 已越过的阶段不该再建议回去（应为 boundary）");
  }
  if (prog.next && prog.next.code !== "boundary") problems.push(`next 应为 boundary，实际 ${prog.next.code}`);
}

/* 5) stage_code 必须真落库。
   实测发现的 bug：score_hit 表有 stage_code 列、addScoreHit 也收到了参数，
   但 INSERT 语句里**漏了这列** → 永远写 null → scoreStageOf 退化成"按 target 猜"，
   于是"给 5 个阶段各塞一条分"只有 internet 变 done，其余仍 pending。
   缺这一列就够隐蔽：不漏报错、不漏字段名，只是阶段归属悄悄全错。
   同时验旧名映射：store 直达与工具层两条入口必须行为一致（exploit→internet 等）。 */
{
  const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-stage-code-"));
  const s4 = new RedteamStore(tmp4);
  const e4 = s4.openEngagement("stage_code 验证靶", "203.0.113.0/24").id;
  s4.importBundle(e4, { scan: { tool: "gate", argv: [] }, assets: [{ ip: "203.0.113.61", state: "live", provenance: "passive", tool: "gate" }] });
  const a4 = s4.listAssets(e4, { ip: "203.0.113.61", limit: 1 })?.items?.[0]?.id;
  const p4 = (s4.listScorePoints(e4, {})?.items || []).find((x) => String(x.code) === "server-host");
  const db4 = s4.db(e4);
  const cases = [
    ["boundary", "boundary"],
    ["exploit", "internet"],   // 旧名必须映射，不能落 null
    ["access", "internal"],
    ["pivot", "boundary"],
    ["乱写的阶段", null],        // 认不出来 → null（不猜）
  ];
  for (const [input, want] of cases) {
    const h = s4.addScoreHit(e4, { point_id: p4.id, evidence: "stage_code 验证", asset_id: a4, stage_code: input });
    const got = db4.prepare("SELECT stage_code FROM score_hit WHERE id = ?").get(h.id)?.stage_code ?? null;
    if (got !== want) problems.push(`stage_code 传入「${input}」应落库 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);
  }
  /* 五阶段各有分时，stageProgress 必须全 done（这条是上面那个 bug 的端到端体现） */
  for (const st of ["recon", "internet", "boundary", "internal", "target"]) {
    s4.addScoreHit(e4, { point_id: p4.id, evidence: "stage_" + st, asset_id: a4, stage_code: st });
  }
  const pp = s4.stageProgress(e4);
  const notDone = pp.items.filter((x) => x.status !== "done").map((x) => x.code);
  if (notDone.length) problems.push(`五阶段各塞一条分后仍非 done：${notDone.join(",")}（stage_code 没落库会这样）`);
  if (pp.doneAll !== true) problems.push("五阶段全 done 时 doneAll 应为 true");
}

console.log(`[check-continuity] 步骤 ${all.total} 条｜fail 可筛 ${fails.total} 条｜老库补列已验｜阶段进度已验｜stage_code 落库已验`);
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 连续性靠落库：没有 outcome，「哪些路已堵死」就不在新会话的视野里，会重走一遍。");
  process.exit(1);
}
console.log("  ✓ outcome 可写可筛（含中文归一化）｜老库自动补列｜未标注不被猜");
process.exit(0);