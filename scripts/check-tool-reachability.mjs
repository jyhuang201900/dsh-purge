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
const onceOnly = [];
for (const name of registered) {
  /* 必须按**词边界**匹配，不能用 includes。
     踩过的坑：redteam_chain 被 redteam_chain_add 的子串蒙过——闸门报"全覆盖"，
     实际那个工具没有任何技能说它何时用。这类假阴性比漏检查更危险：
     闸门变绿让人以为没问题，而真相是工具在裸奔。 */
  const re = new RegExp("\\b" + name + "\\b(?!_)", "g");
  let hits = 0;
  for (const c of corpus) {
    const m = c.text.match(re);
    if (m) hits += m.length;
  }
  if (hits === 0) silent.push(name);
  /* 「只出现 1 次」是另一类隐形问题：工具只在 redteam-setup 的工具表里被登记一次，
     属于「目录式登记」而非「场景式调用指引」——模型做具体动作时不会去翻 setup 查工具名。
     1.1.103 实测 34/56 属于这种情况（redteam_asset_graph / attack_path / report 都在内），
     改成生成器按 records 自动指路后降到 23。
     阈值 30：留出余量，但只要有人把指路拆掉、或新加一批工具不写进技能，就会撞线。 */
  else if (hits === 1) onceOnly.push(name);
}

const pct = Math.round((silent.length / registered.length) * 100);
const ONCE_LIMIT = 30;

/* 直接守「自动指路的覆盖率」，比间接守「只提及 1 次」更灵敏：
   实测删掉单个技能的指路行，因为同名工具在别处还有指路，「只提及 1 次」计数不变，
   探针抓不到单点退化。覆盖率能抓到。
   基线（1.1.103）：收口必做 107、配套工具 81。阈值留 3~6 个余量。 */
const countWith = (marker) => corpus.filter((c) => c.text.includes(marker)).length;
const verifyRoute = countWith("收口必做");
const toolRoute = countWith("配套工具");
const VERIFY_MIN = 100;
const TOOL_ROUTE_MIN = 75;

console.log(
  `[check-tool-reachability] 注册工具 ${registered.length} 个｜零技能点名 ${silent.length} 个（${pct}%）｜只提及 1 次 ${onceOnly.length} 个（上限 ${ONCE_LIMIT}）\n` +
    `  自动指路覆盖：收口必做 ${verifyRoute} 个技能（下限 ${VERIFY_MIN}）｜配套工具 ${toolRoute} 个（下限 ${TOOL_ROUTE_MIN}）`
);

if (silent.length) {
  console.log("  ✗ 以下工具模型有、技能里从没说过何时用（等于要靠猜）：");
  for (const s of silent) console.log("     · " + s);
  console.log("  → 修法：按用途把它们写进对应技能（不是每个工具都要写，但每类至少要有入口技能提到）");
  process.exit(1);
}
if (onceOnly.length > ONCE_LIMIT) {
  console.log(`  ✗ 只提及 1 次的工具 ${onceOnly.length} 个，超上限 ${ONCE_LIMIT}（去重计数，含词边界）：`);
  for (const s of onceOnly) console.log("     · " + s);
  console.log("  → 「只在 redteam-setup 工具表里登记一次」等于目录式登记：模型做具体动作时不会去翻它。");
  console.log("  → 修法：在对应技能的正文里按场景点名（首选改 build-skill-graph 的自动指路，别手工改 100+ 文件）");
  process.exit(1);
}
if (verifyRoute < VERIFY_MIN) {
  console.log(`  ✗ 「收口必做」指路只覆盖 ${verifyRoute} 个技能（下限 ${VERIFY_MIN}）：限制到 model-tools 的验证层引用会掉回去`);
  process.exit(1);
}
if (toolRoute < TOOL_ROUTE_MIN) {
  console.log(`  ✗ 「配套工具」指路只覆盖 ${toolRoute} 个技能（下限 ${TOOL_ROUTE_MIN}）：数据面工具会退回「只在 setup 登记一次」`);
  process.exit(1);
}

console.log("  ✓ 全部 56 个工具都有技能提到何时用");
process.exit(0);