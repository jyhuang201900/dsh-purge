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

// 4) 条令（AGENTS.md 的「进攻技能路由」+ 注入正文）点名的技能，必须都在 skills/redteam 里
const doctrineFiles = ["AGENTS.md", "lib/default-prompt-inject.md", "lib/default-prompt-inject.zh.md", "lib/default-prompt-inject.en.md"];
const skillSet = new Set(skills);
const missingSkills = [];
for (const rel of doctrineFiles) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue; // 注入源在 gitignore 里，缺失不算错
  const text = fs.readFileSync(fp, "utf8");
  // 只认「反引号包裹 + 出现在技能语境」的名字：形如 `subdomain-bruteforce` 且同段提到 skill/技能
  for (const m of text.matchAll(/`([a-z][a-z0-9]+(?:-[a-z0-9]+){1,4})`/g)) {
    const name = m[1];
    const around = text.slice(Math.max(0, m.index - 220), m.index + 220);
    if (!/技能|skill/i.test(around)) continue;
    if (skillSet.has(name)) continue;
    if (!/^(fofa|passive|recon|active|subdomain|web|asset|dir|nuclei|unauth|credential|webshell|shell|vps|suo5|chisel|frp|gogo|fscan|lateral|browser|kimi|cn-proxy|redteam|secdev|iot|injection|waf|web-vuln)/.test(name)) continue;
    // 排除已知的非技能名（工具/包名/宿主名），只留疑似技能引用
    if (/-\d|\.md|\.js|\.yml|v\d/i.test(name)) continue;
    if (!missingSkills.includes(`${rel} → ${name}`)) missingSkills.push(`${rel} → ${name}`);
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ skills: skills.length, realTools: realTools.size, regCalls, ghostRefs, missingSkills }, null, 1) + "\n");
} else {
  console.log(`弹药层审计：技能 ${skills.length} 个｜注册工具名 ${realTools.size} 个（register ${regCalls} 处）`);
  console.log(`  幽灵工具引用: ${ghostRefs.length ? ghostRefs.slice(0, 8).join(", ") : "0 ✓"}`);
  console.log(`  条令点名但技能不存在: ${missingSkills.length ? missingSkills.slice(0, 8).join(", ") : "0 ✓"}`);
}
const bad = ghostRefs.length > 0 || missingSkills.length > 0 || realTools.size === 0 || skills.length === 0;
process.exit(bad ? 1 : 0);
