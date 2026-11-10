#!/usr/bin/env node
/**
 * 用途：弹药层一致性审计——红队技能正文引用的工具名 / 条令里点名的技能，必须都真实存在。
 * 用法：node scripts/audit-skills.mjs [--json]
 * 依赖：Node ≥18；只读仓库文件，不碰宿主、不需要 store。
 * 验证：2026-11-09 首跑：skills 32 / 注册工具 56 / 幽灵引用 0 / 条令点名缺失 0（从 .cache 版提升为仓内并接进 verify 关 9）。
 *
 * 为什么值得有一道门：技能正文写的是工具名，条令写的是技能名 —— 两边改名都会静默说谎，
 * 而这类"引用不存在的东西"我们已经真踩过（上游文档里的 redteam_asset_upsert）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

// 1) 技能清单
const skillDir = path.join(root, "skills", "redteam");
const skills = fs.readdirSync(skillDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));

// 2) 预设面真实注册的工具名（引号无关：tools.js 用单引号，别用只吃双引号的正则）
const toolsSrc = fs.readFileSync(path.join(root, "lib", "redteam", "tools.js"), "utf8");
const realTools = new Set([...toolsSrc.matchAll(/name:\s*.(redteam_[a-z0-9_]+)./g)].map((m) => m[1]));
const regCalls = (toolsSrc.match(/tools\.register\(/g) || []).length;

// 3) 技能正文引用的 redteam_* —— 不存在的就是幽灵引用
const ghostRefs = [];
for (const s of skills) {
  const text = fs.readFileSync(path.join(skillDir, `${s}.md`), "utf8");
  for (const m of text.matchAll(/\b(redteam_[a-z0-9_]+)\b/g)) {
    if (!realTools.has(m[1])) ghostRefs.push(`${s}.md → ${m[1]}`);
  }
}

// 4) 条令（AGENTS.md 的「进攻技能路由」+ 注入正文）点名的技能，必须都在 skills/redteam 里。
//    lib/model-tools.js 也纳入：drill summary 的「下一步」会点名该加载哪个技能，
//    那些名字同样必须真实存在（否则日常会话照着调就撞空），纳入后才不会漂。
const doctrineFiles = ["AGENTS.md", "lib/default-prompt-inject.md", "lib/default-prompt-inject.zh.md", "lib/default-prompt-inject.en.md", "lib/model-tools.js"];
const skillSet = new Set(skills);
const missingSkills = [];
for (const rel of doctrineFiles) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue; // 注入源在 gitignore 里，缺失不算错
  const text = fs.readFileSync(fp, "utf8");
  // 4a) 代码里的显式标记 SK("name")：函数名即契约——SK 只用于技能名，所以这里必须是真技能，
  //     且不受前缀白名单限制。（第 108 轮踩到两点：① 技能名走函数拼接，源码里没有字面反引号，
  //      只扫反引号的写法对这个文件完全失效（实测「反引号名 0」）；② 先用通用 S() 扫，
  //      结果 S("asset") 这类实体名被误判成缺失技能——所以专门分出 SK()。）
  for (const m of text.matchAll(/\bSK\(\s*["']([a-z][a-z0-9-]{2,40})["']\s*\)/g)) {
    const name = m[1];
    if (skillSet.has(name)) continue;
    if (!missingSkills.includes(`${rel} → ${name}`)) missingSkills.push(`${rel} → ${name}（SK() 声明为技能）`);
  }
  // 4b) 文档里的反引号形式：只认「反引号包裹 + 出现在技能语境」的名字
  for (const m of text.matchAll(/`([a-z][a-z0-9]+(?:-[a-z0-9]+){1,4})`/g)) {
    const name = m[1];
    const around = text.slice(Math.max(0, m.index - 220), m.index + 220);
    if (!/技能|skill/i.test(around)) continue;
    if (skillSet.has(name)) continue;
    // 前缀白名单：只查「看起来像技能名」的。第 108 轮补全过一次——原来的名单漏了
    // netexec / windows / ctf / identity / cloud / ot / edr 等开头，导致「点名了但不存在」漏检。
    if (!/^(fofa|passive|recon|active|subdomain|web|asset|dir|nuclei|unauth|credential|webshell|shell|vps|suo5|chisel|frp|gogo|fscan|netexec|lateral|windows|identity|cloud|ot|iot|edr|threat|digital|malware|hardware|radio|wifi|reverse|ida|ghidra|radare|pwn|patch|binary|protocol|dotnet|js|apk|mobile|browser|kimi|cn-proxy|redteam|secdev|injection|waf|web-vuln|api|code|database|email|llm|supply|privesc|oob|thick|competition|ctf|case|pentest|attack|go-rust)/.test(name)) continue;
    // 排除已知的非技能名（工具/包名/宿主名），只留疑似技能引用
    if (/-\d|\.md|\.js|\.yml|v\d/i.test(name)) continue;
    if (!missingSkills.includes(`${rel} → ${name}`)) missingSkills.push(`${rel} → ${name}`);
  }
}

// ── 链路层校验（第 106 轮加）：技能不能是散落的 .md ──
// 索引/关系/角色档案是构建产物，技能目录是源；两者一旦不同步，链路就不再描述现实，
// 而「有 114 个技能」和「只有几个会被用到」会重新变成同一件事。所以这里硬校验。
const linkProblems = [];
try {
  const ids = skills.map((f) => f.replace(/\.md$/, ""));
  const idxPath = path.join(root, "lib", "generated", "skills-index.json");
  const relPath = path.join(root, "lib", "generated", "skills-relations.json");
  const agtPath = path.join(root, "lib", "generated", "skills-agents.json");
  if (!fs.existsSync(idxPath) || !fs.existsSync(relPath) || !fs.existsSync(agtPath)) {
    linkProblems.push("链路产物缺失（跑 npm run build:skills-graph）");
  } else {
    const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
    const rel = JSON.parse(fs.readFileSync(relPath, "utf8"));
    const agt = JSON.parse(fs.readFileSync(agtPath, "utf8"));
    const idxIds = new Set(idx.skills.map((s) => s.id));
    const miss = ids.filter((x) => !idxIds.has(x));
    const extra = [...idxIds].filter((x) => !ids.includes(x));
    if (miss.length) linkProblems.push(`索引缺 ${miss.length} 个技能：${miss.slice(0, 3).join(", ")}`);
    if (extra.length) linkProblems.push(`索引多 ${extra.length} 个已不存在的技能：${extra.slice(0, 3).join(", ")}`);
    const zeroIn = ids.filter((x) => !rel.relations.some((r) => r.target === x));
    if (zeroIn.length) linkProblems.push(`零入边 ${zeroIn.length} 个：${zeroIn.slice(0, 3).join(", ")}`);
    const noLink = ids.filter((x) => !fs.readFileSync(path.join(root, "skills", "redteam", x + ".md"), "utf8").includes("skill-link-graph"));
    if (noLink.length) linkProblems.push(`缺链路章节 ${noLink.length} 个：${noLink.slice(0, 3).join(", ")}`);
    const assigned = new Set(Object.values(agt.roles).flatMap((r) => r.skills));
    const unassigned = ids.filter((x) => !assigned.has(x));
    if (unassigned.length) linkProblems.push(`未被任何角色挂载 ${unassigned.length} 个：${unassigned.slice(0, 3).join(", ")}`);
    // 落库实体必须 ∈ 演练台合法值（真值取自 purge_drill 的 entity 参数）：
    // 技能里写一个演练台不认的实体名，模型照着调就撞空——第 106 轮实测抓到一个 `chain`（应为 `stage`）。
    const LEDGER = new Set(["vuln", "credential", "access", "webshell", "tunnel", "http", "shot", "prompt", "scorepoint", "stage", "asset", "poc"]);
    const badRec = idx.skills.flatMap((s) => (s.records || []).filter((r) => !LEDGER.has(r)).map((r) => `${s.id}→${r}`));
    if (badRec.length) linkProblems.push(`落库实体不在演练台：${badRec.slice(0, 3).join(", ")}`);
  }
} catch (e) {
  linkProblems.push(`链路校验异常：${String((e && e.message) || e).slice(0, 50)}`);
}

if (asJson) {
  process.stdout.write(JSON.stringify({ skills: skills.length, realTools: realTools.size, regCalls, ghostRefs, missingSkills, linkProblems }, null, 1) + "\n");
} else {
  console.log(`弹药层审计：技能 ${skills.length} 个｜注册工具名 ${realTools.size} 个（register ${regCalls} 处）`);
  console.log(`  幽灵工具引用: ${ghostRefs.length ? ghostRefs.slice(0, 8).join(", ") : "0 ✓"}`);
  console.log(`  条令点名但技能不存在: ${missingSkills.length ? missingSkills.slice(0, 8).join(", ") : "0 ✓"}`);
  console.log(`  链路层（索引/关系/角色 ↔ 技能目录）: ${linkProblems.length ? linkProblems.slice(0, 3).join("｜") : `一致、零入边 0、角色无遗漏 ✓`}`);
}
const bad = ghostRefs.length > 0 || missingSkills.length > 0 || realTools.size === 0 || skills.length === 0 || linkProblems.length > 0;
process.exit(bad ? 1 : 0);
