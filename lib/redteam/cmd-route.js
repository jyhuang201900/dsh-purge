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
import { execFileSync } from "node:child_process";
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
 *
 * **装过但被安全软件删掉**要单独说：第 119 轮实测本机腾讯电脑管家会把 chisel / suo5 / gobuster
 * 这类红队工具在 20 秒内静默删除（装好即消失，Defender 无记录、QQPCMgr 在跑）。
 * 这种情形报「缺失」会让人以为是没装成功、反复重装；所以检测「目录在但 exe 不在」并标 `blocked`，
 * 由调用方给出「加白名单」的处置，而不是让人瞎试。
 */
const ALIASED = {
  // 工具名 → 判断「这个 PATH 命中是不是冒牌」的函数
  httpx: (p) => /pythoncore|site-packages|Scripts/i.test(p),
};

/**
 * 别名 → 真名。
 *
 * 第 139 轮实测：radare2 的 Windows 包里 `r2.exe` 与 `r2agent.exe` **哈希完全相同**
 * （都是 r2agent 这个守护进程），真正能分析的 CLI 是 `radare2.exe`。
 * 而技能正文大量写 `r2 -A ./bin`、`r2 -q -c ...`——查 `r2` 会说「本机无」，
 * 让人以为要另装一个工具，其实主程序就在同一个目录里。
 * 所以 `r2` 指到 `radare2`：**别名不是另一个工具，是同一个工具的短名**。
 */
export const TOOL_ALIAS = {
  r2: "radare2",
  rabin2: "radare2",
  radiff2: "radare2",
  rahash2: "radare2",
  rax2: "radare2",
};

export function probeTool(name) {
  // 别名先归一：r2/rabin2 等都是 radare2 的短名，不该报「本机无」
  const real = TOOL_ALIAS[String(name || "").toLowerCase()] || name;
  const exe = process.platform === "win32" ? `${real}.exe` : real;
  const abs = path.join(toolkitRoot(), real, exe);
  try { if (fs.existsSync(abs)) return { ok: true, kind: "toolkit", path: abs }; } catch { /* 探测失败按没有处理 */ }
  // **不能只认 `<name>.exe`**：有些工具的二进制名与工具名不同（strings → strings64.exe，
  // 64 位版才能读大文件）。第 140 轮实测：strings 明明装好、真跑出 838 行，
  // probeTool 却报 blocked（因为找的是 strings.exe）。所以目录存在时，
  // 退一步**扫目录里第一个可执行文件**，别再假定名字一致。
  try {
    const dir = path.join(toolkitRoot(), real);
    if (fs.existsSync(dir)) {
      const cands = fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f));
      if (cands.length) {
        // 优先与工具名同前缀的（strings64.exe 之于 strings）
        const best = cands.find((f) => f.toLowerCase().startsWith(real.toLowerCase())) || cands[0];
        return { ok: true, kind: "toolkit", path: path.join(dir, best) };
      }
    }
  } catch { /* 扫不动就按下面继续 */ }
  // 目录在、exe 不在 = 装过但被删（安全软件）。与「从没装过」是两回事。
  let dirExists = false;
  try { dirExists = fs.existsSync(path.dirname(abs)); } catch { /* 忽略 */ }
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
  if (dirExists) return { ok: false, kind: "blocked", path: "", note: "装过但文件已被删除（多为安全软件拦截）" };
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
  // 被安全软件删掉与「从没装过」处置完全不同：前者重装没用，要加白名单。
  if (hit.kind === "blocked") {
    return {
      cmd: install || "",
      note: `装过但被安全软件删除（多为腾讯电脑管家/Defender 实时防护）——**重装会被再删一次**，先把 toolkit 目录加进白名单再装`,
      ok: false,
    };
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
 * 本机字典目录与可用字典。
 * 第 126 轮实测：技能里所有字典路径都是 `/usr/share/seclists/...`，而 Windows 会把绝对路径
 * 当相对路径拼到盘符后面（`E:\usr\share\seclists\...`），于是 `ffuf -w /usr/share/seclists/...`
 * **必然失败**（不是「可能失败」）。所以生成命令时必须用**本机真实存在的字典**。
 */
export function wordlistsRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "redteam", "wordlists");
}

/** 列出本机可用字典（按用途挑一个默认） */
export function listWordlists() {
  const dir = wordlistsRoot();
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => {
      let size = 0;
      try { size = fs.statSync(path.join(dir, f)).size; } catch { /* 忽略 */ }
      return { name: f.replace(/\.txt$/, ""), path: path.join(dir, f), size };
    }).filter((x) => x.size > 1024);
  } catch {
    return [];
  }
}

