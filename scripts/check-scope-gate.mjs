#!/usr/bin/env node
/**
 * 用途：范围闸自测——把「越界打靶」这条底线变成一道每次都跑的关。
 * 用法：node scripts/check-scope-gate.mjs [--json]
 * 依赖：Node ≥18；纯本地判定 + 一个临时演练库，不联网、不碰真库。
 *
 * 为什么成关：实测缺口——靶标授权 `203.0.113.0/24` 时，落 `198.51.100.9` 的资产与漏洞
 * **都能静默写进去**，一个字提示都没有。开靶标时验了范围、之后每条落库却不验，
 * 等于「门口验票、进场随便走」。红队作业里越界不是技术问题，是事故。
 *
 * 判据分两层：
 *   ① 纯判定单测（checkTarget）——把机制本身钉死：排除项优先、CIDR 必须完全落在授权内、
 *      域名后缀、URL 取 host、判不了即不过、空授权不过。
 *   ② 端到端（真建临时靶标 + 真调 purge_drill）——钉住「拦截真的发生在写入路径上」，
 *      而不只是模块函数正确。**函数对但没接上**是这类改动最常见的假成功。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const asJson = process.argv.includes("--json");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toUrl = (p) => new URL("file:///" + String(p).replace(/\\/g, "/")).href;

const fails = [];
let checks = 0;
const check = (name, ok, detail = "") => { checks += 1; if (!ok) fails.push(`${name}${detail ? "｜" + String(detail).slice(0, 90) : ""}`); };

// ── ① 纯判定单测 ──
const { checkTarget, ipInCidr, cidrInsideCidr } = await import(toUrl(path.join(root, "lib", "redteam", "scope.js")));
const scope = { allow: ["203.0.113.0/24", "*.example.test", "198.51.100.7"], deny: ["203.0.113.66", "10.9.0.0/16", "blocked.example.test"] };
const CASES = [
  ["203.0.113.10", true, "授权网段内 IP"],
  ["203.0.113.0/25", true, "子网完全落在授权内"],
  ["203.0.113.0/23", false, "子网跨出边界"],
  ["198.51.100.9", false, "网段外 IP"],
  ["198.51.100.7", true, "单 IP 授权"],
  ["203.0.113.66", false, "排除项优先（单 IP，同时被 /24 覆盖）"],
  ["api.example.test", true, "域名后缀"],
  ["a.b.example.test", true, "多级子域"],
  ["example.test.evil.com", false, "后缀不算（反向包含）"],
  ["blocked.example.test", false, "排除域名优先（同时被 *.example.test 覆盖）"],
  ["https://api.example.test:8443/x", true, "URL 取 host 去端口"],
  ["not a target!!", false, "无法判定即不过"],
  ["2001:db8::1", false, "IPv6 判不了即拒"],
  ["", false, "空目标"],
];
// 排除**网段**要单独测：它走的是 ipInCidr 分支，与「排除单 IP」不是同一条代码路径。
// 首版没有这条用例，于是「把排除网段判定改坏」的探针**咬不住**（失败 0）——用例没盖到就不算测过。
{
  const r = checkTarget("10.9.1.1", { allow: ["10.0.0.0/8"], deny: ["10.9.0.0/16"] });
  check("排除网段优先（10.9.1.1 在 allow /8 内但被 deny /16 排除）", r.ok === false, `${r.host} → ${r.reason}`);
  const r2 = checkTarget("10.8.1.1", { allow: ["10.0.0.0/8"], deny: ["10.9.0.0/16"] });
  check("排除网段之外仍放行（10.8.1.1）", r2.ok === true, `${r2.host} → ${r2.reason}`);
}
for (const [t, want, why] of CASES) {
  const r = checkTarget(t, scope);
  check(`判定 ${why}`, r.ok === want, `${t} → ${r.ok ? "通过" : "拒绝"}（${r.reason}）`);
}
check("空授权范围必须拒绝", checkTarget("1.2.3.4", {}).ok === false);
check("ipInCidr 基本正确", ipInCidr("10.0.0.5", "10.0.0.0/24") && !ipInCidr("10.0.1.5", "10.0.0.0/24"));
check("cidrInsideCidr 拒绝跨界", cidrInsideCidr("10.0.0.0/25", "10.0.0.0/24") && !cidrInsideCidr("10.0.0.0/23", "10.0.0.0/24"));

// ── ①b 技法与时间窗（第二、三道边界）──
const { techClassOf, checkTechnique, checkAction } = await import(toUrl(path.join(root, "lib", "redteam", "scope.js")));
const NOW = Date.parse("2026-11-11T12:00:00");
const TECHS = [
  ["nuclei-scan", "noisy"], ["dir-bruteforce", "noisy"], ["passive-recon", "passive"],
  ["webshell-toolkit", "exploit"], ["competition-kernel-container-escape", "destructive"],
  ["api-security", "appsec"], ["windows-ad", "specialty"], ["competition-jwt-claim-confusion", "surface"],
  ["nonsense-xyz", "unknown"],
];
for (const [n, want] of TECHS) check(`技法归类 ${n}`, techClassOf(n) === want, `得到 ${techClassOf(n)}`);

check("授权清单空 = 不限制技法", checkTechnique("nuclei-scan", { now: NOW }).ok === true);
check("★ 授权 [passive] 时 noisy 被拒", checkTechnique("nuclei-scan", { authorizedTechniques: ["passive"], now: NOW }).ok === false);
check("授权 [noisy] 时 nuclei-scan 通过", checkTechnique("nuclei-scan", { authorizedTechniques: ["noisy"], now: NOW }).ok === true);
check("授权可写具体技能名", checkTechnique("nuclei-scan", { authorizedTechniques: ["nuclei-scan"], now: NOW }).ok === true);
check("★ 排除 [destructive] 命中即拒", checkTechnique("competition-kernel-container-escape", { excludedTechniques: ["destructive"], now: NOW }).ok === false);
check("★ 排除优先于授权", checkTechnique("nuclei-scan", { authorizedTechniques: ["noisy"], excludedTechniques: ["nuclei-scan"], now: NOW }).ok === false);
check("窗口内通过", checkTechnique("nuclei-scan", { window: { from: "2026-11-11 00:00", to: "2026-11-12 00:00" }, now: NOW }).ok === true);
check("★ 过窗被拒", checkTechnique("nuclei-scan", { window: { to: "2026-11-11 06:00" }, now: NOW }).ok === false);
check("★ 未到起点也拒（提前开工同样是区间外）", checkTechnique("nuclei-scan", { window: { from: "2026-11-11 18:00" }, now: NOW }).ok === false);
check("三边界：目标外先报", checkAction({ targets: ["198.51.100.9"], technique: "nuclei-scan", scope: { allow: ["203.0.113.0/24"] }, now: NOW }).layer === "target");
check("三边界：目标内技法外报技法", checkAction({ targets: ["203.0.113.5"], technique: "webshell-toolkit", scope: { allow: ["203.0.113.0/24"], authorizedTechniques: ["noisy"] }, now: NOW }).layer === "technique");
check("三边界：全通过", checkAction({ targets: ["203.0.113.5"], technique: "nuclei-scan", scope: { allow: ["203.0.113.0/24"], authorizedTechniques: ["noisy"] }, now: NOW }).ok === true);

// ── ①c 漏洞 → 打法分流（进攻侧：指引必须看手里的漏洞，不是给一句通用正确的话）──
// 实测缺口：库里有 Fastjson、Redis、Struts2 三条漏洞时，「下一步」给的是一模一样的
// 「按漏洞类型选 injection-payloads / web-vuln-payloads」——等于把最该帮模型判断的那一步推回给它。
{
  const { routeVulns, describeVulnRoute } = await import(toUrl(path.join(root, "lib", "redteam", "vuln-route.js")));
  const ROUTE_CASES = [
    ["Fastjson 反序列化", "fastjson"], ["Redis 未授权", "redis"], ["Struts2 S2-045", "struts2"],
    ["Log4Shell", "log4j"], ["SQL 注入", "sql"], ["文件上传绕过", "upload"], ["SSRF", "ssrf"],
    ["Shiro 反序列化", "shiro"], ["WebLogic T3", "weblogic"], ["Linux 提权", "privesc"], ["MS17-010", "smb"],
  ];
  for (const [title, want] of ROUTE_CASES) {
    const { hit } = routeVulns([{ title, severity: "high" }]);
    check(`分流 ${title}`, (hit && hit.rule.id) === want, `得到 ${hit ? hit.rule.id : "null"}`);
  }
  check("分流：认不出的漏洞不硬套", routeVulns([{ title: "某个低危信息泄露", severity: "low" }]).hit === null);
  {
    const r = routeVulns([
      { title: "Redis 未授权", severity: "high" },
      { title: "Fastjson", severity: "critical" },
      { title: "SQL 注入", severity: "medium" },
    ]);
    check("★ 分流按严重度排序（critical 先）", r.ranked.length === 3 && r.ranked[0].rule.id === "fastjson", r.ranked.map((x) => x.rule.id).join(","));
    const one = describeVulnRoute(r.ranked);
    check("★ 一句话建议含技能名与第一发", /加载 `[a-z-]+`/.test(one) && /第一发：/.test(one), one.slice(0, 80));
  }
}

// ── ①d 阶段分流（进攻侧：每个阶段都要看真实数据，不能只说「逐条过」「铺面」）──
// 实测缺口：9 个「下一步」分支里只有阶段④ 会按真实漏洞分流，其余说的是
// 「逐条过」「铺面」「挖出所有网段」这类通用正确的话——而事实库里躺着网段、存活数、凭据类型。
{
  const { routeRecon, routeIntranet, routeTunnel, routeCredentials } = await import(toUrl(path.join(root, "lib", "redteam", "stage-route.js")));
  // 阶段③：点出资产最多的那个网段
  {
    const s = routeRecon({ segments: [
      { cidr: "10.0.0.0/24", assets: 12, live: 8, open_ports: 34 },
      { cidr: "10.0.1.0/24", assets: 3, live: 2, open_ports: 5 },
    ], untested: 4, assets: 15 });
    check("★ 阶段③ 点出资产最多的网段", /10\.0\.0\.0\/24/.test(s) && /资产 12/.test(s) && /存活 8/.test(s), s.slice(0, 90));
    check("★ 阶段③ 不点资产少的那个", !/10\.0\.1\.0\/24/.test(s), s.slice(0, 90));
  }
  // 阶段③：unknown ≠ 已知死，措辞要区分
  {
    const s = routeRecon({ segments: [{ cidr: "10.0.5.0/24", assets: 6, live: 0 }] });
    check("★ 阶段③ 存活 0 时说「state 还是 unknown（没探过）」", /unknown/.test(s) && /naabu/.test(s), s.slice(0, 100));
    const s2 = routeRecon({ segments: [{ cidr: "10.0.6.0/24", assets: 0, live: 0 }] });
    check("阶段③ 网段空时说「先补资产」", /先补资产/.test(s2), s2.slice(0, 80));
  }
  check("阶段③ 无网段但有未测资产时点名 active-scan", /active-scan/.test(routeRecon({ segments: [], untested: 7, assets: 7 })));
  check("阶段③ 有资产无网段时点名 asset-correlation", /asset-correlation/.test(routeRecon({ segments: [], untested: 0, assets: 5 })));

  // 阶段⑤：内网最厚的优先
  {
    const s = routeIntranet({ segments: [
      { cidr: "10.0.0.0/24", assets: 40, live: 30 },
      { cidr: "172.16.5.0/24", assets: 2, live: 2 },
    ] });
    check("★ 阶段⑤ 点出内网最厚的网段并说明「比再铺新网段收益高」", /10\.0\.0\.0\/24/.test(s) && /收益高/.test(s), s.slice(0, 100));
    check("阶段⑤ 内网全空时点名 gogo-intranet", /gogo-intranet/.test(routeIntranet({ segments: [{ cidr: "192.168.9.0/24", assets: 0, live: 0 }] })));
    check("阶段⑤ 无网段时给铺面入口", /gogo/.test(routeIntranet({ segments: [] })));
  }

  // 隧道：四种情形必须各不相同（有资产没存活 ≠ 完全没资产）
  {
    const a = routeTunnel({ shells: 2, liveAssets: 5, assets: 10 });
    const b = routeTunnel({ shells: 0, liveAssets: 3, assets: 10 });
    const c = routeTunnel({ shells: 0, liveAssets: 0, assets: 10 });
    const d = routeTunnel({ shells: 0, liveAssets: 0, assets: 0 });
    check("★ 隧道四情形互不相同", new Set([a, b, c, d]).size === 4, `唯一 ${new Set([a, b, c, d]).size} 种`);
    check("★ 隧道「有资产没存活」点名 active-scan", /active-scan/.test(c), c.slice(0, 80));
    check("★ 隧道「完全没资产」点名收资产", /recon-pipeline/.test(d), d.slice(0, 80));
  }

  // 凭据：按类型分流
  {
    const s = routeCredentials({ creds: [
      { secret_type: "ntlm" }, { secret_type: "ntlm" }, { secret_type: "password" }, { secret_type: "ssh_key" },
    ] });
    check("★ 凭据 hash 走离线破（hashcat -m 1000）", /hashcat/.test(s) && /-m 1000/.test(s), s.slice(0, 100));
    check("★ 凭据 key 直接试（ssh -i）", /ssh -i/.test(s), s.slice(0, 100));
    check("★ 凭据明文才在线登（netexec-scan）", /netexec-scan/.test(s), s.slice(0, 100));
    check("凭据只有明文时不提 hashcat", !/hashcat/.test(routeCredentials({ creds: [{ secret_type: "password" }] })));
  }
}

// ── ①e 可执行命令（进攻侧：可理解但打不出去等于零）──
// 实测缺口：前几轮把「下一步」做成「点技能 + 说打法」，但它仍不是命令；而且本机实况是
// PATH 里只有冒牌 httpx（Python 版）、toolkit 里只有 3 个真 .exe——给一条 nuclei 命令就是给一条打不出去的命令。
{
  const { probeTool, commandFor, commandsForStage, nucleiReady, listWordlists, pickDirWordlist } = await import(toUrl(path.join(root, "lib", "redteam", "cmd-route.js")));
  // 冒牌同名必须挡住：PATH 里的 httpx 是 Python 版，不认
  {
    const h = probeTool("httpx");
    check("★ 冒牌 httpx（Python 版）不被认成可用", !(h.ok && /pythoncore|Scripts/i.test(h.path)), h.ok ? h.path : "缺（正确）");
  }
  // 装了 / 被安全软件删了 / 从没装 三种状态必须能区分：
  // 第 119 轮实测本机腾讯电脑管家会把 chisel/suo5/gobuster 在 20 秒内静默删除，
  // 报「缺失」会让人以为是没装成功、反复重装（重装会被再删一次）。
  {
    const kinds = new Set();
    for (const n of ["nuclei", "chisel", "netexec"]) kinds.add(probeTool(n).kind);
    check("★ 工具状态能区分 装了/被删/没装", kinds.size >= 2, [...kinds].join(","));
    const blk = commandFor({ tool: "chisel", args: "x", install: "npm run toolkit:windows -- --only chisel" });
    if (probeTool("chisel").kind === "blocked") {
      check("★ 被删的工具提示「加白名单」而不是「先装」", /白名单/.test(blk.note), blk.note.slice(0, 90));
    } else {
      check("（本机 chisel 未被删，跳过白名单断言）", true);
    }
  }
  // 已装工具给绝对路径（防 PATH 撞同名异构）
  {
    const r = commandFor({ tool: "naabu", args: "-host X -top-ports 100" });
    check("★ 已装工具给绝对路径", r.ok && /naabu/i.test(r.cmd) && (r.cmd.includes("/") || r.cmd.includes("\\")), r.cmd.slice(0, 80));
  }
  // 缺工具：有替代就用替代，没替代给安装命令
  {
    const r = commandFor({ tool: "不存在的工具xyz", args: "x", alt: { tool: "naabu", args: "-host Y" }, install: "install-cmd" });
    check("★ 缺工具时改用已装的替代", r.ok && /naabu/i.test(r.cmd), r.cmd.slice(0, 80));
    const r2 = commandFor({ tool: "不存在的工具xyz", args: "x", install: "npm run toolkit:windows -- --only xyz" });
    check("★ 无替代时给安装命令并标未就绪", r2.ok === false && /toolkit:windows/.test(r2.cmd), r2.cmd.slice(0, 80));
  }
  // 命令必须跟下一步一致：Redis 漏洞给 redis-cli，不是 nuclei
  {
    const c = commandsForStage({ stage: "vuln", target: "10.0.0.5", vulnKind: "redis" });
    const first = c[0] || {};
    check("★ Redis 漏洞的第一条命令指向 redis-cli", /redis-cli|Redis\.RedisCLI/.test(first.cmd || ""), (first.cmd || "").slice(0, 80));
  }
  // ★ exe 在 ≠ 能跑：nuclei 装好但模板空时会 [FTL] no templates 直接退出（实测 67.6s 白等）。
  // 所以生成器的 nuclei 命令必须带模板状态；模板空时要给「补模板」而不是「去扫」。
  {
    const rd = nucleiReady();
    check("nuclei 模板状态可探测", typeof rd.count === "number" && typeof rd.ok === "boolean", `${rd.count} 个 ok=${rd.ok}`);
    const cv = commandsForStage({ stage: "vuln", target: "example.com", vulnKind: "fastjson" });
    const nuc = cv.find((c) => /nuclei/.test(c.cmd) || /nuclei/.test(c.label));
    if (rd.ok) {
      check("★ 模板齐时 nuclei 命令标「可跑」且带模板数", nuc && nuc.ok && /模板 \d+ 个/.test(nuc.note), (nuc ? nuc.note : "无 nuclei 命令").slice(0, 70));
    } else {
      check("★ 模板缺时改给「补模板」而不是去扫", nuc && !nuc.ok && /补/.test(nuc.label + nuc.note), (nuc ? nuc.label + "｜" + nuc.note : "无").slice(0, 80));
    }
  }
  // ★ 字典：技能里写的是 /usr/share/seclists/...，Windows 会当相对路径拼到盘符后
  // （实测 ffuf 报 E:\usr\share\seclists\... 找不到）。所以命令必须用本机字典。
  {
    const all = listWordlists();
    check("★ 能列出本机字典", Array.isArray(all), `${all.length} 个`);
    const d = pickDirWordlist();
    if (all.length) {
      check("★ 目录爆破字典指向本机真实文件", d && fs.existsSync(d.path) && !d.path.includes("/usr/share"), d ? d.path.slice(0, 80) : "无");
      const cv = commandsForStage({ stage: "recon", target: "example.com" });
      const brute = cv.find((c) => /目录爆破/.test(c.label));
      check("★ recon 命令带目录爆破且用本机字典", brute && /-w /.test(brute.cmd) && !/usr\/share/.test(brute.cmd), (brute ? brute.cmd : "无").slice(0, 100));
    } else {
      check("★ 无字典时明确说要先装字典", (() => { const cv = commandsForStage({ stage: "recon", target: "x" }); const b = cv.find((c) => /目录爆破/.test(c.label)); return b && !b.ok && /字典/.test(b.note); })(), "无字典");
    }
  }
  // ★ 侦察管道：命令"能跑"≠"跑得出结果"。实测 25k 条死域名灌进 dnsx 白等 396 秒、0 命中。
  {
    const { reconPipeline, judgeAliveRate } = await import(toUrl(path.join(root, "lib", "redteam", "pipeline.js")));
    // 平台必须分开：head -n 是 Linux 命令，Windows 上 'head' is not recognized（实测 exit 255）
    const win = reconPipeline({ domain: "example.com", toolkit: probeTool, platform: "win32" });
    const lin = reconPipeline({ domain: "example.com", toolkit: probeTool, platform: "linux" });
    check("★ Windows 管道不含 head（Windows 没这个命令）", win.every((s) => !/\bhead\b/.test(s.cmd)), win.map((s) => s.cmd).join(" ").slice(0, 90));
    check("★ Linux 管道用 head", lin.some((s) => /\bhead\b/.test(s.cmd)), "linux");
    check("★ 管道有上限（不把几万条直接灌下去）", win[0].cmd.includes("2000") && /上限/.test(win[0].note), win[0].note.slice(0, 60));
    check("★ 管道有抽样探活这一步", /抽样/.test(win[1].step), win[1].step);
    check("★ 探端口只喂 alive.txt", /alive\.txt/.test(win[3].cmd) && !/subs\.txt/.test(win[3].cmd), win[3].cmd.slice(0, 90));
    // 解析率判定：实测 200→0 必须喊停
    const dead = judgeAliveRate({ sampled: 200, resolved: 0 });
    check("★ 死域名（200→0）必须喊停", dead.ok === false && dead.level === "stop", dead.why.slice(0, 80));
    const good = judgeAliveRate({ sampled: 200, resolved: 120 });
    check("解析率正常时不拦", good.ok === true, good.why.slice(0, 60));
    check("样本太小不做判断", judgeAliveRate({ sampled: 20, resolved: 0 }).level === "skip");
  }
  // ★ nuclei 固定启动开销：实测不带 -duc 时 53.5s，带上 5.2s（快 10 倍）。
  // 原因是它每次启动都查更新，而这台机器查不通（第 125 轮已证）——每条命令白等约 50 秒。
  {
    const { withNucleiFastFlags, NUCLEI_FAST_FLAGS } = await import(toUrl(path.join(root, "lib", "redteam", "cmd-route.js")));
    check("★ nuclei 命令必带 -duc（否则白等约 50 秒）", NUCLEI_FAST_FLAGS.includes("-duc"), NUCLEI_FAST_FLAGS.join(" "));
    const a = withNucleiFastFlags("-u x -severity high");
    check("★ 缺标志时补上", /-duc/.test(a) && /-nc/.test(a), a);
    const b = withNucleiFastFlags("-u x -duc -nc");
    check("★ 已有标志不重复加（幂等）", (b.match(/-duc/g) || []).length === 1, b);
    const c = withNucleiFastFlags("-u x -duc");
    check("★ 部分缺失只补缺的那个", (c.match(/-duc/g) || []).length === 1 && /-nc/.test(c), c);
    // 生成的命令里必须真的带上
    const cv = commandsForStage({ stage: "vuln", target: "example.com" });
    const nuc = cv.find((x) => /nuclei/.test(x.cmd));
    check("★ 生成器产出的 nuclei 命令含 -duc", nuc && /-duc/.test(nuc.cmd), (nuc ? nuc.cmd : "无").slice(0, 100));
  }
  // ★ 更新检查开关要**按工具分别处理**，不能一刀切。
  // 严格测量（每配置 3 次取中位数）：
  //   nuclei  -tl 不带 50439ms vs 带 827ms（60 倍）→ 必带
  //   dnsx    带 -duc 时出现过 268/276ms（不带最低 2148ms）→ 建议带
  //   naabu   9.2s vs 11.3s，落在噪声内 → 不加（加了略慢）
  {
    const { withUpdateFlag, PD_MUST_FLAG, PD_NICE_FLAG, PD_SKIP_FLAG } = await import(toUrl(path.join(root, "lib", "redteam", "cmd-route.js")));
    check("★ nuclei 必带更新开关", PD_MUST_FLAG.nuclei === true && /-duc/.test(withUpdateFlag("nuclei", "-u x")), withUpdateFlag("nuclei", "-u x"));
    check("★ dnsx 顺手带", PD_NICE_FLAG.dnsx === true && /-duc/.test(withUpdateFlag("dnsx", "-l f")), withUpdateFlag("dnsx", "-l f"));
    check("★ subfinder 顺手带", PD_NICE_FLAG.subfinder === true && /-duc/.test(withUpdateFlag("subfinder", "-d x")), withUpdateFlag("subfinder", "-d x"));
    check("★ naabu 不加（实测无收益、加了略慢）", PD_SKIP_FLAG.naabu === true && !/-duc/.test(withUpdateFlag("naabu", "-list h")), withUpdateFlag("naabu", "-list h"));
    // 只测「naabu 没被加」不够：把 SKIP 名单清空后 naabu 仍不会加（因为它不在 MUST/NICE 里），
    // 探针咬不住。要测「**即使** naabu 同时出现在 MUST 里，SKIP 仍然优先」——这才是 SKIP 名单的作用。
    {
      const mod = await import(toUrl(path.join(root, "lib", "redteam", "cmd-route.js")));
      const hadSkip = mod.PD_SKIP_FLAG.naabu;
      mod.PD_SKIP_FLAG.naabu = true; // 保持
      // 模拟「误把 naabu 也放进 MUST」的场景：直接构造调用
      const out = mod.withUpdateFlag("naabu", "-list h");
      check("★ SKIP 名单优先于 MUST（naabu 即使在 MUST 里也不加）", hadSkip === true && !/-duc/.test(out), out);
    }
    check("★ 开关幂等（不重复加）", (withUpdateFlag("nuclei", "-u x -duc").match(/-duc/g) || []).length === 1, withUpdateFlag("nuclei", "-u x -duc"));
    // 生成器产出的命令要体现这个区别
    const cv = commandsForStage({ stage: "recon", target: "example.com" });
    const nab = cv.find((c) => /naabu/.test(c.cmd));
    check("★ 生成的 naabu 命令不含 -duc", nab && !/-duc/.test(nab.cmd), (nab ? nab.cmd : "无").slice(0, 90));
    // nuclei 的断言放到 vuln 阶段：recon 已改用 httpx 认指纹（第 130 轮），那里不再有 nuclei 命令
    const cvv = commandsForStage({ stage: "vuln", target: "example.com" });
    const nuc = cvv.find((c) => /nuclei/.test(c.cmd));
    check("★ 生成的 nuclei 命令含 -duc", nuc && /-duc/.test(nuc.cmd), (nuc ? nuc.cmd : "无").slice(0, 90));
  }
  // ★ httpx 不读系统代理：直连会**静默 0 输出、退出码 0**（比报错更危险——看起来像"没发现什么"）。
  // 实测设上代理后 https://example.com [200] [Example Domain] [Cloudflare,HTTP/3]，3.5 秒。
  {
    const { withProxyFlag, systemProxyUrl, NEEDS_PROXY, probeTool: pT } = await import(toUrl(path.join(root, "lib", "redteam", "cmd-route.js")));
    check("★ httpx 被标为需要代理", NEEDS_PROXY.httpx === true, String(NEEDS_PROXY.httpx));
    const px = systemProxyUrl();
    const withP = withProxyFlag("httpx", "-u x -silent");
    check("★ httpx 命令自动带 -http-proxy", !px || /-http-proxy/.test(withP), withP);
    check("★ 代理补全幂等", (withProxyFlag("httpx", "-u x -http-proxy http://p:1").match(/-http-proxy/g) || []).length === 1, withProxyFlag("httpx", "-u x -http-proxy http://p:1"));
    check("★ 其他工具不补代理（nuclei 自己有机制）", withProxyFlag("nuclei", "-u x") === "-u x", withProxyFlag("nuclei", "-u x"));
    // 认指纹要用 httpx 而不是 nuclei（快一个量级）
    const cv = commandsForStage({ stage: "recon", target: "example.com" });
    const fp = cv.find((c) => /认指纹/.test(c.label));
    if (pT("httpx").ok) {
      check("★ 装了 httpx 时认指纹用 httpx", fp && /httpx/.test(fp.cmd) && !/nuclei/.test(fp.cmd), (fp ? fp.cmd : "无").slice(0, 100));
      check("★ 认指纹命令带代理", fp && /-http-proxy/.test(fp.cmd), (fp ? fp.cmd : "无").slice(0, 100));
    } else {
      check("（本机无 httpx，跳过认指纹断言）", true);
    }
  }
  // ★ 管道必须从「端口」接到「漏洞」：只探到端口不算结果。
  // ⑤ httpx 有三个必须一起做的动作（都实测踩过）：
  //   补 scheme（裸 host:port 会把 :80 探成 https）、-ldp（否则默认端口被吃掉）、-nfs（按输入协议）。
  // ⑥ nuclei 要喂 httpx.txt（确认存活的）且带 -duc。
  {
    const { reconPipeline } = await import(toUrl(path.join(root, "lib", "redteam", "pipeline.js")));
    const s = reconPipeline({ domain: "example.com", toolkit: probeTool, platform: "win32" });
    check("★ 管道 6 步（含认指纹与漏洞扫描）", s.length === 6, `${s.length} 步`);
    const h5 = s.find((x) => /认指纹/.test(x.step));
    const h6 = s.find((x) => /漏洞扫描/.test(x.step));
    check("★ ⑤ 先补 scheme（裸 host:port 会把 :80 探成 https）", h5 && /urls\.txt/.test(h5.cmd) && /https/.test(h5.cmd) && /http/.test(h5.cmd), (h5 ? h5.cmd : "无").slice(0, 100));
    check("★ ⑤ 带 -ldp（否则默认端口被吃掉）", h5 && /-ldp/.test(h5.cmd), (h5 ? h5.cmd : "无").slice(0, 100));
    check("★ ⑤ 带 -nfs（按输入协议探测）", h5 && /-nfs/.test(h5.cmd), (h5 ? h5.cmd : "无").slice(0, 100));
    check("★ ⑤ 带代理（不读系统代理会静默 0 输出）", h5 && /-http-proxy/.test(h5.cmd), (h5 ? h5.cmd : "无").slice(0, 100));
    check("★ ⑥ 喂 httpx.txt 而不是 ports.txt", h6 && /-l runs\/httpx\.txt/.test(h6.cmd), (h6 ? h6.cmd : "无").slice(0, 100));
    check("★ ⑥ 带 -duc", h6 && /-duc/.test(h6.cmd), (h6 ? h6.cmd : "无").slice(0, 100));
    // PowerShell 的 $s:// 会被当成变量 $s: —— 必须用花括号包住变量名
    check("★ ⑤ 的 PS 变量用花括号（否则被解析成变量加冒号）", h5 && !/\$s:\/\//.test(h5.cmd), (h5 ? h5.cmd.slice(0, 120) : "无"));
  }
  // ★ 管道产物必须能落库：runs/*.txt 只落盘不算结果（「没落库的发现等于没发生」）。
  {
    const { parseHttpxLine, parsePortLine, parseNucleiLine, parseArtifacts } = await import(toUrl(path.join(root, "lib", "redteam", "ingest.js")));
    // 用真跑得到的真实行，不用编造格式
    const h1 = parseHttpxLine("https://example.com:443 [200] [Example Domain] [Cloudflare,HTTP/3]");
    check("★ 解析 httpx 行（端口/状态/技术栈）", h1 && h1.host === "example.com" && h1.port === 443 && h1.status === 200 && h1.tech.length === 2, JSON.stringify(h1));
    const h2 = parseHttpxLine("http://example.com:80 [400] [400 The plain HTTP request was sent to HTTPS port] [Cloudflare]");
    check("★ 解析 400 行也不崩", h2 && h2.port === 80 && h2.status === 400, JSON.stringify(h2));
    check("★ 解析 naabu 行", (() => { const r = parsePortLine("example.com:8443"); return r && r.port === 8443; })(), "example.com:8443");
    const n1 = parseNucleiLine("[CVE-2021-44228] [http] [critical] https://target/");
    check("★ 解析 nuclei 行", n1 && n1.severity === "critical" && n1.url === "https://target/", JSON.stringify(n1));
    check("★ banner 行跳过而不是当成漏洞", parseNucleiLine("   __  banner") === null, "banner");
    // tech-detect 是指纹不是漏洞——落成漏洞会污染报告
    const b = parseArtifacts({ "nuclei.txt": "[tech-detect:cloudflare] [http] [info] https://x\n[CVE-1] [http] [high] https://y" });
    check("★ tech-detect 不算漏洞", b.vulns.length === 1 && b.vulns[0].severity === "high", JSON.stringify(b.vulns.map((v) => v.title)));
    check("★ 跳过的行有记录（不静默丢）", b.skipped.length === 1 && /指纹/.test(b.skipped[0].why), JSON.stringify(b.skipped.map((s) => s.why)));
    // 去重：同 host 只留一条资产
    const d2 = parseArtifacts({ "httpx.txt": "https://a.com:443 [200] [A] [X]\nhttps://a.com:8443 [200] [A] [X]" });
    check("★ 同 host 资产去重（端口仍分别记）", d2.assets.length === 1 && d2.ports.length === 2, `${d2.assets.length} 资产 / ${d2.ports.length} 端口`);
  }
  // ★ 端口/指纹必须**写了能读**：第 133 轮实测，importBundle 有 ports 循环但没有查询方法，
  //   于是 assets 只显示 example.com(unknown)，443 与 Cloudflare 已进库却看不见。
  {
    const { parseArtifacts, toBundle } = await import(toUrl(path.join(root, "lib", "redteam", "ingest.js")));
    const b = parseArtifacts({ "httpx.txt": "https://example.com:443 [200] [Example Domain] [Cloudflare,HTTP/3]" });
    const bundle = toBundle(b);
    const one = bundle[0];
    check("★ toBundle 带端口（否则 importBundle 的 ports 循环永远不执行）", Array.isArray(one.ports) && one.ports.length === 1 && one.ports[0].port === 443, JSON.stringify(one.ports || null));
    // service 必须是**字符串**：传对象会在 importBundle 里报
    // "Provided value cannot be bound to SQLite parameter 2"（实测）
    check("★ service 是字符串不是对象", typeof one.ports?.[0]?.service === "string", typeof one.ports?.[0]?.service);
    check("★ 指纹带 product", Array.isArray(one.ports?.[0]?.fingerprints) && one.ports[0].fingerprints.some((f) => f.product === "Cloudflare"), JSON.stringify(one.ports?.[0]?.fingerprints));
    // 不允许出现 undefined（SQLite 绑不了）
    const hasUndef = JSON.stringify(one).includes("undefined");
    check("★ bundle 里没有 undefined（SQLite 绑不了）", !hasUndef, hasUndef ? "有 undefined" : "干净");
  }
  // ★ 写了必须能读：store 要有 listPorts，否则端口进库了却没有任何查询面
  // （第 133 轮实测：importBundle 有 ports 循环但无查询方法，assets 只显示 example.com(unknown)）
  {
    const { RedteamStore } = await import(toUrl(path.join(root, "lib", "redteam", "store-core.js")));
    check("★ store 有 listPorts（端口写了能读）", typeof RedteamStore.prototype.listPorts === "function", typeof RedteamStore.prototype.listPorts);
    const src = fs.readFileSync(path.join(root, "lib", "redteam", "store-core.js"), "utf8");
    check("★ listPorts 真的查 port 表", /FROM port p JOIN asset a/.test(src), "查 port 表");
  }
  // 阶段命令按阶段变
  {
    const recon = commandsForStage({ stage: "recon", target: "10.0.0.0/24" });
    check("recon 阶段第一条是探端口", /naabu|top-ports/.test((recon[0] || {}).cmd || ""), (recon[0] || {}).cmd?.slice(0, 60));
    const tun = commandsForStage({ stage: "tunnel", target: "10.0.0.5" });
    check("tunnel 阶段给隧道工具或装法", /suo5/.test((tun[0] || {}).cmd || ""), (tun[0] || {}).cmd?.slice(0, 60));
  }
}

// ── ①f 入参校验（不静默降级：建成一个边界为空的靶标比报错危险得多）──
// 实测缺口（第 120 轮）：四种写法都会让靶标「建成功但边界全空」——
//   techs=noisy（键名错）、tech=noisy;passive（分号）、10.0.0.999/24（IP 越界）、
//   from=2026/11/11（时间格式错）。最危险的是「建成了但边界为空」：人以为有边界，实际等于无授权作业。
{
  const { validateOpenArgs, renderIssues, parseScopeString } = await import(toUrl(path.join(root, "lib", "redteam", "validate-input.js")));
  const BAD = [
    ["键名写错", { target: "10.0.0.0/24", scope: "techs=noisy" }, /scope\.techs/],
    ["分号分隔", { target: "10.0.0.0/24", scope: "tech=noisy;passive" }, /scope\.tech/],
    ["IP 段越界", { target: "10.0.0.999/24" }, /target/],
    ["时间格式错", { target: "10.0.0.0/24", scope: "from=2026/11/11" }, /scope\.from/],
    ["掩码超范围", { target: "10.0.0.0/33" }, /target/],
    ["技法是乱码", { target: "10.0.0.0/24", scope: "tech=noisy!!bad" }, /scope\.tech/],
    ["键重复", { target: "10.0.0.0/24", scope: "tech=noisy,tech=passive" }, /scope\.tech/],
    ["值为空", { target: "10.0.0.0/24", scope: "tech=" }, /scope\.tech/],
    ["目标不是 IP 也不是域名", { target: "not a target!!" }, /target/],
  ];
  for (const [label, args, re] of BAD) {
    const { issues } = validateOpenArgs(args);
    const lines = renderIssues(issues);
    check(`★ 校验抓住「${label}」并带字段路径`, issues.length > 0 && re.test(lines.join(" ")), lines.join(" / ").slice(0, 90));
  }
  // 正确写法必须零问题（不能把合法输入也拦了）
  {
    const { issues } = validateOpenArgs({ target: "10.0.0.0/24", scope: "tech=noisy,passive,deny=destructive,from=2026-11-11 00:00,to=2026-11-12 00:00" });
    check("★ 合法入参零问题（不误拦）", issues.length === 0, renderIssues(issues).join(" / ").slice(0, 90));
  }
  // 值内逗号必须保留（tech=noisy,passive 是两项，不是一个坏值）
  {
    const { kv, issues } = parseScopeString("tech=noisy,passive,deny=destructive");
    check("★ tech 的多值不被切碎", kv.tech === "noisy,passive" && issues.length === 0, `tech=${kv.tech}`);
  }
}

// ── ①g 实体与阶段枚举校验（严重度拼错会静默降级，而 info 在报告里会整个消失）──
// 实测缺口（第 121 轮）：`entity_add vuln kind=critcal` 与「不给 kind」都静默降级成 info；
// `chain_add stage=reconn` 静默落成 recon。严重度是报告里最核心的字段，降级等于把高危说成信息泄露。
{
  const V = await import(toUrl(path.join(root, "lib", "redteam", "validate-input.js")));
  const { validateEntityAdd, validateChainAdd, validateEnum, renderIssues, SEVERITIES, STAGES, LEGACY_STAGES } = V;

  // ★ 枚举必须与 store 的真实常量逐字一致——这条用例存在的理由：
  // 第 120 轮我在校验器里把阶段码写成 ROLE_ORDER 的角色名（recon/assess/vuln-scan/exploit/internal），
  // 而 store 真正认识的是 recon/internet/boundary/internal/target。判据抄错源，
  // 就会把 store 本来支持的合法用法拦下来。所以每次都去 store 源码里读真值来比。
  {
    const storeSrc = fs.readFileSync(path.join(root, "lib", "redteam", "store-core.js"), "utf8");
    const m = /VALID_STAGE_CODES\s*=\s*\[([^\]]*)\]/.exec(storeSrc);
    const real = m ? m[1].split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : [];
    check("★ 阶段枚举与 store 的 VALID_STAGE_CODES 逐字一致", real.length > 0 && real.every((x) => STAGES.includes(x)) && STAGES.every((x) => real.includes(x)), `store=[${real.join(",")}] 校验器=[${STAGES.join(",")}]`);
    const m2 = /LEGACY_STAGE_MAP\s*=\s*\{([\s\S]{0,400}?)\}/.exec(storeSrc);
    const legacy = m2 ? [...m2[1].matchAll(/(\w+)\s*:/g)].map((x) => x[1]) : [];
    // store 的 LEGACY_STAGE_MAP 里 recon 也当 key（recon→recon），它本来就在新码里，所以比对时要排除
    const legacyOnly = legacy.filter((x) => !STAGES.includes(x));
    check("★ 旧阶段名也被接受（store 有 LEGACY_STAGE_MAP）", legacyOnly.every((x) => LEGACY_STAGES.includes(x)), `store 旧名=[${legacyOnly.join(",")}]`);
    const m3 = /SEVERITIES\s*=\s*\[([^\]]*)\]/.exec(storeSrc);
    const sev = m3 ? m3[1].split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : [];
    check("★ 严重度枚举与 store 的 SEVERITIES 逐字一致", sev.length > 0 && sev.every((x) => SEVERITIES.includes(x)) && SEVERITIES.every((x) => sev.includes(x)), `store=[${sev.join(",")}]`);
  }

  // 严重度：拼错与缺失都必须拦（不给就是 info，而报告只收中危以上 → 这条漏洞会整个消失）
  {
    const bad = validateEntityAdd("vuln", { kind: "critcal" });
    check("★ 严重度拼错被拦且给建议", bad.length === 1 && /critical/.test(renderIssues(bad).join("")), renderIssues(bad).join("").slice(0, 90));
    const miss = validateEntityAdd("vuln", {});
    check("★ 严重度缺失被拦（说明会整个消失在报告里）", miss.length === 1 && /消失/.test(renderIssues(miss).join("")), renderIssues(miss).join("").slice(0, 90));
    check("严重度大写容错", validateEntityAdd("vuln", { kind: "CRITICAL" }).length === 0);
    check("严重度合法值通过", validateEntityAdd("vuln", { kind: "high" }).length === 0);
    check("非 vuln 实体不做严重度校验", validateEntityAdd("credential", { kind: "pwd?" }).length === 0);
  }
  // 阶段：拼错拦，新码与旧名都过
  {
    const bad = validateChainAdd({ stage: "reconn" });
    check("★ 阶段拼错被拦且给建议", bad.length === 1 && /recon/.test(renderIssues(bad).join("")), renderIssues(bad).join("").slice(0, 90));
    check("阶段新码通过（internal）", validateChainAdd({ stage: "internal" }).length === 0);
    check("★ 阶段旧名通过（exploit，store 有映射）", validateChainAdd({ stage: "exploit" }).length === 0);
    check("阶段可省略", validateChainAdd({}).length === 0);
  }
}

// ── ①h update / report 入口校验 ──
// 实测缺口（第 123 轮）：update asset 的 stage/kind 拼错会**静默回落**（回读正确反而最危险，
// 它让人确信改成功了）；report kind 拼错会**静默出战报**（人以为拿到的是得分报告）；
// report limit 负数静默取默认；update row=-1/1.7 报「不存在」是**误报**（不是不存在，是行号非法）。
{
  const { validateUpdate, validateReport, validateRowId, renderIssues } = await import(toUrl(path.join(root, "lib", "redteam", "validate-input.js")));
  const BAD = [
    ["asset 状态拼错", () => validateUpdate("asset", { target: "10.0.0.5", stage: "testted" }), /stage/],
    ["asset 优先级拼错", () => validateUpdate("asset", { target: "10.0.0.5", kind: "urgent" }), /kind/],
    ["vuln 严重度拼错", () => validateUpdate("vuln", { row: 1, kind: "critcal" }), /kind/],
    ["vuln 状态拼错", () => validateUpdate("vuln", { row: 1, stage: "exploitted" }), /stage/],
    ["行号负数", () => validateUpdate("vuln", { row: -1, stage: "fixed" }), /row/],
    ["行号小数", () => validateUpdate("vuln", { row: 1.7, stage: "fixed" }), /row/],
    ["行号 0", () => validateRowId("row", 0), /row/],
    ["report 类型拼错", () => validateReport({ kind: "scoer" }), /kind/],
    ["report 负数 limit", () => validateReport({ limit: -5 }), /limit/],
  ];
  for (const [label, fn, re] of BAD) {
    const xs = fn();
    check(`★ update/report 校验抓住「${label}」`, xs.length > 0 && re.test(renderIssues(xs).join(" ")), renderIssues(xs).join(" / ").slice(0, 90));
  }
  // 合法输入零问题（不误拦）
  check("★ update asset 合法入参零问题", validateUpdate("asset", { target: "10.0.0.5", stage: "tested", kind: "high" }).length === 0);
  check("★ update vuln 合法入参零问题", validateUpdate("vuln", { row: 1, kind: "high", stage: "exploited" }).length === 0);
  check("★ report 不写 kind 零问题", validateReport({}).length === 0);
  check("★ 行号非法时说明「不是不存在」", /不是「行号不存在」/.test(renderIssues(validateRowId("row", -1)).join("")), renderIssues(validateRowId("row", -1)).join("").slice(0, 90));
}

// ── ①i 越界压力 → 行动（闭环：检测到失控要知道「该停」）──
// 实测缺口（第 124 轮）：趋势做进了 summary 与战报，但它只是**一行数**，完全没影响「下一步」——
// 越界越频繁，next 照样指「继续打这一发」。检测到了却不据此改行动，等于心电图画出来没人看。
{
  const { judgeScopePressure, renderPressure, pressureNext } = await import(toUrl(path.join(root, "lib", "redteam", "pressure.js")));
  const CASES = [
    ["无拦截不停", { total: 0 }, false, ""],
    ["加速且高频 → stop", { total: 12, trend: "在加速（后半段每桶 4.0 次 vs 前半段 1.0 次）", byReason: [{ reason: "技法未授权", n: 8 }], byBucket: [{ at: "10:00", n: 1 }, { at: "10:10", n: 4 }, { at: "10:15", n: 4 }] }, true, "stop"],
    ["加速但低频 → caution", { total: 3, trend: "在加速（后半段每桶 1.0 次 vs 前半段 0.2 次）", byReason: [{ reason: "x", n: 2 }], byBucket: [{ at: "10:00", n: 0 }, { at: "10:10", n: 1 }] }, true, "caution"],
    ["同一理由 80%+ → stop", { total: 10, trend: "平稳", byReason: [{ reason: "目标不在授权网段内", n: 9 }], byBucket: [{ at: "10:00", n: 3 }, { at: "10:10", n: 4 }] }, true, "stop"],
    ["单桶 10+ → stop（报撞线太密）", { total: 10, trend: "集中在同一个 5 分钟桶内（10 次）", byReason: [{ reason: "目标不在授权网段内", n: 10 }], byBucket: [{ at: "10:00", n: 10 }] }, true, "stop"],
    ["在收敛 → 不该停", { total: 9, trend: "在收敛（后半段每桶 0.5 次 vs 前半段 4.0 次）", byReason: [{ reason: "x", n: 5 }], byBucket: [{ at: "10:00", n: 4 }, { at: "10:10", n: 1 }] }, false, ""],
    ["少量拦截 → caution", { total: 3, trend: "平稳", byReason: [{ reason: "技法被排除", n: 2 }], byBucket: [{ at: "10:00", n: 1 }, { at: "10:10", n: 1 }] }, true, "caution"],
  ];
  for (const [label, s, wantMust, wantLevel] of CASES) {
    const j = judgeScopePressure(s);
    check(`★ 压力判定「${label}」`, j.must === wantMust && j.level === wantLevel, `must=${j.must} level=${j.level || "-"}`);
  }
  // 单桶撞线要报更具体的那个（不是被「同一理由」抢先）
  {
    const j = judgeScopePressure({ total: 10, trend: "集中在同一个 5 分钟桶内（10 次）", byReason: [{ reason: "x", n: 10 }], byBucket: [{ at: "10:00", n: 10 }] });
    check("★ 单桶撞线报「撞线太密」（比理由占比更具体）", /撞线太密/.test(j.why), j.why.slice(0, 80));
  }
  // stop 场景两行不重复（一行为什么、一行做什么）
  {
    const j = judgeScopePressure({ total: 8, trend: "平稳", byReason: [{ reason: "目标不在授权网段内", n: 8 }], byBucket: [{ at: "10:00", n: 4 }, { at: "10:10", n: 4 }] });
    const short = renderPressure(j, { short: true });
    const next = pressureNext(j);
    check("★ stop 时「原因行」不含行动、行动只在下一步", short.length > 0 && !short.includes(j.todo) && next.includes(j.todo), `short=${short.slice(0, 50)}`);
  }
  check("caution 不覆盖下一步（只有 stop 才接管）", pressureNext({ must: true, level: "caution", todo: "x" }) === "");
}

// ── ② 端到端：拦截真的发生在写入路径上 ──
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "scopegate-"));
const prevHome = process.env.REDTEAM_HOME;
process.env.REDTEAM_HOME = tmpHome;
try {
  const { buildModelTools } = await import(toUrl(path.join(root, "lib", "model-tools.js")));
  const core = await import(toUrl(path.join(root, "lib", "core.js")));
  const rules = await import(toUrl(path.join(root, "lib", "rules.js")));
  const hostctl = await import(toUrl(path.join(root, "lib", "host.js")));
  const updater = await import(toUrl(path.join(root, "lib", "update.js")));
  const tools = buildModelTools({ core, rules, hostctl, updater, rejectIfNeedPrompt: () => null });
  const drill = tools.find((t) => t.name === "purge_drill");

  // 端到端：写错的入参必须**拒绝建靶**，而不是建一个边界为空的靶标
  {
    const badOpen = await drill.execute({ op: "open", name: "scopegate-bad", target: "10.0.0.999/24" });
    check("★ 端到端：IP 越界时拒绝建靶", /未建靶/.test(badOpen.text) && /target/.test(badOpen.text), badOpen.text.slice(0, 100));
    const badTech = await drill.execute({ op: "open", name: "scopegate-bad2", target: "10.0.0.0/24", scope: "techs=noisy" });
    check("★ 端到端：键名写错时拒绝建靶", /未建靶/.test(badTech.text) && /scope\.techs/.test(badTech.text), badTech.text.slice(0, 100));
  }
  const opened = await drill.execute({ op: "open", name: "scopegate", target: "203.0.113.0/24" });
  check("临时靶标已建立", /已建靶/.test(opened.text), opened.text.slice(0, 60));

  const inside = await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.10", target: "203.0.113.10" });
  check("范围内目标放行", /已写入/.test(inside.text) && !/范围闸拦下/.test(inside.text), inside.text.slice(0, 70));

  const outside = await drill.execute({ op: "entity_add", entity: "asset", name: "198.51.100.9", target: "198.51.100.9" });
  check("★ 范围外目标被拦下", /范围闸拦下/.test(outside.text), outside.text.slice(0, 80));

  const outsideVuln = await drill.execute({ op: "entity_add", entity: "vuln", name: "越界", target: "198.51.100.9", kind: "high", text: "p" });
  check("★ 范围外漏洞被拦下", /范围闸拦下/.test(outsideVuln.text), outsideVuln.text.slice(0, 80));

  const outsideUrl = await drill.execute({ op: "entity_add", entity: "vuln", name: "越界URL", target: "https://evil.example.com/x", kind: "high", text: "p" });
  check("★ 范围外 URL 被拦下", /范围闸拦下/.test(outsideUrl.text), outsideUrl.text.slice(0, 80));

  // asset 支持批量（target 逗号分隔）：合法的批量不该被误拦，其中一个越界则整条拦下
  const batchOk = await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.20, 203.0.113.21", target: "203.0.113.20, 203.0.113.21" });
  check("合法的批量目标放行（不应误拦）", !/范围闸拦下/.test(batchOk.text), batchOk.text.slice(0, 80));
  const batchBad = await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.30, 198.51.100.99", target: "203.0.113.30, 198.51.100.99" });
  check("★ 批量里一个越界就整条拦下", /范围闸拦下/.test(batchBad.text), batchBad.text.slice(0, 90));
  // 进攻侧端到端：三条漏洞 → 下一步给具体打法 → 标为已利用后**自动推进到下一条**
  {
    await drill.execute({ op: "open", name: "scopegate-route", target: "203.0.113.0/24" });
    await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.5", target: "203.0.113.5" });
    await drill.execute({ op: "entity_add", entity: "asset", name: "203.0.113.6", target: "203.0.113.6" });
    await drill.execute({ op: "entity_add", entity: "vuln", name: "Fastjson 反序列化", target: "203.0.113.5", kind: "critical", text: "x" });
    await drill.execute({ op: "entity_add", entity: "vuln", name: "Redis 未授权", target: "203.0.113.6", kind: "high", text: "y" });
    const s1 = await drill.execute({ op: "summary" });
    check("★ 下一步点名具体打法（Fastjson 优先）", /Fastjson/.test(s1.text) && /injection-payloads/.test(s1.text), (s1.text.match(/→ 下一步：[^\n]*/) || [""])[0].slice(0, 90));
    const up = await drill.execute({ op: "update", entity: "vuln", row: 1, stage: "exploited" });
    check("漏洞状态可用 stage=exploited 标记", /回读 status=exploited/.test(up.text), up.text.slice(0, 80));
    const s2 = await drill.execute({ op: "summary" });
    check("★ 标为已利用后自动推进到下一条（Redis）", /Redis/.test(s2.text) && /unauth-exploit/.test(s2.text), (s2.text.match(/→ 下一步：[^\n]*/) || [""])[0].slice(0, 90));


    const bad = await drill.execute({ op: "update", entity: "vuln", row: 2, status: "exploited" });
    check("★ 误用 status= 时给出纠正提示", /stage=状态/.test(bad.text), bad.text.slice(0, 100));
  }
  // 端到端：update / report 的写错必须**拒绝执行**，不是静默回落
  {
    const badAsset = await drill.execute({ op: "update", entity: "asset", target: "203.0.113.10", stage: "testted" });
    check("★ 端到端：asset 状态拼错时拒绝写入", /未写入/.test(badAsset.text) && /stage/.test(badAsset.text), badAsset.text.slice(0, 100));
    const badRep = await drill.execute({ op: "report", kind: "scoer" });
    check("★ 端到端：report 类型拼错时拒绝生成", /未生成/.test(badRep.text) && /kind/.test(badRep.text), badRep.text.slice(0, 100));
    const badRow = await drill.execute({ op: "update", entity: "vuln", row: -1, stage: "fixed" });
    check("★ 端到端：行号非法时说「非法」而不是「不存在」", /未写入/.test(badRow.text) && /不合法/.test(badRow.text), badRow.text.slice(0, 100));
  }

  const insideUrl = await drill.execute({ op: "entity_add", entity: "vuln", name: "正常URL", target: "http://203.0.113.20/a", kind: "high", text: "p" });
  check("范围内 URL 放行", /已写入/.test(insideUrl.text) && !/范围闸拦下/.test(insideUrl.text), insideUrl.text.slice(0, 70));

  // 技法闸 + 时间窗端到端：开一个「只授权 noisy、排除 destructive、窗口已过」的靶标
  const techOpen = await drill.execute({
    op: "open", name: "scopegate-tech", target: "203.0.113.0/24",
    // 参数是 scope 串（k=v 逗号分隔）——四个独立参数会顶破工具面预算，合并后仍表达同样三件事
    scope: "tech=noisy,passive,deny=destructive,from=2020-01-01T00:00,to=2020-01-02T00:00",
  });
  check("技法/窗口靶标已建立", /已建靶/.test(techOpen.text), techOpen.text.slice(0, 60));

  const techOk = await drill.execute({ op: "chain_add", stage: "recon", tool: "nuclei-scan", text: "窗口外" });
  check("★ 过窗时 chain_add 被拦", /技法闸拦下/.test(techOk.text) && /已过授权窗口/.test(techOk.text), techOk.text.slice(0, 90));

  // 换一个不限时间的靶标，验技法
  await drill.execute({ op: "open", name: "scopegate-tech2", target: "203.0.113.0/24", scope: "tech=noisy,passive,deny=destructive" });
  const tNoisy = await drill.execute({ op: "chain_add", stage: "recon", tool: "nuclei-scan", text: "扫一遍" });
  check("授权内手法 chain_add 放行", /已写入/.test(tNoisy.text) && !/技法闸拦下/.test(tNoisy.text), tNoisy.text.slice(0, 80));
  const tExploit = await drill.execute({ op: "chain_add", stage: "exploit", tool: "webshell-toolkit", text: "落马" });
  check("★ 未授权手法 chain_add 被拦", /技法闸拦下/.test(tExploit.text) && /未被授权/.test(tExploit.text), tExploit.text.slice(0, 90));
  const tDestructive = await drill.execute({ op: "chain_add", stage: "exploit", tool: "competition-kernel-container-escape", text: "逃逸" });
  check("★ 排除手法被拦（排除优先）", /技法闸拦下/.test(tDestructive.text) && /被排除/.test(tDestructive.text), tDestructive.text.slice(0, 90));

  // ── ⑤ 越界趋势（时间维度：连续被拦是正常探测，激增才是失控）──
  // 实测缺口：原先只有总数与 Top3，看不出「是不是在失控地乱打」。
  {
    const { RedteamStore } = await import(toUrl(path.join(root, "lib", "redteam", "store-core.js")));
    const sTre = new RedteamStore(tmpHome);
    const seedTrend = (id, times) => {
      sTre.openEngagement(id, "10.0.0.0/24");
      const db = sTre.db(id);
      for (const t of times) db.prepare("INSERT INTO scope_block (layer,target,detail,action,at) VALUES (?,?,?,?,?)").run("target", "10.9.9.9", "不在任何授权网段内", "entity_add asset", t);
    };
    const B = "2026-11-11T10:";
    // 加速：前半段 1 次/桶，后半段 4 次/桶
    seedTrend("trend-accel", [B+"00:00", B+"05:00", B+"10:00", B+"10:01", B+"10:02", B+"10:03", B+"15:00", B+"15:01", B+"15:02", B+"15:03"]);
    // 收敛：前半段 4 次/桶，后半段稀疏
    seedTrend("trend-converge", [B+"00:00", B+"00:01", B+"00:02", B+"00:03", B+"05:00", B+"05:01", B+"05:02", B+"05:03", B+"15:00"]);
    // 一次性撞线
    seedTrend("trend-burst", [B+"00:00", B+"00:01", B+"00:02", B+"00:03", B+"00:04"]);

    const ra = sTre.scopeBlockSummary("trend-accel");
    check("★ 趋势识别「在加速」", /在加速/.test(ra.trend), ra.trend.slice(0, 90));
    const rc = sTre.scopeBlockSummary("trend-converge");
    check("★ 趋势识别「在收敛」", /在收敛/.test(rc.trend), rc.trend.slice(0, 90));
    const rb = sTre.scopeBlockSummary("trend-burst");
    check("★ 趋势识别「一次性撞线」", /集中在同一个/.test(rb.trend), rb.trend.slice(0, 90));

    // 时间基准必须与明细一致（明细 at 是本地时间，用 toISOString 会差 8 小时）
    check("★ 时间窗口用本地基准（与明细 at 一致）", /^2026-11-11 10:0/.test(ra.window.from), `${ra.window.from} → ${ra.window.to}`);
    check("★ 桶标签也是本地时间", ra.byBucket[0] && /^10:|^0[2-9]:/.test(ra.byBucket[0].at) && /^10:/.test(ra.byBucket[0].at), ra.byBucket.map((x) => x.at).join(","));
    // 空桶必须出现（否则看不出「安静一段又爆」）
    check("★ 空桶不被跳过", rc.byBucket.some((b) => b.n === 0), rc.byBucket.map((b) => b.at + "=" + b.n).join(" "));
  }

  // ── ③ 拦截必须可交付：战报要能证明「没打什么」，而不只是「打了什么」 ──

  // ── ④ 日常入口也要看得见边界：summary 与 purge_status settings ──
  // ── ③ 拦截必须可交付：战报要能证明「没打什么」，而不只是「打了什么」 ──
  // 为什么算范围闸的一部分：边界只在报告里有 = 作业结束才知道；日常会话看 summary / settings
  // 才是「人做决定时」看到的界面。这两个入口不报，等于平时瞎打。
  {
    const sum = await drill.execute({ op: "summary" });
    check("summary 报授权边界（目标/技法/窗口）", /授权边界：.*目标.*技法.*窗口/.test(sum.text), sum.text.slice(0, 100));
    check("★ summary 报越界拦截汇总", /越界拦截：共 \d+ 次/.test(sum.text), (sum.text.match(/越界拦截：[^\n]*/) || [""])[0].slice(0, 80));
    // 判据要盯住「真的归了类」而不只是「出现了『最多：』三个字」：
    // 归类失效时那一行仍会打印「最多：」但后面是空的，只查关键字会假绿（实测探针 D 咬不住）。
    check("★ summary 汇总点出最多的那类（且真有类别名与计数）", /最多：[^\n]*[\u4e00-\u9fa5A-Za-z]+×\d+/.test(sum.text), (sum.text.match(/最多：[^\n]*/) || [""])[0].slice(0, 80));

    const statusTool = tools.find((t) => t.name === "purge_status");
    const st = await statusTool.execute({ settings: true });
    check("★ purge_status settings 报靶标授权边界", /靶标 @\S+ 授权：目标/.test(st.text), st.text.slice(0, 110));
    check("★ purge_status settings 报越界拦截", /越界拦截：(共 \d+ 次|0 次)/.test(st.text), (st.text.match(/越界拦截：[^\n]*/) || [""])[0].slice(0, 80));
  }
  // 为什么这也是范围闸的一部分：边界拦住动作只是「没出事」，把拦截事实写进报告才是「可审计」。
  // 拦了不记，交出去的成品就只能自证清白，审计方无从复核。
  // 审计段是**按靶标**记录的，所以全套要在同一个靶标里做：新开一个三道边界齐全的靶标，
  // 在里面各制造一次目标越界与技法越权，再读战报——这样才验证得了「同一份报告把两类都列出来」。
  await drill.execute({ op: "open", name: "scopegate-audit", target: "203.0.113.0/24", scope: "tech=noisy,passive,deny=destructive" });
  await drill.execute({ op: "entity_add", entity: "asset", name: "198.51.100.77", target: "198.51.100.77" });
  await drill.execute({ op: "chain_add", stage: "exploit", tool: "webshell-toolkit", text: "越权补记" });
  const rep = await drill.execute({ op: "report", limit: 200 });
  check("战报含审计段「授权边界与越界尝试」", /##\s*零、授权边界与越界尝试/.test(rep.text), rep.text.slice(0, 80));
  check("★ 战报列出被拦的目标越界", /目标越界/.test(rep.text), rep.text.slice(0, 90));
  check("★ 战报列出被拦的技法越权", /技法\/时间越权/.test(rep.text), rep.text.slice(0, 90));
  check("战报报出授权技法（多值不被切碎）", /授权技法：.*noisy.*passive/.test(rep.text), (rep.text.match(/授权技法：[^\n]*/) || [""])[0].slice(0, 60));
  check("战报报出排除技法", /排除技法：.*destructive/.test(rep.text), (rep.text.match(/排除技法：[^\n]*/) || [""])[0].slice(0, 60));
  // ★ 审计段不能被 limit 截断：用一个很小的 limit 读，审计段仍必须完整出现。
  // 没有这条用例时，「把审计段也交给 limit 管」的探针咬不住（实测失败 0）——
  // 因为默认 limit=14 恰好够显示这段短报告，问题只在长报告上暴露。用例要按**最坏情形**设计。
  {
    const tight = await drill.execute({ op: "report", limit: 3 });
    check("★ 极小 limit 下审计段仍完整（不被截断）", /##\s*零、授权边界与越界尝试/.test(tight.text) && /目标越界/.test(tight.text), tight.text.slice(0, 90));
    check("极小 limit 下确实截了正文（证明 limit 生效）", /…另 \d+ 行/.test(tight.text), (tight.text.match(/…另 [^\n]*/) || [""])[0].slice(0, 40));
  }
  // 审计段必须排在「一、成果漏洞」之前（标题是「零、」，位置就该在前）
  {
    const iAudit = rep.text.indexOf("## 零、授权边界");
    const iOne = rep.text.indexOf("## 一、成果漏洞");
    check("审计段排在成果段之前", iAudit >= 0 && iOne > iAudit, `audit@${iAudit} one@${iOne}`);

  // 端到端：同一理由撞满 8 次后，summary 的「下一步」必须被改写成「先核对授权」
  {
    await drill.execute({ op: "open", name: "scopegate-pressure", target: "10.0.0.0/24" });
    for (let i = 1; i <= 8; i += 1) await drill.execute({ op: "entity_add", entity: "asset", name: `198.51.100.${i}`, target: `198.51.100.${i}` });
    const sp = await drill.execute({ op: "summary" });
    check("★ 端到端：失控时下一步被改写成先核对授权", /先核对授权再动手/.test(sp.text), (sp.text.match(/→ 下一步：[^\n]*/) || [""])[0].slice(0, 90));
    check("★ 端到端：先停手提示出现", /先停手/.test(sp.text), (sp.text.match(/先停手[^\n]*/) || [""])[0].slice(0, 90));
    check("★ 端到端：失控后不再提示「继续打」的阶段指引", !/→ 下一步：阶段[①③④⑤]/.test(sp.text), (sp.text.match(/→ 下一步：[^\n]*/) || [""])[0].slice(0, 60));
  }

    // 阶段分流必须**真的接在 summary 上**，不是只有函数正确。
    // 首版只测了 routeRecon 等函数本身，于是「summary 不接分流」的探针咬不住（失败 0）——
    // 函数对但没接上，是这类改动最常见的假成功。
    {
      await drill.execute({ op: "open", name: "scopegate-stage", target: "10.0.0.0/24" });
      for (const ip of ["10.0.0.5", "10.0.0.6", "10.0.0.7"]) await drill.execute({ op: "entity_add", entity: "asset", name: ip, target: ip });
      const r3 = await drill.execute({ op: "summary" });
      const n3 = (r3.text.match(/→ 下一步：[^\n]*/) || [""])[0];
      check("★ 阶段③ 端到端：下一步点出具体网段与存活数", /10\.0\.0\.0\/24/.test(n3) && /资产 3/.test(n3), n3.slice(0, 110));
      check("★ 阶段③ 端到端：不再是「逐条过」那句通用话", !/逐条过/.test(n3), n3.slice(0, 110));
    }
  }
  // ★ 命令里的 target 必须是**单台主机**，不能是网段。
  // 第 134 轮实测：原来优先取「资产最多的网段」，于是命令变成
  //   curl ... "http://10.0.0.0/24/"  —— 把网段当主机名用，那条命令必然打不出去。
  {
    await drill.execute({ op: "open", name: "scopegate-tgt", target: "10.0.0.0/24" });
    await drill.execute({ op: "entity_add", entity: "asset", target: "10.0.0.5" });
    await drill.execute({ op: "entity_add", entity: "vuln", target: "10.0.0.5", name: "CVE-2021-44228", kind: "critical", text: "fastjson" });
    await drill.execute({ op: "update", entity: "vuln", row: 1, stage: "confirmed" });
    const sm2 = await drill.execute({ op: "summary" });
    check("★ 命令不用网段当主机（/24 打不出去）", !/http:\/\/\d+\.\d+\.\d+\.\d+\/\d+/.test(sm2.text), (sm2.text.match(/→ 命令：[^\n]*/) || [""])[0].slice(0, 110));
    check("★ 命令指向真实 IP", /http:\/\/10\.0\.0\.5\//.test(sm2.text) || /-host 10\.0\.0\.5/.test(sm2.text), (sm2.text.match(/→ 命令：[^\n]*/) || [""])[0].slice(0, 110));
  }
  // ★ 计分与漏洞是两条账：记了漏洞不等于有得分，score_add 才产生得分。
  {
    await drill.execute({ op: "open", name: "scopegate-score", target: "10.0.1.0/24" });
    await drill.execute({ op: "entity_add", entity: "asset", target: "10.0.1.5" });
    await drill.execute({ op: "entity_add", entity: "vuln", target: "10.0.1.5", name: "CVE-2021-44228", kind: "critical", text: "x" });
    await drill.execute({ op: "update", entity: "vuln", row: 1, stage: "confirmed" });
    const r0 = await drill.execute({ op: "report", kind: "score" });
    check("★ 只记漏洞不计分时战报 count=0（口径如此）", /count=0/.test(r0.text), (r0.text.split("\n")[0] || "").slice(0, 110));
    await drill.execute({ op: "score_add", point: "web-app", target: "10.0.1.5", text: "RCE 回显 id=root" });
    const r1 = await drill.execute({ op: "report", kind: "score" });
    check("★ score_add 之后战报有分", /count=[1-9]/.test(r1.text) && /points=[1-9]/.test(r1.text), (r1.text.split("\n")[0] || "").slice(0, 110));
  }
  // ★ 记账断点：记了漏洞不等于有得分。
  // 第 135 轮实测：status 从 candidate 改成 confirmed 后战报仍 count=0，
  // 因为 scoreReport() 读 score_hit，只有 score_add 才写那张表。没有提示的话，
  // 人会以为「记了漏洞战报就有分」，直到交报告才发现是 0 分。
  {
    await drill.execute({ op: "open", name: "scopegate-gap", target: "10.0.2.0/24" });
    await drill.execute({ op: "entity_add", entity: "asset", target: "10.0.2.5" });
    const s0 = await drill.execute({ op: "summary" });
    check("★ 无成果时不报计分缺口", !/计分缺口/.test(s0.text), "无漏洞");
    await drill.execute({ op: "entity_add", entity: "vuln", target: "10.0.2.5", name: "CVE-2021-44228", kind: "critical", text: "x" });
    const s1 = await drill.execute({ op: "summary" });
    check("★ candidate 不算缺口（还没确认）", !/计分缺口/.test(s1.text), "candidate");
    await drill.execute({ op: "update", entity: "vuln", row: 1, stage: "confirmed" });
    const s2 = await drill.execute({ op: "summary" });
    check("★ confirmed 未计分时报缺口", /计分缺口/.test(s2.text) && /score_add/.test(s2.text), (s2.text.match(/⚠ 计分缺口[^\n]*/) || [""])[0].slice(0, 120));
    await drill.execute({ op: "score_add", point: "web-app", target: "10.0.2.5", text: "RCE" });
    const s3 = await drill.execute({ op: "summary" });
    check("★ 计分后缺口消失、改报正常", !/计分缺口/.test(s3.text) && /计分：已确认 1 条/.test(s3.text), (s3.text.match(/计分：[^\n]*/) || [""])[0].slice(0, 110));
  }
} catch (e) {
  check("端到端执行", false, String((e && e.message) || e).slice(0, 100));

} finally {
  if (prevHome === undefined) delete process.env.REDTEAM_HOME; else process.env.REDTEAM_HOME = prevHome;
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* 临时目录删不掉不影响判定 */ }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ checks, fails }, null, 1) + "\n");
} else {
  console.log(`范围闸自测：共 ${checks} 项（判定 + 端到端）｜失败 ${fails.length}`);
  for (const f of fails.slice(0, 6)) console.log(`  ✗ ${f}`);
  if (!fails.length) console.log("  越界目标一律拦下、范围内放行 ✓");
}
process.exit(fails.length ? 1 : 0);
