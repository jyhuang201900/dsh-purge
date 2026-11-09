#!/usr/bin/env node
/**
 * 用途：把「仓库 → 宿主 profile 插件副本」这条重复手工动作固化成一条命令（自更新走 COPY_NAMES，首装走 pnpm，两者都要手动同步）。
 * 用法：node scripts/host-sync.mjs [--profile desktop] [--home <.dsh>] [--dry-run] [--no-update]
 * 依赖：Node ≥18；git（取 HEAD SHA）；pnpm 取 PATH，找不到则回退 $HOME/dsh-runtimes/dsh-primary-runtime/dependencies/{node/bin/node.exe, pnpm/bin/pnpm.cjs}。
 * 验证：2026-11-09 在 dsh-purge 实跑通过 —— specifier 从 45639a2 推进，副本 version=1.1.84，退出码 0。
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
const noUpdate = argv.includes("--no-update");
const home = path.resolve(arg("home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));

function die(msg) {
  process.stderr.write(`[host-sync] ${msg}\n`);
  process.exit(1);
}

const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) die(`git rev-parse 失败：${(head.stderr || "").trim()}`);
const sha = head.stdout.trim();

const pkgPath = path.join(home, "profiles", profile, "package.json");
if (!fs.existsSync(pkgPath)) die(`找不到 profile 清单：${pkgPath}`);
const text = fs.readFileSync(pkgPath, "utf8");
const m = /tar\.gz\/([0-9a-f]{7,40})/.exec(text);
if (!m) die(`${pkgPath} 里 dsh-purge 不是 codeload tar.gz 形式（可能装的是 file: 或 npm 版本），本脚本不猜路径，请手动同步`);
const before = m[1];
process.stdout.write(`profile=${profile}\nSHA: ${before.slice(0, 7)} → ${sha.slice(0, 7)}\n`);

if (before === sha) {
  process.stdout.write("已经是最新，无需改动 ✓\n");
} else if (dryRun) {
  process.stdout.write("dry-run：未写盘、未跑 pnpm\n");
} else {
  fs.writeFileSync(pkgPath, text.replace(before, sha), "utf8");
  if (noUpdate) {
    process.stdout.write("只改了 specifier（--no-update）\n");
  } else {
    const runtime = path.join(home, "dsh-runtimes", "dsh-primary-runtime", "dependencies");
    const nodeBin = path.join(runtime, "node", "bin", "node.exe");
    const pnpmCli = path.join(runtime, "pnpm", "bin", "pnpm.cjs");
    const useRuntime = fs.existsSync(nodeBin) && fs.existsSync(pnpmCli);
    const cmd = useRuntime ? nodeBin : "node";
    const prefix = useRuntime ? [pnpmCli] : [];
    const res = spawnSync(cmd, [...prefix, "update", "dsh-purge", "--reporter=silent"], {
      cwd: path.join(home, "profiles", profile),
      encoding: "utf8",
      shell: false,
    });
    if (res.status !== 0) die(`pnpm update 退出码 ${res.status}：${(res.stderr || res.stdout || "").trim().split("\n").slice(-2).join(" / ")}`);
  }
}

// 复验：读副本清单确认版本与 SHA，别只说「跑完了」。
const copyPkg = path.join(home, "profiles", profile, "node_modules", "dsh-purge", "package.json");
if (fs.existsSync(copyPkg)) {
  const c = JSON.parse(fs.readFileSync(copyPkg, "utf8"));
  process.stdout.write(`副本 version=${c.version} dshTarget=${c.dshTarget || "-"} ✓\n`);
} else {
  process.stdout.write("副本 package.json 还没出现（pnpm 未装完？）\n");
}
