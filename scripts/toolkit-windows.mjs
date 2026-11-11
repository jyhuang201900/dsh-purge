#!/usr/bin/env node
/**
 * 用途：把红队技能用到的二进制装到 $DSH_HOME/redteam/toolkit/（Windows 版装配器）。
 * 用法：node scripts/toolkit-windows.mjs [--check] [--only name,name] [--force]
 * 依赖：Node ≥18；网络可达 GitHub releases（走官方 latest API，不猜 URL）。
 * 验证：2026-11-10 首跑装 projectdiscovery 四件套，逐个 --version 验证可执行。
 *
 * 为什么需要它（不是造轮子）：仓里的 `$DSH_HOME/redteam/setup.sh` 是 **Linux/Kali 专用**，
 * 资产正则写死 `linux_amd64`，在 Windows 上每个都报「无匹配资产」——第 99 轮实测 14 个全失败。
 * 而这些上游**全部提供官方 Windows 构建**（实测 subfinder/dnsx/naabu/httpx/chisel/suo5/fscan/frp/ligolo 都有），
 * 所以这里只做一件事：把 setup.sh 的那张表按 OS 换成 windows_amd64 资产名，仍旧用它们的官方发布。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync, execFileSync } from "node:child_process";

const NL = String.fromCharCode(10);
const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const toolkit = path.join(home, "redteam", "toolkit");
const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const probeOnly = argv.includes("--probe"); // 只解析「正则命中哪个资产」不下载：先证明正则会中，再信能装
const force = argv.includes("--force");
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : [];

// 每项：repo、资产名正则（windows）、解压后二进制名、安装子目录、验证参数。
const TOOLS = [
  { name: "subfinder", repo: "projectdiscovery/subfinder", re: /windows_amd64\.zip$/, bin: "subfinder.exe", dir: "subfinder", ver: ["-version"] },
  { name: "dnsx", repo: "projectdiscovery/dnsx", re: /windows_amd64\.zip$/, bin: "dnsx.exe", dir: "dnsx", ver: ["-version"] },
  { name: "naabu", repo: "projectdiscovery/naabu", re: /windows_amd64\.zip$/, bin: "naabu.exe", dir: "naabu", ver: ["-version"] },
  { name: "httpx", repo: "projectdiscovery/httpx", re: /windows_amd64\.zip$/, bin: "httpx.exe", dir: "httpx", ver: ["-version"] },
  { name: "chisel", repo: "jpillora/chisel", re: /windows_amd64\.zip$/, bin: "chisel.exe", dir: "chisel", ver: ["--version"] },
  { name: "suo5", repo: "zema1/suo5", re: /suo5-windows-amd64\.exe$/, bin: "suo5.exe", dir: "suo5", ver: ["--help"] },
  { name: "fscan", repo: "shadow1ng/fscan", re: /fscan-nolocal_.*windows_x64\.exe$/, bin: "fscan.exe", dir: "fscan", ver: ["-h"] },
  { name: "frp", repo: "fatedier/frp", re: /windows_amd64\.zip$/, bin: "frpc.exe", dir: "frp", ver: ["--version"] },
  { name: "ligolo", repo: "nicocha30/ligolo-ng", re: /agent_.*windows_amd64\.zip$/, bin: "ligolo-agent.exe", dir: "ligolo", ver: ["--help"] },
  // 第 110 轮扩面：技能引用了、但装配器没覆盖、且**确有官方 Windows 构建**的工具。
  // 按「接入现成项目」原则加，资产名与正则全部对着真实 release 资产列表核过（不是照记忆写的）。
  // 覆盖后 dir-bruteforce（ffuf/feroxbuster/gobuster）、nuclei-scan 与 web-fingerprint 与 secdev-boundary（nuclei）、
  // 逆向族（r2）这些技能的「本机缺工具」落差就有装法可指，而不是只能写「未装」。
  { name: "nuclei", repo: "projectdiscovery/nuclei", re: /nuclei_[\d.]+_windows_amd64\.zip$/, bin: "nuclei.exe", dir: "nuclei", ver: ["-version"] },
  { name: "ffuf", repo: "ffuf/ffuf", re: /ffuf_[\d.]+_windows_amd64\.zip$/, bin: "ffuf.exe", dir: "ffuf", ver: ["-V"] },
  { name: "feroxbuster", repo: "epi052/feroxbuster", re: /x86_64-windows-feroxbuster\.exe\.zip$/, bin: "feroxbuster.exe", dir: "feroxbuster", ver: ["--version"] },
  { name: "gobuster", repo: "OJ/gobuster", re: /gobuster_Windows_x86_64\.zip$/, bin: "gobuster.exe", dir: "gobuster", ver: ["version"] },
  // radare2 的资产名用 w64 而非 win；正则必须避开同批的 radare2-<ver>-w64-arm64.zip
  // **bin 必须是 radare2.exe，不是 r2.exe**：实测该 zip 里 r2.exe 与 r2agent.exe 哈希完全相同
  // （都是 r2agent），拿 r2.exe 当主程序会得到 `Usage: r2agent` —— 装好了但根本不能分析。
  // 真正的 CLI 是 radare2.exe（`radare2 -v` → `radare2 6.2.6`）。
  { name: "radare2", repo: "radareorg/radare2", re: /radare2-[\d.]+-w64\.zip$/, bin: "radare2.exe", dir: "radare2", ver: ["-v"] },
  // 有 Windows 形态但暂不纳入（需要额外处理，如实记着而不是假装支持）：
  //   hashcat → 只发 hashcat-<ver>.7z（多平台包，要 7z 解压）
  //   apktool → 只发 apktool_<ver>.jar（要 java 跑，不是 exe）
  //   masscan → release 无任何资产（只发源码）
];

const exists = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };
const target = (t) => path.join(toolkit, t.dir, t.bin);

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "dsh-purge-toolkit", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    // GitHub 未认证 API 只有 60 次/小时。限流与「正则写错」是完全不同的两回事，
    // 但都表现为 probe/安装失败——第 110 轮实测把 403 限流误当成过回归查过一次，
    // 所以这里把限流单独标出来，并给出重置时间。
    if (r.status === 403) {
      const remain = r.headers.get("x-ratelimit-remaining");
      const reset = Number(r.headers.get("x-ratelimit-reset") || 0);
      if (remain === "0" || reset) {
        const at = reset ? new Date(reset * 1000).toISOString().slice(0, 19) + "Z" : "未知";
        throw new Error(`GitHub API 限流（未认证 60 次/小时，剩余 ${remain ?? "?"}，重置于 ${at}）——不是正则写错，稍后重试`);
      }
    }
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

// 下载：三条路依次试，把失败原因留清楚。
//
// 实测历史（这台机器，两种网络状况都出现过）：
//   第 99 轮：github.com:443 连不上，但 api.github.com 可达 → 走 API 资产端点 + Accept: octet-stream。
//   第 119 轮：API 端点也超时了（43.9MB 走 API 是重定向到 objects.githubusercontent.com，
//              Node fetch 在这台机器上 12s 就 failed）。**根因是 Node 的 fetch 不读 Windows 系统代理**
//              （只认 HTTP_PROXY/HTTPS_PROXY 环境变量），而系统代理是开着的（127.0.0.1:10808）；
//              另外 curl 的 schannel 还要关掉证书吊销检查才能握手（--ssl-no-revoke）。
//   实测结论：`curl --proxy <系统代理> --ssl-no-revoke` 能拿到 43.93MB / 61.8s / 746KB/s。
//
// 所以顺序是：fetch(API) → curl(走探测到的代理) → curl(直连)。任何一条成功就返回，
// 全失败时把三条的原因拼起来报——只报最后一条会让人以为是同一个问题。
function systemProxy() {
  // 只**读**系统代理，不改它（用户的代理归用户管）。读不到就返回空串。
  // 注意：本文件是 ESM，**没有 require**——首版这里写了 require("node:child_process")，
  // 异常被 catch 吞掉后返回空串，于是「curl 走代理」那条路被静默跳过，
  // 只剩 curl 直连（超时），症状表现为「解压失败」（其实是根本没下载到）。
  // 用顶层 import 进来的 execFileSync。
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"], { encoding: "utf8", timeout: 5000 });
    const m = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(out);
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const reasons = [];

  // ① fetch（API 资产端点；小文件通常够用）
  try {
    const r = await fetch(url, { headers: { "user-agent": "dsh-purge-toolkit", accept: "application/octet-stream" }, signal: AbortSignal.timeout(120000) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(dest, buf);
      return buf.length;
    }
    reasons.push(`fetch HTTP ${r.status}`);
  } catch (e) {
    reasons.push(`fetch ${String(e?.message ?? e).slice(0, 40)}`);
  }

  // ② curl 走系统代理（不改代理配置，只是让 curl 用它）
  // **必须带 Accept: application/octet-stream**：API 资产端点在不带这个头时返回的是
  // **JSON 元数据**（几百字节），curl 会高高兴兴地报 HTTP 200 + 写一个 0.00 MB 的文件，
  // 然后解压失败——症状看起来像「解压坏了」，其实是根本没下到包。实测踩过。
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || systemProxy();
  const ACCEPT = ["-H", "Accept: application/octet-stream", "-H", "user-agent: dsh-purge-toolkit"];
  if (proxy) {
    const r = spawnSync("curl", ["-sS", "-L", "--proxy", proxy, "--ssl-no-revoke", "-m", "300", ...ACCEPT, "-o", dest, "-w", "%{http_code}", url], { encoding: "utf8", timeout: 330000 });
    if (r.status === 0 && String(r.stdout || "").trim().startsWith("2") && exists(dest) && fs.statSync(dest).size > 1024) return fs.statSync(dest).size;
    reasons.push(`curl(proxy ${proxy}) ${String(r.stdout || "").trim() || String(r.stderr || "").slice(0, 40)}${exists(dest) ? ` size=${fs.statSync(dest).size}` : ""}`);
  } else {
    reasons.push("curl(proxy) 跳过：没探到系统代理");
  }

  // ③ curl 直连（没有代理或代理不通时）
  {
    const r = spawnSync("curl", ["-sS", "-L", "--ssl-no-revoke", "-m", "300", ...ACCEPT, "-o", dest, "-w", "%{http_code}", url], { encoding: "utf8", timeout: 330000 });
    if (r.status === 0 && String(r.stdout || "").trim().startsWith("2") && exists(dest) && fs.statSync(dest).size > 1024) return fs.statSync(dest).size;
    reasons.push(`curl(direct) ${String(r.stdout || "").trim() || String(r.stderr || "").slice(0, 40)}${exists(dest) ? ` size=${fs.statSync(dest).size}` : ""}`);
  }

  throw new Error(`下载失败（三条路都不通）：${reasons.join("｜")}`);
}

function unzip(zipPath, outDir) {
  // Windows 自带 tar 能解 zip（bsdtar）；失败再退回 PowerShell Expand-Archive。
  const r = spawnSync("tar", ["-xf", zipPath, "-C", outDir], { encoding: "utf8", timeout: 120000 });
  if (r.status === 0) return true;
  const ps = spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${outDir}'`], { encoding: "utf8", timeout: 180000 });
  return ps.status === 0;
}

const picks = TOOLS.filter((t) => !only.length || only.includes(t.name));
if (!picks.length) { console.log(`  没有匹配的工具名；可选：${TOOLS.map((t) => t.name).join(", ")}`); process.exit(2); }

// --probe：只解析 latest release 里正则命中的资产名与体积，**不下载、不写盘**。
// 存在的理由：正则写错（资产名对不上）在真装之前看不出来，一装就是白等一次下载；
// 而「先证明它会命中，再信它能装」是本仓的验证纪律。
if (probeOnly) {
  let hitN = 0, missN = 0;
  for (const t of picks) {
    try {
      const rel = await fetchJson(`https://api.github.com/repos/${t.repo}/releases/latest`);
      const asset = (rel.assets || []).find((a) => t.re.test(a.name));
      if (!asset) {
        const names = (rel.assets || []).map((a) => a.name).slice(0, 4).join(", ");
        console.log(`  ✗ ${t.name.padEnd(11)} ${String(rel.tag_name).padEnd(10)} 正则没命中。资产样例：${names || "（无资产）"}`);
        missN += 1;
      } else {
        console.log(`  ✓ ${t.name.padEnd(11)} ${String(rel.tag_name).padEnd(10)} ${asset.name}  ${Math.round(asset.size / 1024)}KB`);
        hitN += 1;
      }
    } catch (e) {
      console.log(`  ✗ ${t.name.padEnd(11)} 查询失败 ${String(e.message).slice(0, 50)}`);
      missN += 1;
    }
  }
  console.log(`  正则命中 ${hitN}｜未命中 ${missN}（--probe 不下载、不写盘）`);
  process.exit(missN ? 1 : 0);
}

let ok = 0, skip = 0, fail = 0;
for (const t of picks) {
  const dst = target(t);
  if (exists(dst) && !force) {
    console.log(`  · ${t.name.padEnd(10)} 已就位（${fs.statSync(dst).size} 字节）`);
    skip += 1;
    continue;
  }
  if (checkOnly) {
    // 注意 spawnSync 找不到可执行文件时 status === null 且带 error —— 不能把 null 当成功（首版就踩过，显示成 ✓ 缺失）。
    const res = spawnSync(dst, t.ver, { encoding: "utf8", timeout: 6000 });
    const runnable = !res.error && (res.status === 0 || res.status === 1);
    console.log(`  ${runnable ? "✓" : "✗"} ${t.name.padEnd(10)} ${runnable ? "可执行" : "缺失或不可执行"}${res.error ? "（" + String(res.error.code || res.error.message).slice(0, 24) + "）" : ""}`);
    if (!runnable) fail += 1;
    continue;
  }
  try {
    const rel = await fetchJson(`https://api.github.com/repos/${t.repo}/releases/latest`);
    const asset = (rel.assets || []).find((a) => t.re.test(a.name));
    if (!asset) throw new Error(`latest 里没有匹配 ${t.re} 的资产`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `tk-${t.name}-`));
    const tmpFile = path.join(tmpDir, asset.name);
    const size = await download(asset.url, tmpFile);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (/\.zip$/i.test(asset.name)) {
      if (!unzip(tmpFile, tmpDir)) throw new Error("解压失败（tar 与 Expand-Archive 都不成）");
      const found = [];
      const walk = (d, depth) => {
        if (depth > 3) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { walk(p, depth + 1); continue; }
          if (e.name.toLowerCase().endsWith(".exe")) found.push(p);
        }
      };
      walk(tmpDir, 0);
      const pick = found.find((p) => path.basename(p).toLowerCase() === t.bin.toLowerCase()) || found[0];
      if (!pick) throw new Error("解压后没找到 .exe");
      // **不能只复制 exe**：radare2 这类工具依赖同目录或上级目录的 r_*.dll，
      // 只拿走 r2.exe 会让它启动即崩（实测退出码 0xC0000135 = DLL 缺失），
      // 而脚本还照样报「✓ 装好」——**装了但跑不起来，比没装更糟**。
      // 做法：把**整个解压树**按原结构铺到目标目录，再把 pick 放到 dst。
      // 只复制 pick 的同级文件不够（实测：r2.exe 在 bin/ 下、dll 在根，同级复制会漏掉 dll）。
      const copyTree = (from, to) => {
        let n = 0;
        const walkCopy = (src, out) => {
          let ents = [];
          try { ents = fs.readdirSync(src, { withFileTypes: true }); } catch { return; }
          for (const e of ents) {
            const s = path.join(src, e.name);
            const o = path.join(out, e.name);
            if (e.isDirectory()) { try { fs.mkdirSync(o, { recursive: true }); } catch { /* 忽略 */ } walkCopy(s, o); continue; }
            try { fs.copyFileSync(s, o); n += 1; } catch { /* 单个文件失败不影响主流程 */ }
          }
        };
        walkCopy(from, to);
        return n;
      };
      const copied = copyTree(tmpDir, path.dirname(dst));
      if (copied <= 1) fs.copyFileSync(pick, dst);
      else if (!exists(dst)) fs.copyFileSync(pick, dst);
      // 解压树可能是 `radare2-<ver>-w64/bin/r2.exe` 这种嵌套结构，而 dll 在 `bin/` 里。
      // 把 pick 所在目录的内容**铺到 dst 同级**，否则 r2.exe 与它的 dll 分居两地，
      // 启动即 0xC0000135（实测：753 个文件都复制了，r2 还是起不来，就是因为差这一层）。
      {
        const pickDir = path.dirname(pick);
        const dstDir = path.dirname(dst);
        if (path.resolve(pickDir) !== path.resolve(dstDir)) {
          for (const e of fs.readdirSync(pickDir, { withFileTypes: true })) {
            if (!e.isFile()) continue;
            const to = path.join(dstDir, e.name);
            if (exists(to)) continue;
            try { fs.copyFileSync(path.join(pickDir, e.name), to); } catch { /* 忽略 */ }
          }
        }
      }
    } else {
      fs.copyFileSync(tmpFile, dst);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const v = spawnSync(dst, t.ver, { encoding: "utf8", timeout: 8000 });
    const verText = String((v.stdout || "") + (v.stderr || "")).split(/\r?\n/).find((l) => l.trim()) || "";
    // **退出码必须看**：radare2 只复制 r2.exe 时启动即崩（0xC0000135 DLL 缺失），
    // 但旧代码只看有没有输出，于是照样打「✓ 装好」——把坏件报成好件。
    // 非 0 且没有任何输出 = 起不来，直接抛错让它进失败分支。
    if (v.status !== 0 && !verText) {
      const hex = v.status === null ? "null" : (v.status >>> 0).toString(16).toUpperCase();
      throw new Error(`装好了但跑不起来（退出码 ${v.status} / 0x${hex}）——多为缺 DLL 或被安全软件拦截`);
    }
    console.log(`  ✓ ${t.name.padEnd(10)} ${String(rel.tag_name).padEnd(10)} ${Math.round(size / 1024)}KB｜${verText.trim().slice(0, 56)}`);
    ok += 1;
  } catch (e) {
    console.log(`  ✗ ${t.name.padEnd(10)} ${String(e.message).slice(0, 70)}`);
    fail += 1;
  }
}
// ── nuclei 模板补全 ──
// 模板是**独立资产**，不在 exe 里。第 125 轮实测：exe 装好了但模板目录空，
// `nuclei -u ...` 直接 `[FTL] no templates provided for scan`——**装好工具 ≠ 能用**，
// 而「下一步」还会一直给这条命令。更麻烦的是 `nuclei -update-templates` 在这台机器上
// **拉不动**（只报 outdated、目录仍空），但 curl 走系统代理直下模板仓库 zip 可以（18.62MB/138s）。
// 所以：先用它自带的 -ut，不行再用 curl 拉仓库 zip 解压到位。
if (picks.some((t) => t.name === "nuclei") && !checkOnly) {
  const tplDir = path.join(os.homedir(), "nuclei-templates");
  const countYaml = () => { try { return fs.readdirSync(tplDir, { recursive: true }).filter((f) => String(f).endsWith(".yaml")).length; } catch { return 0; } };
  if (countYaml() < 100) {
    console.log("  · nuclei 模板缺失，补模板（exe 在但没模板时 nuclei 会直接 FTL 退出）");
    const nucleus = path.join(toolkit, "nuclei", "nuclei.exe");
    if (exists(nucleus)) spawnSync(nucleus, ["-update-templates", "-silent"], { encoding: "utf8", timeout: 300000 });
    if (countYaml() < 100) {
      const zip = path.join(os.tmpdir(), "nuclei-templates.zip");
      const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || systemProxy();
      const url = "https://github.com/projectdiscovery/nuclei-templates/archive/refs/heads/main.zip";
      const ACC = ["-H", "user-agent: dsh-purge-toolkit"];
      const tryCurl = (extra) => {
        try { fs.rmSync(zip, { force: true }); } catch { /* 忽略 */ }
        const r = spawnSync("curl", ["-sS", "-L", ...extra, "--ssl-no-revoke", "-m", "400", ...ACC, "-o", zip, "-w", "%{http_code}", url], { encoding: "utf8", timeout: 430000 });
        return r.status === 0 && String(r.stdout || "").trim().startsWith("2") && exists(zip) && fs.statSync(zip).size > 1048576;
      };
      const okZip = (proxy ? tryCurl(["--proxy", proxy]) : false) || tryCurl([]);
      if (okZip) {
        const tmpU = fs.mkdtempSync(path.join(os.tmpdir(), "ntpl-"));
        spawnSync("tar", ["-xf", zip, "-C", tmpU], { encoding: "utf8", timeout: 180000 });
        const inner = fs.readdirSync(tmpU, { withFileTypes: true }).find((e) => e.isDirectory());
        if (inner) spawnSync("cmd", ["/c", "xcopy", path.join(tmpU, inner.name), tplDir, "/E", "/I", "/Q", "/Y"], { encoding: "utf8", timeout: 300000 });
        try { fs.rmSync(tmpU, { recursive: true, force: true }); } catch { /* 忽略 */ }
        try { fs.rmSync(zip, { force: true }); } catch { /* 忽略 */ }
      }
    }
    const n = countYaml();
    console.log(n >= 100 ? `  ✓ nuclei 模板 ${n} 个（${tplDir}）` : `  ✗ nuclei 模板仍为 ${n} 个——nuclei 会报 no templates，跑扫描前必须先解决`);
  }
}

console.log(`  装好 ${ok}｜已存 ${skip}｜失败 ${fail}｜toolkit=${toolkit}`);
process.exit(fail ? 1 : 0);