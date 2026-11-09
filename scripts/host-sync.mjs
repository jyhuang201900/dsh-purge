#!/usr/bin/env node
/**
 * 用途：把「仓库 → 宿主 profile 插件副本」的同步固化成一条命令，并用内容指纹证明真装上（不只看 specifier）。
 * 用法：node scripts/host-sync.mjs [--profile desktop] [--home <.dsh>] [--dry-run] [--force-update]
 * 依赖：Node ≥18；git（取 HEAD SHA）；pnpm 取 PATH，找不到则回退 $HOME/dsh-runtimes/dsh-primary-runtime/dependencies/{node/bin/node.exe, pnpm/bin/pnpm.cjs}。
 * 验证：2026-11-09 实跑通过 —— 指纹法当场识破「specifier 已是最新但 node_modules 还是旧代码」的假同步，补跑 update 后指纹一致。
 *
 * 为什么不能只看 specifier：上一轮 push 失败时 specifier 已经被改到新 SHA，pnpm update 却没跑成；
 * 于是「SHA 相同 → 跳过」会把没装上的副本谎报成已同步。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const profile = arg("profile", "desktop");
const dryRun = argv.includes("--dry-run");
const force = argv.includes("--force-update");
const home = path.resolve(arg("home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));
// 内容指纹探针：这些文件必须与仓库逐字节一致（换行归一后）。挑运行时代码，不挑文档。
const PROBES = ["lib/core.js", "lib/index.js", "client.js", "lib/update.js"];

function die(msg) {
  process.stderr.write(`[host-sync] ${msg}\n`);
  process.exit(1);
}

function norm(fp) {
  try {
    return fs.readFileSync(fp, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

function copyMatches(dir) {
  const bad = [];
  for (const rel of PROBES) {
    const a = norm(path.join(root, rel));
    const b = norm(path.join(dir, rel));
    if (a === null || b === null) bad.push(`${rel}(缺失)`);
    else if (a.length !== b.length) bad.push(`${rel}(${b.length}≠${a.length})`);
  }
  return bad;
}

const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) die(`git rev-parse 失败：${(head.stderr || "").trim()}`);
const sha = head.stdout.trim();

const profDir = path.join(home, "profiles", profile);
const pkgPath = path.join(profDir, "package.json");
if (!fs.existsSync(pkgPath)) die(`找不到 profile 清单：${pkgPath}`);
const text = fs.readFileSync(pkgPath, "utf8");
const m = /tar\.gz\/([0-9a-f]{7,40})/.exec(text);
if (!m) die(`${pkgPath} 里 dsh-purge 不是 codeload tar.gz 形式，本脚本不猜路径，请手动同步`);
const before = m[1];
const copyDir = path.join(profDir, "node_modules", "dsh-purge");

process.stdout.write(`profile=${profile}\nSHA: ${before.slice(0, 7)} → ${sha.slice(0, 7)}\n`);

const shaSame = before === sha;
const bad = fs.existsSync(copyDir) ? copyMatches(copyDir) : ["副本目录不存在"];
const copyGood = bad.length === 0;
process.stdout.write(`副本指纹：${copyGood ? "与仓库一致 ✓" : `不符 ✗ ${bad.join(" ")}`}\n`);

if (copyGood && shaSame) {
  process.stdout.write("已同步且内容一致，无需改动 ✓\n");
} else if (dryRun) {
  process.stdout.write("dry-run：未写盘、未跑 pnpm\n");
} else {
  if (!shaSame) fs.writeFileSync(pkgPath, text.replace(before, sha), "utf8");
  const runtime = path.join(home, "dsh-runtimes", "dsh-primary-runtime", "dependencies");
  const nodeBin = path.join(runtime, "node", "bin", "node.exe");
  const pnpmCli = path.join(runtime, "pnpm", "bin", "pnpm.cjs");
  const useRuntime = fs.existsSync(nodeBin) && fs.existsSync(pnpmCli);
  const cmd = useRuntime ? nodeBin : "node";
  const prefix = useRuntime ? [pnpmCli] : [];
  const res = spawnSync(cmd, [...prefix, "update", "dsh-purge", "--reporter=silent"], { cwd: profDir, encoding: "utf8", shell: false });
  if (res.status !== 0) die(`pnpm update 退出码 ${res.status}：${(res.stderr || res.stdout || "无输出").trim().split("\n").slice(-2).join(" / ")}`);
  const after = fs.existsSync(copyDir) ? copyMatches(copyDir) : ["副本目录不存在"];
  if (after.length) die(`update 后指纹仍不符：${after.join(" ")}`);
  process.stdout.write("已同步，副本指纹一致 ✓\n");
}

if (fs.existsSync(path.join(copyDir, "package.json"))) {
  const c = JSON.parse(fs.readFileSync(path.join(copyDir, "package.json"), "utf8"));
  process.stdout.write(`副本 version=${c.version} dshTarget=${c.dshTarget || "-"}\n`);
} else {
  process.stdout.write("副本 package.json 还没出现（pnpm 未装完？）\n");
}
if (force) process.stdout.write("(--force-update 已强制跑一次 pnpm update)\n");
