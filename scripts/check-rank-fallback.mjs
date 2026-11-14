#!/usr/bin/env node
/**
 * 第 33 关：枚举兜底不许把「未知」当成「最差」或「最好」。
 *
 * 由来（1.1.116 实测）：`REVERT_RANK[x] ?? 0` 把未登记的状态悄悄当成 missing（最小值），
 * 后果是 `worseRevertHit('failed','applied')` 返回 'applied' —— **坏结果被成功覆盖**，
 * 而这个函数的注释恰恰写着「坏结果不被成功覆盖」。兜底值把承诺反着做了。
 *
 * 判据：`?? 0` / `|| 0` 出现在「按排名比较」的上下文里 = 可疑；
 * 必须给未知值**显式最高分**（浮上来），不能沉到最低（静默降级）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

/* ① 行为断言：直接复现 worseRevertHit 的三条关键语义 */
{
  const src = fs.readFileSync(path.join(ROOT, "lib", "core.js"), "utf8");
  const mRank = src.match(/const REVERT_RANK = \{[\s\S]*?\};/);
  const mUnk = /const UNKNOWN_RANK = (\d+);/.exec(src);
  const mFn = src.match(/function worseRevertHit[\s\S]*?\n\}/);
  if (!mRank || !mUnk || !mFn) {
    problems.push("lib/core.js 里找不到 REVERT_RANK / UNKNOWN_RANK / worseRevertHit（结构变了要跟着改闸门）");
  } else {
    const code = `${mRank[0]}\nconst UNKNOWN_RANK = ${mUnk[1]};\n${mFn[0]}\nglobalThis.__w = worseRevertHit;`;
    new Function(code)();
    const w = globalThis.__w;
    const cases = [
      /* 坏结果必须压过成功 —— 这是注释里的承诺，也是最初被兜底值反着做的一条 */
      ["failed", "applied", "failed", "失败不能被 applied 覆盖"],
      ["failed", "reverted", "failed", "失败不能被 reverted 覆盖"],
      /* 正常排序 */
      ["applied", "missing", "missing", "missing 要比 applied 更坏"],
      /* 未知值必须浮上来，不能沉到最低 */
      ["某个没登记的状态", "applied", "某个没登记的状态", "未知状态不能被 applied 压掉"],
      /* error: 前缀始终最优先 */
      ["error:boom", "failed", "error:boom", "error: 必须最优先"],
    ];
    for (const [a, b, want, why] of cases) {
      const got = w(a, b);
      if (got !== want) problems.push(`worseRevertHit('${a}','${b}') = '${got}'，应 '${want}'（${why}）`);
    }
  }
}

/* ② 静态扫描：`?? 0` / `|| 0` 用在排名比较里 = 高危模式 */
{
  const files = [];
  for (const dir of ["lib", "lib/redteam"]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".js")) files.push(path.join(abs, f));
    }
  }
  const risky = [];
  for (const f of files) {
    /* 必须先整文件剥块注释再逐行看：逐行剥只能处理单行块注释，
       而本仓习惯写多行块注释讲坑（APPLY_STATUS_RANK 那段就是），
       逐行剥会漏掉块注释的中间行，把讲解文字当成问题报红。 */
    const raw = fs.readFileSync(f, "utf8");
    const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    const lines = noBlock.split(/\r?\n/);
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      /* 只看 "RANK" / "PRIORITY" 这类命名里出现 ?? 0 / || 0 */
      if (/(RANK|PRIORITY)[A-Z_]*\[[^\]]+\]\s*(\?\?|\|\|)\s*0\b/.test(code)) {
        risky.push(`${path.relative(ROOT, f)}:${i + 1} ${fs.readFileSync(f, "utf8").split(/\r?\n/)[i].trim()}`);
      }
    });
  }
  for (const r of risky) problems.push(`排名表用 ?? 0 兜底（未知值会沉到最低）：${r}`);
}

console.log("[check-rank-fallback] 枚举兜底语义检查");
if (problems.length) {
  for (const p of problems.slice(0, 8)) console.log(`  ✗ ${p}`);
  console.log("  → 未知值必须给显式最高分，让它浮上来；静默当成最差比报错更危险。");
  process.exit(1);
}
console.log("  ✓ 坏结果压过成功｜未知值浮上来｜排名表无 ?? 0 兜底");
process.exit(0);
