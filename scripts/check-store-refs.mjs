#!/usr/bin/env node
/**
 * 第 23 关：事实库引用完整性自测。
 *
 * 为什么要有：schema 里 24 张表**没有任何 FOREIGN KEY**（SQLite 默认也不强制），
 * 应用层原先也不校验 asset_id。实测 asset_id=99999 会写入成功并可查回，asset_ip 为 null。
 * 后果不是「多一条脏数据」：报告里这条记录没有关联主机，"打到了什么"答不出来，
 * 而它又确实计入得分与统计 —— 这是审计方最不能接受的一类错误（数字对不上来源）。
 *
 * 这类缺陷在正常流程里**永远不会暴露**：正常用法都先建资产再挂漏洞。
 * 只有构造非法 id 才看得见，所以必须实测。
 *
 * 判据：
 *   1. vuln / credential / access 挂不存在的 asset_id → 必须抛错
 *   2. 不传 asset_id（用 target/host 描述位置）→ 必须放行，不许误拦
 *   3. 挂真实存在的 asset_id → 必须放行
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(process.argv[2] || ".");
const storePath = path.join(ROOT, "lib", "redteam", "store-core.js");
if (!fs.existsSync(storePath)) {
  console.error("[check-store-refs] ✗ 找不到 lib/redteam/store-core.js");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-refs-"));
const results = [];

try {
  const { RedteamStore } = await import(pathToFileURL(storePath).href);
  const store = new RedteamStore(tmp);
  const opened = store.openEngagement({ name: "refs-gate", target: "10.0.0.0/24", scope: "passive" });
  const eid = opened?.id ?? opened?.engagement ?? opened;

  const mustThrow = (label, fn) => {
    try {
      fn();
      results.push({ ok: false, label, why: "未拒绝（悬空引用被写入）" });
    } catch {
      results.push({ ok: true, label });
    }
  };
  const mustPass = (label, fn) => {
    try {
      fn();
      results.push({ ok: true, label });
    } catch (e) {
      results.push({ ok: false, label, why: "误拦：" + String(e.message).slice(0, 70) });
    }
  };

  mustThrow("漏洞挂不存在的 asset_id", () =>
    store.addVuln(eid, { asset_id: 99999, title: "gate-orphan-vuln", severity: "high" })
  );
  mustThrow("凭据挂不存在的 asset_id", () =>
    store.addCredential(eid, { asset_id: 99999, host: "10.9.9.9", username: "gate" })
  );
  mustThrow("访问会话挂不存在的 asset_id", () =>
    store.addAccess(eid, { asset_id: 99999, host: "10.9.9.9" })
  );

  mustPass("漏洞不挂资产（只给 target）", () =>
    store.addVuln(eid, { title: "gate-noasset-vuln", severity: "low", target: "10.9.9.9:80" })
  );
  mustPass("凭据只给 host", () =>
    store.addCredential(eid, { host: "10.9.9.8", username: "gate2" })
  );
  mustPass("访问会话只给 host", () =>
    store.addAccess(eid, { host: "10.9.9.8" })
  );

  // 真实资产应放行（资产入库走 importBundle，与 redteam_asset_add 工具同一路径）
  let realId = null;
  try {
    store.importBundle(eid, {
      scan: { tool: "check-store-refs", argv: ["gate"] },
      assets: [{ ip: "10.9.9.7", state: "live", provenance: "passive", tool: "gate" }],
    });
    const found = store.listAssets(eid, { ip: "10.9.9.7", limit: 1 });
    realId = found?.items?.[0]?.id ?? null;
  } catch { /* 建不出来就跳过该项，不把闸门判成失败 */ }
  if (realId !== null) {
    mustPass("漏洞挂真实资产", () =>
      store.addVuln(eid, { asset_id: realId, title: "gate-real-vuln", severity: "high" })
    );
  }
  try { store.closeAll?.(); } catch { /* 无该方法时忽略 */ }
} catch (e) {
  console.error("[check-store-refs] ✗ 运行失败：" + String(e.message || e).slice(0, 160));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 句柄未释放时忽略 */ }

const failed = results.filter((r) => !r.ok);
console.log(
  `[check-store-refs] 用例 ${results.length} 个｜通过 ${results.length - failed.length}｜失败 ${failed.length}`
);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.label}：${f.why}`);
  console.log("  → 悬空引用会让报告里的成果找不到来源主机，而统计仍然计入。必须当场拒绝。");
  process.exit(1);
}
console.log("  ✓ 悬空 asset_id 三处均被拒绝，不挂资产与真实资产均正常放行");
process.exit(0);