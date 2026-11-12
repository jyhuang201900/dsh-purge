#!/usr/bin/env node
/**
 * 用途：toolkit 定时巡检——只回答一个问题：「有没有工具被安全软件删了、目录空着」。
 * 用法：node scripts/watch-toolkit.mjs [--json]
 * 依赖：Node ≥18；只读目录，不下载、不启动工具。
 * 退出码：0 = 无空壳｜1 = 有空壳（该加白名单再重装）｜2 = toolkit 目录不存在（一个都没装，不算故障）。
 *
 * 为什么单独成脚本（第 150 轮）：空壳检测接在 check-tools 里，只有人跑 verify 时才会被执行。
 * suo5 那晚的形态是「目录在、零 exe」，所有闸门全绿——因为没人去看。定时跑这一条，
 * 才能在文件消失的当天就知道，而不是等到要用 suo5 起隧道时才发现。
 *
 * 挂定时任务（Windows 任务计划 / cron 皆可），例如每天 09:00：
 *   node scripts/watch-toolkit.mjs --json
 * 红了才需要人看；绿了就是一句话。
 */
import process from "node:process";
import { scanToolkit, describeToolkit, shellAdvice } from "../lib/toolkit-health.js";

const asJson = process.argv.includes("--json");
const scan = scanToolkit();

if (asJson) {
  process.stdout.write(`${JSON.stringify(scan, null, 1)}\n`);
} else {
  console.log(describeToolkit(scan));
  const advice = shellAdvice(scan);
  if (advice) console.log(`  ✗ ${advice}`);
}

if (!scan.exists) process.exit(2);
process.exit(scan.shells.length ? 1 : 0);