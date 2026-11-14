/**
 * 给技能打 ATT&CK 标注（在文件末尾追加 `## ATT&CK 映射` 段）。
 *
 * 为什么要在末尾追加而不是人工逐个编辑：
 *   · 119 个文件手工改必然漏、必然写得五花八门；
 *   · 标注是**数据**（技能→技术编号），应该集中维护、可重复生成；
 *   · 集中之后改一个映射只跑一遍脚本，不用去 119 个文件里找。
 *
 * 纪律：编号必须存在于 lib/redteam/attack-map.js，否则脚本拒绝写入（不写假编号）。
 * 重复执行安全：已有该段则原地替换，不会叠加两段。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TECHNIQUES, TACTICS, displayTechniqueId, normalizeTechniqueId, ATTACK_VERSION } from "../lib/redteam/attack-map.js";

/* 根目录必须用 fileURLToPath：手写 `url.pathname.replace(/^\/([A-Za-z]:)/,'$1')` 在中文目录下
   会被二次编码成 %E5%AE%8C…，scandir 直接 ENOENT（已踩过两次，不要再手拼）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "skills", "redteam");

/**
 * 技能 → 技术编号。
 * 只写**这个技能真正会执行的手法**，不写"它顺便提到过的"。
 * 判据：这个技能教的动作，在 ATT&CK 里能对上哪条；对不上就不写（宁缺勿滥）。
 */
