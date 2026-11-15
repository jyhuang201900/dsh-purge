#!/usr/bin/env node
/**
 * 用途：为 skills/redteam 的技能建「链路层」——索引 + 关系表 + 角色档案，产物落 lib/generated/。
 * 用法：node scripts/build-skill-graph.mjs [--dry] [--check]
 *   --dry    只算不写
 *   --check  只校验（有索引但不重写，用于 verify 挂节）
 *
 * 为什么要它：第 106 轮实测——114 个技能里 **72 个零入边、66 个谁也不引用、41 个（全部 competition-*）
 * 两层路由都没点名**。技能散落成 .md，模型加载一个技能后不知道上游是谁、下游交给谁、结果落到哪个库，
 * 于是「有 114 个技能」和「只有几个会被用到」变成同一件事。本脚本把技能从「文件集合」变成「链路」。
 *
 * 参考 dsh-pentester 的成熟做法（MIT）：它用 skill-search-index.json（每个技能 14 维元数据）+
 * relations（895 条 source/target/relationship）+ agents/<role>/profile.yml（角色挂技能）三层组织 1011 个技能。
 * 本脚本按同一架构实现，但**只保留我能维护的维度**，不搬它的字段堆。
 *
 * 产物（都在 lib/generated/，不占注入预算）：
 *   skills-index.json     每个技能的 stage/role/domain/target/upstream/downstream/related/records
 *   skills-relations.json {source,target,relationship} 关系表（next / complementary / specializes）
 *   skills-agents.json    角色 → 技能档案（供预设与文档引用）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const dry = process.argv.includes("--dry");
const root = process.cwd();
const SKILLS = path.join(root, "skills", "redteam");
const OUT = path.join(root, "lib", "generated");

/** 阶段定义（与注入正文的五阶段一致） */
const STAGES = {
  "1": "信息收集",
  "2": "资产梳理",
  "3": "漏洞发现",
  "4": "漏洞利用",
  "5": "内网渗透",
  flow: "流程/编排",
  surface: "攻击面专项（按靶子面选）",
};

/** 角色定义（与预设的六个角色一致；每角色给出它该用的技能前缀/关键词规则） */
const ROLES = {
  recon: { name: "信息收集", stage: "1" },
  assess: { name: "资产梳理", stage: "2" },
  "vuln-scan": { name: "漏洞发现", stage: "3" },
  exploit: { name: "漏洞利用", stage: "4" },
  internal: { name: "内网渗透", stage: "5" },
  flow: { name: "流程/编排", stage: "flow" },
  aux: { name: "辅助（浏览器桥 / 代理池）", stage: "flow" },
};

/* ── 1) 阶段归属：前缀/关键词规则（顺序敏感，先命中先用） ── */
const STAGE_RULES = [
  [/^(fofa-recon|passive-recon|recon-pipeline|active-scan|subdomain-bruteforce|social-engineering|industrial-protocol-recon)$/, "1", "recon"],
  [/^(web-fingerprint|asset-correlation)$/, "2", "assess"],
  [/^(dir-bruteforce|nuclei-scan|unauth-exploit|credential-attack|injection-payloads|web-vuln-payloads|waf-bypass|http-smuggling|graphql-testing|race-conditions|oob-verification|database-security|email-security|llm-security|ai-infra-attack|cn-oa-exploit)$/, "3", "vuln-scan"],
  [/^(webshell-toolkit|shell-handler|vps-reverse-shell|privesc-persistence|secdev-boundary|iot-iiot-netdev)$/, "4", "exploit"],
  [/^(gogo-intranet|fscan-intranet|netexec-scan|lateral-movement|windows-ad|identity-federation|cloud-k8s|ot-ics|plc-controller-attack|scada-hmi-attack|c2-framework-ops|edr-bypass-re|threat-hunting|wifi-wireless|hardware-security|radio-sdr)$/, "5", "internal"],
  [/^(suo5-tunnel|chisel-tunnel|frp-tunnel)$/, "4", "exploit"],
  [/^(attack-chain|pentest-tools|case-review|ctf-sandbox|ctf-sandbox-orchestrator|redteam-setup)$/, "flow", "flow"],
  /* 验证层三技能：**跨阶段**，不是某一阶段的专属。
     verification-discipline 在每个阶段收尾都用（证明打中了）；
     detection-pairing 在选手法时用（评估响度）；
     attack-traceability 在规划与交付时用（定坐标、算覆盖度）。
     挂到 flow 角色（编排/交付）而不是某个攻击阶段——挂在攻击阶段会让
     模型以为「打完才用」，实际它们应该在**打之前和打之后都用**。 */
  [/^(verification-discipline|detection-pairing|attack-traceability)$/, "flow", "flow"],
  [/^(browser-automation|kimi-webbridge|cn-proxy-pool)$/, "flow", "aux"],
  [/^(reverse-engineering|ida-reverse|ghidra-reverse|radare2|binary-diff|patch-diff-exploit|pwn-chain|go-rust-reverse|dotnet-reverse|js-reverse|browser-extension-reverse|thick-client|protocol-reverse|firmware-pentest|apk-reverse|mobile-reverse|mobile-app-assessment)$/, "4", "exploit"],
  [/^(malware-analysis|digital-forensics|supply-chain-security|api-security|code-audit)$/, "3", "vuln-scan"],
  [/^competition-/, "surface", null],
];

/** 攻击面专项（competition-*）按靶子面归到主导阶段：AD/凭据→5，云容器→5，Web/协议→3，客户端→4，取证→3，架构→3 */
const SURFACE_STAGE = {
  "competition-ad-certificate-abuse": "5", "competition-kerberos-delegation": "5", "competition-dpapi-credential-chain": "5",
  "competition-lsass-ticket-material": "5", "competition-relay-coercion-chain": "5", "competition-windows-pivot": "5",
  "competition-identity-windows": "5", "competition-linux-credential-pivot": "5", "competition-mailbox-abuse": "5",
  "competition-k8s-control-plane": "5", "competition-container-runtime": "5", "competition-kernel-container-escape": "5",
  "competition-cloud-metadata-path": "5", "competition-ssrf-metadata-pivot": "5", "competition-agent-cloud": "5",
  "competition-request-normalization-smuggling": "3", "competition-jwt-claim-confusion": "3", "competition-oauth-oidc-chain": "3",
  "competition-graphql-rpc-drift": "3", "competition-race-condition-state-drift": "3", "competition-template-render-path": "3",
  "competition-websocket-runtime": "3", "competition-web-runtime": "3", "competition-runtime-routing": "3",
  "competition-file-parser-chain": "3", "competition-queue-worker-drift": "3", "competition-browser-persistence": "3",
  "competition-bundle-sourcemap-recovery": "3", "competition-supply-chain": "3", "competition-prompt-injection": "3",
  "competition-pcap-protocol": "3", "competition-custom-protocol-replay": "3", "competition-forensic-timeline": "3",
  "competition-stego-media": "3", "competition-malware-config": "3", "competition-zip-archive": "3",
  "competition-android-hooking": "4", "competition-ios-runtime": "4", "competition-crypto-mobile": "4",
  "competition-firmware-layout": "4", "competition-reverse-pwn": "4",
};

