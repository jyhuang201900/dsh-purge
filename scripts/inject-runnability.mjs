#!/usr/bin/env node
/**
 * 用途：给技能注入「本机可执行性」块——本技能命令用到的工具，本机到底有没有、没有怎么补。
 * 用法：node scripts/inject-runnability.mjs [--dry] [--check]
 *   --dry    只算不写
 *   --check  只校验（每个引用了缺失工具的技能都必须有该块；没有就 exit 1）
 * 依赖：Node ≥18；只读技能 + 只探本机；不下载、不执行技能里的命令。
 *
 * 为什么需要它：实测 114 个技能里有 33 个引用了本机没装的工具，其中 **9 个「静默落差」**
 * ——缺工具却一个字都没说，模型照抄命令就是撞空。技能数量再多，落不了地就是纸面功夫。
 * 这个块把落差**写在技能自己的上下文里**（技能是按需加载的，写进注入正文未必同屏），
 * 每条都给「装法」或「替代」，能立刻用。
 *
 * 判据不手写：缺失工具由本机实测得出；装法只指向**本仓自己的装配器**（npm run toolkit:windows），
 * 替代方案表只收「Windows 上真能用的等价物」。装了工具后重跑，块会自动变短或消失。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const dry = process.argv.includes("--dry");
const checkOnly = process.argv.includes("--check");
const root = process.cwd();
const SKILLS = path.join(root, "skills", "redteam");
const START = "<!-- runnability:start";
const END = "runnability:end -->";

/** 装配器覆盖的工具（与 scripts/toolkit-windows.mjs 的 TOOLS 对齐；不一致由本脚本自检报出） */
const INSTALLABLE = new Set([
  "subfinder", "dnsx", "naabu", "httpx", "chisel", "suo5", "fscan", "frp", "ligolo",
  "nuclei", "ffuf", "feroxbuster", "gobuster", "radare2",
  // 第 110 轮装配器扩面时加的两个（strings → strings64.exe、nmap → NSIS 静默装），
  // 本表没跟上是「装配器有本脚本没登记」的红：装法会指到一个本脚本说不支持的名字。
  "strings", "nmap",
]);

/**
 * 装得上的工具也要留兜底：装配器有官方构建，不等于这台机器一定装得成
 * （nmap 是 NSIS 静默装、要管理员；strings 装的是 strings64.exe）。删掉 SUBSTITUTE 里
 * nmap/strings 两条后，替代路径会从技能上下文里消失——用这张小表把它们接回去。
 */
const INSTALL_HINT = {
  nmap: "；装不上（NSIS 要管理员）时用 `naabu -scan-type c`（TCP connect）或 PowerShell `Test-NetConnection`",
  strings: "；包内是 `strings64.exe`，也可用 PowerShell 提取可打印串",
};

