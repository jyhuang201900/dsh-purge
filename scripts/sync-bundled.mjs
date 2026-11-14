#!/usr/bin/env node
/**
 * 用途：把仓库随包资源同步到运行时（技能 + 红队预设），幂等。
 * 用法：node scripts/sync-bundled.mjs            # 补缺失（技能缺失直接补；预设内容不同只报告）
 *      node scripts/sync-bundled.mjs --force    # 仓源为准全量覆盖（技能与预设都覆盖）
 *      node scripts/sync-bundled.mjs --dry      # 只报告差异，不写盘
 * 依赖：Node ≥18；只读写文件，不碰宿主、不联网。
 * 验证：2026-11-10：技能 32→69 补齐；预设 agent.cordis.yml 检出真差异（运行时停在 1.1.79 之前的版本）。
 *
 * 为什么要有它：插件有**两套「仓源 ↔ 运行时」的双份资源**，而 dsh 只读运行时那份：
 *   · 技能   skills/redteam/*.md        → ~/.dsh/redteam/skills/      （由预设 customSkillDirs 发现）
 *   · 预设   presets/redteam/*          → ~/.dsh/.agent-presets/redteam/（core.js L5943 读这个路径）
 * 插件代码里只有**读**预设的逻辑（L5943），没有写；仓源改了而不手动同步，运行时就会一直停在旧版本——
 * 第 100 轮实测正是如此：仓源含 1.1.79/1.1.80/1.1.82/1.1.83 四次更新，运行时那份一个都没有。
 *
 * 判据用**规范化内容**（统一行尾、去行尾空白）而不是字节 hash：否则 CRLF/LF 差异会被当成内容不一致，
 * 本项目 two files 实测就因此误报过一次（preset.yml 只差 3 个换行）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dry = argv.includes("--dry");

const norm = (buf) => String(buf).split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).join("\n");

/** 递归列出相对路径（只算文件） */
function walk(dir, base = dir, out = []) {
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, base, out); continue; }
    if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

/* 包内技能副本必须在 BUNDLES 之前算出来：宿主启动时 lib/redteam/index.js:155 会用
   「包内 skills/redteam/*.md」覆盖 $DSH_HOME/redteam/skills。只同步仓源而不管包内，
   宿主一重启就被旧版盖回去（实测：只同步 ~/.dsh/redteam/skills/ 后重启，新内容消失，
   因为包内那份还是 5543 字节的旧文件）。
   动态发现所有 profile 下的 dsh-purge（用户可能装了 desktop 之外的面）。 */
function pluginSkillDirs() {
  const out = [];
  const profilesRoot = path.join(home, "profiles");
  let names = [];
  try { names = fs.readdirSync(profilesRoot); } catch { return out; }
  for (const name of names) {
    const dir = path.join(profilesRoot, name, "node_modules", "dsh-purge", "skills", "redteam");
    if (fs.existsSync(dir)) out.push(dir);
  }
  return out;
}

const BUNDLES = [
  {
    label: "技能",
    src: path.join(root, "skills", "redteam"),
    dst: path.join(home, "redteam", "skills"),
    ext: ".md",
    /* 技能是**生成物**（build-skill-graph 每次重建「链路位置/配套工具/收口必做」段落），
       仓源永远是权威，内容不一致就该覆盖。
       原先这里是 onDiff:"add"（只补缺失），后果很隐蔽：120 个已存在的技能文件
       内容全部落后仓源，跑 sync 一遍"成功"了，但一个字都没更新。
       实测 2026-11-14：包内与仓源 120/120 文件不一致，而同步脚本报「已补齐」。 */
    onDiff: "overwrite",
  },
  ...pluginSkillDirs().map((d) => ({
    label: `技能（包内副本 ${path.basename(path.dirname(path.dirname(path.dirname(d))))}）`,
    src: path.join(root, "skills", "redteam"),
    dst: d,
    ext: ".md",
    onDiff: "overwrite",
    optional: true,
  })),
  {
    label: "红队预设",
    src: path.join(root, "presets", "redteam"),
    dst: path.join(home, ".agent-presets", "redteam"),
    ext: "",
    /* 预设也含**生成物**：`agent.cordis.yml` 里的「阶段→技能」清单是按技能库统计出的表，
       技能数一变它就过期。实测 2026-11-14：运行时那份 `vuln-scan` 只有 21 个技能、
       仓源已 23 个，`flow` 6 vs 9 —— 差的是新加的技能，运行时永远看不到。
       原先这里是 report（怕盖掉用户改动）。但这份文件用户不该手改（改的是仓源），
       所以按生成物处理：覆盖。真要保留本地改动就先提交到仓源。 */
    onDiff: "overwrite",
  },
];

let totalAdded = 0, totalDiff = 0;
for (const b of BUNDLES) {
  const srcFiles = walk(b.src).filter((f) => !b.ext || f.endsWith(b.ext));
  const added = [], diffed = [], missingInRepo = [];
  for (const f of srcFiles) {
    const sp = path.join(b.src, f), dp = path.join(b.dst, f);
    let sbuf = null, dbuf = null;
    try { sbuf = fs.readFileSync(sp, "utf8"); } catch { continue; }
    try { dbuf = fs.readFileSync(dp, "utf8"); } catch { dbuf = null; }
    if (dbuf === null) { added.push(f); continue; }
    if (norm(sbuf) !== norm(dbuf)) { diffed.push(f); continue; }
  }
  // 运行时多出来的（仓源没有）
  for (const f of walk(b.dst).filter((f) => !b.ext || f.endsWith(b.ext))) {
    if (!srcFiles.includes(f)) missingInRepo.push(f);
  }

  /* 三种策略：
     add       → 只补缺失，内容不同不碰（旧行为，适合"运行时可能被人改过"的资源）
     overwrite → 仓源为准，缺失补、内容不同也覆盖（**生成物**类资源该用这个）
     report    → 内容不同只报告，等 --force（最保守）
   force 一律全量覆盖。 */
  const willWrite = force
    ? [...added, ...diffed]
    : (b.onDiff === "overwrite" ? [...added, ...diffed] : (b.onDiff === "add" ? added : []));
  console.log(`  【${b.label}】仓源 ${srcFiles.length}｜运行时 ${srcFiles.length - added.length + missingInRepo.length}` +
    `｜缺失 ${added.length}｜内容不同 ${diffed.length}${missingInRepo.length ? `｜运行时多余 ${missingInRepo.length}` : ""}`);
  if (diffed.length && !force && b.onDiff === "report") {
    console.log(`    内容不同（未覆盖，加 --force 才覆盖）：${diffed.join(", ")}`);
  }
  if (dry) { totalAdded += added.length; totalDiff += diffed.length; continue; }

  fs.mkdirSync(b.dst, { recursive: true });
  let n = 0;
  for (const f of willWrite) {
    const dp = path.join(b.dst, f);
    fs.mkdirSync(path.dirname(dp), { recursive: true });
    fs.copyFileSync(path.join(b.src, f), dp);
    n += 1;
  }
  console.log(`    → 已写 ${n} 个到 ${b.dst.replace(os.homedir(), "~")}`);
  totalAdded += added.length;
  totalDiff += diffed.length;
}

if (dry) {
  console.log(`  【--dry】缺失合计 ${totalAdded}｜内容不同合计 ${totalDiff}（未写盘）`);
} else {
  console.log(`  合计：缺失 ${totalAdded}｜内容不同 ${totalDiff}`);
  if (totalDiff && !force) console.log("  提示：内容不同已按 overwrite 策略覆盖（技能与预设都是生成物，仓源为准）。");
}