/** 2) 主干链路：手工指定的 upstream → downstream（这是「打通」的核心，不能靠猜） */
const TRUNK = {
  "fofa-recon": { down: ["asset-correlation", "web-fingerprint"] },
  "passive-recon": { down: ["fofa-recon", "recon-pipeline"] },
  "recon-pipeline": { up: ["fofa-recon"], down: ["web-fingerprint", "active-scan"] },
  "active-scan": { up: ["recon-pipeline"], down: ["web-fingerprint", "nuclei-scan"] },
  "subdomain-bruteforce": { up: ["passive-recon"], down: ["active-scan"] },
  /* 社工钓鱼：入口是「人」而不是服务。上游必须是画像（pretext 靠画像质量决定），
     下游分两路 —— 拿到凭据走 lateral-movement，拿到 shell 走 shell-handler。 */
  "social-engineering": { up: ["passive-recon", "email-security"], down: ["lateral-movement", "shell-handler", "identity-federation"] },
  "web-fingerprint": { up: ["recon-pipeline", "active-scan"], down: ["asset-correlation", "dir-bruteforce", "nuclei-scan", "cn-oa-exploit", "ai-infra-attack"] },
  "asset-correlation": { up: ["fofa-recon", "web-fingerprint"], down: ["dir-bruteforce", "nuclei-scan"] },
  "dir-bruteforce": { up: ["web-fingerprint", "asset-correlation"], down: ["nuclei-scan", "unauth-exploit"] },
  "nuclei-scan": { up: ["dir-bruteforce", "asset-correlation"], down: ["injection-payloads", "web-vuln-payloads", "unauth-exploit", "cn-oa-exploit", "ai-infra-attack"] },
  "unauth-exploit": { up: ["dir-bruteforce", "nuclei-scan"], down: ["webshell-toolkit", "shell-handler"] },
  "credential-attack": { up: ["nuclei-scan", "netexec-scan"], down: ["netexec-scan", "lateral-movement"] },
  "injection-payloads": { up: ["nuclei-scan"], down: ["webshell-toolkit", "oob-verification"] },
  "web-vuln-payloads": { up: ["nuclei-scan"], down: ["webshell-toolkit", "thick-client"] },
  "waf-bypass": { up: ["nuclei-scan", "http-smuggling"], down: ["injection-payloads", "web-vuln-payloads"] },
  "http-smuggling": { up: ["nuclei-scan"], down: ["waf-bypass", "unauth-exploit"] },
  "graphql-testing": { up: ["web-fingerprint"], down: ["api-security", "injection-payloads"] },
  "race-conditions": { up: ["nuclei-scan"], down: ["api-security"] },
  "api-security": { up: ["graphql-testing", "web-fingerprint"], down: ["code-audit", "injection-payloads"] },
  "code-audit": { up: ["api-security", "supply-chain-security"], down: ["injection-payloads", "webshell-toolkit"] },
  "supply-chain-security": { up: ["code-audit"], down: ["code-audit"] },
  "oob-verification": { up: ["injection-payloads", "web-vuln-payloads"], down: ["webshell-toolkit"] },
  "webshell-toolkit": { up: ["injection-payloads", "unauth-exploit", "code-audit"], down: ["privesc-persistence", "suo5-tunnel"] },
  "shell-handler": { up: ["unauth-exploit", "web-vuln-payloads"], down: ["vps-reverse-shell", "privesc-persistence"] },
  "vps-reverse-shell": { up: ["shell-handler"], down: ["privesc-persistence", "suo5-tunnel"] },
  "privesc-persistence": { up: ["webshell-toolkit", "shell-handler"], down: ["suo5-tunnel", "credential-attack"] },
  "suo5-tunnel": { up: ["privesc-persistence"], down: ["gogo-intranet", "fscan-intranet"] },
  "chisel-tunnel": { up: ["privesc-persistence"], down: ["gogo-intranet", "fscan-intranet"] },
  "frp-tunnel": { up: ["privesc-persistence"], down: ["gogo-intranet", "fscan-intranet"] },
  "gogo-intranet": { up: ["suo5-tunnel", "chisel-tunnel"], down: ["fscan-intranet", "netexec-scan"] },
  "fscan-intranet": { up: ["gogo-intranet"], down: ["credential-attack", "netexec-scan"] },
  "netexec-scan": { up: ["fscan-intranet", "credential-attack"], down: ["lateral-movement", "windows-ad"] },
  "lateral-movement": { up: ["netexec-scan"], down: ["windows-ad", "identity-federation"] },
  "windows-ad": { up: ["lateral-movement", "netexec-scan"], down: ["identity-federation", "edr-bypass-re", "competition-kerberos-delegation"] },
  "identity-federation": { up: ["windows-ad"], down: ["cloud-k8s", "competition-oauth-oidc-chain"] },
  "cloud-k8s": { up: ["identity-federation"], down: ["competition-k8s-control-plane", "competition-cloud-metadata-path"] },
  /* C2：拿到 shell 之后才需要。上游是「有一次性 shell」，下游是「在 shell 里做横向」。 */
  "c2-framework-ops": { up: ["shell-handler", "vps-reverse-shell", "edr-bypass-re"], down: ["lateral-movement", "credential-attack", "suo5-tunnel"] },
  "edr-bypass-re": { up: ["privesc-persistence", "windows-ad", "c2-framework-ops"], down: ["threat-hunting", "lateral-movement"] },
  "threat-hunting": { up: ["edr-bypass-re"], down: ["digital-forensics"] },
  "digital-forensics": { up: ["threat-hunting", "malware-analysis"], down: ["case-review"] },
  "malware-analysis": { up: ["digital-forensics"], down: ["case-review", "competition-malware-config"] },
  /* OT 四技能：总纲（ot-ics）→ 侦察（被动）→ 两个专项（控制器 / 监督层）。
     顺序不能反：先被动看清有什么，再决定碰哪一层。 */
  "ot-ics": { up: ["fscan-intranet"], down: ["industrial-protocol-recon", "iot-iiot-netdev", "competition-kernel-container-escape"] },
  "industrial-protocol-recon": { up: ["fscan-intranet", "ot-ics"], down: ["plc-controller-attack", "scada-hmi-attack"] },
  "plc-controller-attack": { up: ["industrial-protocol-recon"], down: ["scada-hmi-attack", "iot-iiot-netdev"] },
  "scada-hmi-attack": { up: ["industrial-protocol-recon", "plc-controller-attack"], down: ["lateral-movement", "digital-forensics"] },
  "iot-iiot-netdev": { up: ["ot-ics"], down: ["firmware-pentest"] },
  "firmware-pentest": { up: ["iot-iiot-netdev"], down: ["hardware-security", "competition-firmware-layout"] },
  "hardware-security": { up: ["firmware-pentest"], down: ["radio-sdr"] },
  "radio-sdr": { up: ["hardware-security"], down: [] },
  "wifi-wireless": { up: ["recon-pipeline"], down: ["netexec-scan"] },
  "reverse-engineering": { up: ["binary-diff"], down: ["ida-reverse", "ghidra-reverse", "radare2"] },
  "ida-reverse": { up: ["reverse-engineering"], down: ["patch-diff-exploit", "pwn-chain"] },
  "ghidra-reverse": { up: ["reverse-engineering"], down: ["patch-diff-exploit"] },
  "radare2": { up: ["reverse-engineering"], down: ["pwn-chain"] },
  "binary-diff": { up: ["patch-diff-exploit"], down: ["reverse-engineering"] },
  "patch-diff-exploit": { up: ["binary-diff", "ida-reverse"], down: ["pwn-chain"] },
  "pwn-chain": { up: ["ida-reverse", "radare2"], down: ["competition-reverse-pwn"] },
  "js-reverse": { up: ["web-fingerprint"], down: ["browser-extension-reverse", "web-vuln-payloads"] },
  "browser-extension-reverse": { up: ["js-reverse"], down: ["thick-client"] },
  /* 移动端：逆向本体（apk-reverse / mobile-reverse）→ 完整测试链（环境+抓包+接口提取）→ Web 侧打点。 */
  "mobile-app-assessment": { up: ["apk-reverse", "mobile-reverse"], down: ["api-security", "injection-payloads", "protocol-reverse"] },
  "apk-reverse": { up: ["mobile-reverse"], down: ["competition-android-hooking"] },
  "mobile-reverse": { up: [], down: ["apk-reverse", "competition-ios-runtime"] },
  "dotnet-reverse": { up: ["reverse-engineering"], down: ["thick-client"] },
  "protocol-reverse": { up: ["reverse-engineering"], down: ["competition-custom-protocol-replay"] },
  "thick-client": { up: ["dotnet-reverse", "js-reverse"], down: ["protocol-reverse"] },
  "secdev-boundary": { up: ["nuclei-scan"], down: ["webshell-toolkit", "credential-attack"] },
  "cn-oa-exploit": { up: ["web-fingerprint", "nuclei-scan"], down: ["webshell-toolkit", "credential-attack"] },
  "ai-infra-attack": { up: ["web-fingerprint", "nuclei-scan"], down: ["credential-attack", "webshell-toolkit", "llm-security"] },
  "database-security": { up: ["api-security"], down: ["credential-attack"] },
  "email-security": { up: ["recon-pipeline"], down: ["credential-attack"] },
  "llm-security": { up: ["api-security"], down: ["competition-prompt-injection"] },
  "attack-chain": { up: [], down: ["recon-pipeline", "attack-traceability"] },
  "ctf-sandbox-orchestrator": { up: [], down: [] },
  "ctf-sandbox": { up: [], down: ["ctf-sandbox-orchestrator"] },
  "case-review": { up: ["digital-forensics", "malware-analysis", "verification-discipline"], down: [] },
  /* 验证层三技能是「横切」的：不属于某一阶段，而是贯穿「证明 / 评估 / 定位」三件事。
     链路设计：oob-verification（判定手段）→ verification-discipline（证明成立）
     → detection-pairing（评估响度）→ attack-traceability（钉坐标）→ case-review（复盘）。 */
  "verification-discipline": { up: ["oob-verification"], down: ["detection-pairing", "case-review"] },
  "detection-pairing": { up: ["verification-discipline"], down: ["attack-traceability"] },
  "attack-traceability": { up: ["attack-chain", "detection-pairing"], down: ["case-review"] },
  "redteam-setup": { up: [], down: ["recon-pipeline"] },
  "pentest-tools": { up: [], down: ["recon-pipeline", "nuclei-scan"] },
  "browser-automation": { up: ["web-fingerprint"], down: ["js-reverse"] },
  "kimi-webbridge": { up: ["web-fingerprint"], down: ["browser-automation"] },
  "cn-proxy-pool": { up: ["recon-pipeline"], down: ["active-scan", "dir-bruteforce"] },
};

/** 演练台合法实体（真值取自 purge_drill 的 entity 参数；写侧） */
const LEDGER_ENTITIES = new Set(["vuln", "credential", "access", "webshell", "tunnel", "http", "shot", "prompt", "scorepoint", "stage", "asset", "poc"]);

/** 技能域：链路用。默认全落到 misc 就等于没分类（第 108 轮实测 57/114 是 misc），所以逐组显式列。 */
const DOMAIN_RULES = [
  [/^(fofa-recon|passive-recon|recon-pipeline|active-scan|subdomain-bruteforce|web-fingerprint|asset-correlation|social-engineering)$/, "recon"],
  [/^(dir-bruteforce|nuclei-scan|unauth-exploit|injection-payloads|web-vuln-payloads|waf-bypass|http-smuggling|graphql-testing|race-conditions|oob-verification|cn-oa-exploit)$/, "web"],
  [/^(credential-attack)$/, "credential"],
  [/^(webshell-toolkit|shell-handler|vps-reverse-shell|privesc-persistence|c2-framework-ops)$/, "payload"],
  [/tunnel$/, "tunnel"],
  [/^(netexec-scan|lateral-movement|fscan-intranet|gogo-intranet)$/, "intranet"],
  [/^(windows-ad|identity-federation)$/, "identity"],
  [/^(cloud-k8s)$/, "cloud"],
  [/^(ot-ics|plc-controller-attack|scada-hmi-attack|industrial-protocol-recon|iot-iiot-netdev|firmware-pentest|hardware-security|radio-sdr|wifi-wireless)$/, "ot-hardware"],
  [/^(apk-reverse|mobile-reverse|mobile-app-assessment)$/, "mobile"],
  [/^(reverse-engineering|ida-reverse|ghidra-reverse|radare2|binary-diff|patch-diff-exploit|pwn-chain|go-rust-reverse|dotnet-reverse|protocol-reverse)$/, "reverse"],
  [/^(js-reverse|browser-extension-reverse|thick-client)$/, "client"],
  [/^(edr-bypass-re|threat-hunting|digital-forensics|malware-analysis)$/, "defense"],
  [/^(api-security|code-audit|database-security|email-security|llm-security|supply-chain-security)$/, "appsec"],
  [/^(ai-infra-attack)$/, "ai"],
  [/^(secdev-boundary)$/, "boundary"],
  [/^(attack-chain|pentest-tools|case-review|ctf-sandbox|ctf-sandbox-orchestrator|redteam-setup|browser-automation|kimi-webbridge|cn-proxy-pool)$/, "flow"],
  [/^competition-/, "surface"],
];