/** Windows 上的等价替代：只收「本机真能用」的。没写的就是没有好替代，如实说。 */
const SUBSTITUTE = {
  hydra: "Windows 无官方构建；改用 `netexec`（nxc）打 SMB/WinRM/MSSQL，HTTP 表单用 `curl` 循环",
  sqlmap: "`python -m pip install sqlmap`（本机有 python）",
  apktool: "官方只发 `apktool_<ver>.jar`（需 java）；装上后 `java -jar apktool.jar d <apk>`",
  proxychains: "Windows 无 proxychains；用 `curl --socks5-hostname 127.0.0.1:<port>` 或 PowerShell `-Proxy`",
  hashcat: "官方只发 `hashcat-<ver>.7z`（多平台包，需 7z 解压后取 hashcat.exe）",
  binwalk: "`python -m pip install binwalk`（新版是 python 包）",
  pip: "用 `python -m pip` 代替裸 `pip`",
  nc: "Windows 无原生 nc；用 PowerShell `TcpClient` 或 nmap 包里的 `ncat.exe`",
  frida: "`python -m pip install frida-tools`",
  jadx: "官方发 `jadx-gui-<ver>-win.zip`（Java 启动器，需 java）",
  openssl: "Git for Windows 的 bash 自带 openssl；或 PowerShell 证书命令（`New-SelfSignedCertificate` 等）",
  whatweb: "Ruby gem；无 ruby 时用 `curl -I` + 人工指纹（技能里的指纹表可当字典）",
  masscan: "该仓库 release 无任何资产（只发源码）；Windows 上优先用 `naabu`",
  nmap_nping: "PowerShell `Test-Connection`",
  asnmap: "无 Windows 构建；用 FOFA/被动数据源替代",
  massdns: "无 Windows 构建；用 `dnsx` 批量解析替代",
  zgrab2: "无 Windows 构建；用 `httpx` 探存活替代",

  /* ---------- 1.1.119 补齐：这一批原来全是「先确认它是否必要，必要时找官方 Windows 构建」，
     那句话对模型零信息量（既不告诉你能否替代，也不告诉你怎么装）。
     140 条工具落差里 80 条（57%）是这种空话，模型读到只会跳过。
     补齐的原则是**先分三类，再给具体出口**：
       A. 本机有等价物 → 直接说用哪个、差在哪（模型可以立刻换）；
       B. 只能在目标机上跑 / 离线跑 → 明确说「本机没有是对的」，别去找；
       C. 真装法 → 给一条能复制的命令。 */

  /* A. 本机有等价物（已验证替代，写明能力差异） */
  gogo: "本机无 Windows 构建。**用 `fscan` 替代铺面**（本机已装）：`fscan -h <cidr> -nobr -nopoc -nofile`；gogo 的 DSL/workflow 与自带 3138 条指纹是它独有的，需要精细指纹时再想办法取二进制，日常扫面 fscan 够用",
  katana: "本机无。**用 `httpx` + `feroxbuster` 组合替代**：`httpx -u <url> -path -status-code` 拉路径，再 `feroxbuster` 递归；katana 的无头浏览器渲染（`-headless`）是它独有的，只在需要 JS 渲染的 SPA 上才必须",
  crackmapexec: "该项目已改名为 **netexec**（`nxc`）；本机两个都没有 —— 用 `fscan` 的 SMB 模块做初筛，深挖再装 netexec",
  nxc: "同 `netexec`：本机没有。用 `fscan` 初筛 SMB；需要 PtH/WinRM 精确验证时 `python -m pip install netexec`",
  responder: "Windows 上直接跑会抢占本机 NetBIOS 名（有风险）。**用 `python -m pip install responder` 并只在授权靶段的小网段跑**；轻量替代是 `fscan` 的 `-m ms` 与 arp 扫描",
  mimikatz: "**只能拷到目标机跑**（它读的是目标内存里的凭据，本机跑没有任何意义）。本机只需准备二进制：`Invoke-Mimikatz` 官方 release 或 `python -m pip install pypykatz`（离线解析目标 dump 出来的 lsass.dmp）",
  volatility: "`python -m pip install volatility3`（Python 3 版，命令是 `vol` 而非 `vol.py`）；本机没有是正常的，它分析的是**拷回来**的内存镜像",
  /* B. 只能在目标机/离线跑（本机没有是设计如此，别去找） */
  hashcat: "官方只发 `hashcat-<ver>.7z`（多平台包，需 7z 解压后取 `hashcat.exe`）。**注意：CPU 跑慢**，先小字典+规则，破不出就用哈希直接 PtH",
  john: "`jumbo` 版才有 Windows 二进制（官方 johntheRipper/bleeding-jumbo 的 `run/` 里有 `john.exe`）。同一件事优先用 `hashcat`（本机也没有，见上）",
  bloodhound: "采集器 **SharpHound 是 .NET，可本机跑**（`Invoke-BloodHound` 或 `SharpHound.exe`）；BloodHound 本体是 Java/Neo4j 服务端，本机只装采集器即可",
  objection: "`python -m pip install objection`（依赖 frida，见上）；它操作的是**连着的目标 App**，本机装客户端即可",
  yara: "Windows 有官方二进制（`yara-<ver>-win64.zip`）；只做规则**语法检查**时也可 `python -m pip install yara-python`",
  binwalk: "`python -m pip install binwalk`（新版是 python 包）；固件分析在本机做，不是目标机",
  /* C. 真装法（一条能复制的命令） */
  impacket: "`python -m pip install impacket`（本机有 python）；装完直接用 `python -m impacket.examples.wmiexec` 等模块名，别指望有 `impacket-*` 在 PATH",
  netexec: "`python -m pip install netexec`（旧名 crackmapexec）；装完命令是 `nxc`",
  sqlmap: "`python -m pip install sqlmap`（本机有 python）；或用 `python sqlmap.py -u <url>` 从源码目录跑",
  ghidra: "官方发 `ghidra_<ver>_PUBLIC_<date>.zip`（**需 JDK 17+**，解压后 `ghidraRun.bat`）。**本机已有 `radare2`**：日常反汇编/字符串交叉引用用 `radare2` 够，Ghidra 的优势是反编译成伪 C，只在需要读复杂逻辑时装",
  frida: "`python -m pip install frida-tools`（本机有 python）；App 侧还需 `frida-server`（推目标机，架构要对）",
  apktool: "官方只发 `apktool_<ver>.jar`（**需 java**）；`java -jar apktool.jar d <apk>`",
  jadx: "官方发 `jadx-gui-<ver>-win.zip`（自带 JRE 的发行版可直接双击）",
  dirsearch: "本机无。**用 `ffuf`/`feroxbuster` 替代**（都已装）：`ffuf -u http://<t>/FUZZ -w <字典> -mc 200,301,403`；dirsearch 的优势只是内置字典与递归策略",
  masscan: "该仓库 release 无任何资产（只发源码）；**用 `naabu` 替代**（已装）：`naabu -host <ip> -p - -rate 2000`",
  nc: "Windows 无原生 nc；**用 `nmap` 包里的 `ncat.exe`**（本机 nmap 目录里有，实测存在）或 PowerShell `TcpClient`",
  socat: "Windows 有官方 `socat-<ver>.zip`；轻量替代是 `ncat --ssl` / `chisel`（都已装）",
  proxychains: "Windows 无 proxychains；用 `curl --socks5-hostname 127.0.0.1:<port>`，或 `chisel`/`ligolo` 自带的本地监听（都已装）",
  tcpdump: "Windows 无 tcpdump；**用 `tshark`**（Wireshark 命令行，官方 Windows 安装包自带）或 `pktmon`（Win10+ 内置）",
  readelf: "Windows 无 readelf；**用 `objdump`（MinGW 自带）或 `radare2`**（已装）：`radare2 -q -c iI <elf>`",
  objdump: "MinGW/binutils 或 `radare2`（已装）：`radare2 -q -c iI <bin>`",
  nikto: "Windows 无官方包（Perl 脚本）；**用 `nuclei` 的 `http/misconfiguration` 模板替代**（已装）",
  wget: "Windows 10+ 自带 `curl.exe`；或 PowerShell `Invoke-WebRequest`",
  frpc: "本机有（`toolkit/frp/frpc.exe`）——这里是**目标机侧**的客户端，拷过去跑即可，本机不需要再装",
  frps: "本机有（`toolkit/frp/frps.exe`）——跑在 **VPS** 上，不是本机也不是目标机",
  "aircrack-ng": "官方发 Windows zip（`aircrack-ng-<ver>-win.zip`）；**需支持监听的无线网卡**，虚拟机上通常不成立",
  msfconsole: "Windows 官方安装包（`metasploitframework-latest.msi`）；**轻量替代**：`nuclei` 打已知漏洞、`chisel`+`suo5` 做隧道、`shell-handler` 技能里的各语言反弹一句话（都已装）",
};

