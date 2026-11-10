/**
 * 阶段分流器：把「下一步」从「点个技能名 + 一句通用说明」变成「按手里真实数据说这一发打哪」。
 *
 * 为什么需要（实测）：`summary` 的 9 个「下一步」分支里，只有阶段④（漏洞利用）会按真实漏洞分流。
 * 其余分支虽然点了技能名，但说的都是「逐条过」「铺面」「挖出所有网段」这类**通用正确**的话——
 * 而事实库里其实躺着足够具体的信息：哪个网段资产最多、哪个还没铺开、哪些资产还没测过。
 * 手里有数据却不说，等于让模型自己再算一遍，那正是「最强进攻手」最不该省的一步。
 */

/* ─────────────────────────── 阶段③ 漏洞发现 ─────────────────────────── */

/**
 * 按资产/网段状态给「先打谁」。
 * @param {{ segments?: Array, untested?: number, assets?: number }} ctx
 * @returns {string} 一句可直接执行的话
 */
export function routeRecon(ctx = {}) {
  const segs = Array.isArray(ctx.segments) ? ctx.segments : [];
  const untested = Number(ctx.untested || 0);
  const assets = Number(ctx.assets || 0);

  // 有网段就点名「资产最多且还活着」的那一个：先打最厚的那块，不是先打最边上的
  const withLive = segs.filter((s) => Number(s.live || 0) > 0);
  const pool = withLive.length ? withLive : segs;
  if (pool.length) {
    const top = pool.slice().sort((a, b) => Number(b.assets || 0) - Number(a.assets || 0))[0];
    const live = Number(top.live || 0);
    const assetsN = Number(top.assets || 0);
    const ports = Number(top.open_ports ?? top.openPorts ?? 0);
    const bits = `${top.cidr}（资产 ${assetsN}${live ? `，存活 ${live}` : "，存活 0"}${ports ? `，开放端口 ${ports}` : ""}）`;
    // 存活 0 要先分两种情形说清楚：asset.state 默认是 'unknown'（没探过），
    // 与「探过确认是死的」不是一回事。混为一谈会让人以为资产全废了。
    if (!live) {
      return assetsN > 0
        ? `先确认存活：${bits} —— 这些资产 state 还是 unknown（只落库、没探过），用 ${"`"}naabu${"`"} 探端口或 ${"`"}dnsx${"`"} 复核解析，别直接上模板`
        : `先补资产：${bits} 还没有任何资产，用 ${"`"}subdomain-bruteforce${"`"} 或 ${"`"}fofa-recon${"`"} 收一轮`;
    }
    return `先打资产最多的 ${bits} —— 用 ${"`"}nuclei-scan${"`"} 过模板，再 ${"`"}web-fingerprint${"`"} 认技术栈`;
  }
  if (untested > 0) return `还有 ${untested} 个资产没测过 —— 先用 ${"`"}active-scan${"`"} 补存活与端口，再 ${"`"}nuclei-scan${"`"}`;
  if (assets > 0) return `${assets} 个资产已收但没有网段归属 —— 先 ${"`"}asset-correlation${"`"} 归段，否则打起来不知道边界在哪`;
  return "";
}

/* ─────────────────────────── 阶段⑤ 内网铺面 ─────────────────────────── */

/**
 * 按网段状态给「内网先铺哪块」。
 * @param {{ segments?: Array }} ctx
 * @returns {string}
 */