/** 挑一个目录爆破字典：优先 small（快），没有就 medium，再没有就用任何非 DNS 字典 */
export function pickDirWordlist() {
  const all = listWordlists();
  if (!all.length) return null;
  const byName = (n) => all.find((x) => x.name === n);
  return byName("raft-small-directories") || byName("raft-medium-directories") || byName("common")
    || all.find((x) => !/subdomain/i.test(x.name)) || all[0];
}

/** 挑一个子域字典 */
export function pickSubdomainWordlist() {
  const all = listWordlists();
  return all.find((x) => /subdomain/i.test(x.name)) || null;
}

/**
 * ProjectDiscovery 全家桶的更新检查开销：**按工具分别处理，不搞一刀切**。
 *
 * 第 129 轮做了严格测量（每个配置跑 3 次取中位数，排除网络抖动）：
 *   · **nuclei**：`-tl` 不带 `-duc` **50,439 ms** vs 带 `-duc` **827 ms**（**60 倍**）。
 *     它的更新检查在连不通时会一直重试，是**每条命令都付的固定税**，必须带。
 *   · **dnsx**：不带中位 3151 ms / 带中位 3141 ms，但带 `-duc` 时**有两次只要 268/276 ms**
 *     ——有收益但方差极大（取决于是否恰好撞上网络探测）。**带上**，代价为零。
 *   · **naabu**：不带 9.2s / 带 11.3s，差异落在噪声内，**带上反而略慢**。**不加**。
 *   · **subfinder**：实测带 `-duc` 反而更慢（46.7s vs 87.4s）——但那是**枚举结果数量波动**，
 *     不是开关本身的问题。开关对它是中性偏正，**加上**（它确实会查更新）。
 *
 * 一句话：**只有 nuclei 是硬需求，dnsx/subfinder 是顺手收益，naabu 不加。**
 * 这个区别是测出来的，不是猜的——所以写在这里，免得下次又"统一加一下"。
 */
export const PD_UPDATE_FLAG = "-duc";
/** 必须带（固定税极大） */
export const PD_MUST_FLAG = { nuclei: true };
/** 建议带（有收益、代价为零） */
export const PD_NICE_FLAG = { dnsx: true, subfinder: true };
/** 不加（实测无收益或略慢） */
export const PD_SKIP_FLAG = { naabu: true };

/** 按工具名决定是否补 -duc（幂等） */
export function withUpdateFlag(tool, args) {
  const name = String(tool || "").toLowerCase();
  const s = String(args || "");
  if (PD_SKIP_FLAG[name]) return s;
  if (!PD_MUST_FLAG[name] && !PD_NICE_FLAG[name]) return s;
  if (new RegExp(`(^|\\s)${PD_UPDATE_FLAG}(\\s|$)`).test(s)) return s;
  return `${s} ${PD_UPDATE_FLAG}`.trim();
}

/**
 * 需要**显式代理**才能出网的工具。
 *
 * 第 130 轮实测：`httpx` 不读 Windows 系统代理，直连 `https://example.com` 报
 * `Get "https://example.com": context deadline exceeded`，**输出为空、退出码 0**
 * （看起来像"没发现什么"，其实是根本没连上——比报错更危险）。
 * 它自己说会回退到 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量，实测确实如此：
 * 设上后 `https://example.com [200] [Example Domain]` 正常输出。
 *
 * 所以生成 httpx 命令时，要么带 `-http-proxy <系统代理>`，要么在调用前设环境变量。
 * 这里选择**显式带参数**：命令自包含，复制出去就能跑，不依赖调用方的环境。
 */
export const NEEDS_PROXY = { httpx: true };

/** 读系统代理（只读，不改——用户的代理归用户管） */
export function systemProxyUrl() {
  if (process.env.HTTPS_PROXY) return String(process.env.HTTPS_PROXY);
  if (process.env.HTTP_PROXY) return String(process.env.HTTP_PROXY);
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"], { encoding: "utf8", timeout: 5000 });
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(String(out));
    if (!m) return "";
    const v = m[1].trim();
    return /^https?:\/\//i.test(v) ? v : `http://${v}`;
  } catch {
    return "";
  }
}

/** 给需要代理的工具补上 `-http-proxy`（幂等；探不到系统代理就原样返回，让命令本身报连不上） */
export function withProxyFlag(tool, args) {
  const name = String(tool || "").toLowerCase();
  if (!NEEDS_PROXY[name]) return args;
  const s = String(args || "");
  if (/(^|\s)-(http-proxy|proxy|hp)(\s|=)/.test(s)) return s;
  const px = systemProxyUrl();
  return px ? `${s} -http-proxy ${px}`.trim() : s;
}

/** nuclei 的快速标志（-duc 必带、-nc 去色） */
export const NUCLEI_FAST_FLAGS = ["-duc", "-nc"];