const have = new Map();
const TK = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh"), "redteam", "toolkit");
// radare2 的短名（r2/rabin2/...）指同一个主程序：`r2.exe` 在 Windows 包里是 r2agent 的副本，
// 哈希与 r2agent.exe 相同，拿它当主程序会得到 `Usage: r2agent`——装好了但不能分析。
const ALIAS = { r2: "radare2", rabin2: "radare2", radiff2: "radare2", rahash2: "radare2", rax2: "radare2" };
function has(tool) {
  const alias = ALIAS[String(tool || "").toLowerCase()];
  if (alias) tool = alias;
  if (have.has(tool)) return have.get(tool);
  const base = tool.replace(/\.exe$/i, "");
  for (const c of [path.join(TK, base, base + ".exe"), path.join(TK, base + ".exe")]) {
    try { if (fs.statSync(c).size > 0) { have.set(tool, true); return true; } } catch { /* 下一个 */ }
  }
  // 二进制名可能与工具名不同（strings → strings64.exe）：目录里有 exe 就算装了
  try {
    const dir = path.join(TK, base);
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /\.exe$/i.test(f))) {
      have.set(tool, true);
      return true;
    }
  } catch { /* 忽略 */ }
  let ok = false;
  for (const p of ["where.exe", "which"]) {
    try { execFileSync(p, [tool], { stdio: "ignore", timeout: 3000 }); ok = true; break; } catch { /* 下一个 */ }
  }
  have.set(tool, ok);
  return ok;
}

