/**
 * 得分点机会雷达 —— 把「事实库里已经有什么」翻译成「现在值多少分、差哪一步」。
 *
 * 为什么需要它（实测缺口）：25 条得分点是交付物的计价单位，但这条链上此前只有两段——
 * 「记分校验」（addScoreHit 校验分值/证据/封顶）与「记分报告」（scoreReport 汇总），
 * 中间缺了**计分规划**：打之前没人告诉模型手里这堆东西对应哪一条。
 *
 * 实测表现（第 134 轮）：
 *   · 库里躺着 3 条 Web 后台凭据，`op=scores` 只列出 25 条规则名，
 *     模型看不出「这 3 条凭据已经值 300 分」，于是继续去挖新洞 —— 打了不等于拿到；
 *   · 反过来也有「集权系统按 10 分/台记」这种把 500 记成 10 的错档，
 *     因为规则名里没有「你手上这台是堡垒机」这层对应。
 *
 * 本模块输出三档状态：
 *   hit   —— 已记分（来自 scoreChain，报已得分与上限占用）
 *   ready —— **证据已具备、只差点一次记分**（最贵的提示：分已经在口袋里）
 *   gap   —— 前置有了、差一个动作（只给**一个**动作，不给一段方法论）
 * 并按 预期分/成本 排序给 Top N，服务于「指向准、消耗省」。
 *
 * 判据只依赖 store 的公开读方法；**任何一条判据抛错都降级成「该条不判」**，不阻断整张雷达。
 * 理由：雷达自己报错比没有雷达更糟——模型会以为「没机会」。
 */

/** 得分点名字在雷达里只需要「一眼认得出是哪类」，不必整句：
 *  原名常带一长串括号说明（「集权系统权限（运维 / 身份 / 组网 / 终端管理后台）」），
 *  硬截 28 字会把括号切在半截（实测输出「…终端管理后台」后面挂个孤零零的括号）。 */
