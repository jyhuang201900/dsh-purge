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

/* 必须登记**凭据**并挂到资产上（asset_id），否则：
   · 凭据查不到（trace 是 `WHERE asset_id = ?`，不传就落空）
   · 模板占位符一个都填不上 → 填充前后数量相同
   · 「正文用原始模板还是填充后模板」这个矛盾就测不出来
   （实测踩过：探针改到代码但闸门仍绿，就是因为测试里没有能匹配上的凭据） */
store.addCredential(eid, {
  asset_id: aid, host: "203.0.113.50", username: "root", secret_type: "password",
  secret_value: "P@ssw0rd", privilege: "admin", source: "gate", tool: "gate",
});

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

/* 正文命令与占位符提示必须同源。
   踩过的坑：正文印 `confirm.replay`（规则里的原始模板，占位符一个都没填），
   而提示按 `replay_cmd`（已填充）算，于是正文写着 4 个占位符、提示只说"还有 1 个没填"。
   读者既不知道要填几个，也不知道哪些已经填好了。

   ⚠ 判据不能用「数量」：replay 与 script 两套模板的占位符个数**恰好相同**，数数分辨不出来。
   必须逐个比对**占位符集合**。
   ⚠ 也只在**真有占位符**时才判：本用例的步骤带了真实命令（repro_kind=cli），
   正文根本不含 <占位符>，两边都空自然相等 —— 那种"空转通过"没有意义。
   模板分支（method）由下面的独立用例专门覆盖。 */
