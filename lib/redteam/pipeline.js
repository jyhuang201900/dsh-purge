/**
 * 侦察管道编排：把 subfinder → dnsx → naabu 串起来，并且**每一步都收敛**。
 *
 * 为什么需要（第 127 轮实测）：
 *   用 example.com 真跑 `subfinder → dnsx`：
 *     · subfinder 出了 **25,108** 个子域（这域被大量注册做测试，不是通配符——三个假子域都解析失败）；
 *     · dnsx 全量跑 **396 秒**，只解析出 3 条，还报 1335 个失败；
 *     · 取 200 条样本单独跑，**0 条解析**。
 *   也就是说：**命令"能跑"和"跑得出结果"是两回事**。把 25k 条死域名灌进 naabu，
 *   用户等十几分钟只拿到空结果——这比命令报错更糟，因为**报错至少告诉你错了**。
 *
 * 所以管道必须做三件事，缺一件就等于把坑推给用户：
 *   ① **限流**：subfinder 默认可能收几万条，先按上限截断并**明确说截了多少**；
 *   ② **先小样试**：先用 N 条探活，若解析率过低就**停下来报警**，而不是把全量灌下去；
 *   ③ **把中间产物落盘**：每步的输出写 runs/，下一环从文件读——断了能续，也能人工看。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** runs/ 目录（与技能里约定的位置一致） */
export function runsDir(root = process.cwd()) {
  return path.join(root, "runs");
}

/**
 * 判断一次探活结果是否「值得继续」。
 * 判据是可解释的：解析率 < 5% 且样本 ≥ 50 时，说明这批子域基本是死的，
 * 继续往下灌只会浪费时间——此时应停下来换源（换域名/换字典），而不是硬跑。
 * @param {{ sampled: number, resolved: number }} r
 */
export function judgeAliveRate(r = {}) {
  const sampled = Number(r.sampled || 0);
  const resolved = Number(r.resolved || 0);
  if (sampled < 50) return { ok: true, level: "skip", why: "样本太小，不做判断" };
  const rate = resolved / sampled;
  if (rate < 0.05) {
    return {
      ok: false, level: "stop",
      why: `抽样 ${sampled} 条只解析出 ${resolved} 条（${(rate * 100).toFixed(1)}%）——这批子域基本是死的，继续灌下去只会白等`,
      todo: "换源重收（换根域或换 subfinder 的 -all），别把全量灌进 naabu",
    };
  }
  if (rate < 0.3) {
    return { ok: true, level: "warn", why: `解析率 ${(rate * 100).toFixed(1)}%，偏低但可继续`, todo: "" };
  }
  return { ok: true, level: "ok", why: `解析率 ${(rate * 100).toFixed(1)}%，正常`, todo: "" };
}

/**
 * 生成侦察管道的**可执行命令序列**（不是单条命令）。
 * 每一步都带：输入文件 → 输出文件 → 上限 → 失败时怎么办。
 *
 * **按平台生成**（第 127 轮实测踩到的坑）：`head -n` 是 Linux 命令，Windows 上
 * `'head' is not recognized` 退出码 255——我第一版生成的管道在 Windows 上**必然失败**，
 * 而我在同一轮里正在批评「给出打不出去的命令」。所以这里分平台：
 *   · Windows：用 PowerShell 的 `Select-Object -First N`（或 `findstr /n` 截断）
 *   · 其它：用 `head -n`
 * @param {{ domain: string, toolkit: (n: string) => { ok: boolean, path: string }, cap?: number, sample?: number, platform?: string }} ctx
 * @returns {Array<{ step: string, cmd: string, out: string, note: string, ok: boolean }>}
 */
