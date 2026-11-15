#!/usr/bin/env node
/**
 * 第 42 关：ATT&CK 标注充分度——正文讲了多类手法，映射段却只标一两个编号。
 *
 * 由来：1.1.122 子代理审阅实测 `code-audit` 的映射段只有 T1190 一条，
 * 而它的人工验证清单明写「硬编码密钥 / 命令与模板注入 / 自定义 crypto」——
 * 分别是 T1552、T1059、T1027。**标注不足与标注错误一样有害**：
 * 报告里「按 ATT&CK 复核」时，这个技能的产出对不上任何战术，防守方拿不到坐标。
 *
 * 判据（只判能机器判的部分，不做语义猜测）：
 *   用「手法关键词组」扫正文（不含映射段），命中 ≥3 组却只标 ≤2 个编号 → 报红。
 *   每组代表一类明确的攻击动作，命中即说明「正文真的在讲这件事」。
 *   这条判据不追求全覆盖，只抓「明显标少了」——误报代价高，所以阈值取宽。
 *
 * 反向探针验过：把 code-audit 的映射段还原成只有 T1190 一条 → 立刻报红。
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "skills/redteam");

/** 手法关键词组 → 对应技术编号。命中该组关键词 = 正文在讲这类动作。 */
const FAMILIES = [
  { id: "T1552", name: "凭据/密钥", re: /硬编码(密钥|密码|凭据)|hardcoded|明文密码|配置文件里的密码|secret.*hardcod/i },
  { id: "T1059", name: "命令/脚本执行", re: /命令注入|命令执行|os\.system|system\(|popen|模板注入|SSTI/i },
  { id: "T1078", name: "有效账号/默认口令", re: /默认口令|默认密码|弱口令|有效账号|default credential/i },
  { id: "T1005", name: "本地数据收集", re: /读取本地文件|本地系统数据|敏感文件读取|路径遍历|任意文件读/i },
  { id: "T1071", name: "应用层协议 C2", re: /beacon|心跳|C2 通道|应用层协议/i },
  { id: "T1070", name: "痕迹清除", re: /清除痕迹|清日志|wevtutil|时间戳篡改|反取证/i },
  { id: "T1055", name: "进程注入", re: /进程注入|CreateRemoteThread|shellcode 注入/i },
  { id: "T1027", name: "混淆/加密", re: /混淆|加壳|加密混淆|自定义 ?crypto|自定义加密/i },
  { id: "T1190", name: "利用公开应用", re: /SQL ?注入|SQLi|RCE|反序列化|SSRF|文件上传|XXE/i },
  { id: "T1485", name: "数据破坏/篡改", re: /数据破坏|篡改.*数据|删除数据/i },
  { id: "T1046", name: "服务发现", re: /端口扫描|服务探测|协议指纹|nmap/i },
];

/* 前提描述 vs 自己的手法 —— 这是判据第一版最大的误报来源。
   `vps-reverse-shell` 与 `chisel-tunnel` 提到 RCE，说的是「你是从 RCE 进来的」，
   是**入口假设**而不是它们自己去做利用。给它们标 T1190 是错的。
   判据：关键词所在的那一行如果带「入口 / 前提 / 从…进 / 只有」这类词，就不算本技能的手法。 */
const PREMISE_LINE = /入口|前提|从…?进|只有|已经有|已有|假设|若已|如果已/;

/** 取「真正在讲自己手法」的正文：剥掉 frontmatter、代码块、表格前置列 */
function actionableBody(text, mapIdx) {
  let body = text.slice(0, mapIdx);
  body = body.replace(/^---[\s\S]*?---\n/, "");          // frontmatter（含 source/name 等无关行）
  body = body.replace(/```[\s\S]*?```/g, "");             // 代码块（命令示例里的词不算"讲解"）
  // 逐行过滤前提描述
  return body
    .split("\n")
    .filter((ln) => !PREMISE_LINE.test(ln))
    .join("\n");
}

/* 不适用的技能类别：这些技能的正文会大量提到「混淆 / 注入 / 加密」等词，
   但那是**分析对象**而不是它自己的手法。
   实测误报（第一版 18 个里 11 个是这类）：
     radare2 / ida-reverse / ghidra-reverse / pwn-chain / protocol-reverse —— 逆向，看的是被分析的样本
     digital-forensics / threat-hunting / malware-analysis —— 检测与取证，看的是别人的痕迹
     detection-pairing / verification-discipline —— 验证层，本身不执行攻击
   判据：**"谁在讲这件事"** 才决定标注该不该加。不加这条豁免，闸门会逼人去给
   "分析混淆" 的技能标 T1027（混淆），那是错的。 */
const EXEMPT = /^(radare2|ida-reverse|ghidra-reverse|binary-diff|reverse-engineering|go-rust-reverse|dotnet-reverse|js-reverse|thick-client|protocol-reverse|pwn-chain|firmware-pentest|malware-analysis|digital-forensics|threat-hunting|detection-pairing|verification-discipline|attack-traceability|ctf-sandbox|ctf-sandbox-orchestrator|case-review|redteam-setup|kimi-webbridge|browser-automation)$/;

const files = fs.readdirSync(DIR).filter((x) => x.endsWith(".md"));
const problems = [];
const rows = [];

for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(DIR, f), "utf8");
  const mapIdx = text.indexOf("## ATT&CK 映射");
  if (mapIdx < 0) continue;
  if (EXEMPT.test(id)) continue;
  // 正文 = 映射段之前的部分（避免把映射表里的技术名当成"正文在讲"）
  const body = actionableBody(text, mapIdx);
  const seg = text.slice(mapIdx);
  const end = seg.indexOf("\n## ", 3);
  const block = end === -1 ? seg : seg.slice(0, end);
  const ids = new Set([...block.matchAll(/\b(T\d{4}(?:\.\d{3})?)\b/g)].map((m) => m[1]));

  const hitFams = FAMILIES.filter((fam) => fam.re.test(body));
  rows.push({ file: id, ids: ids.size, fams: hitFams.length });

  /* 阈值：正文命中 ≥3 类手法，映射却只有 ≤2 个编号 → 明显标少。
     为什么不用「命中类数 > 编号数」：很多技能正文会顺带提到相邻手法（一句话），
     严格比会大面积误报。≥3 类 vs ≤2 编号这个组合在实测里只命中真缺陷。 */
  if (hitFams.length >= 3 && ids.size <= 2) {
    problems.push({ file: id, fams: hitFams.map((x) => `${x.id}(${x.name})`), ids: ids.size });
  }
}

if (problems.length) {
  console.log(`[check-attack-suff] ✗ ${problems.length} 个技能标注明显不足（正文讲了多类手法，映射只标 1-2 个）：`);
  for (const p of problems) {
    console.log(`   ${p.file}：正文命中 ${p.fams.length} 类 → ${p.fams.join("、")}｜映射只有 ${p.ids} 个编号`);
  }
  console.log("  → 后果：报告里「按 ATT&CK 复核」时这个技能对不上战术，防守方拿不到坐标。");
  process.exit(1);
}

const avg = (rows.reduce((s, r) => s + r.ids, 0) / rows.length).toFixed(1);
console.log(`[check-attack-suff] ✓ ${rows.length} 个技能标注充分（平均 ${avg} 个编号/技能）`);