const SKILL_ATTACK = {
  /* 侦察 */
  "recon-pipeline": ["T1595", "T1592", "T1590", "T1593"],
  "passive-recon": ["T1593", "T1596", "T1594"],
  "active-scan": ["T1595", "T1595_002", "T1046"],
  "subdomain-bruteforce": ["T1590", "T1595"],
  "fofa-recon": ["T1596", "T1593"],
  "web-fingerprint": ["T1592", "T1518"],
  "asset-correlation": ["T1590", "T1016"],
  "dir-bruteforce": ["T1595", "T1083"],
  "nuclei-scan": ["T1595_002"],
  "fscan-intranet": ["T1046", "T1018", "T1110"],
  "gogo-intranet": ["T1046", "T1018"],

  /* 初始访问 / 执行 */
  "injection-payloads": ["T1190"],
  "web-vuln-payloads": ["T1190", "T1059"],
  "unauth-exploit": ["T1190"],
  "api-security": ["T1190"],
  "graphql-testing": ["T1190"],
  "http-smuggling": ["T1190"],
  "race-conditions": ["T1190"],
  "waf-bypass": ["T1190", "T1027"],
  "supply-chain-security": ["T1195"],
  "patch-diff-exploit": ["T1190", "T1068"],
  "pwn-chain": ["T1068", "T1055"],
  "webshell-toolkit": ["T1505", "T1505_003", "T1059"],
  "shell-handler": ["T1059", "T1059_001", "T1059_003", "T1059_004", "T1071"],
  "pentest-tools": ["T1595", "T1587"],

  /* 凭据 */
  "credential-attack": ["T1187", "T1110", "T1110_003", "T1003", "T1003_001", "T1003_002", "T1552", "T1552_001", "T1555"],
  "netexec-scan": ["T1021_002", "T1110", "T1078"],
  "windows-ad": ["T1047", "T1569", "T1082", "T1057", "T1136", "T1098", "T1558", "T1558_001", "T1558_002", "T1558_003", "T1558_004", "T1003_003", "T1003_001", "T1550_002", "T1134", "T1484", "T1187", "T1087", "T1018"],
  "identity-federation": ["T1550", "T1606", "T1528"],
  "browser-extension-reverse": ["T1555", "T1185"],
  "thick-client": ["T1552_001", "T1055"],

  /* 提权 / 横向 / 持久化 */
  "privesc-persistence": ["T1505", "T1137", "T1068", "T1548", "T1053", "T1543", "T1547", "T1136", "T1070"],
  "lateral-movement": ["T1047", "T1569", "T1021_002", "T1021", "T1021_001", "T1021_002", "T1021_004", "T1570", "T1550", "T1550_002", "T1563"],
  "edr-bypass-re": ["T1562_001", "T1055", "T1027", "T1622", "T1497", "T1218"],
  "detection-pairing": ["T1562", "T1070", "T1070_004", "T1562_008", "T1490"],

  /* 隧道 / C2 */
  "chisel-tunnel": ["T1572", "T1090"],
  "frp-tunnel": ["T1572", "T1090", "T1102"],
  "suo5-tunnel": ["T1572", "T1071_001"],
  "vps-reverse-shell": ["T1105", "T1571"],
  "cn-proxy-pool": ["T1090_003", "T1090_001"],
  "oob-verification": ["T1048", "T1071"],

  /* 云与容器 */
  "cloud-k8s": ["T1530", "T1525", "T1619", "T1610", "T1613", "T1611", "T1526", "T1552_001"],

  /* 域 / 基础设施 */
  "cn-oa-exploit": ["T1190", "T1078"],
  "code-audit": ["T1190"],
  "reverse-engineering": ["T1027", "T1140"],
  "ghidra-reverse": ["T1027", "T1140"],
  "ida-reverse": ["T1027", "T1140"],
  "radare2": ["T1027", "T1140"],
  "binary-diff": ["T1068"],
  "malware-analysis": ["T1055", "T1070", "T1027", "T1014", "T1620", "T1564", "T1036"],
  "threat-hunting": ["T1070", "T1562", "T1568", "T1008", "T1041", "T1567"],
  "digital-forensics": ["T1039", "T1114", "T1213", "T1560", "T1074", "T1070", "T1005", "T1485", "T1486", "T1491", "T1531"],
  "ai-infra-attack": ["T1648", "T1190", "T1526"],
  "llm-security": ["T1190", "T1059"],
  "mobile-reverse": ["T1027", "T1140"],
  "apk-reverse": ["T1027", "T1140"],
  "firmware-pentest": ["T1200", "T1542"],
  "hardware-security": ["T1200"],
  "radio-sdr": ["T1669"],
  "wifi-wireless": ["T1669", "T1557"],
  "ot-ics": ["T1190", "T1489"],
  "email-security": ["T1566", "T1203"],
  "browser-automation": ["T1204", "T1203"],
  "kimi-webbridge": ["T1071_001"],
  "secdev-boundary": ["T1195"],
  "database-security": ["T1190", "T1003"],
  "js-reverse": ["T1140"],
  "dotnet-reverse": ["T1027", "T1140"],
  "go-rust-reverse": ["T1027"],
  "protocol-reverse": ["T1040", "T1027"],
  "ctf-sandbox": ["T1595", "T1190"],
  "ctf-sandbox-orchestrator": ["T1595", "T1190"],
  "case-review": ["T1593"],
  "redteam-setup": ["T1583", "T1587"],
  "verification-discipline": ["T1595"],
  "attack-chain": ["T1190", "T1021", "T1090"],
  "attack-traceability": ["T1070", "T1595", "T1592", "T1590", "T1190", "T1059", "T1562", "T1003", "T1558", "T1087", "T1018"],

  /* 竞赛专项（competition-*）：名字即技术方向，按正文手法映射。
     这批的共同点：都是"某类具体机制怎么打"，所以恒有 2-6 条技术，不存在"无技术"的竞赛技能。 */
  "competition-ad-certificate-abuse": ["T1649", "T1558", "T1078"],
  "competition-agent-cloud": ["T1078", "T1552", "T1526"],
  "competition-android-hooking": ["T1055", "T1622", "T1140"],
  "competition-browser-persistence": ["T1176", "T1547", "T1185"],
  "competition-bundle-sourcemap-recovery": ["T1140", "T1027", "T1213"],
  "competition-cloud-metadata-path": ["T1552", "T1078", "T1526"],
  "competition-container-runtime": ["T1611", "T1610", "T1613"],
  "competition-crypto-mobile": ["T1140", "T1027", "T1555"],
  "competition-custom-protocol-replay": ["T1040", "T1071", "T1572"],
  "competition-dpapi-credential-chain": ["T1555", "T1003", "T1552"],
  "competition-file-parser-chain": ["T1203", "T1190", "T1068"],
  "competition-firmware-layout": ["T1542", "T1200", "T1014"],
  "competition-forensic-timeline": ["T1070", "T1005", "T1560"],
  "competition-graphql-rpc-drift": ["T1190", "T1595"],
  "competition-identity-windows": ["T1134", "T1550", "T1078"],
  "competition-ios-runtime": ["T1611", "T1555", "T1140"],
  "competition-jwt-claim-confusion": ["T1550", "T1606", "T1528"],
  "competition-k8s-control-plane": ["T1610", "T1613", "T1526"],
  "competition-kerberos-delegation": ["T1558", "T1134", "T1550"],
  "competition-kernel-container-escape": ["T1611", "T1068", "T1548"],
  "competition-linux-credential-pivot": ["T1003", "T1552", "T1078"],
  "competition-lsass-ticket-material": ["T1003_001", "T1558", "T1555"],
  "competition-mailbox-abuse": ["T1114", "T1566", "T1098"],
  "competition-malware-config": ["T1027", "T1140", "T1070"],
  "competition-oauth-oidc-chain": ["T1606", "T1528", "T1550"],
  "competition-pcap-protocol": ["T1040", "T1071", "T1572"],
  "competition-prompt-injection": ["T1190", "T1059", "T1204"],
  "competition-queue-worker-drift": ["T1610", "T1059", "T1526"],
  "competition-race-condition-state-drift": ["T1190", "T1068"],
  "competition-relay-coercion-chain": ["T1187", "T1557", "T1550_002"],
  "competition-request-normalization-smuggling": ["T1190", "T1027"],
  "competition-reverse-pwn": ["T1068", "T1055", "T1027"],
  "competition-runtime-routing": ["T1610", "T1071", "T1572"],
  "competition-ssrf-metadata-pivot": ["T1552", "T1078", "T1090"],
  "competition-stego-media": ["T1027", "T1140", "T1564"],
  "competition-supply-chain": ["T1195", "T1553", "T1078"],
  "competition-template-render-path": ["T1190", "T1059"],
  "competition-web-runtime": ["T1190", "T1059", "T1505_003"],
  "competition-websocket-runtime": ["T1071", "T1572", "T1190"],
  "competition-windows-pivot": ["T1021_002", "T1570", "T1090"],
  "competition-zip-archive": ["T1560", "T1027", "T1140"],
  "iot-iiot-netdev": ["T1190", "T1595", "T1669"],
};