// 与装配器对齐自检：装配器支持的工具名变了，这里必须跟着变，否则「装法」会指错
let installable = [];
try {
  const src = fs.readFileSync(path.join(root, "scripts", "toolkit-windows.mjs"), "utf8");
  const body = src.slice(src.indexOf("const TOOLS = ["), src.indexOf("];", src.indexOf("const TOOLS = [")));
  installable = [...body.matchAll(/name:\s*"([a-z0-9]+)"/g)].map((m) => m[1]);
} catch { /* 读不到就跳过自检 */ }
const drift = installable.filter((x) => !INSTALLABLE.has(x));
if (drift.length) console.log(`  ⚠ 装配器有本脚本没登记的工具（装法会指不到）：${drift.join(", ")}`);

const TOOLS = [
  "nmap", "masscan", "naabu", "subfinder", "dnsx", "httpx", "katana", "nuclei", "ffuf", "feroxbuster", "gobuster",
  "dirsearch", "wfuzz", "whatweb", "wafw00f", "nikto", "dalfox", "sqlmap", "hydra", "hashcat", "john", "medusa",
  "msfconsole", "msfvenom", "impacket", "netexec", "nxc", "crackmapexec", "bloodhound", "rubeus", "mimikatz",
  "fscan", "gogo", "suo5", "chisel", "frpc", "frps", "ligolo", "proxychains", "responder", "bettercap",
  "frida", "objection", "apktool", "jadx", "ghidra", "radare2", "r2", "objdump", "readelf", "strings", "binwalk",
  "yara", "volatility", "tshark", "tcpdump", "aircrack-ng",
  "curl", "wget", "nc", "ncat", "socat", "openssl", "python", "python3", "pip", "pip3", "node", "go",
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * 工具名在正文里的出现判据。
 *
 * 第 138 轮实测的漏检：旧正则 `(?:^|[\s|&;($`])name(?=[\s|&;)$`\\]|$)` 要求工具名
 * **前后都是空白或特定分隔符**，于是三种最常见的真实写法全被漏掉：
 *   `$TK/suo5/suo5-linux-amd64`、`C:\...\toolkit\suo5\suo5.exe`、`./suo5`
 * ——它们的前导字符是 `/`、`\`、`.`，都不在字符集里。
 * 后果：`suo5-tunnel` 正文里 `suo5` 出现 16 次，却只报「本机缺 nmap」，
 * **真正要用的主工具一个字都没提**。这正是「本机可执行性」块最该说清的事。
 *
 * 改成两侧都接受路径分隔符与常见前缀字符；同时要求右侧不是「单词延续」，
 * 免得 `suo5x`、`suo5_helper` 这类同前缀名字被误判成工具本身。
 */
const toolRe = (t) => new RegExp(
  "(?:^|[\\s|&;($`'\"=:/\\\\])" + esc(t) + "(?=$|[\\s|&;)$`'\"<>:,\\\\/]|\\.exe\\b|\\.md\\b|-[a-z])",
  "m",
);

