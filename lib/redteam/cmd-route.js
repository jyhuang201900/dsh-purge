/**
 * 可执行命令生成器：把「下一步」从「加载 X 技能、用 Y 手法」变成**能直接复制粘贴的一条命令**。
 *
 * 为什么需要（实测）：前几轮把「下一步」做成了「点技能 + 说打法」，但它仍然不是命令。
 * 模型还得自己拼参数、自己判断本机有没有这个工具——而本机实况是：
 *   PATH 里只有 `httpx`（还是 Python 版，不是 ProjectDiscovery 的），
 *   toolkit 里只有 subfinder / dnsx / naabu 三个真装了 .exe，其余 10 个目录是空的。
 * 也就是说：给一条 `nuclei -u TARGET ...` 而本机没有 nuclei，**这条命令打不出去**。
 * 「可理解但打不出去，等于零」——所以命令必须**按本机实况生成**：
 *   有工具 → 给能真跑的命令（含 toolkit 绝对路径，避免 PATH 里撞到同名异构程序）
 *   没工具 → 给安装命令，或给已装工具的等价打法
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** toolkit 根目录（与 toolkit-windows.mjs 保持一致） */
export function toolkitRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "redteam", "toolkit");
}

/**
 * 探测某工具在本机是否可用：先 toolkit 绝对路径，再 PATH。
 *
 * **同名异构必须排除**：PATH 里的 httpx 通常是 **Python 的 httpx 库 CLI**（位于 pythoncore 目录下的 Scripts），
 * 参数体系与 ProjectDiscovery 的 httpx 完全不同（-u / -title / -tech-detect 它一个都不认）。
 * 拿它去跑 ProjectDiscovery 的命令会直接报参数错，症状看起来像「工具坏了」。
 * 第 111 轮已经吃过这个亏，这里用路径特征把它挡掉：命中 python 目录的 httpx 一律不认。
 */
const ALIASED = {
  // 工具名 → 判断「这个 PATH 命中是不是冒牌」的函数
  httpx: (p) => /pythoncore|site-packages|Scripts/i.test(p),
};

export function probeTool(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const abs = path.join(toolkitRoot(), name, exe);
  try { if (fs.existsSync(abs)) return { ok: true, kind: "toolkit", path: abs }; } catch { /* 探测失败按没有处理 */ }
  const fake = ALIASED[name];
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, exe);
    try {
      if (!fs.existsSync(p)) continue;
      if (fake && fake(p)) continue; // 同名异构：不认
      return { ok: true, kind: "path", path: p };
    } catch { /* 继续找 */ }
  }
  return { ok: false, kind: "missing", path: "" };
}

/** 用带引号的绝对路径拼命令（Windows 路径含空格时必须引号） */
function q(p) {
  return /\s/.test(p) ? `"${p}"` : p;
}

/**
 * 生成一条可执行命令。
 * @param {{ tool: string, args: string, install?: string, alt?: { tool: string, args: string } }} spec
 * @returns {{ cmd: string, note: string, ok: boolean }}
 */
export function commandFor(spec) {
  const { tool, args, install, alt } = spec;
  const hit = probeTool(tool);
  if (hit.ok) {
    return { cmd: `${q(hit.path)} ${args}`, note: hit.kind === "toolkit" ? "toolkit" : "PATH", ok: true };
  }
  // 没装：优先给已装的等价工具，其次给安装命令
  if (alt) {
    const a = probeTool(alt.tool);
    if (a.ok) return { cmd: `${q(a.path)} ${alt.args}`, note: `无 ${tool}，改用已装的 ${alt.tool}`, ok: true };
  }
  if (install) return { cmd: install, note: `本机无 ${tool}，先装`, ok: false };
  return { cmd: "", note: `本机无 ${tool}，且没有替代方案`, ok: false };
}

/**
 * 按阶段生成「这一发打哪」的命令行。
 * @param {{ stage: "recon"|"vuln"|"intranet"|"tunnel"|"cred", target?: string, extra?: string }} ctx
 * @returns {Array<{ label: string, cmd: string, note: string, ok: boolean }>}
 */
export function commandsForStage(ctx = {}) {
  const t = String(ctx.target || "TARGET").trim();
  const out = [];
  const push = (label, spec) => { const r = commandFor(spec); if (r.cmd) out.push({ label, ...r }); };
  switch (ctx.stage) {
    case "recon":
      // 资产最多的网段：先探端口再认指纹（本机 naabu/httpx 情况决定用哪个）
      push("探端口", { tool: "naabu", args: `-host ${t} -top-ports 100 -silent -o runs/ports.txt` });
      push("认指纹", {
        tool: "nuclei",
        args: `-u ${t} -severity critical,high,medium -rl 30 -o runs/nuclei.txt`,
        alt: { tool: "httpx", args: `-u ${t} -title -status-code -tech-detect -silent` },
        install: "npm run toolkit:windows -- --only nuclei",
      });
      break;
    case "vuln":
      // 按漏洞类型给命令，而不是一律 nuclei：下一步说的是「redis-cli 直连」，
      // 命令却给「nuclei 过模板」，两条指向不同动作——命令必须跟下一步一致。
      // ctx.vulnKind 取 vuln-route 的 rule.id。
      {
        const kind = String(ctx.vulnKind || "");
        if (kind === "redis") {
          push("直连验未授权", { tool: "redis-cli", args: `-h ${t} -p 6379 INFO server`, install: "winget install Redis.RedisCLI" });
        } else if (kind === "smb") {
          push("SMB 探测", { tool: "netexec", args: `smb ${t}`, install: "pip install netexec" });
        } else if (kind && kind !== "privesc") {
          // 其余类型（fastjson/struts2/log4j/sql/shiro/weblogic/upload/ssrf/unauth）
          // 第一发都是「发一个探测请求看回显」，命令用 curl，不依赖本机装什么。
          push("发探测请求", {
            tool: "curl",
            args: `-sS -m 10 -o runs/probe-${kind}.txt -w "%{http_code}" "http://${t}/"`,
          });
        }
      }
      push("过模板", {
        tool: "nuclei",
        args: `-u ${t} -severity critical,high -rl 30 -o runs/nuclei.txt`,
        install: "npm run toolkit:windows -- --only nuclei",
      });
      push("补存活", { tool: "naabu", args: `-host ${t} -top-ports 100 -silent` });
      break;
    case "intranet":
      push("内网铺面", {
        tool: "gogo",
        args: `-i ${t} -m 2 -p 22,80,445,3389,6379,8080 -o runs/gogo.txt`,
        install: "npm run toolkit:windows -- --only gogo",
      });
      push("打点", {
        tool: "fscan",
        args: `-h ${t} -p 22,445,3389,6379,8080 -o runs/fscan.txt`,
        install: "npm run toolkit:windows -- --only fscan",
      });
      break;
    case "tunnel":
      push("建隧道", {
        tool: "suo5",
        args: `-l ${t} -p 8001`,
        install: "npm run toolkit:windows -- --only suo5",
      });
      break;
    case "cred":
      push("逐条实测登录", {
        tool: "netexec",
        args: `smb ${t} -u users.txt -p pass.txt`,
        install: "pip install netexec",
      });
      break;
    default:
      break;
  }
  return out;
}