let placeholderMismatch = 0;
{
  const lines = md.split("\n");
  const i = lines.findIndex((x) => x.includes("**复现方式**"));
  if (i >= 0) {
    const inCmd = [...new Set((lines[i].match(/<[^>\s]{1,24}>/g) || []))].sort();
    const warnLine = lines.slice(i, i + 4).join(" ");
    const m = /没填：`([^`]*(?:`、`[^`]*)*)`/.exec(warnLine);
    const declared = m ? [...new Set(m[1].split("`、`"))].sort() : [];
    if (inCmd.length > 0 || declared.length > 0) {
      if (JSON.stringify(inCmd) !== JSON.stringify(declared)) placeholderMismatch = 1;
    }
  }
}

/* 独立用例：**没有真实命令**的场景（repro_kind=method），模板必然留占位符。
   这条才真正覆盖「正文是否用填充后的模板」——命令里剩下的占位符集合
   必须与提示里报的完全一致。 */
let templateCaseOk = 1;
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tpl-"));
  const s2 = new RedteamStore(tmp2);
  const e2 = s2.openEngagement("模板用例", "203.0.113.0/24").id;
  s2.importBundle(e2, { scan: { tool: "gate", argv: [] }, assets: [{ ip: "203.0.113.51", state: "live", provenance: "passive", tool: "gate" }] });
  const a2 = s2.listAssets(e2, { ip: "203.0.113.51", limit: 1 })?.items?.[0]?.id;
  s2.addVuln(e2, { asset_id: a2, title: "SQLi", severity: "high", target: "203.0.113.51/api?id=1", evidence: "x" });
  const v2 = (s2.listVulns(e2, {})?.items || [])[0]?.id;
  /* 只给凭据、不记攻击步骤 → 没有真实命令可用 → 必然走模板分支 */
  s2.addCredential(e2, { asset_id: a2, host: "203.0.113.51", username: "root", secret_type: "password", secret_value: "P@ssw0rd", privilege: "admin", source: "gate", tool: "gate" });
  const p2 = (s2.listScorePoints(e2, {})?.items || []).find((x) => String(x.code) === "db-credential");
  /* 只给凭据、不记攻击步骤 → 没有真实命令可用 → 必然走模板分支。
   注意 addScoreHit 必须带 asset_id：trace 查凭据是 `WHERE asset_id = ?`，
   不传就查不到凭据，模板里 <user>/<pass> 一个都填不上，
   于是"填不进去"和"该填却没填"分不清（实测踩过好几次）。 */
  s2.addScoreHit(e2, { point_id: p2.id, evidence: "SQL注入拿库", vuln_id: v2, asset_id: a2 });
  const md2 = String(s2.scoreReport(e2, {}).markdown || "");
  const l2 = md2.split("\n");
  const j = l2.findIndex((x) => x.includes("**复现方式**"));
  if (j < 0) {
    templateCaseOk = 0;
  } else {
    const cmdText = l2[j];
    const inCmd2 = [...new Set((cmdText.match(/<[^>\s]{1,24}>/g) || []))].sort();
    const warn2 = l2.slice(j, j + 4).join(" ");
    const m2 = /没填：`([^`]*(?:`、`[^`]*)*)`/.exec(warn2);
    const declared2 = m2 ? [...new Set(m2[1].split("`、`"))].sort() : [];
    if (inCmd2.length === 0) templateCaseOk = 0;                      // 模板用例必须真有占位符，否则是空转
    else if (JSON.stringify(inCmd2) !== JSON.stringify(declared2)) templateCaseOk = 0;
    /* 有依据可填却留空的，才是缺陷：资产 IP 在库、凭据也登记了，
       <host> 与 <user>/<pass> 就该被填进去。留着占位符等于让读者手工补已知信息。 */
    else if (cmdText.includes("<host>")) templateCaseOk = 0;
    else if (!cmdText.includes("root") || !cmdText.includes("P@ssw0rd")) templateCaseOk = 0;
  }
}

/* 用例 3：target 完全为空（只有 asset_id）时，host 必须从**资产 IP** 回落。
   为什么单列：记分时常只给 asset_id（批量动作、从漏洞反查），target 是空的。
   不回落到资产 IP，模板里 <host> 就永远填不上，读者拿到的是一条连主机都没指明的命令。
   实测验证过这条回落是真的被依赖（漏洞无 target 时，撤掉回落则 <host> 留在原地）。 */
let assetFallbackOk = 1;
{
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-fb-"));
  const s3 = new RedteamStore(tmp3);
  const e3 = s3.openEngagement("回落用例", "203.0.113.0/24").id;
  s3.importBundle(e3, { scan: { tool: "gate", argv: [] }, assets: [{ ip: "203.0.113.58", state: "live", provenance: "passive", tool: "gate" }] });
  const a3 = s3.listAssets(e3, { ip: "203.0.113.58", limit: 1 })?.items?.[0]?.id;
  s3.addVuln(e3, { asset_id: a3, title: "SQLi", severity: "high", evidence: "x" });   // 无 target
  const v3 = (s3.listVulns(e3, {})?.items || [])[0]?.id;
  s3.addCredential(e3, { asset_id: a3, host: "203.0.113.58", username: "root", secret_type: "password", secret_value: "P@ssw0rd", privilege: "admin", source: "gate", tool: "gate" });
  const p3 = (s3.listScorePoints(e3, {})?.items || []).find((x) => String(x.code) === "db-credential");
  s3.addScoreHit(e3, { point_id: p3.id, evidence: "SQL注入拿库", vuln_id: v3, asset_id: a3 });
  const l3 = String(s3.scoreReport(e3, {}).markdown || "").split("\n");
  const k = l3.findIndex((x) => x.includes("**复现方式**"));
  if (k < 0 || !l3[k].includes("203.0.113.58")) assetFallbackOk = 0;
}

const checks = [
  ["有计分条目", s.count >= 1],
  ["有得分", (s.points || 0) > 0],
  ["有复现步骤", s.withSteps >= 1],
  ["有复现命令", s.withCommands >= 1],
  ["报告完整", s.incomplete === 0],
  ["复现索引有目标（不是空 ``）", emptyTargetRows === 0],
  ["正文占位符与提示同源", placeholderMismatch === 0],
  ["模板分支：占位符与提示同源", templateCaseOk === 1],
  ["无 target 时 host 从资产 IP 回落", assetFallbackOk === 1],
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