/** 在 nuclei 参数串里补上快速标志（幂等：已有就不重复加） */
export function withNucleiFastFlags(args) {
  const s = String(args || "");
  const missing = NUCLEI_FAST_FLAGS.filter((f) => !new RegExp(`(^|\\s)${f}(\\s|$)`).test(s));
  return missing.length ? `${s} ${missing.join(" ")}`.trim() : s;
}

/**
 * nuclei 是否**真能跑**：exe 在 ≠ 能跑。第 125 轮实测：exe 装好但模板目录空，
 * `nuclei -u ...` 直接 `[FTL] no templates provided for scan` 退出码 1。
 * 所以生成 nuclei 命令前必须查模板数量，没有就把它当「未就绪」，给补模板的命令而不是扫描命令。
 */
export function nucleiReady() {
  try {
    const dir = path.join(os.homedir(), "nuclei-templates");
    const n = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".yaml")).length;
    return { ok: n >= 100, count: n, dir };
  } catch {
    return { ok: false, count: 0, dir: path.join(os.homedir(), "nuclei-templates") };
  }
}

/**
 * 按阶段生成「这一发打哪」的命令行。
 * @param {{ stage: "recon"|"vuln"|"intranet"|"tunnel"|"cred", target?: string, extra?: string }} ctx
 * @returns {Array<{ label: string, cmd: string, note: string, ok: boolean }>}
 */
