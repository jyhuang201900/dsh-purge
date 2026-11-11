/**
 * 管道产物 → 演练台落库。
 *
 * 为什么需要（第 132 轮实测）：管道跑完只把结果写在 `runs/*.txt`，**演练台里一条记录都没有**。
 * 而本仓的条令是「**没落库的发现等于没发生**」——文件散落在磁盘上，`summary` 看不到、
 * 报告写不进去、下一步也不知道你已经有资产了，于是下一轮又从零开始收。
 *
 * 设计要点（每条都有踩坑依据）：
 *   ① **按产物类型分派**，不是一股脑塞进 asset：
 *      · `httpx.txt` 的行是 `https://host:port [200] [title] [tech]` → 资产 + 端口 + 指纹；
 *      · `ports.txt` 的行是 `host:port` → 端口；
 *      · `nuclei.txt` 的行是 `[template-id] [proto] [severity] host` → **漏洞**（这才是成果）；
 *      · `alive.txt` / `subs.txt` → 资产（存活/未探）。
 *   ② **幂等**：`importBundle` 本身按 ip upsert，重复导入不产生重复行——所以管道可以反复跑。
 *   ③ **不静默丢行**：解析不了的行要**计数并回报**，否则用户以为全落库了。
 *   ④ **落库前先校验**：域名/IP 形状不对的行（httpx 的 400 行、nuclei 的 banner 行）要跳过并说明。
 */

/**
 * 解析 httpx 输出行。格式实测：`https://example.com:443 [200] [Example Domain] [Cloudflare,HTTP/3]`
 * @returns {{ url: string, host: string, port: number, status: number, title: string, tech: string[] }|null}
 */
export function parseHttpxLine(line) {
  const s = String(line || "").trim();
  if (!s) return null;
  // 取 URL 部分（到第一个空格为止）
  const m = /^(https?:\/\/[^\s]+)\s+\[(\d{3})\]/.exec(s);
  if (!m) return null;
  const url = m[1];
  const status = Number(m[2]);
  const u = /^https?:\/\/([^/:]+)(?::(\d+))?/i.exec(url);
  if (!u) return null;
  const host = u[1];
  const scheme = /^https/i.test(url) ? "https" : "http";
  const port = u[2] ? Number(u[2]) : (scheme === "https" ? 443 : 80);
  // 标题：第一个 [..] 之后再一个 [..]
  const brackets = [...s.matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]);
  const title = brackets.length >= 2 ? brackets[1] : "";
  const tech = brackets.length >= 3 ? brackets[2].split(",").map((x) => x.trim()).filter(Boolean) : [];
  return { url, host, port, status, title, tech };
}

/** 解析 naabu 输出行：`host:port` */
export function parsePortLine(line) {
  const s = String(line || "").trim();
  const m = /^([^\s:]+):(\d+)$/.exec(s);
  if (!m) return null;
  return { host: m[1], port: Number(m[2]) };
}

/**
 * 解析 nuclei 输出行。实测格式：
 *   `[tech-detect:cloudflare] [http] [info] https://example.com`
 *   `[CVE-2021-44228] [http] [critical] https://target/`
 * @returns {{ template: string, proto: string, severity: string, url: string }|null}
 */
export function parseNucleiLine(line) {
  const s = String(line || "").trim();
  if (!s || s.startsWith("[" + "INF") || /^\s*__/.test(s)) return null;
  const m = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(\S+)/.exec(s);
  if (!m) return null;
  return { template: m[1], proto: m[2], severity: m[3].toLowerCase(), url: m[4] };
}

/**
 * 把若干产物文件解析成「可落库的批次」。
 * @param {Record<string, string>} files - { 'httpx.txt': '<内容>', ... }
 * @returns {{ assets: Array, ports: Array, vulns: Array, skipped: Array<{file:string,line:string,why:string}> }}
 */