const LINUX_MARKS = [/\bsudo\b/, /\bapt(-get)?\s+(install|update|upgrade)\b/, /\bsystemctl\b/, /\/usr\/bin\//, /\/usr\/share\//, /\bchmod\s+\+x\b/, /\bcat\s+\/etc\//, /~(?:^|\/|\s)/, /\.\/\w+\.(sh|py)\b/];

/** 渲染该技能的「本机可执行性」块；没问题时返回 ""（不硬塞空块） */
function render(body, text) {
  // 判据用**全文**而不是只查代码块：
  // 第 138 轮实测，`ida-reverse` 把 `radare2` 写在表格与「上游备选」里（`| radare2 | ❌ 未装 |`），
  // 代码块里没有，于是只查 body 就判成「无需该块」——而技能正文明确告诉读者要用它。
  // 正文提到的工具同样是「要用的工具」，漏掉它等于把坑留给读者。
  const scope = `${body}\n${text || ""}`;
  const missing = TOOLS.filter((t) => toolRe(t).test(scope) && !has(t));
  const marks = LINUX_MARKS.filter((re) => re.test(scope)).length;
  if (!missing.length && !marks) return "";
  const L = [START + " scripts/inject-runnability.mjs 生成，勿手改 -->", "", "## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）"];
  if (missing.length) {
    L.push("", `本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：${missing.map((x) => "`" + x + "`").join("、")}`);
    for (const m of missing) {
      // 「装过但被安全软件删了」与「从没装过」处置完全不同：前者重装会被再删一次，要先加白名单。
      // 第 119 轮实测本机腾讯电脑管家会在 20 秒内静默删掉 chisel / suo5 / gobuster 这类红队工具
      // （装好即消失，Defender 无记录）。同一件事在 cmd-route.js 里也这么判，两处说法必须一致。
      const dir = path.join(TK, m);
      let blocked = false;
      try { blocked = fs.existsSync(dir) && !fs.existsSync(path.join(dir, m + ".exe")); } catch { blocked = false; }
      if (blocked) L.push(`- \`${m}\`：**装过但文件已被删除**（多为腾讯电脑管家/Defender 实时防护）——重装会被再删一次，先把 \`${dir}\` 加进白名单再装`);
      else if (INSTALLABLE.has(m)) L.push(`- \`${m}\`：\`npm run toolkit:windows -- --only ${m}\`（官方 Windows 构建已支持）${INSTALL_HINT[m] || ""}`);
      else if (SUBSTITUTE[m]) L.push(`- \`${m}\`：${SUBSTITUTE[m]}`);
      else L.push(`- \`${m}\`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建`);
    }
  }
  if (marks) L.push("", "命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。");
  L.push("", END);
  return L.join("\n");
}

const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
let written = 0, noNeed = 0;
const problems = [];
for (const f of files) {
  const p = path.join(SKILLS, f);
  let t = fs.readFileSync(p, "utf8");
  const s = t.indexOf(START), e = t.indexOf(END);
  const stripped = (s >= 0 && e > s) ? (t.slice(0, s).replace(/\s+$/, "") + "\n\n" + t.slice(e + END.length).replace(/^[\r\n]+/, "")).replace(/\s+$/, "") : t;
  const blocks = [...stripped.matchAll(/```(?:bash|sh|shell|powershell|ps1)?\r?\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  const block = render(blocks, stripped);
  if (checkOnly) {
    if (block && !(s >= 0 && e > s)) problems.push(f.replace(/\.md$/, ""));
    continue;
  }
  if (!block) { noNeed += 1; if (s >= 0 && e > s && !dry) fs.writeFileSync(p, stripped, "utf8"); continue; }
  const next = stripped.replace(/[ \t]+$/, "") + "\n\n" + block + "\n";
  if (next !== t) { if (!dry) fs.writeFileSync(p, next, "utf8"); written += 1; }
}

if (checkOnly) {
  if (problems.length) { console.log(`  有 ${problems.length} 个技能引用了缺失工具却没有「本机可执行性」块：${problems.slice(0, 8).join(", ")}`); process.exit(1); }
  console.log("  所有引用了缺失工具的技能都带了「本机可执行性」块 ✓");
  process.exit(0);
}
console.log(`本机可执行性：写入/更新 ${written} 个技能｜无需该块 ${noNeed} 个${dry ? "（--dry 未写盘）" : ""}`);
