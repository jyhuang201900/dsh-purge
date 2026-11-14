import { RedteamStore } from "file:///E:/完成项目/dsh-purge/lib/redteam/store-core.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* 进程内验证「记漏洞 → 记步骤 → 记分 → 出报告」整条链路的指标。
   为什么要它：报告 completeness（withSteps/withRequests/incomplete）取决于
   score_hit 与 attack_step 的**关联字段**是否传对，而这类问题在写入时看不出，
   只有出报告才暴露。以前靠"改完重启喂数据看指标"，现在直接在同进程跑完。

   注意几点（都是踩过的）：
     · openEngagement 返回对象 {id,name,scope}，要取 .id（拿整个对象会生成 object-object 目录）
     · scoreReport 的指标在 .summary 里，不在顶层
     · 不要删临时目录（DB 句柄未关会 EBUSY），交给系统清理
     · **vuln 的返回值形状不稳定**（可能 {ok,id} 也可能包一层），所以用 listVulns 反查 id
*/
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-chain-"));
const store = new RedteamStore(tmp);
const eid = store.openEngagement("链路验证靶", "203.0.113.0/24").id;

store.importBundle(eid, {
  scan: { tool: "gate", argv: [] },
  assets: [{ ip: "203.0.113.50", state: "live", provenance: "passive", tool: "gate" }],
});
const aid = store.listAssets(eid, { ip: "203.0.113.50", limit: 1 })?.items?.[0]?.id;
store.addVuln(eid, { asset_id: aid, title: "SQL注入", severity: "high", target: "203.0.113.50/api?id=1", evidence: "sqlmap" });
const vid = (store.listVulns(eid, {})?.items || [])[0]?.id;

/* 关键：三处都要传关联字段，否则报告必然 incomplete。
   这里刻意从漏洞反查 asset_id/target —— 这正是 tool 层该做的事
   （模型知道"这条分对应哪个洞"，不该再被要求填一遍 asset_id）。 */
const vuln = (store.listVulns(eid, {})?.items || []).find((x) => Number(x.id) === Number(vid));
store.addChainStep(eid, {
  stage_code: "internet", title: "SQL注入拿库", detail: "回显 3 个库",
  tool: "sqlmap -u 'http://203.0.113.50/api?id=1' --dbs",
  vuln_id: vid, asset_id: vuln?.asset_id ?? null,
});
const pts = store.listScorePoints(eid, {})?.items || [];
const p = pts.find((x) => String(x.code) === "server-host") || pts[0];
store.addScoreHit(eid, {
  point_id: p.id, evidence: "拿到服务器主机权限",
  vuln_id: vid, asset_id: vuln?.asset_id ?? null, target: vuln?.target ?? null,
});

const rep = store.scoreReport(eid, {});
const s = rep.summary || {};
const md = String(rep.markdown || "");

/* 报告「复现索引」的目标列：读 hit.asset_id / hit.target，两者皆空时整列是 ``。
   实测踩过：两行都是 ``，读者无法判断这条分属于哪台机器 —— 交付物级别缺陷。 */
const emptyTargetRows = (md.match(/\|\s*``\s*\|/g) || []).length;

const checks = [
  ["有计分条目", s.count >= 1],
  ["有得分", (s.points || 0) > 0],
  ["有复现步骤", s.withSteps >= 1],
  ["有复现命令", s.withCommands >= 1],
  ["报告完整", s.incomplete === 0],
  ["复现索引有目标（不是空 ``）", emptyTargetRows === 0],
];
console.log("[check-report-chain] 指标 " + JSON.stringify({
  count: s.count, points: s.points, withSteps: s.withSteps,
  withCommands: s.withCommands, withRequests: s.withRequests,
  missingRequests: s.missingRequests, incomplete: s.incomplete,
  emptyTargetRows,
}));

let bad = 0;
for (const [label, ok] of checks) {
  console.log((ok ? "  ✓ " : "  ✗ ") + label);
  if (!ok) bad += 1;
}
if (bad) {
  console.log("  → 记漏洞/步骤/得分时没把关联字段传下去（vuln_id / asset_id / target / step_id）");
  console.log("  → 症状：写入成功但报告说「无法复现」或说不清打的是哪台机器。");
  console.log("  → 修法：tool 层从关联漏洞反查 asset_id/target 自动带上，不要要求模型多填参数。");
}
process.exit(bad ? 1 : 0);