function shortName(name) {
  const s = String(name || "");
  const i = s.search(/[（(]/);
  if (i >= 4 && i <= 24) return s.slice(0, i);
  return s.length > 24 ? s.slice(0, 24) + "…" : s;
}

/** 成本档：1 = 只差记分；2 = 一次登录/验证；3 = 一次利用；4 = 打穿边界。用于排序，不是精确工期。 */
const COST_LABEL = { 1: "只差记分", 2: "一次验证", 3: "一次利用", 4: "打穿边界" };

/**
 * 指纹 → 得分点。命中即认为「这类系统已在手里」，只差实测登录后记分。
 *
 * 为什么用正则而不是结构化字段：指纹是扫描器的自由文本（product/banner/title/service 都可能带），
 * 没有归一化词表。与其假装精确，不如把匹配面写宽、把命中理由一起印出来让模型自己复核。
 * 顺序敏感：**越具体、分值越高的越靠前**（集权 500 必须排在通用 Web 100 之前）。
 */
const FINGERPRINT_RULES = [
  {
    code: "central-system",
    label: "集权系统",
    re: /堡垒机|jumpserver|齐治|行云|帕拉迪|sso\b|单点登录|4a\b|iam\b|身份认证|域控|domain\s*control|ldap|零信任|终端管理|桌面云|云桌面|citrix|vdi\b/i,
    hint: "堡垒机/SSO/域控/终端管理后台都是集权系统：管理员档 500 分/个，普通档 50",
    cost: 2,
  },
  {
    code: "bigdata-system",
    label: "大数据系统",
    re: /hadoop|hive|hbase|spark|clickhouse|druid|flink|elasticsearch|kibana|大数据|数据仓库|数据中台/i,
    hint: "大数据系统管理员档 1000 分；注意数据量 < 5 亿条或 1TB 的要改按普通数据库（第 4 项）算",
    cost: 2,
  },
  {
    code: "cloud-platform",
    label: "云管理平台",
    re: /kubernetes|k8s\b|rancher|openshift|openstack|vmware|vcenter|esxi|proxmox|云管|容器云|阿里云|腾讯云|华为云|aws\b|azure/i,
    hint: "云管理平台控制权 500 分/个；托管主机跨类引用「控制一般系统」分值，别按 500 算批量",
    cost: 3,
  },
  {
    code: "model-compute",
    label: "算力/训练平台",
    re: /算力|训练平台|推理平台|model\s*(hub|server)|ollama|vllm|triton|pytorch|tensorflow|jupyter|notebook|modelarts|ai\s*平台/i,
    hint: "算力管理平台/训练数据系统 500 分；先判是「平台权限」还是「算力卡资源」（后者 10 分/张）",
    cost: 3,
  },
  {
    code: "ai-agent",
    label: "模型智能体/agent 工具",
    re: /mcp\b|agent\s*(tool|平台|管理)|skill\s*(市场|库)|langflow|dify|coze|n8n|autogpt|智能体/i,
    hint: "能操作 agent 工具链的按 ai-agent 记（100 分）；能下发指令到宿主的要写清「能操作什么」",
    cost: 3,
  },
  {
    code: "iiot",
    label: "工业互联网系统",
    re: /scada|plc\b|modbus|opc\s*ua|工控|工业互联网|dcs\b|hmi\b|组态|西门子|施耐德|和利时/i,
    hint: "工业互联网系统 200 分/个；打到端点设备再进核心网的走 iot-corenet（5000 分）",
    cost: 4,
  },
  {
    code: "iot-platform",
    label: "物联网管控平台",
    re: /物联网|iot\s*(平台|管控|云)|海康|hikvision|大华|dahua|宇视|uniview|设备管理平台|物联卡/i,
    hint: "物联网设备管控平台 200 分；**平台下面的终端按台另算**（摄像头 10 分/台，G4）",
    cost: 3,
  },
  {
    code: "netdev",
    label: "网络设备",
    re: /路由器|交换机|防火墙|网闸|光闸|摆渡|vpn\b|华为\s*(ar|s\d)|h3c|cisco|juniper|fortinet|深信服\s*(af|ac)|飞塔/i,
    hint: "网络设备管理员档 200 分；在其上做重定向 +200、植远控 +1000（netdev-redirect / netdev-implant 另记）",
    cost: 3,
  },
  {
    code: "secdev",
    label: "安全设备",
    /* 注意不能把「堡垒」写进来：堡垒机是**集权系统**（500 分），不是安全设备（200 分）。
       实测第 134 轮：正则里带 `堡垒` 时，Jumpserver 同时被算成 central-system + secdev + web-app，
       一张雷达报出三条重复机会，分值虚高 700 分。 */
    re: /waf\b|ips\b|ids\b|日志审计|审计设备|态势感知|漏扫|基线|edr\b|hids\b|杀毒|防病毒|防火墙管理/i,
    hint: "非集权类安全设备 200 分/个；**如果是集权类（能管一堆设备的）走 central-system 500**",
    cost: 3,
  },
  {
    code: "file-storage",
    label: "文件存储类系统",
    re: /ftp\b|sftp|smb\b|nfs\b|nas\b|对象存储|oss\b|minio|网盘|nextcloud|owncloud|共享盘|文件服务器/i,
    hint: "文件存储类系统 50 分/个；里面的大批量数据按 G2 另计",
    cost: 2,
  },
  {
    code: "terminal-access",
    label: "终端设备",
    re: /摄像头|ipc\b|nvr\b|dvr\b|打印机|printer|wifi|无线|ap\b|pad\b|手机|大屏|广告机|考勤机/i,
    hint: "终端按台记：打印机/wifi 路由器 5 分/台，PC/Pad/手机/摄像头/大屏 10 分/台；须能证明与目标单位的关系（G7）",
    cost: 3,
  },
  {
    code: "db-credential",
    label: "数据库",
    re: /mysql|mariadb|redis|mongodb|postgres|sqlserver|mssql|oracle|elastic|memcache|达梦|人大金仓|oceanbase/i,
    hint: "数据库管理员档 50 分/个；空口令/未授权统一 10 分/个；数据成果单独计分（G2）",
    cost: 2,
  },
  {
    code: "web-app",
    label: "Web 应用系统",
    re: /http|nginx|apache|tomcat|iis\b|weblogic|jboss|后台|管理端|登录|oa\b|erp\b|邮箱|mail|exchange|门户|业务系统/i,
    hint: "Web 应用管理员档 100 分/个；判不出更贴切类别就归本条（兜底归类），别因为「看不出是不是 OA」而漏记",
    cost: 2,
  },
];

/** 凭据/会话里的「Web 登录」形态判定：host 是 URL，或端口落在 Web 常见段，或备注里带后台字样。 */
const WEB_PORT = /:(80|443|8080|8443|8000|8888|9000|9090|7001|8081|8088|5000|3000|81|82|88|8001|8090)$/;
function looksWebHost(host, note) {
  const h = String(host || "");
  if (/^https?:\/\//i.test(h)) return true;
  if (WEB_PORT.test(h)) return true;
  return /后台|管理端|管理平台|登录|后台管理|admin|console|portal|web/i.test(String(note || ""));
}

/** 数据库形态判定 */
const DB_HINT = /mysql|redis|mongo|postgres|sqlserver|mssql|oracle|elastic|memcache|达梦|金仓|oceanbase|3306|6379|5432|1433|1521|27017/i;

/** 安全取值：任何一条读失败都返回空数组，不抛。 */
function safe(fn, fallback) {
  try {
    const v = fn();
    return Array.isArray(v) ? v : (Array.isArray(v?.items) ? v.items : fallback);
  } catch {
    return fallback;
  }
}

/**
 * 从 store 抓一份雷达用的状态快照。**只读**，不改库。
 * 每个集合单独 try：某个表坏了不该让整张雷达空掉。
 */
export function radarState(store, engagementId) {
  return {
    assets: safe(() => store.listAssets(engagementId, {}), []),
    ports: safe(() => store.listPorts(engagementId, {}), []),
    vulns: safe(() => store.listVulns(engagementId, {}), []),
    credentials: safe(() => store.listCredentials(engagementId, {}), []),
    accesses: safe(() => store.listAccess(engagementId, {}), []),
    webshells: safe(() => store.listWebshells(engagementId, {}), []),
    tunnels: safe(() => store.listTunnels(engagementId, {}), []),
    webs: safe(() => store.listWeb(engagementId, {}), []),
    hits: safe(() => store.scoreChain(engagementId, { limit: 2000 }), []),
  };
}

/** 已记分聚合：code → { n, points, targets[] } */
function aggregateHits(hits) {
  const byCode = new Map();
  for (const h of hits) {
    const code = String(h.code || "");
    if (!code) continue;
    if (Number(h.enabled) === 0) continue; // 停用的得分点不进雷达（与面板口径一致）
    /* 口径必须与 scoreChain 逐条对齐（审计 I3：这里原来取 hit_points，未乘 multiplier、
       也没看自建/封顶，实测 120 分对真实 10 分，虚高 12 倍）：
       ① 自建账号不计分；② 被判封顶的那条不再计分；③ 分值取 h.points（chainPointsOf 已含 multiplier 与档位）。 */
    if (Number(h.self_created) === 1 || h.self_created === true) continue;
    if (h.capped === true) continue;
    const got = Number(h.points) || 0;
    if (!byCode.has(code)) byCode.set(code, { n: 0, points: 0, targets: [] });
    const rec = byCode.get(code);
    rec.n += 1;
    rec.points += got;
    const t = String(h.target || h.asset_ip || h.vuln_title || "").trim();
    if (t && rec.targets.length < 5 && !rec.targets.includes(t)) rec.targets.push(t);
  }
  return byCode;
}

/**
 * 指纹命中：把 ports 的 service/fingerprints/title/banner/url 拼成一条文本，逐条规则试。
 *
 * **端口级「首个命中即止」**，不是「所有命中都收」：一台 Jumpserver 的 8080 同时满足
 * 集权/安全设备/Web 三条正则，全收会把一台机器算成三份分（实测虚高 700 分）。
 * 规则表按「越具体、分值越高越靠前」排序，首个命中即该类系统——这正是得分规则里
 * 「先判是否有更贴切类别，没有才归入 Web 应用」的实现。
 *
 * 返回 code → 命中样本（最多 5 条，带 IP:port 与命中理由）。
 */
function matchFingerprints(state) {
  const out = new Map();
  for (const p of state.ports) {
    const blob = [p.service, p.fingerprints, p.title, p.banner, p.url].filter(Boolean).join(" ");
    if (!blob) continue;
    for (const rule of FINGERPRINT_RULES) {
      let hit;
      try { hit = rule.re.test(blob); } catch { hit = false; }
      if (!hit) continue;
      if (!out.has(rule.code)) out.set(rule.code, []);
      const bucket = out.get(rule.code);
      const where = `${p.ip || "?"}${p.port ? ":" + p.port : ""}`;
      if (bucket.length < 5 && !bucket.some((x) => x.where === where)) {
        bucket.push({ where, ip: String(p.ip || ""), why: String(p.title || p.service || p.fingerprints || "").slice(0, 40) });
      }
      break; // ← 首个命中即止：不许一台机器同时进多条规则
    }
  }
  return out;
}

/** 把 host 归一成「纯 IP/主机名」，用于把凭据与端口对上（凭据常带端口与 scheme）。 */
function hostKey(h) {
  return String(h || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .trim()
    .toLowerCase();
}

/**
 * 主入口：算雷达。
 *
 * @param {object} state  radarState() 的返回值
 * @param {Array}  points listScorePoints().items（得分点定义，含 code/points/cap/enabled）
 * @param {object} opts   { top: number }
 * @returns {{ engagement: string, totals: object, hit: Array, ready: Array, gap: Array, top: Array }}
 */
export function scoreRadar(state, points, opts = {}) {
  const topN = Number.isFinite(opts.top) ? opts.top : 3;
  const hitMap = aggregateHits(state.hits || []);
  const fp = matchFingerprints(state);

  const pointByCode = new Map();
  for (const p of points || []) {
    if (p && p.code) pointByCode.set(String(p.code), p);
  }

  const hit = [];
  const ready = [];
  const gap = [];

  /* ── 一、已记分 ───────────────────────────────────────────── */
  for (const [code, rec] of hitMap) {
    const meta = pointByCode.get(code);
    hit.push({
      code,
      name: shortName(meta?.name || code),
      n: rec.n,
      points: rec.points,
      cap: Number(meta?.cap) || 0,
      targets: rec.targets,
    });
  }
  hit.sort((a, b) => b.points - a.points);

  /* ── 二、可拿未拿（ready）：证据已在库里，只差记分 ──────────── */
  /* 这一类是雷达的核心价值：**分已经在口袋里**，只是没记。 */
  /* 同一主机 × 同一得分点只算一次（审计 I4）：库里 1 个账号会被凭据行 + 指纹行各推一次，
     实测 ready 报 "db-credential n=2 est=100"，而规则 dedup_scope=service 只给 50。
     「可拿未拿」的语义是「去记一次分」，同一台机器同一类证据重复记并不加分。 */
  const readyHosts = new Map(); // code → Set(hostKey)
  const readyPush = (code, where, why, unit, hostHint) => {
    const meta = pointByCode.get(code);
    if (!meta || Number(meta.enabled) === 0) return;
    const hk = hostKey(hostHint !== undefined ? hostHint : where);
    if (hk) {
      if (!readyHosts.has(code)) readyHosts.set(code, new Set());
      const seen = readyHosts.get(code);
      if (seen.has(hk)) return;
      seen.add(hk);
    }
    const per = Number(unit ?? meta.points) || 0;
    let bucket = ready.find((x) => x.code === code);
    if (!bucket) {
      bucket = { code, name: shortName(meta.name || code), n: 0, est: 0, cap: Number(meta.cap) || 0, per, samples: [], cost: 1 };
      ready.push(bucket);
    }
    bucket.n += 1;
    bucket.est = Math.min(bucket.cap > 0 ? bucket.cap : Number.POSITIVE_INFINITY, bucket.est + per);
    if (bucket.samples.length < 4 && where) bucket.samples.push(`${where}${why ? "（" + why + "）" : ""}`);
  };

  /* 2.1 凭据：Web / 数据库 两类直接对应得分点 */
  for (const c of state.credentials || []) {
    const host = String(c.host || "");
    if (!host) continue;
    const note = `${c.note || ""} ${c.privilege || ""} ${c.username || ""}`;
    if (DB_HINT.test(`${host} ${note}`)) {
      /* 空口令/未授权一律 10 分/个（规则原文），管理员档才 50 */
      const unit = /admin|root|sa\b|sysdba|管理员/i.test(note) ? 50 : 10;
      readyPush("db-credential", `${host}${c.username ? " / " + c.username : ""}`, String(c.privilege || c.secret_type || "").slice(0, 16), unit, host);
    } else if (looksWebHost(host, note)) {
      const unit = /admin|管理员|超级|root/i.test(note) ? 100 : 50;
      readyPush("web-app", `${host}${c.username ? " / " + c.username : ""}`, String(c.privilege || "普通").slice(0, 12), unit, host);
    } else {
      /* 主机凭据（ssh/rdp）→ 服务器主机权限 */
      const unit = /admin|管理员|root|system/i.test(note) ? 50 : 10;
      readyPush("server-host", `${host}${c.username ? " / " + c.username : ""}`, "凭据", unit, host);
    }
  }

  /* 2.2 会话/访问：已拿到权限但没记分 */
  for (const a of state.accesses || []) {
    const host = String(a.host || a.asset_ip || "");
    if (!host) continue;
    const unit = /admin|管理员|root|system/i.test(`${a.privilege || ""} ${a.username || ""}`) ? 50 : 10;
    readyPush("server-host", `${host}${a.username ? " / " + a.username : ""}`, String(a.method || "访问会话"), unit, host);
  }

  /* 2.3 webshell：明确按服务器主机权限（含 webshell） */
  for (const w of state.webshells || []) {
    const host = String(w.asset_ip || w.url || "");
    if (!host) continue;
    readyPush("server-host", host, "webshell", 50, host);
  }

  /* 2.4 指纹 × 已控主机：**指纹只说明「看到了」，凭据/会话才说明「控住了」**。
     两者同时具备才算「只差记分」；只有指纹的进「差一步」，因为它还差一次利用。
     这条区分是雷达诚实的底线：把「扫到一个 8080」当成分已到手，会让模型停止进攻。 */
  const controlHosts = new Set();
  for (const c of state.credentials || []) controlHosts.add(hostKey(c.host));
  for (const a of state.accesses || []) controlHosts.add(hostKey(a.host || a.asset_ip));
  for (const w of state.webshells || []) controlHosts.add(hostKey(w.asset_ip || w.url));
  controlHosts.delete("");

  const fpGap = []; // 只有指纹、没有控制证据 → 差一步
  for (const [code, samples] of fp) {
    const meta = pointByCode.get(code);
    if (!meta || Number(meta.enabled) === 0) continue;
    for (const s of samples) {
      if (controlHosts.has(hostKey(s.ip))) {
        readyPush(code, s.where, s.why, Number(meta.points) || 0, s.ip);
      } else {
        fpGap.push({ code, name: shortName(meta.name || code), points: Number(meta.points) || 0, cap: Number(meta.cap) || 0, where: s.where, why: s.why });
      }
    }
  }

  /* 2.5 隧道：边界类得分点（逻辑/强隔离），只报「已建立且入口合法」的 */
  const legitTunnels = (state.tunnels || []).filter((t) => t.legit === true || t.legit === 1);
  if (legitTunnels.length) {
    const t = legitTunnels[0];
    readyPush("boundary-logical", String(t.asset_ip || t.listen || "内网入口"), `经 ${t.entry_kind_label || t.entry_kind || "合法入口"}`, 1000, t.asset_ip || t.listen);
  }

  for (const r of ready) r.cost = 1; // ready 的定义就是「只差记分」
  ready.sort((a, b) => b.est - a.est);

  /* ── 三、差一步（gap）：有前置、缺一个动作 ─────────────────── */
  /* 只对「得分点存在、但当前没有任何证据」的条目给动作；没有把握的条目不编。 */
  const hasCode = (code) => hitMap.has(code) || ready.some((x) => x.code === code);
  const gapRules = [
    {
      code: "web-app",
      when: () => (state.assets || []).length > 0 && !hasCode("web-app"),
      todo: "用已有资产跑一遍未授权/弱口令/已知 CVE，拿**一个能登录的后台**（这是最容易变现的一条：100 分/个）",
    },
    {
      code: "server-host",
      when: () => (state.vulns || []).length > 0 && !hasCode("server-host"),
      todo: "把已记的漏洞挑一条能落地的（RCE/文件上传/反序列化）打成 webshell 或 SSH 会话",
    },
    {
      code: "db-credential",
      when: () => (state.assets || []).length > 0 && !hasCode("db-credential"),
      todo: "对 3306/6379/5432/1433 探未授权与弱口令；**空口令也值 10 分/个**，别嫌少不记",
    },
    {
      code: "central-system",
      when: () => hasCode("web-app") && !hasCode("central-system"),
      todo: "从已控的 Web 系统里翻配置/数据库找堡垒机、SSO、域控地址 —— 一条集权管理员就 500 分",
    },
    {
      code: "boundary-logical",
      when: () => (state.accesses || []).length > 0 && !hasCode("boundary-logical"),
      todo: "在已控主机上起隧道（frp/suo5）并**截图证明能访问内网**，这是边界分（1000 分）的证据要求",
    },
  ];
  for (const g of gapRules) {
    let ok = false;
    try { ok = g.when(); } catch { ok = false; }
    if (!ok) continue;
    const meta = pointByCode.get(g.code);
    if (!meta || Number(meta.enabled) === 0) continue;
    /* 指纹已经点名了同一类系统（「10.0.0.5:8080 是堡垒机」比「从 Web 里翻堡垒机」具体得多），
       通用规则就不再重复占一行——同一类给两条指引等于让人自己选，那是把判断推回给模型。 */
    if (fpGap.some((x) => x.code === g.code)) continue;
    gap.push({
      code: g.code,
      name: shortName(meta.name || g.code),
      points: Number(meta.points) || 0,
      cap: Number(meta.cap) || 0,
      todo: g.todo,
      cost: 3,
    });
  }
  /* 指纹点名的机会排在前面：它有具体目标，可直接下手 */
  for (const f of fpGap) {
    gap.unshift({
      code: f.code,
      name: f.name,
      points: f.points,
      cap: f.cap,
      todo: `已经看到 ${f.where}（${f.why || "指纹命中"}）——去打这一台，拿下后 op=score_add point=${f.code}`,
      cost: 3,
    });
  }
  gap.sort((a, b) => b.points - a.points);

  /* ── 四、Top N：按 预期分/成本 排，ready 优先（成本 1） ─────── */
  const pool = [
    ...ready.map((r) => ({ code: r.code, name: r.name, est: r.est, cost: r.cost, kind: "ready", why: `证据已在库里：${r.n} 条` })),
    ...gap.map((g) => ({ code: g.code, name: g.name, est: g.points, cost: g.cost, kind: "gap", why: "差一步" })),
  ];
  const top = pool
    .map((x) => ({ ...x, score: x.est / Math.max(1, x.cost) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const totals = {
    hit_points: hit.reduce((s, x) => s + x.points, 0),
    hit_codes: hit.length,
    ready_points: ready.reduce((s, x) => s + (Number.isFinite(x.est) ? x.est : 0), 0),
    ready_codes: ready.length,
    gap_codes: gap.length,
  };

  return { hit, ready, gap, top, totals };
}

/** 渲染成给人/模型看的多行文本。紧凑优先：默认只印能动手的部分。 */
export function renderRadar(r, opts = {}) {
  const lines = [];
  const t = r.totals || {};
  lines.push(`得分机会雷达：已记分 ${t.hit_points || 0} 分（${t.hit_codes || 0} 类）｜可拿未拿 ${t.ready_points || 0} 分（${t.ready_codes || 0} 类）｜差一步 ${t.gap_codes || 0} 类`);

  if (r.hit.length) {
    lines.push("", "已记分：");
    for (const h of r.hit.slice(0, 8)) {
      const capTxt = h.cap > 0 ? ` / 上限 ${h.cap}` : "";
      lines.push(`  · ${h.code} ${h.name} ×${h.n} = ${h.points} 分${capTxt}${h.targets.length ? "｜" + h.targets.slice(0, 3).join("、") : ""}`);
    }
  }

  if (r.ready.length) {
    lines.push("", "可拿未拿（证据已在库里，只差点一次记分）：");
    for (const x of r.ready.slice(0, opts.limit || 8)) {
      lines.push(`  · ${x.code} ${x.name} ×${x.n} ≈ ${x.est} 分${x.cap > 0 ? `（上限 ${x.cap}）` : ""}`);
      if (x.samples.length) lines.push(`      ${x.samples.join("；")}`);
      lines.push(`      → op=score_add point=${x.code} value=${x.n} text=<账号/回显/数据量>`);
    }
  }

  if (r.gap.length) {
    lines.push("", "差一步：");
    for (const g of r.gap.slice(0, opts.limit || 6)) {
      lines.push(`  · ${g.code} ${g.name}（${g.points} 分）—— ${g.todo}`);
    }
  }

  if (r.top.length) {
    lines.push("", "建议先打（按 预期分/成本 排）：");
    for (const x of r.top) {
      lines.push(`  · ${x.code} ≈ ${Math.round(x.est)} 分｜${COST_LABEL[x.cost] || "成本未知"}｜${x.why}`);
    }
  }

  if (!r.hit.length && !r.ready.length && !r.gap.length) {
    lines.push("", "（还没有可判的机会：先开靶标、跑一轮侦察把资产落库，雷达才有东西可算）");
  }
  return lines.join("\n");
}

/**
 * 一行版，供 summary 的「下一步」内嵌。
 * 为什么要嵌：`summary` 是缺省 op，模型每次开局都会看它；
 * 只把雷达放在 `op=radar` 里等于「有机会但没人看」——和「存了不读等于没存」是同一条。
 */
export function radarOneLine(r) {
  const t = r.totals || {};
  if (!t.ready_codes && !t.gap_codes) return "";
  const parts = [];
  if (t.ready_codes) {
    const head = r.ready.slice(0, 3).map((x) => `${x.code} ≈${x.est}分`).join("、");
    parts.push(`可拿未拿 ${t.ready_points} 分（${head}）`);
  }
  if (t.gap_codes) {
    parts.push(`差一步 ${r.gap.slice(0, 2).map((g) => `${g.code} ${g.points}分`).join("、")}`);
  }
  return `计分机会：${parts.join("｜")}（详见 op=radar）`;
}
