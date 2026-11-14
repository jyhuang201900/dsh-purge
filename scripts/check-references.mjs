#!/usr/bin/env node
/**
 * 第 21 关：references 引用完整性。
 *
 * 为什么要有：技能正文里写着「Load references/xxx.md 看检查清单」，但文件不存在——
 * 这是**承诺了却给不出内容**。实测过：153 处引用里 149 处指向不存在的文件，
 * 全库只有 2 个 references 文件。模型照着找会扑空，而且它无法区分
 * 「我不知道」和「文件丢了」，只会当成自己没找到。
 *
 * 这种断链任何代码闸门都看不见：references 不在代码路径上，技能本身语法正确、
 * 能加载、能检索。只有「承诺 vs 实物」的比对能发现。
 *
 * 判据：
 *   1. 技能正文中 `references/xxx.md` 形式的引用，必须存在对应文件。
 *      查找顺序：<skills>/references/<rel>、<skills>/references/<skill-id>/<rel>
 *      （后者是渐进披露的目录式布局）
 *   2. 允许 `../xxx/references/...` 跨技能引用，按相对路径解析。
 *
 * 退出码：0 = 全部存在；1 = 有缺失（附清单）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const SKILLS = path.join(ROOT, "skills", "redteam");
const REFROOT = path.join(SKILLS, "references");

if (!fs.existsSync(SKILLS)) {
  console.error("[check-references] ✗ 技能目录不存在：" + SKILLS);
  process.exit(1);
}

const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
const missing = [];
const ok = [];
let total = 0;

for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(SKILLS, f), "utf8");
  /* 抓两种形态：
     - references/xxx.md（本技能目录下）
     - ../<other>/references/xxx.md（跨技能）
     都归一到「相对 skills/redteam 的路径」上判断。 */
  for (const m of text.matchAll(/(\.\.\/[\w\-]+\/)?references\/([\w\-.\/]+\.md)/g)) {
    const rel = m[2];
    const crossSkill = m[1] ? m[1].replace(/^\.\.\//, "").replace(/\/$/, "") : "";
    total += 1;
    const cands = [];
    if (crossSkill) {
      cands.push(path.join(SKILLS, crossSkill, "references", rel));
      cands.push(path.join(SKILLS, "references", rel)); // 也允许集中存放
    } else {
      cands.push(path.join(REFROOT, rel));
      cands.push(path.join(REFROOT, id, rel));
    }
    if (cands.some((p) => fs.existsSync(p))) ok.push(`${id} → ${rel}`);
    else missing.push(`${id} → ${rel}`);
  }
}

const pct = total ? Math.round((ok.length / total) * 100) : 100;
console.log(`[check-references] 引用 ${total} 处｜存在 ${ok.length}｜缺失 ${missing.length}（覆盖 ${pct}%）`);

if (missing.length) {
  /* 按目标文件聚合：一个文件可能被多个技能引用，修一次就消多条 */
  const byTarget = new Map();
  for (const m of missing) {
    const [id, rel] = m.split(" → ");
    if (!byTarget.has(rel)) byTarget.set(rel, []);
    if (!byTarget.get(rel).includes(id)) byTarget.get(rel).push(id);
  }
  console.log(`  ✗ 缺失文件 ${byTarget.size} 个（涉及 ${missing.length} 处引用）：`);
  for (const [rel, users] of [...byTarget.entries()].sort()) {
    console.log(`     references/${rel}  ← ${users.join(", ")}`);
  }
  console.log("  → 修法：要么写出该文件（真内容，不是占位符），要么删掉技能里的引用句。");
  console.log("    不许留「承诺了但给不出」的引用——模型照找会扑空且无法自知。");
  process.exit(1);
}

console.log(`  ✓ 全部 ${total} 处 references 引用都指向真实文件`);
process.exit(0);