export function commandsForStage(ctx = {}) {
  const t = String(ctx.target || "TARGET").trim();
  const out = [];
  const push = (label, spec) => {
    const r = commandFor(spec);
    if (!r.cmd) return;
    // 按工具名补更新检查开关（实测：nuclei 必带、dnsx/subfinder 顺手、naabu 不加）
    if (r.ok && spec && spec.tool) {
      // 先补代理（httpx 不读系统代理，直连会静默 0 输出），再补更新开关
      let fixed = withProxyFlag(spec.tool, spec.args);
      fixed = withUpdateFlag(spec.tool, fixed);
      if (fixed !== spec.args) r.cmd = r.cmd.replace(spec.args, fixed);
    }
    out.push({ label, ...r });
  };
  // nuclei 专用：exe 在但模板空时，给「补模板」而不是「去扫」——否则命令必然 FTL
  const pushNuclei = (label, args) => {
    const exe = probeTool("nuclei");
    if (!exe.ok) { push(label, { tool: "nuclei", args, install: "npm run toolkit:windows -- --only nuclei" }); return; }
    const rd = nucleiReady();
    if (rd.ok) {
      // 必带 -duc：不带的话每条命令白等约 50 秒（实测 53.5s → 5.2s）
      out.push({ label, cmd: `${q(exe.path)} ${withNucleiFastFlags(args)}`, note: `toolkit｜模板 ${rd.count} 个`, ok: true });
      return;
    }
    out.push({
      label: "补 nuclei 模板",
      cmd: "npm run toolkit:windows -- --only nuclei --force",
      note: `nuclei 在但模板 ${rd.count} 个，直接扫会报 no templates——先补模板`,
      ok: false,
    });
  };
  switch (ctx.stage) {
    case "recon":
      // 资产最多的网段：先探端口再认指纹（本机 naabu/httpx 情况决定用哪个）
      push("探端口", { tool: "naabu", args: `-host ${t} -top-ports 100 -silent -o runs/ports.txt` });
      // nmap 与 naabu 不是替代关系：naabu 快（秒级、只报端口），nmap 慢但能**认版本 + 跑脚本**。
      // 第 142 轮实测：装了 nmap 却完全没进生成器——**装了不出现在下一步里，等于白装**。
      // 分工：naabu 先扫出开放端口，nmap 再拿这个端口表做 -sV（版本）与 -sC（默认脚本）。
      {
        const nm = probeTool("nmap");
        if (nm.ok) {
          // **端口表要用平台各自的办法从 ports.txt 里抽**：`$(cut | paste)` 是 Linux 写法，
          // Windows 上根本没有这两个命令（第 127 轮 head 同类问题，又踩一次）。
          const isW = process.platform === "win32";
          const portArg = isW
            ? "$((Get-Content runs/ports.txt | ForEach-Object { ($_ -split ':')[-1] }) -join ',')"
            : "$(cut -d: -f2 runs/ports.txt | paste -sd,)";
          const nmCmd = isW
            ? `${q(nm.path)} -sV -sC -Pn -p ${portArg} ${t} -oN runs/nmap.txt`
            : `${q(nm.path)} -sV -sC -Pn -p ${portArg} ${t} -oN runs/nmap.txt`;
          out.push({
            label: "认版本（nmap）",
            cmd: nmCmd,
            note: "naabu 只报端口；版本与脚本要靠 nmap（-sV -sC）。端口表取自 ports.txt",
            ok: true,
          });
        } else {
          out.push({ label: "认版本（nmap）", cmd: "npm run toolkit:windows -- --only nmap", note: "本机无 nmap——端口有了但认不出服务版本", ok: false });
        }
      }
      // 认指纹用 httpx（专门做这件事，比 nuclei 快一个量级）；nuclei 留给阶段③ 的漏洞扫描。
      // httpx 不读系统代理，push 会自动补 -http-proxy（实测直连会静默 0 输出）。
      {
        const hx = probeTool("httpx");
        if (hx.ok) {
          push("认指纹", { tool: "httpx", args: `-u ${t} -title -status-code -tech-detect -silent -nc -o runs/httpx.txt` });
        } else {
          pushNuclei("认指纹（无 httpx，退回 nuclei）", `-u ${t} -severity critical,high,medium -rl 30 -o runs/nuclei.txt`);
        }
      }
      // 目录爆破：**必须用本机字典**。技能里写的是 /usr/share/seclists/...，
      // 而 Windows 会把它当相对路径拼到盘符后（实测 ffuf 报 E:\usr\share\seclists\... 找不到）。
      {
        const wl = pickDirWordlist();
        const ff = probeTool("ffuf");
        if (!wl) {
          out.push({ label: "目录爆破", cmd: "npm run wordlists:windows", note: "本机没有字典——技能里的 /usr/share/seclists 在 Windows 上必然找不到", ok: false });
        } else if (ff.ok) {
          out.push({ label: "目录爆破", cmd: `${q(ff.path)} -u http://${t}/FUZZ -w ${q(wl.path)} -t 30 -mc 200,301,302,403 -o runs/ffuf.txt`, note: `ffuf｜字典 ${wl.name}`, ok: true });
        } else {
          out.push({ label: "目录爆破", cmd: "npm run toolkit:windows -- --only ffuf", note: "本机无 ffuf", ok: false });
        }
      }
      // 子域爆破：技能里写的是 Linux 路径 /usr/share/seclists/...，Windows 上必然找不到。
      // pickSubdomainWordlist() 就是为这件事写的（本机 subdomains-top1million-20000），
      // 但一直没被调用——**写了不用等于没写**（第 143 轮审阅发现的孤儿导出）。
      {
        const subWl = pickSubdomainWordlist();
        const ks = probeTool("ksubdomain");
        if (!subWl) {
          out.push({ label: "子域爆破", cmd: "npm run wordlists:windows", note: "本机没有子域字典——技能里的 /usr/share/seclists 在 Windows 上找不到", ok: false });
        } else if (ks.ok) {
          out.push({ label: "子域爆破", cmd: `${q(ks.path)} -d ${t} -f ${q(subWl.path)} -o runs/subs-brute.txt`, note: `ksubdomain｜字典 ${subWl.name}`, ok: true });
        } else {
          // 没有 ksubdomain 就用 dnsx 读字典（慢但一定有）
          const dn = probeTool("dnsx");
          out.push({
            label: "子域爆破",
            cmd: dn.ok ? `${q(dn.path)} -d ${t} -w ${q(subWl.path)} -silent -a -resp -o runs/subs-brute.txt` : "npm run toolkit:windows -- --only dnsx",
            note: dn.ok ? `dnsx 读字典 ${subWl.name}（无 ksubdomain）` : "本机无 dnsx",
            ok: dn.ok,
          });
        }
      }
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
      pushNuclei("过模板", `-u ${t} -severity critical,high -rl 30 -o runs/nuclei.txt`);
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
  // 逆向阶段：不是「打点」而是「看样本」。radare2 与 strings 都装了却一直没进生成器
  // （第 142 轮实测：装了不出现在下一步里等于白装）。
  if (ctx.stage === "reverse") {
    const r2 = probeTool("radare2");
    const st2 = probeTool("strings");
    const bin = String(ctx.binary || "SAMPLE.exe");
    if (st2.ok) {
      out.push({ label: "提可打印串", cmd: `${q(st2.path)} -accepteula -n 8 ${bin} > runs/strings.txt`, note: "先看字符串找线索（URL/路径/报错/密钥），比直接反汇编快得多", ok: true });
    } else {
      out.push({ label: "提可打印串", cmd: "npm run toolkit:windows -- --only strings", note: "本机无 strings", ok: false });
    }
    if (r2.ok) {
      out.push({ label: "看二进制头", cmd: `${q(r2.path)} -q -c "ij" ${bin} > runs/r2-info.json`, note: "radare2 -q -c ij 出架构/位数/类型（JSON），决定后面用哪套分析", ok: true });
      out.push({ label: "看导入表", cmd: `${q(r2.path)} -q -c "ii" ${bin} > runs/r2-imports.txt`, note: "导入表能看出用了什么库（加密/网络/注册表），是找攻击面的入口", ok: true });
    } else {
      out.push({ label: "反汇编", cmd: "npm run toolkit:windows -- --only radare2", note: "本机无 radare2", ok: false });
    }
  }

  return out;
}