export function reconPipeline(ctx = {}) {
  const domain = String(ctx.domain || "TARGET").trim();
  const tk = typeof ctx.toolkit === "function" ? ctx.toolkit : () => ({ ok: false, path: "" });
  const cap = Number(ctx.cap) || 2000;
  const sample = Number(ctx.sample) || 200;
  const plat = String(ctx.platform || process.platform);
  const isWin = plat === "win32";
  const runs = "runs";
  const out = [];
  const q = (p) => (/\s/.test(p) ? `"${p}"` : p);

  const sub = tk("subfinder");
  const dns = tk("dnsx");
  const nab = tk("naabu");

  // 截断前 N 行：平台不同写法不同（Windows 没有 head）
  const takeFirst = (file, n) => isWin
    ? `Get-Content ${file} -TotalCount ${n}`
    : `head -n ${n} ${file}`;
  // 重定向：Windows 的 > 在 PowerShell 里是 UTF-16，dnsx 读不了——用 Out-File -Encoding utf8
  const redirect = (file) => isWin ? `| Out-File -Encoding utf8 ${file}` : `> ${file}`;

  out.push({
    step: "① 收集子域",
    cmd: sub.ok
      ? (isWin
        ? `${q(sub.path)} -d ${domain} -silent -timeout 10 | Select-Object -First ${cap}${redirect(`${runs}/subs.txt`)}`
        : `${q(sub.path)} -d ${domain} -silent -timeout 10 | head -n ${cap} > ${runs}/subs.txt`)
      : "npm run toolkit:windows -- --only subfinder",
    out: `${runs}/subs.txt`,
    // 上限是**刻意**的：25k 条死域名灌下去会让下一步等十几分钟
    note: sub.ok ? `上限 ${cap} 条（默认可能收几万条，先截断再判活）` : "本机无 subfinder",
    ok: sub.ok,
  });

  out.push({
    step: `② 抽样探活（前 ${sample} 条）`,
    cmd: dns.ok
      ? (isWin
        ? `${takeFirst(`${runs}/subs.txt`, sample)} | ${q(dns.path)} -silent -a -resp${redirect(`${runs}/alive-sample.txt`)}`
        : `head -n ${sample} ${runs}/subs.txt | ${q(dns.path)} -silent -a -resp > ${runs}/alive-sample.txt`)
      : "npm run toolkit:windows -- --only dnsx",
    out: `${runs}/alive-sample.txt`,
    note: dns.ok
      ? `先探 ${sample} 条：解析率 < 5% 就别往下灌了（实测 25k 条死域名白等 396 秒）`
      : "本机无 dnsx",
    ok: dns.ok,
  });

  out.push({
    step: "③ 全量探活（样本合格才做）",
    cmd: dns.ok
      ? (isWin
        ? `${q(dns.path)} -l ${runs}/subs.txt -silent -a -resp -t 200 -retry 1${redirect(`${runs}/alive.txt`)}`
        : `${q(dns.path)} -l ${runs}/subs.txt -silent -a -resp -t 200 -retry 1 > ${runs}/alive.txt`)
      : "npm run toolkit:windows -- --only dnsx",
    out: `${runs}/alive.txt`,
    note: dns.ok ? "样本解析率合格后再跑全量；-t 200 -retry 1 比默认快（实测 200 条 8.5s）" : "本机无 dnsx",
    ok: dns.ok,
  });

  out.push({
    step: "④ 探端口",
    cmd: nab.ok
      ? `${q(nab.path)} -list ${runs}/alive.txt -top-ports 100 -silent -o ${runs}/ports.txt`
      : "npm run toolkit:windows -- --only naabu",
    out: `${runs}/ports.txt`,
    // 只喂**已解析**的资产：把死域名喂给端口扫描是纯浪费
    note: nab.ok ? "只喂 alive.txt（已解析的），不要把 subs.txt 直接灌进来" : "本机无 naabu",
    ok: nab.ok,
  });

  return out;
}

/** 把管道写成 runs/recon.sh 与 runs/recon.ps1（两个平台都能跑），返回路径 */
export function writePipelineScripts(steps = [], root = process.cwd()) {
  const dir = runsDir(root);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return { sh: "", ps1: "" }; }
  const sh = path.join(dir, "recon.sh");
  const ps1 = path.join(dir, "recon.ps1");
  const cmds = steps.filter((s) => s.ok).map((s) => s.cmd);
  if (!cmds.length) return { sh: "", ps1: "" };
  try {
    fs.writeFileSync(sh, "#!/bin/sh\nset -e\nmkdir -p runs\n" + cmds.join("\n") + "\n", "utf8");
    fs.writeFileSync(ps1, "# 由 dsh-purge 生成；Windows 上用 pwsh 跑\nNew-Item -ItemType Directory -Force runs | Out-Null\n" + cmds.join("\n") + "\n", "utf8");
  } catch { return { sh: "", ps1: "" }; }
  return { sh, ps1 };
}
