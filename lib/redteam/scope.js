/**
 * 靶标范围判定：这条落库/这次调用涉及的目标，到底在不在授权范围内。
 *
 * 为什么要有它（实测缺口）：靶标授权 `203.0.113.0/24`，但落 `198.51.100.9` 的资产与漏洞
 * **都静默写进去了**、一个字提示都没有。开靶标时校验了范围，之后每条落库却不校验——
 * 等于「门口验票、进场随便走」。红队作业里这是最不该缺的一环：越界打靶不是技术问题，是事故。
 *
 * 机制参照 `@integsec/agentic-pentest-proxy` 的 scope manifest（MIT，只借机制不抄代码）：
 *   · **每个目标都校验，一个越界就整条拦下**（不是"警告后照写"）
 *   · **排除项优先**：excluded 命中即拒，哪怕同时被更宽的 allow 覆盖
 *   · **CIDR 必须完全落在授权 CIDR 内**（子网不能跨出边界）
 *   · **域名按后缀匹配**，支持 `*.example.test` 单标签通配
 *   · **无法判定也算不通过**（DNS 解析失败 / 不是 IP 也不是域名 → 明确拒绝，不静默放行）
 *
 * 本模块只做纯判定（无 IO），所以可以直接单测；调用方决定「拦」还是「只记警告」。
 */

