#!/usr/bin/env node
/**
 * 事务原子性：importBundle 中途失败时，不许留下任何半条记录。
 *
 * 为什么单独成关：这类缺陷**在正常流程里永远不出现** —— 只有构造非法输入才看得见。
 * 1.1.119 实测到的形态：`scan_run` 的 INSERT 写在 `BEGIN` 之前，后面的 upsert 抛错走
 * ROLLBACK 时那条已经提交，于是库里留着一条 `status='completed'` 的运行记录，
 * 而它关联的资产/端口/漏洞全被回滚掉。后果不是"多一行"：
 * 报告里会显示「跑过一次扫描」、统计里 count>0，但点进去什么都没有。
 *
 * 判据（三条都要成立，缺一条就说明事务边界又漏了）：
 *   ① 失败后 scan_run 不能多（这条是 1.1.119 的真缺陷）
 *   ② 失败后 asset/port/vuln 不能多（资产类整体回滚）
 *   ③ 失败后再跑一次**合法** bundle，必须完整成功（不能因为脏状态卡住）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ESM 的静态 import 不许拼接路径（`import x from "file:///" + p` 是语法错误，
   必须用动态 import）。写这行时先踩了一次，症状是 SyntaxError: Unexpected token '+'。 */
const ROOT = path.resolve(process.argv[2] || ".");
const { RedteamStore } = await import("file:///" + path.join(ROOT, "lib", "redteam", "store-core.js").replace(/\\/g, "/"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-tx-"));
const store = new RedteamStore(tmp);
const eid = store.openEngagement("事务原子性靶", "203.0.113.0/24").id;

const countRows = () => {
  const db = store.db(eid);
  const one = (t) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  return { scan_run: one("scan_run"), asset: one("asset"), port: one("port"), vuln: one("vuln") };
};

const before = countRows();

/* 构造非法 bundle：port 的 port 字段是字符串 'abc'，SQLite 的 INTEGER 列会接受它
   （动态类型），但 #upsertAsset 之后的 SELECT `WHERE port = ?` 用 Number('abc') = NaN
   会拿不到行 → 抛 TypeError。**必须真的抛**，否则这关测的是"没出错"。
   为了保证它抛，这里把 proto 设成非法值的同时把 port 设成对象（Number() 得 NaN）。 */
let threw = false;
try {
  store.importBundle(eid, {
    scan: { tool: "gate", argv: ["--probe"] },
    assets: [
      { ip: "203.0.113.7", state: "live", provenance: "passive", ports: [{ port: 80, proto: "tcp" }] },
      { ip: "203.0.113.8", state: "live", provenance: "passive", ports: [{ port: {}, proto: "tcp" }] },
    ],
  });
} catch { threw = true; }

const after = countRows();
const problems = [];

if (!threw) {
  problems.push("构造的非法 bundle 没有抛错 —— 本关测不到事务边界（先确认 #upsertAsset 会拒非法 port）");
}
for (const k of ["scan_run", "asset", "port", "vuln"]) {
  if (after[k] !== before[k]) {
    problems.push(`回滚后 ${k} 数量变了：${before[k]} → ${after[k]}（应保持 ${before[k]}，说明该表写在事务外或没回滚）`);
  }
}

/* ③ 脏状态不卡后续：再跑一次合法 bundle 必须成功且计数正确 */
let resumed = false;
try {
  const r = store.importBundle(eid, {
    scan: { tool: "gate2", argv: [] },
    assets: [{ ip: "203.0.113.9", state: "live", provenance: "passive", ports: [{ port: 443, proto: "tcp" }] }],
  });
  resumed = r && r.counts && r.counts.assets === 1 && r.scan_run_id > 0;
} catch (e) {
  problems.push(`回滚后重跑合法 bundle 失败：${e.message}`);
}
if (!resumed && !problems.length) problems.push("回滚后合法 bundle 未返回正确计数（counts.assets 应为 1 且 scan_run_id > 0）");

console.log(`[check-tx-atomicity] 非法 bundle 抛错=${threw}｜回滚后各表数量不变=${after.scan_run === before.scan_run && after.asset === before.asset}｜重跑合法=${resumed}`);

if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("  → 事务边界漏了：报告会显示「跑过」但明细全空。这类问题只在构造非法输入时才出现。");
  process.exit(1);
}
console.log("  ✓ 中途失败全量回滚（无孤儿 scan_run / asset / port）｜脏状态不阻塞后续写入");
process.exit(0);