/* 编号存在性校验：任何一条不在表里，整批拒绝（不写假编号）。 */
const missing = [];
for (const [skill, ids] of Object.entries(SKILL_ATTACK)) {
  for (const id of ids) {
    if (TECHNIQUES[normalizeTechniqueId(id)] === undefined) missing.push(`${skill} → ${id}`);
  }
}
if (missing.length) {
  console.error("✗ 以下编号在 attack-map.js 里不存在，拒绝写入（宁缺勿滥，不写假编号）：");
  for (const m of missing) console.error("   " + m);
  process.exit(1);
}

const MARK_START = "## ATT&CK 映射";
const TAC_ORDER = new Map(TACTICS.map((t, i) => [t.id, i]));

function renderSection(ids) {
  const rows = ids
    .map((raw) => {
      const key = normalizeTechniqueId(raw);
      const t = TECHNIQUES[key];
      const tac = TACTICS.find((x) => x.id === t.tactic);
      return { disp: displayTechniqueId(key), name: t.name, tac: tac ? tac.zh : "", ord: TAC_ORDER.get(t.tactic) ?? 99 };
    })
    .sort((a, b) => (a.ord === b.ord ? a.disp.localeCompare(b.disp) : a.ord - b.ord));
  const lines = [
    MARK_START,
    "",
    `> 本技能会执行的手法对应 MITRE ATT&CK v${ATTACK_VERSION} 下列技术（编号来自 \`lib/redteam/attack-map.js\`，唯一来源）。`,
    "",
    "| 战术 | 编号 | 技术 |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| ${r.tac} | ${r.disp} | ${r.name} |`),
    "",
    "落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；",
    "**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。",
  ];
  return lines.join("\n");
}

let changed = 0;
let skipped = 0;
const notFound = [];
for (const [skill, ids] of Object.entries(SKILL_ATTACK)) {
  if (!ids.length) continue;
  const file = path.join(DIR, `${skill}.md`);
  if (!fs.existsSync(file)) { notFound.push(skill); continue; }
  let text = fs.readFileSync(file, "utf8");
  const section = renderSection(ids);
  const idx = text.indexOf(MARK_START);
  if (idx >= 0) {
    /* 已有该段：从该段起到下一个 `## ` 之前整体替换（不叠加两段） */
    const after = text.slice(idx + MARK_START.length);
    const nextH = after.search(/\n## /);
    const tail = nextH === -1 ? "" : after.slice(nextH + 1);
    const next = text.slice(0, idx) + section + (tail === "" ? "\n" : "\n\n" + tail);
    if (next !== text) { fs.writeFileSync(file, next, "utf8"); changed += 1; } else skipped += 1;
  } else {
    const sep = text.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(file, text + sep + section + "\n", "utf8");
    changed += 1;
  }
}

console.log(`[build-attack-map] 写入 ${changed} 个技能｜未变 ${skipped} 个`);
if (notFound.length) console.log(`  ⚠ 映射表里有、但技能文件不存在：${notFound.join(", ")}`);
const covered = Object.keys(SKILL_ATTACK).filter((s) => SKILL_ATTACK[s].length).length;
const total = fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).length;
console.log(`  覆盖 ${covered}/${total} 个技能（剩余未标的多为竞赛专项，标注由后续按需补）`);