import { RedteamStore } from "file:///E:/完成项目/dsh-purge/lib/redteam/store-core.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* 进程内验证「记漏洞 → 记步骤 → 记分 → 出报告」整条链路的指标。
   为什么要它：报告 completeness（withSteps/withRequests/incomplete）取决于
   score_hit 与 attack_step 的**关联字段**是否传对，而这类问题在写入时看不出，
   只有出报告才暴露。以前靠"改完重启喂数据看指标"，现在直接在同进程跑完。
   注意三点（都是踩过的）：
     · openEngagement 返回对象 {id,name,scope}，要取 .id（拿整个对象会生成 object-object 目录）
     · scoreReport 的指标在 .summary 里，不在顶层
     · 不要删临时目录（DB 句柄未关会 EBUSY），交给系统清理 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-chain-"));
const store = new RedteamStore(tmp);
const eid = store.openEngagement("链路验证靶", "203.0.113.0/24").id;

store.importBundle(eid, {
  scan: { tool: "gate", argv: [] },
  assets: [{ ip: "203.0.113.50", state: "live", provenance: "passive", tool: "gate" }],
});
const aid = store.listAssets(eid, { ip: "203.0.113.50", limit: 1 })?.items?.[0]?.id;
const v = store.addVuln(eid, { asset_id: aid, title: "SQL注入", severity: "high", target: "203.0.113.50/api?id=1", evidence: "sqlmap" });
const vid = v?.id ?? v?.vuln?.id;

/* 关键：这三处都要传关联字段，否则报告必然 incomplete */
store.addChainStep(eid, {
  stage_code: "internet", title: "SQL注入拿库", detail: "回显 3 个库",
  tool: "sqlmap -u 'http://203.0.113.50/api?id=1' --dbs", vuln_id: vid,
});
const pts = store.listScorePoints(eid, {})?.items || [];
const p = pts.find((x) => String(x.code) === "db-credential") || pts[0];
store.addScoreHit(eid, { point_id: p.id, evidence: "SQL注入获取数据库权限", vuln_id: vid });

const s = store.scoreReport(eid, {}).summary || {};
const checks = [
  ["有计分条目", s.count >= 1],
  ["有得分", (s.points || 0) > 0],
  ["有复现步骤", s.withSteps >= 1],
  ["有复现命令", s.withCommands >= 1],
  ["报告完整", s.incomplete === 0],
];
console.log("[check-report-chain] 指标 " + JSON.stringify({
  count: s.count, points: s.points, withSteps: s.withSteps,
  withCommands: s.withCommands, withRequests: s.withRequests,
  missingRequests: s.missingRequests, incomplete: s.incomplete,
}));

let bad = 0;
for (const [label, ok] of checks) {
  console.log((ok ? "  ✓ " : "  ✗ ") + label);
  if (!ok) bad += 1;
}
if (bad) {
  console.log("  → 记漏洞/步骤/得分时没把关联字段传下去（vuln_id / asset_id / step_id）");
  console.log("  → 症状：写入成功但报告说「无法复现」，因为取不到原始请求与命令");
}
process.exit(bad ? 1 : 0);