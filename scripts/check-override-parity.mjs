#!/usr/bin/env node
/**
 * 第 36 关：用户 override 与出厂注入的**条款覆盖比对**。
 *
 * 为什么必须有这一关：用户 `~/.dsh/prompt-inject.md` 存在且 `override_status: custom` 时，
 * 它**整份替换**出厂条令 —— 改 `lib/default-prompt-inject.md` 对实际行为零影响。
 * 1.1.119 实测：用户稿 30027 字、出厂稿 32030 字，差 2003 字；逐条比对发现
 * 用户稿**缺三条技能链路条款**（「谁归谁」「前后接谁」「走链路的纪律」）——
 * 也就是全库 119 个技能末尾精心生成的「链路位置」章节，在真实运行里**没有读入口**。
 * 这正是 1.1.96 踩过的同一个坑（当时生效稿缺 18/28 条而字数只差 6729），
 * 结论写进了记忆却**没有闸门**，所以复发。
 *
 * 判据（不比字数，比条款）：
 *   1. 出厂稿里每一组「必须出现在生效稿里」的锚点条款，都要在用户稿命中
 *   2. 关键词层用 `includes` 就够（这是「条款在不在」）；语义层由 check-clarify-behavior 管
 *   3. 只读，不改用户文件 —— 本关只报告
 *
 * 为什么锚点要挑「读入口」类条款而不是全部条款：出厂稿有很多重复措辞与示例，
 * 全量比对会产生大量误报（1.1.119 第一次跑，10 条里 7 条是措辞差异的误报）。
 * 真正会伤行为的是**「教会模型怎么用某个机制」的那几条** —— 缺了它们，
 * 机制生成了也用不上（链路位置 / 角色总表 / 落库纪律 / 验证层入口 / 检索入口）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const FACTORY = path.join(ROOT, "lib", "default-prompt-inject.md");
const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const CUSTOM = path.join(HOME, "prompt-inject.md");

if (!fs.existsSync(FACTORY)) {
  console.log("[check-override-parity] 跳过：出厂明文源不在（gitignore，只随包分发）");
  process.exit(0);
}
if (!fs.existsSync(CUSTOM)) {
  console.log("[check-override-parity] 无用户 override（出厂稿直接生效），无需比对");
  process.exit(0);
}

const factory = fs.readFileSync(FACTORY, "utf8");
const custom = fs.readFileSync(CUSTOM, "utf8");

/* 读入口锚点：每组是「机制名 + 该组任一命中词」。
   命中词用**最能代表该机制的短语**，不是原句 —— 用户稿允许改写措辞，
   但机制名几乎不会被换掉（换了模型就认不出来了）。 */
const ANCHORS = [
  {
    name: "技能链路·谁归谁",
    any: ["角色技能库总表", "谁归谁"],
    why: "缺了它，模型不知道 8 个角色各挂哪些技能，会派错人",
  },
  {
    name: "技能链路·链路位置",
    any: ["链路位置"],
    why: "缺了它，全库 119 个技能末尾的「链路位置」章节没有读入口（1.1.119 实测就是这个状态）",
  },
  {
    name: "技能链路·上游下游纪律",
    any: ["上游 → 本技能 → 下游", "上游→本技能→下游", "不要跳步"],
    why: "缺了它，模型会跳步（没做 recon 直接打 exploit）",
  },
  {
    name: "落库纪律",
    any: ["没落库的发现等于没发生"],
    why: "缺了它，发现只停在对话里，报告与统计全空",
  },
  {
    name: "验证层入口",
    any: ["verification-discipline"],
    why: "缺了它，模型不知道打完要证明（误报排除 / 补丁后复测）",
  },
  {
    name: "检索入口",
    any: ["purge_skills", "技能检索"],
    why: "缺了它，模型不知道可以按关键词查技能，只能凭记忆挑",
  },
  {
    name: "确认条款·只问一次",
    /* 措辞不固定：出厂写「只问一次」，而用户稿写「只对第一次开口收一次费」——
       语义等价但字面不同。判据必须落在**约束本身**（一次开口 / 不再问 / 不再等），
       不能只认一个短语，否则误报（1.1.119 第一次跑就把这条误判成缺失）。 */
    any: ["只问一次", "一次开口", "不再问、不再等", "只对第一次开口"],
    why: "缺了它，明确指令会被变成问卷（1.1.93 的核心约束）",
  },
  {
    name: "ATT&CK 映射入口",
    any: ["ATT&CK", "attack-traceability"],
    why: "缺了它，战果不会归到战术编号，检测配对无法对齐",
  },
];

const problems = [];
const hits = [];
for (const a of ANCHORS) {
  const inFactory = a.any.some((k) => factory.includes(k));
  const inCustom = a.any.some((k) => custom.includes(k));
  if (!inFactory) continue; // 出厂稿自己都没有，不算 override 的锅
  if (!inCustom) {
    problems.push({ name: a.name, why: a.why, keys: a.any.join(" / ") });
  } else {
    hits.push(a.name);
  }
}

const delta = factory.length - custom.length;
console.log(`[check-override-parity] 出厂 ${factory.length} 字｜用户 override ${custom.length} 字｜差 ${delta}`);
console.log(`  读入口锚点：${hits.length}/${hits.length + problems.length} 在位`);

if (problems.length) {
  for (const p of problems) {
    console.log(`  ✗ ${p.name}：用户 override 里没有（命中词 ${p.keys}）`);
    console.log(`      → ${p.why}`);
  }
  console.log("  ⚠ 用户 override 整份替换出厂条令 —— 改出厂稿对实际行为零影响，必须同时改用户稿。");
  console.log("    备份位置：~/.dsh/prompt-inject.md.bak-before-*");
  /* 这一关只警告不失败：override 是用户资产，插件不能替用户改，也不该因为用户
     改了自己的提示词就让整个 verify 红。但要让它**每次都出现在输出里**，
     否则会像 1.1.96 那样「记了教训但没人再看见」。 */
  process.exit(0);
}
console.log("  ✓ 用户 override 覆盖了全部读入口锚点（链路位置 / 落库 / 验证层 / 检索 / 确认条款 / ATT&CK）");
process.exit(0);