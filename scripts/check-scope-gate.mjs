#!/usr/bin/env node
/**
 * 用途：范围闸自测——把「越界打靶」这条底线变成一道每次都跑的关。
 * 用法：node scripts/check-scope-gate.mjs [--json]
 * 依赖：Node ≥18；纯本地判定 + 一个临时演练库，不联网、不碰真库。
 *
 * 为什么成关：实测缺口——靶标授权 `203.0.113.0/24` 时，落 `198.51.100.9` 的资产与漏洞
 * **都能静默写进去**，一个字提示都没有。开靶标时验了范围、之后每条落库却不验，
 * 等于「门口验票、进场随便走」。红队作业里越界不是技术问题，是事故。
 *
 * 判据分两层：
 *   ① 纯判定单测（checkTarget）——把机制本身钉死：排除项优先、CIDR 必须完全落在授权内、
 *      域名后缀、URL 取 host、判不了即不过、空授权不过。
 *   ② 端到端（真建临时靶标 + 真调 purge_drill）——钉住「拦截真的发生在写入路径上」，
 *      而不只是模块函数正确。**函数对但没接上**是这类改动最常见的假成功。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const asJson = process.argv.includes("--json");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toUrl = (p) => new URL("file:///" + String(p).replace(/\\/g, "/")).href;

const fails = [];
let checks = 0;
const check = (name, ok, detail = "") => { checks += 1; if (!ok) fails.push(`${name}${detail ? "｜" + String(detail).slice(0, 90) : ""}`); };

// ── ① 纯判定单测 ──
const { checkTarget, ipInCidr, cidrInsideCidr } = await import(toUrl(path.join(root, "lib", "redteam", "scope.js")));
const scope = { allow: ["203.0.113.0/24", "*.example.test", "198.51.100.7"], deny: ["203.0.113.66", "10.9.0.0/16", "blocked.example.test"] };
const CASES = [
  ["203.0.113.10", true, "授权网段内 IP"],
  ["203.0.113.0/25", true, "子网完全落在授权内"],
  ["203.0.113.0/23", false, "子网跨出边界"],
  ["198.51.100.9", false, "网段外 IP"],
  ["198.51.100.7", true, "单 IP 授权"],
  ["203.0.113.66", false, "排除项优先（单 IP，同时被 /24 覆盖）"],
  ["api.example.test", true, "域名后缀"],
  ["a.b.example.test", true, "多级子域"],
  ["example.test.evil.com", false, "后缀不算（反向包含）"],
  ["blocked.example.test", false, "排除域名优先（同时被 *.example.test 覆盖）"],
  ["https://api.example.test:8443/x", true, "URL 取 host 去端口"],
  ["not a target!!", false, "无法判定即不过"],
  ["2001:db8::1", false, "IPv6 判不了即拒"],
  ["", false, "空目标"],
];
// 排除**网段**要单独测：它走的是 ipInCidr 分支，与「排除单 IP」不是同一条代码路径。
// 首版没有这条用例，于是「把排除网段判定改坏」的探针**咬不住**（失败 0）——用例没盖到就不算测过。
{
  const r = checkTarget("10.9.1.1", { allow: ["10.0.0.0/8"], deny: ["10.9.0.0/16"] });
  check("排除网段优先（10.9.1.1 在 allow /8 内但被 deny /16 排除）", r.ok === false, `${r.host} → ${r.reason}`);
  const r2 = checkTarget("10.8.1.1", { allow: ["10.0.0.0/8"], deny: ["10.9.0.0/16"] });
  check("排除网段之外仍放行（10.8.1.1）", r2.ok === true, `${r2.host} → ${r2.reason}`);
}
for (const [t, want, why] of CASES) {
  const r = checkTarget(t, scope);
  check(`判定 ${why}`, r.ok === want, `${t} → ${r.ok ? "通过" : "拒绝"}（${r.reason}）`);
}
check("空授权范围必须拒绝", checkTarget("1.2.3.4", {}).ok === false);
check("ipInCidr 基本正确", ipInCidr("10.0.0.5", "10.0.0.0/24") && !ipInCidr("10.0.1.5", "10.0.0.0/24"));
check("cidrInsideCidr 拒绝跨界", cidrInsideCidr("10.0.0.0/25", "10.0.0.0/24") && !cidrInsideCidr("10.0.0.0/23", "10.0.0.0/24"));

// ── ①b 技法与时间窗（第二、三道边界）──
const { techClassOf, checkTechnique, checkAction } = await import(toUrl(path.join(root, "lib", "redteam", "scope.js")));
const NOW = Date.parse("2026-11-11T12:00:00");
const TECHS = [
  ["nuclei-scan", "noisy"], ["dir-bruteforce", "noisy"], ["passive-recon", "passive"],
  ["webshell-toolkit", "exploit"], ["competition-kernel-container-escape", "destructive"],
  ["api-security", "appsec"], ["windows-ad", "specialty"], ["competition-jwt-claim-confusion", "surface"],
  ["nonsense-xyz", "unknown"],
];
for (const [n, want] of TECHS) check(`技法归类 ${n}`, techClassOf(n) === want, `得到 ${techClassOf(n)}`);

check("授权清单空 = 不限制技法", checkTechnique("nuclei-scan", { now: NOW }).ok === true);
check("★ 授权 [passive] 时 noisy 被拒", checkTechnique("nuclei-scan", { authorizedTechniques: ["passive"], now: NOW }).ok === false);
check("授权 [noisy] 时 nuclei-scan 通过", checkTechnique("nuclei-scan", { authorizedTechniques: ["noisy"], now: NOW }).ok === true);
check("授权可写具体技能名", checkTechnique("nuclei-scan", { authorizedTechniques: ["nuclei-scan"], now: NOW }).ok === true);
check("★ 排除 [destructive] 命中即拒", checkTechnique("competition-kernel-container-escape", { excludedTechniques: ["destructive"], now: NOW }).ok === false);
check("★ 排除优先于授权", checkTechnique("nuclei-scan", { authorizedTechniques: ["noisy"], excludedTechniques: ["nuclei-scan"], now: NOW }).ok === false);
check("窗口内通过", checkTechnique("nuclei-scan", { window: { from: "2026-11-11 00:00", to: "2026-11-12 00:00" }, now: NOW }).ok === true);
check("★ 过窗被拒", checkTechnique("nuclei-scan", { window: { to: "2026-11-11 06:00" }, now: NOW }).ok === false);
check("★ 未到起点也拒（提前开工同样是区间外）", checkTechnique("nuclei-scan", { window: { from: "2026-11-11 18:00" }, now: NOW }).ok === false);
check("三边界：目标外先报", checkAction({ targets: ["198.51.100.9"], technique: "nuclei-scan", scope: { allow: ["203.0.113.0/24"] }, now: NOW }).layer === "target");
check("三边界：目标内技法外报技法", checkAction({ targets: ["203.0.113.5"], technique: "webshell-toolkit", scope: { allow: ["203.0.113.0/24"], authorizedTechniques: ["noisy"] }, now: NOW }).layer === "technique");
check("三边界：全通过", checkAction({ targets: ["203.0.113.5"], technique: "nuclei-scan", scope: { allow: ["203.0.113.0/24"], authorizedTechniques: ["noisy"] }, now: NOW }).ok === true);

// ── ② 端到端：拦截真的发生在写入路径上 ──
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "scopegate-"));
const prevHome = process.env.REDTEAM_HOME;
process.env.REDTEAM_HOME = tmpHome;
try {
  const { buildModelTools } = await import(toUrl(path.join(root, "lib", "model-tools.js")));
  const core = await import(toUrl(path.join(root, "lib", "core.js")));
  const rules = await import(toUrl(path.join(root, "lib", "rules.js")));
  const hostctl = await import(toUrl(path.join(root, "lib", "host.js")));
  const updater = await import(toUrl(path.join(root, "lib", "update.js")));
  const tools = buildModelTools({ core, rules, hostctl, updater, rejectIfNeedPrompt: () => null });
  const drill = tools.find((t) => t.name === "purge_drill");

  const opened = await drill.execute({ op: "open", name: "scopegate", target: "203.0.113.0/24" });
  check("临时靶标已建立", /已建靶/.test(opened.text), opened.text.slice(0, 60));

  const inside = await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.10", target: "203.0.113.10" });
  check("范围内目标放行", /已写入/.test(inside.text) && !/范围闸拦下/.test(inside.text), inside.text.slice(0, 70));

  const outside = await drill.execute({ op: "entity_add", entity: "asset", name: "198.51.100.9", target: "198.51.100.9" });
  check("★ 范围外目标被拦下", /范围闸拦下/.test(outside.text), outside.text.slice(0, 80));

  const outsideVuln = await drill.execute({ op: "entity_add", entity: "vuln", name: "越界", target: "198.51.100.9", text: "p" });
  check("★ 范围外漏洞被拦下", /范围闸拦下/.test(outsideVuln.text), outsideVuln.text.slice(0, 80));

  const outsideUrl = await drill.execute({ op: "entity_add", entity: "vuln", name: "越界URL", target: "https://evil.example.com/x", text: "p" });
  check("★ 范围外 URL 被拦下", /范围闸拦下/.test(outsideUrl.text), outsideUrl.text.slice(0, 80));

  // asset 支持批量（target 逗号分隔）：合法的批量不该被误拦，其中一个越界则整条拦下
  const batchOk = await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.20, 203.0.113.21", target: "203.0.113.20, 203.0.113.21" });
  check("合法的批量目标放行（不应误拦）", !/范围闸拦下/.test(batchOk.text), batchOk.text.slice(0, 80));
  const batchBad = await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.30, 198.51.100.99", target: "203.0.113.30, 198.51.100.99" });
  check("★ 批量里一个越界就整条拦下", /范围闸拦下/.test(batchBad.text), batchBad.text.slice(0, 90));
  const insideUrl = await drill.execute({ op: "entity_add", entity: "vuln", name: "正常URL", target: "http://203.0.113.20/a", text: "p" });
  check("范围内 URL 放行", /已写入/.test(insideUrl.text) && !/范围闸拦下/.test(insideUrl.text), insideUrl.text.slice(0, 70));

  // 技法闸 + 时间窗端到端：开一个「只授权 noisy、排除 destructive、窗口已过」的靶标
  const techOpen = await drill.execute({
    op: "open", name: "scopegate-tech", target: "203.0.113.0/24",
    // 参数是 scope 串（k=v 逗号分隔）——四个独立参数会顶破工具面预算，合并后仍表达同样三件事
    scope: "tech=noisy,passive,deny=destructive,from=2020-01-01T00:00,to=2020-01-02T00:00",
  });
  check("技法/窗口靶标已建立", /已建靶/.test(techOpen.text), techOpen.text.slice(0, 60));

  const techOk = await drill.execute({ op: "chain_add", stage: "recon", tool: "nuclei-scan", text: "窗口外" });
  check("★ 过窗时 chain_add 被拦", /技法闸拦下/.test(techOk.text) && /已过授权窗口/.test(techOk.text), techOk.text.slice(0, 90));

  // 换一个不限时间的靶标，验技法
  await drill.execute({ op: "open", name: "scopegate-tech2", target: "203.0.113.0/24", scope: "tech=noisy,passive,deny=destructive" });
  const tNoisy = await drill.execute({ op: "chain_add", stage: "recon", tool: "nuclei-scan", text: "扫一遍" });
  check("授权内手法 chain_add 放行", /已写入/.test(tNoisy.text) && !/技法闸拦下/.test(tNoisy.text), tNoisy.text.slice(0, 80));
  const tExploit = await drill.execute({ op: "chain_add", stage: "exploit", tool: "webshell-toolkit", text: "落马" });
  check("★ 未授权手法 chain_add 被拦", /技法闸拦下/.test(tExploit.text) && /未被授权/.test(tExploit.text), tExploit.text.slice(0, 90));
  const tDestructive = await drill.execute({ op: "chain_add", stage: "exploit", tool: "competition-kernel-container-escape", text: "逃逸" });
  check("★ 排除手法被拦（排除优先）", /技法闸拦下/.test(tDestructive.text) && /被排除/.test(tDestructive.text), tDestructive.text.slice(0, 90));
} catch (e) {
  check("端到端执行", false, String((e && e.message) || e).slice(0, 100));
} finally {
  if (prevHome === undefined) delete process.env.REDTEAM_HOME; else process.env.REDTEAM_HOME = prevHome;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 临时目录删不掉不影响判定 */ }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ checks, fails }, null, 1) + "\n");
} else {
  console.log(`范围闸自测：共 ${checks} 项（判定 + 端到端）｜失败 ${fails.length}`);
  for (const f of fails.slice(0, 6)) console.log(`  ✗ ${f}`);
  if (!fails.length) console.log("  越界目标一律拦下、范围内放行 ✓");
}
process.exit(fails.length ? 1 : 0);