/** 3) 落库工具映射：技能产出该落到哪个演练台实体（值必须 ∈ LEDGER_ENTITIES，否则模型照做就撞空） */
const RECORD_RULES = [
  [/^(fofa-recon|passive-recon|recon-pipeline|active-scan|subdomain-bruteforce|web-fingerprint|asset-correlation|netexec-scan|gogo-intranet|fscan-intranet|industrial-protocol-recon)$/, ["asset"]],
  [/^(dir-bruteforce|nuclei-scan|unauth-exploit|credential-attack|injection-payloads|web-vuln-payloads|waf-bypass|http-smuggling|graphql-testing|race-conditions|oob-verification|api-security|code-audit|database-security|email-security|llm-security|secdev-boundary|iot-iiot-netdev|ai-infra-attack|cn-oa-exploit|plc-controller-attack|scada-hmi-attack|competition-.*)$/, ["vuln"]],
  [/^(credential-attack|privesc-persistence|netexec-scan|lateral-movement|windows-ad|identity-federation|social-engineering)$/, ["credential", "access"]],
  [/^(webshell-toolkit|shell-handler|vps-reverse-shell)$/, ["webshell", "access"]],
  /* C2 产出的是「持续控制通道」，演练台的对应实体是 access（不是 tunnel —— tunnel 是网络层转发）。 */
  [/^(c2-framework-ops)$/, ["access"]],
  [/^(suo5-tunnel|chisel-tunnel|frp-tunnel)$/, ["tunnel"]],
  // 攻击链/复盘产出的是「阶段推进记录」，演练台的对应实体是 stage（不是 chain——没有 chain 这个实体）
  [/^(attack-chain|case-review)$/, ["stage"]],
];

/* ── 构建 ── */
const problems = [];
const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
const skills = [];
const skillNames = new Set(files.map((f) => f.replace(/\.md$/, "")));

for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(SKILLS, f), "utf8");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const head = fm ? fm[1] : "";
  const desc = (/^description:\s*(.+)$/m.exec(head) || [])[1] || "";
  const when = (/^whenToUse:\s*(.+)$/m.exec(head) || [])[1] || "";

  // 阶段与角色
  let stage = "surface", role = null;
  for (const [re, st, rl] of STAGE_RULES) {
    if (re.test(id)) { stage = st; role = rl; break; }
  }
  if (id.startsWith("competition-")) stage = SURFACE_STAGE[id] || "3";

  // 落库
  const records = [];
  for (const [re, recs] of RECORD_RULES) {
    if (re.test(id)) { records.push(...recs); break; }
  }
  const badEntity = records.filter((r) => !LEDGER_ENTITIES.has(r));
  if (badEntity.length) problems.push(`落库实体不存在于演练台: ${id} → ${badEntity.join(", ")}`);

  // 上下游（只保留真实存在的技能名）
  const t = TRUNK[id] || {};
  const up = (t.up || []).filter((x) => skillNames.has(x));
  const down = (t.down || []).filter((x) => skillNames.has(x));

  // 相关：按域分组（同域同阶段即互补）；域由 DOMAIN_RULES 显式给出，不再靠前缀猜
  let domain = "misc";
  for (const [re, d] of DOMAIN_RULES) { if (re.test(id)) { domain = d; break; } }

  skills.push({
    id, summary: desc.slice(0, 180), whenToUse: when.slice(0, 200),
    stage, stageName: STAGES[stage], role, domain,
    targetTypes: [], records: [...new Set(records)],
    upstream: up, downstream: down,
  });
}

// orchestrator 必须是所有攻击面专项的总入口：否则 41 个 competition-* 只能靠注入正文一行带过，
// 模型加载总入口时看不到它们的存在——第 106 轮实测「41 个两层都没点名」就是这么来的。
const orc = skills.find((s) => s.id === "ctf-sandbox-orchestrator");
if (orc) orc.downstream = skills.filter((s) => s.id.startsWith("competition-")).map((s) => s.id).sort();

// 关系表（去重：TRUNK 里 A→B 与 B 的 up 会重复写，这里按 (source,target,relationship) 归并）
const relations = [];
const relKey = new Set();
const pushRel = (source, target, relationship) => {
  if (source === target) return;
  const k = source + "|" + target + "|" + relationship;
  if (relKey.has(k)) return;
  relKey.add(k);
  relations.push({ source, target, relationship });
};
for (const s of skills) {
  for (const d of s.downstream) pushRel(s.id, d, "next");
  for (const u of s.upstream) pushRel(u, s.id, "next");
}
// 专精关系：competition-* 专精于其主干主题
const SPECIALIZES = [
  ["windows-ad", "competition-ad-certificate-abuse"], ["windows-ad", "competition-kerberos-delegation"],
  ["windows-ad", "competition-lsass-ticket-material"], ["identity-federation", "competition-oauth-oidc-chain"],
  ["cloud-k8s", "competition-k8s-control-plane"], ["cloud-k8s", "competition-cloud-metadata-path"],
  ["api-security", "competition-jwt-claim-confusion"], ["http-smuggling", "competition-request-normalization-smuggling"],
  ["race-conditions", "competition-race-condition-state-drift"], ["reverse-engineering", "competition-reverse-pwn"],
  ["firmware-pentest", "competition-firmware-layout"], ["apk-reverse", "competition-android-hooking"],
  ["mobile-reverse", "competition-ios-runtime"], ["llm-security", "competition-prompt-injection"],
  ["digital-forensics", "competition-forensic-timeline"], ["malware-analysis", "competition-malware-config"],
  ["supply-chain-security", "competition-supply-chain"], ["protocol-reverse", "competition-custom-protocol-replay"],
  ["websocket-runtime", "competition-websocket-runtime"], ["edr-bypass-re", "competition-kernel-container-escape"],
  ["web-fingerprint", "competition-browser-persistence"], ["reverse-engineering", "mobile-reverse"],
  ["windows-ad", "competition-windows-pivot"], ["reverse-engineering", "competition-zip-archive"],
  ["pentest-tools", "attack-chain"], ["case-review", "competition-forensic-timeline"],
  ["api-security", "competition-graphql-rpc-drift"], ["wifi-wireless", "competition-pcap-protocol"],
];
for (const [s, t] of SPECIALIZES) {
  if (skillNames.has(s) && skillNames.has(t)) pushRel(s, t, "specializes");
}
// 互补关系：同域同阶段
const byDomainStage = new Map();
for (const s of skills) {
  const k = s.domain + "/" + s.stage;
  if (!byDomainStage.has(k)) byDomainStage.set(k, []);
  byDomainStage.get(k).push(s.id);
}
for (const [, ids] of byDomainStage) {
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length && j < i + 3; j += 1) {
      pushRel(ids[i], ids[j], "complementary");
    }
  }
}

// 角色档案
// 角色的技能 = 「阶段映射」∪「该角色稿正文里点名的技能」。
// 为什么取并集：角色稿是前几轮手写的散文，里面点名的技能（如 assess 稿里点名
// secdev-boundary / iot-iiot-netdev 讲优先级）与按阶段算出来的不一定重合；
// 只用阶段映射会让生成清单与稿子正文**互相打架**（第 110 轮实测：assess 稿点名 A/B，
// 生成清单却列 C/D）。取并集两边都不矛盾，且更完整。
// 真相直接取自 store-core.js 的 DEFAULT_PROMPTS（不另造中间文件，避免第二份会漂的副本）。
const PROMPTS = await (async () => {
  try {
    // Windows 上不能直接 import("E:\\...")：Node 会把盘符当 URL scheme 报
    // 「Only URLs with a scheme in: file, data, ...」。必须过 pathToFileURL。
    const { pathToFileURL } = await import("node:url");
    const p = pathToFileURL(path.join(root, "lib", "redteam", "store-core.js")).href;
    const m = await import(p);
    return m.DEFAULT_PROMPTS || {};
  } catch (e) {
    console.log(`  ⚠ 读不到 DEFAULT_PROMPTS（${String(e.message).slice(0, 46)}）：角色档案只按阶段映射算`);
    return {};
  }
})();
const proseOf = (role) => String(PROMPTS[role] || "");

const agents = {};
for (const [rid, r] of Object.entries(ROLES)) {
  const byStage = skills.filter((s) => s.role === rid).map((s) => s.id);
  const prose = [...new Set([...proseOf(rid).matchAll(/`([a-z][a-z0-9-]{3,40})`/g)].map((m) => m[1]))]
    .filter((n) => skillNames.has(n));
  const merged = [...new Set([...byStage, ...prose])].sort();
  agents[rid] = { id: rid, name: r.name, stage: r.stage, skills: merged, fromStage: byStage.length, fromProse: prose.length };
}
agents["surface"] = { id: "surface", name: "攻击面专项（由 ctf-sandbox-orchestrator 路由）", stage: "surface", skills: skills.filter((s) => s.id.startsWith("competition-")).map((s) => s.id) };