export function routeIntranet(ctx = {}) {
  const segs = Array.isArray(ctx.segments) ? ctx.segments : [];
  if (!segs.length) return `隧道已通但还没有内网网段 —— 用 ${"`"}gogo${"`"} 从当前据点铺面（走 ${"`"}gogo-intranet${"`"}），挖出网段再落 ${"`"}segment${"`"}`;

  // 内网网段优先（10./172.16-31./192.168./100.64-127.）
  const isInternal = (cidr) => {
    const ip = String(cidr || "").split("/")[0];
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return false;
    if (p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  };
  const internal = segs.filter((s) => isInternal(s.cidr));
  const pool = internal.length ? internal : segs;

  // 已经铺开的（有资产）与还没铺的（资产 0）分开说
  const empty = pool.filter((s) => Number(s.assets || 0) === 0);
  const loaded = pool.filter((s) => Number(s.assets || 0) > 0).sort((a, b) => Number(b.assets || 0) - Number(a.assets || 0));

  if (loaded.length) {
    const top = loaded[0];
    return `内网最厚的是 ${top.cidr}（资产 ${Number(top.assets || 0)}${Number(top.live || 0) ? `，存活 ${Number(top.live)}` : ""}）—— 用 ${"`"}fscan-intranet${"`"} 打这块的弱口令/未授权/高危，比再铺新网段收益高`;
  }
  if (empty.length) {
    return `内网网段 ${empty.map((s) => s.cidr).slice(0, 3).join("、")} 还没有资产 —— 先 ${"`"}gogo-intranet${"`"} 铺这几块`;
  }
  return "";
}

/* ─────────────────────────── 隧道 ─────────────────────────── */

/**
 * 隧道建议：按「有没有 webshell / 有没有存活资产」区分。
 * 通用句「建隧道」不看条件，会导致在没入口时让人去建隧道。
 * @param {{ shells?: number, liveAssets?: number, tunnels?: number }} ctx
 */
export function routeTunnel(ctx = {}) {
  const shells = Number(ctx.shells || 0);
  const live = Number(ctx.liveAssets || 0);
  const assets = Number(ctx.assets || 0);
  if (shells > 0) return `已有 ${shells} 个 webshell —— 用 ${"`"}suo5-tunnel${"`"} 建隧道（内存马式，比 chisel 安静），建完**实测能访问内网才算打通**`;
  if (live > 0) return `还没有 webshell —— 先从存活资产拿权限（${"`"}webshell-toolkit${"`"}），再建隧道；没有入口的隧道没有意义`;
  // 有资产但都没确认存活 ≠ 一个资产都没有：前者是「先探存活」，后者是「先收资产」。
  // 合成一句会让人在完全没资产时去探存活（空探），或在有一堆资产时回头重收（白干）。
  if (assets > 0) return `有 ${assets} 个资产但都没确认存活 —— 先 ${"`"}active-scan${"`"} 探活，再从存活的那几个拿权限；现在建隧道没有入口`;
  return `还没有任何资产 —— 先回到阶段① 用 ${"`"}recon-pipeline${"`"} 收一轮，隧道这一步现在做不了`;
}

/* ─────────────────────────── 凭据验证 ─────────────────────────── */

/**
 * 凭据建议：按凭据类型分流（明文 / hash / key）。
 * @param {{ creds?: Array }} ctx
 */
export function routeCredentials(ctx = {}) {
  const creds = Array.isArray(ctx.creds) ? ctx.creds : [];
  if (!creds.length) return "";
  const kinds = {};
  for (const c of creds) {
    const k = String(c.secret_type || c.kind || "unknown").toLowerCase();
    kinds[k] = (kinds[k] || 0) + 1;
  }
  const has = (re) => Object.keys(kinds).some((k) => re.test(k));
  const parts = [];
  if (has(/hash|ntlm|lm/)) parts.push(`${"`"}hashcat${"`"} 先离线破 hash（NTLM 用 -m 1000），别在线硬撞`);
  if (has(/key|ssh|id_rsa/)) parts.push(`SSH key 直接 ${"`"}ssh -i${"`"} 试，比密码更快也更安静`);
  if (has(/password|plain|明文/)) parts.push(`明文口令用 ${"`"}netexec-scan${"`"} 逐条实测登录（只有凭据不算拿到账号）`);
  const summary = Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join("、");
  return parts.length ? `凭据 ${creds.length} 条（${summary}）—— ${parts.join("；")}` : `凭据 ${creds.length} 条 —— 用 ${"`"}netexec-scan${"`"} 逐条实测登录`;
}
