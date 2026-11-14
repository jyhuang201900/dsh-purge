#!/usr/bin/env node
/**
 * 第 20 关：工具可达性闸门。
 *
 * 为什么要有：模型能看到 56 个 redteam_* 工具，但技能里如果从没提过某个工具，
 * 模型就只能靠工具描述去猜"什么时候该用它"。实测过：31/56（55%）工具零技能点名——
 * 演练台、资产评估、POC 复用、角色稿这四类几乎没人提，等于半个演练台没用上。
 *
 * 判据（任一不满足即失败）：
 *   1. 每个注册工具至少被某一个技能的正文提到（名字出现即算）。
 *   2. 每个工具名必须真的注册过——技能里写了但工具不存在，是幽灵引用（交由 audit 管，
 *      这里只做反向：注册了但没人提，是"哑工具"）。
 *
 * 这条闸门只防"哑工具"，不强制某个工具必须写进哪个技能——写在哪由作者判断。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const toolsSrc = fs.readFileSync(path.join(ROOT, "lib/redteam/tools.js"), "utf8");
const skillDir = path.join(ROOT, "skills/redteam");

/* 注册的工具名：与 audit-skills.mjs 同一口径（引号无关） */
const registered = [...new Set([...toolsSrc.matchAll(/name:\s*.(redteam_[a-z0-9_]+)./g)].map((m) => m[1]))];

if (!registered.length) {
  console.error("[check-tool-reachability] ✗ 没解析出任何注册工具名——tools.js 格式可能变了");
  process.exit(1);
}

const skills = fs.readdirSync(skillDir).filter((f) => f.endsWith(".md"));
const corpus = skills.map((f) => ({
  id: f.replace(/\.md$/, ""),
  text: fs.readFileSync(path.join(skillDir, f), "utf8"),
}));

const silent = [];
for (const name of registered) {
  /* 必须按**词边界**匹配，不能用 includes。
     踩过的坑：redteam_chain 被 redteam_chain_add 的子串蒙过——闸门报"全覆盖"，
     实际那个工具没有任何技能说它何时用。这类假阴性比漏检查更危险：
     闸门变绿让人以为没问题，而真相是工具在裸奔。 */
  const re = new RegExp("\\b" + name + "\\b(?!_)", "");
  const hit = corpus.some((c) => re.test(c.text));
  if (!hit) silent.push(name);
}

const pct = Math.round((silent.length / registered.length) * 100);
console.log(
  `[check-tool-reachability] 注册工具 ${registered.length} 个｜零技能点名 ${silent.length} 个（${pct}%）`
);

if (silent.length) {
  console.log("  ✗ 以下工具模型有、技能里从没说过何时用（等于要靠猜）：");
  for (const s of silent) console.log("     · " + s);
  console.log("  → 修法：按用途把它们写进对应技能（不是每个工具都要写，但每类至少要有入口技能提到）");
  process.exit(1);
}

console.log("  ✓ 全部 56 个工具都有技能提到何时用");
process.exit(0);