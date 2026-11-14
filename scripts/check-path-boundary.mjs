#!/usr/bin/env node
/**
 * 第 22 关：路径边界自测（symlink 逃逸）。
 *
 * 为什么要有：`assertPathWithin` 守的是截图 / POC / 攻击文件这些「记录里带的路径」，
 * 而记录内容能被写库工具影响（用户/AI 都能填 file 字段）。第一版只做字符串前缀比对，
 * 实测 `.cache/ptest/allowed/link -> ../secret` 能通过并读出根外文件——8 处调用点全部受影响。
 *
 * 这类漏洞的特点：**正常路径全绿，只有构造 symlink 才暴露**。靠人眼审代码看不出来，
 * 必须实测。所以做成闸门：在临时目录里真造一个 symlink，跑一遍，看是否被拦。
 *
 * 判据：
 *   1. 经符号链接指向根外 → 必须抛错
 *   2. 字面 `..` 穿越 → 必须抛错
 *   3. 根内真实文件 → 必须放行（不许误拦）
 *   4. 根内不存在的新文件 → 必须放行（新建场景，不能被误拦）
 *   5. 根本身 → 必须放行
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(process.argv[2] || ".");
const validatePath = path.join(ROOT, "lib", "redteam", "validate.js");

if (!fs.existsSync(validatePath)) {
  console.error("[check-path-boundary] ✗ 找不到 lib/redteam/validate.js");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-path-"));
const allowed = path.join(tmp, "allowed");
const secret = path.join(tmp, "secret");
fs.mkdirSync(allowed, { recursive: true });
fs.mkdirSync(secret, { recursive: true });
fs.writeFileSync(path.join(secret, "key.txt"), "SECRET\n", "utf8");
fs.writeFileSync(path.join(allowed, "real.txt"), "ok\n", "utf8");

let linkMade = false;
try {
  fs.symlinkSync(path.join("..", "secret"), path.join(allowed, "link"), "dir");
  linkMade = true;
} catch {
  // Windows 无权限建 symlink 时无法构造该场景，明确跳过而不是假装通过
}

const mod = await import(pathToFileURL(validatePath).href);
const { assertPathWithin } = mod;

const results = [];
function rejectCase(label, target) {
  try {
    assertPathWithin(target, [allowed]);
    results.push({ ok: false, label, why: "未拦截（逃逸成功）" });
  } catch {
    results.push({ ok: true, label });
  }
}
function passCase(label, target) {
  try {
    assertPathWithin(target, [allowed]);
    results.push({ ok: true, label });
  } catch (e) {
    results.push({ ok: false, label, why: "误拦：" + String(e.message).slice(0, 60) });
  }
}

if (linkMade) rejectCase("符号链接逃逸", path.join(allowed, "link", "key.txt"));
rejectCase("字面 .. 穿越", path.join(allowed, "..", "secret", "key.txt"));
passCase("根内真实文件", path.join(allowed, "real.txt"));
passCase("根内不存在的新文件", path.join(allowed, "newfile.txt"));
passCase("根本身", allowed);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }

const failed = results.filter((r) => !r.ok);
console.log(
  `[check-path-boundary] 用例 ${results.length} 个｜通过 ${results.length - failed.length}｜失败 ${failed.length}` +
    (linkMade ? "" : "｜symlink 用例跳过（当前环境不允许建符号链接）")
);
if (failed.length) {
  for (const f of failed) console.log(`  ✗ ${f.label}：${f.why}`);
  console.log("  → 路径边界失守意味着写库时填一个带 symlink 的路径就能读到靶标目录外的文件。必须修。");
  process.exit(1);
}
console.log("  ✓ symlink 逃逸与字面穿越均被拦截，正常路径未误拦");
process.exit(0);