export function parseArtifacts(files = {}) {
  const assets = [];
  const ports = [];
  const vulns = [];
  const skipped = [];
  const pushSkip = (file, line, why) => skipped.push({ file, line: String(line).slice(0, 80), why });

  for (const [name, body] of Object.entries(files)) {
    const lines = String(body || "").split(/\r?\n/).filter((x) => x.trim());
    if (/^httpx\.txt$/i.test(name)) {
      for (const line of lines) {
        const r = parseHttpxLine(line);
        if (!r) { pushSkip(name, line, "不是 httpx 结果行"); continue; }
        assets.push({ ip: r.host, primary_name: r.host, state: r.status > 0 ? "live" : "unknown", url: r.url, status: r.status, title: r.title, tech: r.tech });
        ports.push({ host: r.host, port: r.port, state: "open", service: r.tech[0] || "" });
      }
    } else if (/^ports\.txt$/i.test(name)) {
      for (const line of lines) {
        const r = parsePortLine(line);
        if (!r) { pushSkip(name, line, "不是 host:port"); continue; }
        ports.push({ host: r.host, port: r.port, state: "open", service: "" });
      }
    } else if (/^nuclei\.txt$/i.test(name)) {
      for (const line of lines) {
        const r = parseNucleiLine(line);
        if (!r) { pushSkip(name, line, "不是 nuclei 结果行（可能是 banner/统计）"); continue; }
        // tech-detect 这类是「指纹」不是「漏洞」，落到资产技术栈更合适
        if (/^tech-detect/i.test(r.template)) { pushSkip(name, line, "tech-detect 是指纹不是漏洞，已忽略"); continue; }
        vulns.push({ target: r.url, title: r.template, severity: r.severity, source: "nuclei", evidence: line.trim() });
      }
    } else if (/^(alive|subs)\.txt$/i.test(name)) {
      for (const line of lines) {
        const host = String(line).trim().split(/\s+/)[0];
        if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) { pushSkip(name, line, "不是域名"); continue; }
        assets.push({ ip: host, primary_name: host, state: name.startsWith("alive") ? "live" : "unknown" });
      }
    }
  }
  // 去重（同 host 只留一条资产；同 host:port 只留一个端口）
  const uniqAssets = [...new Map(assets.map((a) => [a.ip, a])).values()];
  const uniqPorts = [...new Map(ports.map((p) => [`${p.host}:${p.port}`, p])).values()];
  return { assets: uniqAssets, ports: uniqPorts, vulns, skipped };
}

/**
 * 把「资产 + 端口 + 指纹」组装成 importBundle 真正吃的形状。
 *
 * 第 133 轮实测的缺陷：`ingest` 把端口解析出来了，却**只传了 `ip` 和 `primary_name`**，
 * 端口与技术栈全丢——`assets` 里只看到 `example.com(unknown)`，看不到 443、也看不到 Cloudflare。
 * 而 store 的 `importBundle` 本来就支持 `assets[].ports[]`，每个 port 还能带
 * `service{name,product,version}` 与 `fingerprints[]{category,vendor,product,version}`（读源码确认）。
 * 也就是说：**不是 store 不支持，是我没往里放。**
 * @param {{ assets: Array, ports: Array }} batch
 */
export function toBundle(batch = {}) {
  const portsByHost = new Map();
  for (const p of batch.ports || []) {
    if (!portsByHost.has(p.host)) portsByHost.set(p.host, []);
    portsByHost.get(p.host).push(p);
  }
  return (batch.assets || []).map((a) => {
    const ps = (portsByHost.get(a.ip) || []).map((p) => {
      const one = { port: p.port, proto: "tcp", state: p.state || "open" };
      // **只放有值的字段**：SQLite 不接受 undefined 绑定
      // （实测报 "Provided value cannot be bound to SQLite parameter 2"）。
      // 之前写 `url: x ? a.url : undefined` 就是踩在这里——undefined 不是 null，驱动直接拒。
      if (a.url && Number(a.port) === p.port) one.url = a.url;
      if (a.title) one.title = a.title;
      // service 在 importBundle 里是**字符串字段**（`p.service` 直接进 service.name 列），
      // 不是对象。第 133 轮实测：传 `{name:'Cloudflare'}` 会在 L5481 报
      // "Provided value cannot be bound to SQLite parameter 2"——对象不能绑到 SQLite 参数。
      if (p.service) one.service = String(p.service);
      const fps = (a.tech || []).map((t) => ({ category: "tech", product: t, confidence: 80 }));
      if (fps.length) one.fingerprints = fps;
      return one;
    });
    const out = { ip: a.ip, primary_name: a.primary_name || a.ip };
    if (ps.length) out.ports = ps;
    if (a.primary_name && a.primary_name !== a.ip) out.names = [{ name: a.primary_name, kind: "domain" }];
    return out;
  });
}

/** 生成落库命令（走已有的 entity_add，不新开 op） */
export function importCommands(batch = {}) {
  const out = [];
  const a = Array.isArray(batch.assets) ? batch.assets : [];
  const v = Array.isArray(batch.vulns) ? batch.vulns : [];
  if (a.length) {
    // importBundle 天生吃数组：一次铺完，不必调 N 次
    out.push({
      label: `落库资产 ${a.length} 个`,
      cmd: `op=entity_add entity=asset target=${a.map((x) => x.ip).join(",")}`,
      note: "走 importBundle（按 ip upsert，重复导入不产生重复行）",
    });
  }
  for (const x of v.slice(0, 20)) {
    out.push({
      label: `落库漏洞 ${x.title}`,
      cmd: `op=entity_add entity=vuln target=${x.target} name=${x.title} kind=${x.severity} text=${JSON.stringify(x.evidence).slice(0, 120)}`,
      note: "严重度必填（不给会静默降级成 info，而报告只收中危以上）",
    });
  }
  if (v.length > 20) out.push({ label: `…另 ${v.length - 20} 条漏洞`, cmd: "", note: "分批落，别一次塞满返回" });
  return out;
}