// 校验
const ids = new Set(skills.map((s) => s.id));
for (const r of relations) {
  if (!ids.has(r.source)) problems.push(`关系源不存在: ${r.source}`);
  if (!ids.has(r.target)) problems.push(`关系目标不存在: ${r.target}`);
  if (r.source === r.target) problems.push(`自环: ${r.source}`);
}
const noStage = skills.filter((s) => !STAGES[s.stage]);
for (const s of noStage) problems.push(`阶段未知: ${s.id}`);
const dupRel = new Set();
for (const r of relations) {
  const k = r.source + "|" + r.target + "|" + r.relationship;
  if (dupRel.has(k)) problems.push(`重复关系: ${k}`);
  dupRel.add(k);
}
const assigned = new Set([...Object.values(agents)].flatMap((a) => a.skills));
const unassigned = skills.filter((s) => !assigned.has(s.id)).map((s) => s.id);

console.log(`  技能 ${skills.length}｜关系 ${relations.length} 条（next ${relations.filter((r) => r.relationship === "next").length} / specializes ${relations.filter((r) => r.relationship === "specializes").length} / complementary ${relations.filter((r) => r.relationship === "complementary").length}）`);
console.log(`  阶段分布: ` + Object.entries(STAGES).map(([k, v]) => `${k}(${skills.filter((s) => s.stage === k).length})`).join(" "));
console.log(`  角色挂载: ` + Object.entries(agents).map(([k, a]) => `${k}(${a.skills.length})`).join(" "));
console.log(`  未被任何角色挂载: ${unassigned.length}${unassigned.length ? "：" + unassigned.slice(0, 8).join(", ") : " ✓"}`);
const zeroIn = skills.filter((s) => !relations.some((r) => r.target === s.id)).map((s) => s.id);
const zeroOut = skills.filter((s) => !relations.some((r) => r.source === s.id)).map((s) => s.id);
console.log(`  零入边 ${zeroIn.length}${zeroIn.length ? "：" + zeroIn.slice(0, 8).join(", ") : " ✓"}｜零出边 ${zeroOut.length}${zeroOut.length ? "：" + zeroOut.slice(0, 6).join(", ") : " ✓"}`);

/* ── 检索索引：让模型按「症状/关键词」找到技能，而不是先猜对名字 ──
 *
 * 为什么要有它：116 个技能、正文 66.6 万字，而 purge_skills 原先只有 id=（精确名）和
 * all=1..5（按阶段列名）。阶段 3 一行要列 42 个名字——技能越多，模型越难从名字里挑中，
 * 「有 116 个技能」和「只有几个会被用到」就成了同一件事（与第 106 轮零入边同源）。
 *
 * 为什么不手写关键词表：技能库还会继续加，手写表每加一个技能就要人记得补，一定会漏。
 * 这里从**现有** frontmatter（description / whenToUse）离线抽取，加技能自动跟上。
 * 产物 skills-search.json 不占注入预算（不进提示词，只在 purge_skills 调用时读）。
 */
const SEARCH_STOP = new Set([
  "本技能", "技能", "使用", "进行", "可以", "需要", "一个", "这个", "以及", "相关", "部分",
  "以下", "说明", "注意", "方法", "步骤", "内容", "情况", "问题", "时候", "目标", "结果",
  "攻击", "测试", "渗透", "常见", "工具", "命令", "示例", "参考", "第一", "第二", "第三",
  "第二发", "链路位置", "本机可执行性", // 生成块的标题，不是检索词
  "the", "and", "for", "with", "this", "that", "from", "into", "your", "you", "use",
]);

/* 中文虚词/连接词：出现在片段首尾就是要剥掉的噪音。
 * 不这么做会切出「与信创系统前」「的启动与用法」这类碎片——它们永远命中不了有用查询，
 * 却会把真正的技能挤到结果后面（同一条正则从长句里切 6 字窗口的必然产物）。 */
const CN_LEAD = /^(?:的|与|和|及|在|对|把|被|为|是|这|那|其|之|用|从|到|将|让|使|有|无|或|再|也|就|都|并|而|则|若|如|先|后|时|按|以|向|由)+/;
const CN_TAIL = /(?:的|与|和|及|在|对|把|被|为|是|这|那|其|之|了|着|过|等|后|前|时|后|中|上|下|内|外|者|地|得)+$/;

const EN_COMMON = new Set([
  "map", "to", "the", "and", "for", "with", "from", "into", "your", "this", "that",
  "reduce", "prove", "trust", "abuse", "chain", "reduce", "decisive", "acceptance",
  "accept", "identify", "step", "goal", "note", "read", "see", "use", "using", "used",
  "what", "when", "where", "which", "how", "why", "who", "make", "made", "take", "taken",
  "must", "should", "could", "would", "will", "can", "may", "might", "need", "needs",
  "keep", "preserve", "collect", "record", "check", "verify", "test", "tests", "testing",
  "base", "basic", "common", "general", "quick", "start", "workflow", "reference",
  "output", "input", "result", "results", "effect", "impact", "risk", "target", "targets",
  "client", "server", "user", "users", "admin", "host", "hosts", "service", "services",
  "surface", "evidence", "proof", "report", "status", "state", "mode", "type", "types",
]);

/** 从一段纯文本里抽「专有名词类」关键词：CVE 号、端口、英文/产品名。质量最高的一档。 */
function extractProper(text) {
  const out = new Set();
  const src = String(text || "");
  // ① CVE / CNVD 编号整串保留（「CVE-2025-3248」是最高价值的检索词）
  for (const m of src.matchAll(/\b(?:CVE|CNVD|CNNVD)-\d{4}-\d{3,7}\b/gi)) out.add(m[0]);
  // ② 端口号（11434 这类是实操里最先想到的词）
  for (const m of src.matchAll(/\b(?:端口\s*)?(\d{2,5})\b/g)) {
    const n = Number(m[1]);
    if (n >= 21 && n <= 65535) out.add(m[1]);
  }
  // ③ 英文/产品名（Ollama、Langflow、Milvus、e-cology 这种都在这条里）
  //    **必须含下划线**：工具名是 redteam_xxx 这种形式，不含下划线会在 redteam 处断开，
  //    于是 redteam_score_report 只剩 "redteam" 进索引——查工具名永远命不中写它用法的技能。
  //    实测：redteam_score_report 的首屏被 competition-container-runtime 占据（它正文里
  //    偶然有 "Report"），真正写它用法的 redteam-setup 不在列表里。
  /* ③ 英文/产品名（Ollama、Langflow、Milvus、e-cology 这种都在这条里）
     必须能量出「这是专有名词」而不是普通英文词。原先判据只有「长度≥2 且不在停用表」，
     于是 surface / authorized / Decisive / Reduce / Map / MUST 这些正文里的普通词
     全进了索引 —— 实测 surface 出现 41 次、bundled_skills 37 次、Map 27 次，
     等于把大批技能绑成一团，撞上就一起冒出来。

     新的正面判据（满足任一条才算专有名词）：
       · 首字母大写且是小写结尾（Ollama、Milvus、Kerberos、BloodHound）
       · 全大写缩写 ≥2 字母（RBCD、ADCS、ETW、AMSI、JWT）
       · 含数字（sha256、base64）
       · 含点或连字符（e-cology、.NET、node.js、k8s-）
     纯小写、无数字、无符号的普通词（surface/authorized/reduce）一律不收。 */
  /* 首字母大写的词里，这些是句子开头的普通英文词，不是专有名词。
     实测被误收的：Map（37 次）、To（26）、Decisive（24）、Reduce（22）、MUST（19）、
     Prove、Acceptance、Trust、Abuse、Chain、Identity — 它们来自英文小标题的祈使句
     （"Prove The Edge"、"Reduce Noise"），全部技能都有，撞上就整片冒出来。
     判据：**首字母大写且长度≥4 且不在常见词表**才算专有名词。
     Kerberos/Milvus/Langflow/BloodHound 都在，Map/To/Trust 都被挡掉。 */
  for (const m of src.matchAll(/\b[A-Za-z][A-Za-z0-9._-]{1,24}\b/g)) {
    const w = m[0];
    if (w.length < 2 || SEARCH_STOP.has(w.toLowerCase())) continue;
    const hasDigit = /\d/.test(w);
    const hasPunct = /[._-]/.test(w);
    const allCaps = /^[A-Z0-9]{2,}$/.test(w);
    const capitalized = /^[A-Z][a-z]/.test(w) && w.length >= 4 && !EN_COMMON.has(w.toLowerCase());
    if (hasDigit || hasPunct || allCaps || capitalized) out.add(w);
  }
  /* ④ 纯小写技术缩略词（jku / jwk / alg / kid / xxe / ssrf / rce / saml）：
     上面四条判据全都漏掉它们 —— 全小写、无数字、无符号、首字母不大写。
     实测代价：`jku`（JWT 头注入的核心参数）就在 references 的两个 H2 标题上，
     但查 `jku` 一直回「没有匹配」。同类还有 `jwk`/`alg`/`kid`/`saml`/`oauth`。
     判据必须窄，否则普通小写词全被收进来（那比漏掉更糟）：
       · 长度恰好 3（技术缩写几乎都是 3 字母）
       · 不在 EN_COMMON / SEARCH_STOP
     调用方只把**标题**传进来（正文里 3 字母小写词多半是代码变量 res/req/buf），
     所以这条天然被限定在「人写的短语」范围内。 */
  for (const m of src.matchAll(/(?:^|[\s(`（、,;:/])([a-z][a-z0-9]{2})(?=$|[\s)`）、,;:/])/g)) {
    const w = m[1];
    if (EN_COMMON.has(w) || SEARCH_STOP.has(w)) continue;
    out.add(w);
  }
  // ③b 下划线标识符整体保留（工具名 / 变量名）：单独一条，避免影响上面产品名的匹配
  for (const m of src.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi)) {
    const w = m[0];
    if (w.length >= 5 && w.length <= 40) out.add(w);
  }
  return out;
}