/** 把 IPv4 点分串转 32 位无符号整数；非法返回 null */
export function ipv4ToInt(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || "").trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((x) => x < 0 || x > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** 解析 CIDR 成 { base, mask }；非法返回 null。裸 IP 视为 /32 */
export function parseCidr(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  const [addr, bitsRaw] = t.split("/");
  const base = ipv4ToInt(addr);
  if (base === null) return null;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
  return { base: (base & mask) >>> 0, mask, bits };
}

/** ip 是否落在 cidr 内 */
export function ipInCidr(ip, cidr) {
  const c = parseCidr(cidr);
  const v = ipv4ToInt(ip);
  if (!c || v === null) return false;
  return ((v & c.mask) >>> 0) === c.base;
}

/** cidr 是否**完全**落在 outer 内（子网不许跨出边界） */
export function cidrInsideCidr(inner, outer) {
  const a = parseCidr(inner);
  const b = parseCidr(outer);
  if (!a || !b) return false;
  if (a.bits < b.bits) return false; // 内层比外层宽，不可能被包含
  return ((a.base & b.mask) >>> 0) === b.base;
}

const isIpv4 = (s) => ipv4ToInt(s) !== null;
const isDomain = (s) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(String(s || "").trim());

/** 从一条 target 文本里抽出「要判定的目标」：URL → host；带端口 → 去端口；其余原样 */
export function targetHostOf(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  const url = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(t);
  if (url) t = url[1];
  t = t.replace(/^[^@/]*@/, ""); // 去掉 userinfo
  t = t.replace(/:\d+$/, "");    // 去端口
  t = t.replace(/^\[|\]$/g, ""); // IPv6 方括号（本模块只判 IPv4/域名，IPv6 交由下面判"无法判定"）
  return t;
}

/**
 * 判定一个目标是否在授权范围内。
 * @param {string} raw - 目标（IP / CIDR / 域名 / URL，可带端口）
 * @param {{ allow?: string[], deny?: string[] }} scope - allow 为授权项，deny 为排除项
 * @returns {{ ok: boolean, kind: string, host: string, reason: string }}
 *   kind: ip | cidr | domain | unknown
 */
export function checkTarget(raw, scope = {}) {
  const allow = (scope.allow || []).map((x) => String(x).trim()).filter(Boolean);
  const deny = (scope.deny || []).map((x) => String(x).trim()).filter(Boolean);
  const host = targetHostOf(raw);

  if (!host) return { ok: false, kind: "unknown", host: "", reason: "空目标" };

  // 排除项优先：命中即拒，哪怕同时被更宽的 allow 覆盖
  for (const d of deny) {
    if (d.includes("/") && isIpv4(host)) { if (ipInCidr(host, d)) return { ok: false, kind: "ip", host, reason: `命中排除网段 ${d}` }; continue; }
    if (isDomain(d) && (host === d || host.endsWith("." + d.replace(/^\*\./, "")))) return { ok: false, kind: "domain", host, reason: `命中排除域名 ${d}` };
    if (d === host) return { ok: false, kind: "ip", host, reason: `命中排除项 ${d}` };
  }

  // 授权项为空：明确不通过（不静默放行）
  if (!allow.length) return { ok: false, kind: isIpv4(host) ? "ip" : isDomain(host) ? "domain" : "unknown", host, reason: "靶标未设授权范围" };

  if (host.includes("/")) {
    for (const a of allow) if (a.includes("/") && cidrInsideCidr(host, a)) return { ok: true, kind: "cidr", host, reason: `落在授权网段 ${a}` };
    return { ok: false, kind: "cidr", host, reason: "该网段未完全落在任何授权网段内" };
  }
  if (isIpv4(host)) {
    for (const a of allow) {
      if (a.includes("/") && ipInCidr(host, a)) return { ok: true, kind: "ip", host, reason: `落在授权网段 ${a}` };
      if (!a.includes("/") && a === host) return { ok: true, kind: "ip", host, reason: `命中授权 IP ${a}` };
    }
    return { ok: false, kind: "ip", host, reason: "不在任何授权网段内" };
  }
  if (isDomain(host)) {
    for (const a of allow) {
      // 通配项 `*.example.test` 与裸域名 `example.test` 都按后缀匹配；
      // 注意别拿 isDomain(a) 判通配项——`*.example.test` 含 `*` 不是合法域名，
      // 那样写会把通配授权全部判失效（首版就这么错了，3 条域名用例全挂）。
      const wildcard = /^\*\.(.+)$/.exec(a);
      const bare = wildcard ? wildcard[1] : a;
      if (!isDomain(bare)) continue;
      if (host === bare || host.endsWith("." + bare)) return { ok: true, kind: "domain", host, reason: `命中授权域名 ${a}` };
    }
    return { ok: false, kind: "domain", host, reason: "不在任何授权域名下" };
  }
  // 既不是 IPv4 也不是域名：判不了就是不过（宁严不松）
  return { ok: false, kind: "unknown", host, reason: "无法判定（既不是 IPv4 也不是域名）" };
}

/** 批量判定：返回第一个越界的（有就越界，对应「一个越界就整条拦下」） */
export function firstOutOfScope(targets, scope = {}) {
  for (const t of targets || []) {
    const r = checkTarget(t, scope);
    if (!r.ok) return r;
  }
  return null;
}

/* ────────────────────────── 按技法授权 + 时间窗口 ──────────────────────────
 * 为什么还要这一层（不只按目标）：目标在范围内，不等于「这个时间、这种手法」也被授权。
 * 真实作业里三条独立的边界，缺一条就等于没有边界：
 *   ① 打哪儿（目标范围）—— 上面 checkTarget 已做
 *   ② 用什么手法（技法）—— 拿 0day 打、还是只做被动收集，是两回事；扫内网和读流量也是两回事
 *   ③ 什么时候能打（时间窗口）—— 授权常常只覆盖某几个时段；过窗继续打是最常见的越界
 * 机制同样借自 @integsec/agentic-pentest-proxy 的 manifest（authorized_techniques /
 * excluded_techniques / 时间窗），语义按本仓习惯重写，不抄实现。
 */

/** 技法类别 → 判定用的正则（技能 id / 技法名都按这个归组；顺序敏感，先命中先用） */
const TECH_RULES = [
  [/^(competition-kernel|competition-container|competition-queue|competition-race|competition-relay|competition-lsass|competition-dpapi|competition-ad-certificate)/, "destructive"],
  [/^(webshell|shell-handler|vps-reverse|privesc-persistence|injection-payloads|web-vuln-payloads|pwn-chain|patch-diff-exploit)/, "exploit"],
  [/^(credential-attack|netexec-scan|fscan-intranet|gogo-intranet|lateral-movement|dir-bruteforce|nuclei-scan|active-scan|subdomain-bruteforce|hydra)/, "noisy"],
  [/^(passive-recon|fofa-recon|case-review|ctf-sandbox|pentest-tools|attack-chain|redteam-setup|asset-correlation)/, "passive"],
  [/^(reverse-engineering|ida-reverse|ghidra-reverse|radare2|binary-diff|dotnet-reverse|js-reverse|apk-reverse|mobile-reverse|protocol-reverse|go-rust-reverse|browser-extension-reverse|firmware-pentest|thick-client)/, "reverse"],
  [/^(windows-ad|identity-federation|cloud-k8s|ot-ics|iot-iiot-netdev|edr-bypass-re|hardware-security|radio-sdr|wifi-wireless|digital-forensics|threat-hunting|malware-analysis)/, "specialty"],
  [/^(api-security|code-audit|database-security|email-security|llm-security|supply-chain-security)/, "appsec"],
  [/^competition-/, "surface"],
];

/** 把一个技能 id / 技法名归到一个技法类别 */
export function techClassOf(name) {
  const s = String(name || "").trim();
  if (!s) return "unknown";
  for (const [re, cls] of TECH_RULES) if (re.test(s)) return cls;
  return "unknown";
}

/** 解析时间窗口：接受 "YYYY-MM-DD HH:mm" / "YYYY-MM-DDTHH:mm" / 纯日期（视为当天 00:00）；返回 ms 或 null */
export function parseWindowPoint(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  const iso = t.includes("T") ? t : t.replace(" ", "T");
  const withTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso : iso + "T00:00";
  const ms = Date.parse(withTime);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 判定「现在能不能用这个技法」。
 * @param {string} technique - 技能 id 或技法名（如 "nuclei-scan"、"noisy"）
 * @param {{ authorizedTechniques?: string[], excludedTechniques?: string[],
 *           window?: { from?: string, to?: string }, now?: number }} scope
 * @returns {{ ok: boolean, cls: string, reason: string }}
 */
export function checkTechnique(technique, scope = {}) {
  const cls = techClassOf(technique);
  const allow = (scope.authorizedTechniques || []).map((x) => String(x).trim()).filter(Boolean);
  const deny = (scope.excludedTechniques || []).map((x) => String(x).trim()).filter(Boolean);
  const name = String(technique || "").trim();

  // 排除优先：技法名或类别命中即拒（与目标范围同一原则）
  for (const d of deny) {
    if (d === name || d === cls || techClassOf(d) === cls) {
      return { ok: false, cls, reason: `技法被排除（命中 ${d}）` };
    }
  }
  // 授权清单非空时，技法名或类别必须命中其一；为空表示「不限制技法」（与目标范围不同：
  // 目标为空必须拒——没有授权目标就无靶可打；技法为空是「没特别限制」，这是常见的授权写法）
  if (allow.length) {
    const hit = allow.some((a) => a === name || a === cls || techClassOf(a) === cls);
    if (!hit) return { ok: false, cls, reason: `技法不在授权清单内（${cls} 未被授权）` };
  }
  // 时间窗口
  const w = scope.window || {};
  const from = parseWindowPoint(w.from);
  const to = parseWindowPoint(w.to);
  const now = Number.isFinite(scope.now) ? scope.now : Date.now();
  // 未到起点也**不放行**：授权窗口是「某段区间内可以做」，提前开工同样在区间外。
  // 首版这里返回 ok:true 却写着「需人工确认」，自相矛盾——要么拦、要么不拦，不能既过又说要确认。
  if (from !== null && now < from) return { ok: false, cls, reason: `未到授权窗口起点（${w.from}）` };
  if (to !== null && now > to) return { ok: false, cls, reason: `已过授权窗口（截止 ${w.to}）` };
  return { ok: true, cls, reason: "技法与时间窗均通过" };
}

/** 一次性判定「目标 + 技法 + 时间窗」三道边界，返回第一条不通过的 */
export function checkAction({ targets = [], technique = "", scope = {}, now } = {}) {
  for (const t of targets) {
    const r = checkTarget(t, scope);
    if (!r.ok) return { ok: false, layer: "target", detail: r.reason, host: r.host };
  }
  const tech = checkTechnique(technique, { ...scope, now });
  if (!tech.ok) return { ok: false, layer: "technique", detail: tech.reason, cls: tech.cls };
  return { ok: true, layer: "", detail: "通过", cls: tech.cls };
}