/* 中文噪音：这些是标题里常见的「动词/连接式」片段，切出来像词其实无检索价值。
 * 例：「一台就」「打了就」「稳后猛」「图后枪」——都出自我自己写标题时的口语化短语。
 * 与其逐个加黑名单（永远不全），不如用「必须含名词性汉字」这条正面规则。 */
const CN_NOISE = new Set([
  "一台就", "打了就", "稳后猛", "图后枪", "先判", "判是什么", "认产品", "稳后", "再猛",
  "适用场景", "任务完成自检", "工具一览", "推荐", "可脚本化", "上传后必须验证",
  /* 1.1.123 补：references 标题入索引后，**章节名**也进来了。
     这些词零区分度（每个技能都有「常见坑」「注意事项」），
     留着只会让任何查询都命中一堆同构技能。判据与英文 STRUCTURAL_HEAD 同源。 */
  "落库要求", "输出要求", "判定顺序", "常见误判", "适用范围", "禁止事项", "适用于",
  "编排原则", "行动纪律", "完整流程", "注意事项", "验证清单", "自检清单", "打法顺序",
  "人工复核清单", "怎么用", "怎么证明", "不适用", "纪律", "常见坑", "注意事项",
]);

/* 结构性章节名的**正面判据**：命中即丢。
   为什么用正则而不是继续堆黑名单：章节名有无限种写法（「六条常见提权路」是新的一例），
   但它们的共同形态稳定 —— 「N 条 + 常见/坑/路」「怎么 X」「X 要求/清单/纪律」。
   判据取窄（只在 ≤8 字且整体形态吻合时丢），宁可漏掉几个，不要误删有信息量的词
   （「抓接口清单」「云安全检查清单」是真内容，不能砍）。 */
const CN_HEAD_PATTERN = /^(怎么|如何|为什么|第[一二三四五六七八九十]+|共?[0-9一二三四五六七八九十]+[条个步])|(要求|清单|纪律|注意事项|自检|小结|总结|概览|流程|原则|顺序|回顾|附录|事项)$/;

/* 名词性提示字：一个候选片段里至少要出现一个，否则多半是「打了就」这类动词碎片。
 * 这是正面判据（不是黑名单），新技能里出现同型噪音也能挡住。 */
const CN_NOUN_HINT = /[名平端口服系库台机件数权洞链网码证账令靶面层段点表站牌单书文图型目协议引擎框架平台系统产品漏洞接口服务凭证终端设备数据库主机域名端口]/;

function isGoodCn(s) {
  if (s.length < 2 || s.length > 8) return false;
  if (SEARCH_STOP.has(s) || CN_NOISE.has(s)) return false;
  if (CN_HEAD_PATTERN.test(s)) return false;
  /* 2-4 字的短词直接放行：产品名常常不含任何「名词提示字」（泛微、致远、蓝凌、
     深澜、红队、打点…），靠提示字判据会把最有辨识度的词筛掉。
     5 字以上才要求像个名词短语——长片段是碎句的概率高得多。 */
  if (s.length <= 4) return true;
  return CN_NOUN_HINT.test(s);
}

/** 中文关键词：只从标题取，且必须像「名词短语」而不是动词碎片。 */
function extractCnFromHeadings(headings) {
  const out = new Set();
  for (const h of headings) {
    /* 标题常用「与」「/」「、」串联两三个名词（「端口与指纹速查」），
       先按分隔符拆开，避免整条长标题被长度窗口切掉。 */
    for (const part of String(h).split(/[与和及、/|｜，,。：:（）()\[\]【】“”"'·—]+/)) {
      for (const seg of part.split(/[^\u4e00-\u9fa5]+/)) {
        const s = seg.replace(CN_LEAD, "").replace(CN_TAIL, "");
        if (isGoodCn(s)) out.add(s);
      }
    }
  }
  return out;
}

/** 每个技能一条检索记录：id / stage / keys / why（命中时给模型看的理由） */
/* 同义词**不在索引侧扩张**（这里只留记录，说明为什么不这么做）：
 * 试过「技能里出现触发词就把整组同义词灌进它的 keys」，结果 graphql-testing 正文里提了一次
 * 「横向」（讲横向扩展查询），就被当成内网横向技能——「横向移动」直接把它排到第一。
 * 索引侧扩张让一个词污染一堆技能；查询侧扩张只影响这一次查询，同一件事代价差一个数量级。
 * 同义词表因此搬到了 lib/model-tools.js 的 QUERY_SYNONYMS（查询时展开）。
 * 这里保留一个空实现，是为了让「曾经有过这一层」在代码里留痕，别再被重新发明一遍。 */
function applySynonyms(keys) {
  return [...keys];
}

/* 剥生成块要连**正文**一起剥，不能只剥注释标记。
   原先只做 `.replace(/<!--...-->/g,"")`，生成块的正文原样留下 ——
   于是「本机工具实况」那张表（每个技能都有「表会过期」「命令不会」「复核」
   「sync-tool-status.mjs」）全进了索引，各出现 32 次，等于把 32 个技能绑成一团。
   按标题切段剥离：从这些标题开头，到下一个 `## ` 标题为止，整段丢弃。 */
const GEN_SECTION = /^##\s+(第二发|链路位置|本机可执行性|本机工具实况)/;
function stripGeneratedSections(text) {
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) skipping = GEN_SECTION.test(line);
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

const searchIndex = skills.map((s) => {
  const raw = stripGeneratedSections(
    fs.readFileSync(path.join(SKILLS, s.id + ".md"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  );
  /* 生成块的**小标题**也要排除（正文已由 stripGeneratedSections 剥过，这里防的是
     标题本身残留在 headings 里当关键词）。
     **英文模板标题同样必须剔除。** competition-* 系列从英文上游改写而来，保留着
     `## Quick Start` / `## Workflow` / `## What To Preserve` / `## Read This Reference`
     这类结构性小标题。它们此前没被过滤，实测在索引里的出现次数：
     Workflow 44、Quick 43、Start 42、Reference 41、Read 40 ——
     任何查询只要撞上这些词就命中几十个技能，检索直接失效。
     这类标题的共同特征是「讲文档结构、不讲技术内容」，按词剔除比按正则猜可靠。 */
  const GENERATED_HEAD = /^(第二发|链路位置|本机可执行性|本机工具实况|常见坑|检查清单|工作流|路由上下文)/;
  const STRUCTURAL_HEAD = new Set([
    "quick start", "workflow", "what to preserve", "read this reference", "reference",
    "references", "start", "quick", "what", "read", "preserve", "workflow",
    "usage", "example", "examples", "notes", "note", "overview", "summary",
    "introduction", "background", "checklist", "steps", "step",
  ]);
  const headings = [...raw.matchAll(/^#{2,4}\s+(.+)$/gm)]
    .map((m) => m[1])
    .filter((h) => {
      const t = h.trim();
      if (GENERATED_HEAD.test(t)) return false;
      // 纯英文/短语形态的结构性标题（Quick Start / Workflow / Read This Reference）
      if (STRUCTURAL_HEAD.has(t.toLowerCase())) return false;
      // "Read This Reference"、"What To Preserve" 这类两三个词的祈使式小标题
      if (/^[A-Z][a-z]+( [A-Za-z]+){1,3}$/.test(t) && !/[A-Z]{2,}/.test(t) && t.split(/\s+/).length <= 4) {
        const low = t.toLowerCase().split(/\s+/);
        if (low.some((w) => ["read", "what", "how", "why", "when", "quick", "see", "note", "reference", "preserve", "step", "usage"].includes(w))) return false;
      }
      return true;
    });
  /* CVE 号生在正文表格里（不在 frontmatter），所以专有名词要扫全文；
     但英文名只从摘要+标题取——正文 66.6 万字里扫英文词会引入巨量噪音
     （普通单词也算「专有名词」），那比没有索引更糟。 */
  const cve = new Set([...raw.matchAll(/\b(?:CVE|CNVD|CNNVD)-\d{4}-\d{3,7}\b/gi)].map((m) => m[0]));
  /* 正文里的下划线标识符（工具名 / 环境变量）是**例外**，必须扫全文。
     为什么：工具名的唯一写处就是正文（表格、命令），frontmatter 里从不出现；
     而查工具名（redteam_score_report）是模型最自然的用法——「这个工具怎么用」。
     噪音论证：下划线标识符几乎不存在普通英文单词形态（≤1%，实测 56 个工具名 +
     十几个环境变量），远低于扫全部英文词的噪音水平，所以这条特例是安全的。 */
  const underscore = new Set(
    [...raw.matchAll(/\b[a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+\b/g)]
      .map((m) => m[0])
      .filter((w) => w.length >= 5 && w.length <= 40)
  );
  const proper = extractProper(`${s.id} ${s.summary} ${s.whenToUse} ${headings.join(" ")}`);

  /* 被本技能引用的 references 的**标题**，也要进索引（1.1.118）。
     为什么必须补：references 是深水区（115 篇 / 93.7 万字），技术名全写在它们的 H2/H3 标题里
     （`ESC1`~`ESC15`、`Kerberoast`、`SIDHistory`、`Golden Ticket`、`PrintSpoofer`、`jku`、`HS256`…），
     而索引原先只扫技能正文的 headings —— 实测 references 标题里 399 个技术名，**260 个（65%）
     在索引里完全没有**。后果是：模型查 `potato`/`sebackup`/`jku`/`hs256` 全都回「没有匹配」，
     尽管这些词就在 references 的一级/二级标题上。这是「加了等于白加」的第四次踩点。
     设计取舍：
       · **只取标题，不取正文**。正文 93.7 万字里扫英文词会引入巨量噪音（普通单词也算专有名词），
         标题是人写的短语，质量高得多。这条边界与「英文名只从摘要+标题取」同源。
       · 归属到**引用它的那个技能**（而不是每条 references 一个条目）：模型搜 `ESC1` 要的是
         「哪个技能能打 ESC1」，答案是 `windows-ad` 而非一篇孤立文档。
       · 过同一套 `extractProper` 判据（首字母大写/含数字/下划线/点连字符），
         并同样剔除 ATT&CK 编号与结构性英文标题。 */
  const refHeads = new Set();
  let refCnSet = null;
  for (const m of raw.matchAll(/(?:^|[\s(`])(?:\.\.\/)?references\/([A-Za-z0-9._-]+)\.md/g)) {
    const refFile = path.join(SKILLS, "references", `${m[1]}.md`);
    let refText = "";
    try { refText = fs.readFileSync(refFile, "utf8"); } catch { continue; }
    /* **先剥代码块再抽标题**。踩过的坑：`reverse-pwn.md` 里有
         `# IDA: View → Open Subviews → Cross References；右键函数 → Callers`
       这是**代码块里的注释**（或纯文本行首），`^#{1,4}\s+` 会把它当 H1 标题，
       于是 `References`、`View`、`Open` 这些词全进了索引，第 24 关判「模板词残留」。
       内容为代码的文件（references 里大量 shell/命令）必须先把 ``` 围栏内的行剔除。 */
    const refNoCode = refText.replace(/```[\s\S]*?```/g, "").replace(/^( {4,}|\t).*$/gm, "");
    /* **只取 H2 及以下，不要 H1**（1.1.123 实测踩到）。
       H1 是文档名（`# 攻防演练通用方法论`），它的词跨度极大、区分度极低 ——
       `awesome-pentest-digest.md` 的「三、子域与资产」是 H2，但同文件 H1 论方法；
       更要紧的是：**references 的标题是「这篇文章讲什么」，不是「这个技能主业是什么」**。
       一个技能顺带引用了一篇综合手册，不该因为那篇手册有「子域」这一节
       就在 `q=子域` 里排到 `subdomain-bruteforce` 前面（实测正是如此）。
       所以：H2+ 才收，且中文词另存一个集合，检索侧降权。 */
    const refHeadings = [...refNoCode.matchAll(/^#{2,4}\s+(.+)$/gm)].map((x) => x[1].trim());
    for (const w of extractProper(refHeadings.join(" "))) {
      /* 与技能正文同一条豁免：编号走 attack 字段 */
      if (/^T\d{4}(?:\.[0-9]{3})?$/i.test(w)) continue;
      refHeads.add(w);
    }
    /* references 的中文词单独收（不进 base，见下方合并处）。 */
    refCnSet = refCnSet || new Set();
    for (const w of extractCnFromHeadings(refHeadings)) refCnSet.add(w);
    /* **references 标题里的中文词也要收**（1.1.123 实测缺口）：
       之前只走 `extractProper`（英文/数字形态），于是「变电站」「电力」「遥控」
       这些**只写在 references 标题里**的中文词一个都没进索引 ——
       查「iec104」能中（英文），查「变电站」零结果。
       这与 1.1.118 修「references 标题不可见」是同一类问题，只是那次只补了英文侧。
       判据：走与技能 headings 完全相同的 `extractCnFromHeadings`，
       这样「同一套抽取判据」只维护一处。 */
  }

  /* ATT&CK 技术编号**单列一个字段 `attack`，不进 keys**。
     为什么不能进 keys：① T1190 这种在正文表格里出现在 28 个技能中，
     keyFrequency 会把它判成泛词（阈值 18）直接剔除 —— 恰恰是最需要检索的编号被过滤；
     ② keys 参与模糊打分（前缀/子串/反含），T1059 与 T1059_001 会互相污染，
     模型查子技术却拿到父技术的技能。
     正文里写着编号 = 该技能确实覆盖这个手法（1.1.113 逐条核过），
     所以这里扫全文，按**精确编号**入字段，检索侧做等值/前缀匹配。 */
  const attack = new Set();
  for (const m of raw.matchAll(/\bT(\d{4})(?:\.(\d{3}))?\b/g)) {
    attack.add(m[2] === undefined ? `T${m[1]}` : `T${m[1]}.${m[2]}`);
  }
  /* 反引号里的工具名/参数名（1.1.118）。
     为什么只认反引号而不是扫正文：正文扫英文词会引入巨量噪音（上一段已说明），
     但**反引号是作者显式标注「这是个标识符」**的位置 —— 表格里的 `PrintSpoofer`、
     代码里的 `SeImpersonatePrivilege`、参数 `jku`，都在反引号里。
     实测代价：`privesc-persistence` 正文表格写了 `PrintSpoofer / GodPotato / JuicyPotato`，
     但查 `potato` 完全搜不到它，首条反而是 competition-identity-windows ——
     因为提取只看标题，工具名全在正文里。
     判据收窄到「反引号内、无空格、看起来像标识符」，避免把反引号里的命令整条收进来：
       · 长度 3~40，首字符字母
       · 允许字母数字 _ . - / （工具名与路径形态）
       · **不含空格、不含 `=`、不含中文** —— 那是命令片段不是名字
       · 过 extractProper 的正面判据（大写开头/含数字/含符号），否则普通词全进。 */
  const codeSpans = new Set();
  /* 反引号内容**必须按分隔符拆开再逐个判**，不能整段判。
     实测踩到：`privesc-persistence` 正文写的是
       `PrintSpoofer / GodPotato / JuicyPotato（**按 OS 版本选**）`
     整段含空格、斜杠、中文与 markdown 加粗，整段正则 `^[A-Za-z][A-Za-z0-9._/-]*$`
     直接把它排除了 —— 于是查 `potato` 搜不到这个最该命中的技能。
     拆开后再过滤：只保留「纯 ASCII 标识符形态」的片段，其余（中文、`**`、括号）丢掉。 */
  for (const m of raw.matchAll(/`([^`\n]{2,120})`/g)) {
    for (const piece of m[1].split(/[\s/、,，;；|（）()*]+/)) {
      const tok = piece.trim();
      if (!tok || tok.length < 3 || tok.length > 40) continue;
      if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(tok)) continue;
      const base = tok.replace(/\.(exe|py|sh|ps1|dll|js|mjs)$/i, "");
      if (base.length < 3 || /^\d+$/.test(base)) continue;
      const capitalized = /^[A-Z][a-z]/.test(base) && base.length >= 4 && !EN_COMMON.has(base.toLowerCase());
      const allCaps = /^[A-Z0-9]{2,}$/.test(base);
      const hasDigit = /\d/.test(base);
      const hasPunct = /[._-]/.test(base);
      /* 纯小写 3 字母（`jku`/`kid`/`alg`）单列：它们不是「专有名词」形态，
         却是 JWT/协议参数的高频搜索词，与 headings 里的缩略词判据同源 */
      const lcAbbr = base.length === 3 && /^[a-z]+$/.test(base) && !EN_COMMON.has(base) && !SEARCH_STOP.has(base);
      if (capitalized || allCaps || hasDigit || hasPunct || lcAbbr) codeSpans.add(base);
    }
  }
  /* 表格单元格里的专有名词（1.1.118）。
    为什么必须补这一处：技能正文的**工具名几乎全写在表格里**（含反引号），不在标题里。
    实测：`privesc-persistence` 第三列表格写着 `PrintSpoofer / GodPotato / JuicyPotato`，
    但查 `potato` 首条是 competition-identity-windows —— 因为整段不在反引号内、
    也不在任何标题里，两个通道都够不着它。
    判据收窄（否则整张表的中文与普通英文词全进来）：
      · 只扫**单元格**（`|` 分隔），不扫整行
      · 只收 extractProper 认可的专有名词形态（大写开头/全大写/含数字/含符号）
      · 长度 3~24，纯 ASCII
    噪音论证：表格里的大写词几乎都是产品名/工具名/参数名（`PrintSpoofer`、`SeDebug`、
    `HPing`、`JDK`），普通英文词在中文技能正文的表格里很少首字母大写 ——
    实测加这条把平均关键词从 53 提到 62，且 od 泛词过滤没有新增超阈值的词。 */
  const tableCells = new Set();
  for (const line of raw.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    for (const cell of line.split("|")) {
      for (const m of cell.matchAll(/\b[A-Za-z][A-Za-z0-9._-]{2,23}\b/g)) {
        const w = m[0];
        if (EN_COMMON.has(w.toLowerCase()) || SEARCH_STOP.has(w.toLowerCase())) continue;
        /* 结构性英文标题（References / Workflow / Usage / Notes）同样要挡：
           实测表格里出现 `| References | ... |` 这种行，把 Refs 一起收进索引，
           第 24 关直接判「模板词残留」。表格不是法外之地，判据要与标题一致。 */
        if (STRUCTURAL_HEAD.has(w.toLowerCase())) continue;
        const capitalized = /^[A-Z][a-z]/.test(w) && !EN_COMMON.has(w.toLowerCase());
        const allCaps = /^[A-Z0-9]{2,}$/.test(w);
        const hasDigit = /\d/.test(w);
        const hasPunct = /[._-]/.test(w);
        if (capitalized || allCaps || hasDigit || hasPunct) tableCells.add(w);
      }
    }
  }
  /* 中文产品名（泛微/致远/用友…）主要写在 description 与 whenToUse 里，不在标题里。
     这两段是**人写的短句**，质量高，所以按分隔符拆开后同样过 isGoodCn——
     不要图省事把整段 description 丢进长句切窗，那正是噪音的来源。 */
  const cn = extractCnFromHeadings([...headings, s.summary, s.whenToUse]);
  /* stageName（「漏洞发现」「内网渗透」）**不能进 keys**：同一阶段的技能全都带它，
     零区分度。实测「漏洞发现」在索引里出现 43 次、「漏洞利用」31 次、「内网渗透」29 次 ——
     等于把整阶段绑成一团，查任何相关词都会先命中一堆同阶段技能。
     阶段信息已经由 `stage` / `stageName` 字段单独承载（排序时用 rankOf 调层级），
     不需要再当检索词。domain 同理：它比阶段更细，但同一域通常也只有几个技能，
     实测没有造成成团（最大 22），保留它对"按域找"有用。 */
  const extra = [s.id, s.domain].filter((w) => w && !SEARCH_STOP.has(w));
  /* ATT&CK 编号**不许进 keys**，要从 proper 里剔掉。
     为什么：extractProper 的正则 `[A-Za-z][A-Za-z0-9._-]{1,24}` 会把 `T1562` 当成产品名收下
     （首字母大写 + 含数字），实测 edr-bypass-re 的 keys 里就混进了 T1562。
     两个后果：
       ① 泛词过滤（≥15% 技能共有）会剔除出现次数多的编号（T1190 在 28 个技能里），
          于是「最常见的编号反而搜不到」；出现次数少的（T1562 只 2 个技能）留下 ——
          同一套规则对同类数据给出两种行为，必然错一半。
       ② keys 参与模糊打分（前缀/子串/反含），T1059 与 T1059.001 互相包含，
          查子技术会先拿到父技术的技能。
     编号改由 `attack` 字段精确承载，检索侧走等值/深度匹配（model-tools 的 attackQuery 通道）。 */
  /* references 的中文词**单独一个字段** `refKeys`，不进 base。
     理由见 model-tools 检索侧：它的权重必须低于「技能自己标题里的词」。
     一个技能顺带引用综合手册，不该因为手册某一节叫「子域」就在 `q=子域` 里排第一。 */
  const refKeys = refCnSet ? [...refCnSet].filter((k) => !cn.has(k)) : [];
  const base = [...new Set([...cve, ...underscore, ...proper, ...refHeads, ...codeSpans, ...tableCells, ...cn, ...extra])]
    .filter((k) => !/^T\d{4}(?:[._]\d{3})?$/i.test(String(k)));
  return {
    id: s.id,
    stage: s.stage,
    stageName: s.stageName,
    domain: s.domain,
    /* summary / whenToUse 必须原样带出，不能只合成一个 why：
       model-tools 的中文长词回退读的正是 s.summary / s.whenToUse，
       而这两个字段此前从未写进索引 —— 于是回退永远在空字符串里找片段。 */
    summary: s.summary || "",
    whenToUse: s.whenToUse || "",
    /* ATT&CK 技术编号（1.1.117）：技能正文里写过的编号，精确值，供 purge_skills q=T1059
       或 attack= 直查。空数组表示该技能正文没有编号 —— 审计侧要能看到这个缺口。 */
    attack: [...attack].sort(),
    baseKeys: base,
    /* references 的中文词：单独字段，检索侧按「弱命中」处理（低于技能自己标题里的词）。 */
    refKeys,
    // why 是「命中时怎么解释」：模型看到的是理由，不只是一个光秃秃的名字
    why: s.whenToUse || s.summary || "",
  };
});

/* 动态泛词过滤：出现在过多技能里的词等于没有区分度。
   为什么必须有这一层：静态黑名单永远不全 —— 我修掉了 Workflow/Quick/Map/Reduce，
   又冒出 surface / bundled_skills / 工具链 / 声称完成 / 失败分支。这些都是"每个技能都
   带一点"的通用词，靠人肉加名单追不上新技能的写法。
   判据：一个词出现在 ≥ 15% 的技能里（119 个技能 → ≥18 个）就没有检索价值，剔除。
   为什么不是更低的阈值：中文产品名（泛微/致远）和阶段内通用词（Kerberos 在域渗透里
   出现 8~10 次）都还保有区分度，阈值定太低会误杀。
   这条规则自动跟随技能库增长，不需要维护名单。 */
const KEY_SPREAD_LIMIT = Math.max(6, Math.round(searchIndex.length * 0.15));
const keyFrequency = new Map();
for (const entry of searchIndex) {
  for (const k of entry.baseKeys) keyFrequency.set(k, (keyFrequency.get(k) || 0) + 1);
}
const overSpread = new Set([...keyFrequency.entries()].filter(([, n]) => n >= KEY_SPREAD_LIMIT).map(([k]) => k));

/* refKeys 也要过泛词过滤（它的词同样可能遍布全库），但**不做同义词展开**：
   展开是给「技能自己的词」用的，references 的词只用原样弱匹配。 */
for (const entry of searchIndex) {
  entry.keys = applySynonyms(entry.baseKeys.filter((k) => !overSpread.has(k)));
  entry.refKeys = (entry.refKeys || []).filter((k) => !overSpread.has(k));
  delete entry.baseKeys;
}

// 可达性自检：零关键词 === 存在于库里但找不到，这是闸门原来完全看不见的盲区
const unreachable = searchIndex.filter((s) => !s.keys.length).map((s) => s.id);
if (unreachable.length) problems.push(`检索索引里有 ${unreachable.length} 个技能无任何关键词: ${unreachable.slice(0, 6).join(", ")}`);
{
  const avg = searchIndex.length ? Math.round(searchIndex.reduce((n, s) => n + s.keys.length, 0) / searchIndex.length) : 0;
  console.log(`  检索索引: ${searchIndex.length} 个技能｜平均 ${avg} 条关键词｜零关键词 ${unreachable.length}`);
}

console.log(`  校验问题: ${problems.length}${problems.length ? "：" + problems.slice(0, 5).join(" | ") : " ✓"}`);

const LINK_MARK = "<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->";
// 结束标记：剥离时只吃「本块」这段，绝不能一路截到文件尾。
// 第 110 轮实测踩到：inject-runnability 追加的「本机可执行性」块排在链路块之后，
// 而旧写法 `t.slice(0, i)` 从链路标记截到 EOF，把那个块一起删了——两个生成器互相打架，
// 表现为「刚注入 37 个，闸门立刻报 37 个缺失」。带结束标记就与追加顺序无关了。
const LINK_END = "<!-- /skill-link-graph -->";

/** 渲染「链路位置」章节：这是链路能被用到的唯一载体——模型按需加载技能时就看到上下游 */
function renderSection(s) {
  const L = [];
  L.push(LINK_MARK);
  L.push("");
  L.push("## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）");
  L.push("");
  L.push(`- **阶段**：${s.stage === "flow" ? "流程/编排" : s.stage + " " + (STAGES[s.stage] || "")}` + (s.role ? `｜**角色**：\`${s.role}\`` : ""));
  if (s.upstream.length) L.push("- **上游**（先做完这些再进来）：" + s.upstream.map((x) => "`" + x + "`").join("、"));
  if (s.downstream.length) L.push("- **下游**（产出交给谁）：" + s.downstream.map((x) => "`" + x + "`").join("、"));
  const spec = relations.filter((r) => r.source === s.id && r.relationship === "specializes").map((r) => r.target);
  if (spec.length) L.push("- **专项下游**（同主题更深的靶子面）：" + spec.map((x) => "`" + x + "`").join("、"));
  const comp = relations.filter((r) => r.relationship === "complementary" && (r.source === s.id || r.target === s.id))
    .map((r) => (r.source === s.id ? r.target : r.source)).slice(0, 5);
  if (comp.length) L.push("- **互补**（同类场景一起用）：" + comp.map((x) => "`" + x + "`").join("、"));
  if (s.records.length) L.push("- **落库**（做完必须记进演练台，没落库的发现等于没发生）：" + s.records.map((x) => "`" + x + "`").join("、") + " —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据");
  else L.push("- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台");
  /* 验证层指路：攻击技能只会「打」，不会「证明」和「说清隐蔽性」——这是 2026-11-14
     12 维度矩阵实测出来的空白（检测配对 3%／误报验证 5%／补丁后复测 5%／ATT&CK 5%）。
     三个元技能建好后只有 2/116 的技能引用它们，等于建了没人知道。这条自动指路让
     每个攻击技能在收口时都能被拉到验证层，不必靠作者记得手写。
     元技能自身、以及纯流程类（flow/aux）不加，避免自指与噪声。 */
  const VERIFY_META = ["verification-discipline", "detection-pairing", "attack-traceability"];
  if (!VERIFY_META.includes(s.id) && s.stage !== "flow" && s.stage !== "aux") {
    L.push(
      "- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；" +
        "打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；" +
        "说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。" +
        "**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），" +
        "整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，" +
        "做具体攻击时不会想到去翻，所以在这里点名"
    );
  }
  L.push("");
  /* 相关工具指路：56 个工具里有 34 个**只在 redteam-setup 的工具表里出现过一次**，
     属于"目录式登记"而非"场景式调用指引"。模型做资产测绘时不会想到去翻一个叫
     "redteam-setup" 的技能查工具名，于是这些工具装了却用不上。
     （1.1.96 那次验证层也有同样的问题：建好元技能但只有 2/116 技能引用，
     改生成器自动指路后升到 94%。同一条经验在这里再应用一次。）

     按技能**实际产出的实体类型**（s.records）推该用哪些数据面工具，而不是按技能名猜：
     产出 asset → 提醒图查询/时间线；产出 vuln → 提醒按 CVE 检索与证据关联。
     只对有落库实体的技能加，纯流程类不加，避免噪声。 */
  /* 映射只覆盖 records 里**真实存在**的类型（实测全部取值：
     access / asset / credential / stage / tunnel / vuln / webshell）。
     写不存在的类型等于永远不触发 —— 这类"看起来配了其实空转"的映射最容易骗过 review。 */
  const TOOL_BY_RECORD = {
    asset: "`redteam_asset_stats`（收集收口先看断层：C 段数/存活/端口/服务/指纹/溯源条数）、`redteam_asset_get`（深入单个目标：全部端口服务+指纹+采集时间线）、`redteam_asset_graph`（C 段→资产→端口→域名 的拓扑，找横向路径用它而不是肉眼翻列表）、`redteam_asset_timeline`（发现时间线，判断哪些是新冒出来的）",
    vuln: "`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）",
    credential: "`redteam_sessions`（一屏看已上线 WebShell、隧道可达网段、凭据、访问会话）",
    access: "`redteam_sessions`（同上：判断现在能往哪走，别凭记忆）",
    webshell: "`redteam_webshell_list` 配 `redteam_tunnel_list`（先看已有什么入口，再决定新开还是复用）",
    tunnel: "`redteam_tunnel_list`（可达网段是横向的边界，别凭记的 IP 段推算）",
  };
  const tips = [];
  for (const r of s.records) {
    const tip = TOOL_BY_RECORD[r];
    if (tip) tips.push(tip);
  }
  if (tips.length && s.stage !== "flow" && s.stage !== "aux") {
    L.push("- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：" + [...new Set(tips)].join("；"));
  }
  L.push("");
  L.push(LINK_END);
  return L.join("\n");
}

/* ── 检索索引的抽取逻辑与 searchIndex 定义已上移到「校验问题」之前，
   这样零关键词能在同一行汇总里报出来，不必等写盘后才暴露。 ── */

if (!dry) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "skills-index.json"), JSON.stringify({ schemaVersion: 1, totalSkills: skills.length, stages: STAGES, skills }, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT, "skills-relations.json"), JSON.stringify({ schemaVersion: 1, total: relations.length, relations }, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT, "skills-agents.json"), JSON.stringify({ schemaVersion: 1, roles: agents }, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT, "skills-search.json"), JSON.stringify({ schemaVersion: 1, total: searchIndex.length, stages: STAGES, skills: searchIndex }, null, 2), "utf8");
  console.log(`  ✓ 已写 lib/generated/{skills-index,skills-relations,skills-agents,skills-search}.json`);

  // 把链路写进技能正文（幂等：先剥旧章节再追加）
  let injected = 0;
  for (const s of skills) {
    const p = path.join(SKILLS, s.id + ".md");
    let t = fs.readFileSync(p, "utf8");
    const i = t.indexOf(LINK_MARK);
    if (i >= 0) {
      // 只吃「链路块」这一段，块前的正文与块后别的生成物都保留。
      const e = t.indexOf(LINK_END, i);
      let cutEnd;
      if (e > i) cutEnd = e + LINK_END.length;
      else {
        // 老文件（本标记之前生成的）没有结束标记：切到「下一个生成块标记」为止。
        // 绝不能一路切到 EOF —— 那正是本轮 bug（把排在后面的可执行性块一起吃掉）。
        // 所有生成器都用 HTML 注释做标记，所以「下一个 <!--」就是安全边界。
        const nxt = t.indexOf("<!--", i + LINK_MARK.length);
        cutEnd = nxt > i ? nxt : t.length;
      }
      t = (t.slice(0, i).replace(/[ \t]+$/, "") + "\n\n" + t.slice(cutEnd).replace(/^[\r\n]+/, "")).replace(/\s+$/, "");
    }
    const next = t.replace(/\s+$/, "") + "\n\n" + renderSection(s) + "\n";
    if (next !== fs.readFileSync(p, "utf8")) { fs.writeFileSync(p, next, "utf8"); injected += 1; }
  }
  console.log(`  ✓ 已把「链路位置」写进 ${injected} 个技能正文（幂等：重跑不叠加）`);

  // 模块联系：角色档案 → 预设。预设是模型可见的 system prompt，而 skills-agents.json 模型看不到；
  // 只把档案写在 JSON 里等于「角色有技能库」这件事没人知道（第 106 轮实测缺口 71 个）。
  // 所以把总表派生进预设，且与技能正文的「链路位置」互补：预设管「谁归谁」，技能管「前后接谁」。
  const PRESET = path.join(root, "presets", "redteam", "agent.cordis.yml");
  const S_MARK = "<!-- roles-table:start";
  const E_MARK = "roles-table:end -->";
  if (fs.existsSync(PRESET)) {
    let pt = fs.readFileSync(PRESET, "utf8");
    const ind = "      ";
    const rows = ["| 角色 | 技能数 | 技能 |", "| --- | --- | --- |"];
    for (const [rid, r] of Object.entries(agents)) {
      // 全部角色都列全（含 surface 的 41 个）：少列就会被链路校验判成「未被角色挂载」，
      // 而且模型只在这里一眼看全角色↔技能，省得为找某个技能翻 41 个文件。
      rows.push(`| \`${rid}\` ${r.name} | ${r.skills.length} | ${r.skills.map((x) => "`" + x + "`").join("、")} |`);
    }
    const block = [
      S_MARK + " build-skill-graph.mjs 生成，勿手改 -->",
      ind + "## 角色技能库总表（技能不是散落的：每个技能都有归属角色，上下游写在技能自身的「链路位置」里）",
      "",
      ...rows.map((x) => ind + x),
      "",
      ind + "**用法**：派角色时按上表挑技能；技能正文末尾的「链路位置」会告诉你它前面该做什么、产出交给谁、结果落哪个库（没落库的发现等于没发生）。",
      E_MARK,
    ].join("\n");
    const s = pt.indexOf(S_MARK), e = pt.indexOf(E_MARK);
    if (s >= 0 && e > s) {
      // 剥旧块时把块前块后的空白一起收掉再补回固定两个换行——否则重跑会留下不同数量的空行，
      // 预设 hash 每次都变（第 106 轮实测过：块数仍是 1，但 e6a637→aa84bc 漂了）。
      let start = s, end = e + E_MARK.length;
      while (start > 0 && /[ \t\r\n]/.test(pt[start - 1])) start -= 1;
      // 只吃换行、不吃缩进：锚点行本身带 6 空格缩进，吃掉了下一轮就找不到锚点
      pt = pt.slice(0, start).replace(/[ \t]+$/, "") + "\n\n" + pt.slice(end).replace(/^[\r\n]+/, "");
    }
    const anchor = ind + "## 按用户输入决定怎么开工";
    const i = pt.indexOf(anchor);
    if (i >= 0) {
      pt = pt.slice(0, i) + block + "\n\n" + pt.slice(i);
      fs.writeFileSync(PRESET, pt, "utf8");
      const covered = new Set(Object.entries(agents).filter(([k]) => k !== "surface").flatMap(([, r]) => r.skills));
      console.log(`  ✓ 已把角色技能库总表注入预设（${Object.keys(agents).length} 个角色、覆盖 ${covered.size} 个技能）`);
    } else {
      console.log("  ✗ 预设里找不到「按用户输入决定怎么开工」锚点");
    }
  }

  // 模块联系：链路 → graphify 图谱。技能节点 id 与既有语义层（01-recon-skills.json 等）同一命名
  // （skills_redteam_<下划线名>），同域节点直接挂接而不是另起一份；必须带 source_file/file_type，
  // 否则 graphify-sync 判「非法 file_type "undefined"」（第 106 轮实测 125 条全是这个原因）。
  const semDir = path.join(root, "graphify-out", "semantic");
  fs.mkdirSync(semDir, { recursive: true });
  const absOf = (rel) => path.join(root, rel);
  const sk = (id) => "skills_redteam_" + id.replace(/-/g, "_");
  const rl = (id) => "role_" + id.replace(/-/g, "_");
  const semNodes = [
    ...skills.map((s) => ({
      id: sk(s.id),
      label: `${s.id}（${STAGES[s.stage] || s.stage}${s.role ? " / " + s.role : ""}）`,
      file_type: "document",
      source_file: absOf(`skills/redteam/${s.id}.md`),
      source_location: "L1", source_url: null, captured_at: null, author: null, contributor: null,
      rationale: s.summary || null,
    })),
    ...Object.entries(agents).map(([rid, r]) => ({
      id: rl(rid),
      label: `角色 ${r.name}（${r.skills.length} 个技能）`,
      file_type: "document",
      source_file: absOf("lib/generated/skills-agents.json"),
      source_location: "L1", source_url: null, captured_at: null, author: null, contributor: null,
      rationale: null,
    })),
  ];
  const semEdges = [
    ...relations.map((r) => ({
      source: sk(r.source), target: sk(r.target), relation: r.relationship,
      confidence: "EXTRACTED", confidence_score: 1,
      source_file: absOf("lib/generated/skills-relations.json"), source_location: "L1", weight: 1,
    })),
    ...Object.entries(agents).flatMap(([rid, r]) => r.skills.map((s) => ({
      source: rl(rid), target: sk(s), relation: "owns",
      confidence: "EXTRACTED", confidence_score: 1,
      source_file: absOf("lib/generated/skills-agents.json"), source_location: "L1", weight: 1,
    }))),
  ];
  fs.writeFileSync(path.join(semDir, "skills-chain.json"), JSON.stringify({
    nodes: semNodes, edges: semEdges, hyperedges: [], input_tokens: 0, output_tokens: 0,
    coverage: { skills: skills.length, relations: relations.length, roles: Object.keys(agents).length },
  }, null, 2), "utf8");
  console.log(`  ✓ 语义层 graphify-out/semantic/skills-chain.json：${semNodes.length} 节点 / ${semEdges.length} 边（技能 ${skills.length} + 角色 ${Object.keys(agents).length}）`);
} else {
  console.log("  （--dry 未写盘）");
}
if (problems.length && process.argv.includes("--check")) process.exit(1);
