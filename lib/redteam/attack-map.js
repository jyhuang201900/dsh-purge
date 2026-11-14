/**
 * MITRE ATT&CK 映射表 —— 插件内的**唯一来源**。
 *
 * 为什么要有这张表而不是让每个技能各写各的：
 *   · 编号是外部标准，写错一个数字没人看得出来，但拿去和防守方核对就露馅；
 *   · 战术名会随版本改名（v20 把 Defense Evasion 拆成 Stealth + Defense Impairment），
 *     散落在 119 个文件里就没法一次性对齐。
 *
 * 版本：ATT&CK v20.1（2026-10-13）。**15 个战术**，不是旧版的 14 个。
 *   变化点（容易踩）：TA0005 由 Defense Evasion 改名为 Stealth（隐匿），
 *   并新增 TA0112 Defense Impairment（破坏防御机制）。老文档写"防御规避"= 停在 v17 之前。
 *
 * 纪律：
 *   1. 本表只收录**确实存在**的技术编号；加之前先核对 attack.mitre.org（有闸门守）。
 *   2. 技能的 `## ATT&CK 映射` 段落只能引用本表里的编号 —— 引用不存在的编号会被闸门判红。
 *   3. 战术 id 用 TACTICS，不要另写字面量。
 */

export const ATTACK_VERSION = '20.1'

/* 15 个战术（v20.1）。顺序按 ATT&CK 官方顺序，链式阅读时与红队作业推进一致。 */
export const TACTICS = [
  { id: 'TA0043', en: 'Reconnaissance', zh: '侦察' },
  { id: 'TA0042', en: 'Resource Development', zh: '资源开发' },
  { id: 'TA0001', en: 'Initial Access', zh: '初始访问' },
  { id: 'TA0002', en: 'Execution', zh: '执行' },
  { id: 'TA0003', en: 'Persistence', zh: '持久化' },
  { id: 'TA0004', en: 'Privilege Escalation', zh: '提权' },
  { id: 'TA0005', en: 'Stealth', zh: '隐匿' },
  { id: 'TA0112', en: 'Defense Impairment', zh: '破坏防御机制' },
  { id: 'TA0006', en: 'Credential Access', zh: '凭据访问' },
  { id: 'TA0007', en: 'Discovery', zh: '发现' },
  { id: 'TA0008', en: 'Lateral Movement', zh: '横向移动' },
  { id: 'TA0009', en: 'Collection', zh: '收集' },
  { id: 'TA0011', en: 'Command and Control', zh: '命令与控制' },
  { id: 'TA0010', en: 'Exfiltration', zh: '外带' },
  { id: 'TA0040', en: 'Impact', zh: '影响' },
]

/**
 * 技术编号 → { 名称, 所属战术 }。
 * 只收红队作业里真正会用到的（不是全量 600+ 条）——全量既背不动，也没人查。
 * 需要全量时去 attack.mitre.org，不要在这里堆。
 */
export const TECHNIQUES = {
  /* ── 侦察 ───────────────────────────────────────────── */
  T1595: { name: '主动扫描', tactic: 'TA0043' },
  T1595_002: { name: '漏洞扫描', tactic: 'TA0043' },
  T1592: { name: '主机信息收集', tactic: 'TA0043' },
  T1590: { name: '网络信息收集', tactic: 'TA0043' },
  T1593: { name: '公开信息搜索', tactic: 'TA0043' },
  T1596: { name: '公开数据源检索（搜索引擎/证书）', tactic: 'TA0043' },
  T1594: { name: '搜索目标自建站点', tactic: 'TA0043' },

  /* ── 资源开发 ───────────────────────────────────────── */
  T1583: { name: '获取基础设施', tactic: 'TA0042' },
  T1587: { name: '开发能力', tactic: 'TA0042' },

  /* ── 初始访问 ───────────────────────────────────────── */
  T1190: { name: '利用面向公众的应用', tactic: 'TA0001' },
  T1566: { name: '钓鱼', tactic: 'TA0001' },
  T1078: { name: '有效账号', tactic: 'TA0001' },
  T1195: { name: 'Supply Chain Compromise（供应链入侵）', tactic: 'TA0001' },
  T1200: { name: '硬件投放', tactic: 'TA0001' },
  T1669: { name: 'Wi-Fi Networks（连入无线网络）', tactic: 'TA0001' },

  /* ── 执行 ───────────────────────────────────────────── */
  T1059: { name: '命令与脚本解释器', tactic: 'TA0002' },
  T1059_001: { name: 'PowerShell', tactic: 'TA0002' },
  T1059_003: { name: 'Windows 命令外壳', tactic: 'TA0002' },
  T1059_004: { name: 'Unix Shell', tactic: 'TA0002' },
  T1203: { name: '客户端执行利用', tactic: 'TA0002' },
  T1204: { name: '用户执行', tactic: 'TA0002' },
  T1047: { name: 'WMI', tactic: 'TA0002' },
  T1053: { name: '计划任务/作业', tactic: 'TA0002' },
  T1569: { name: '系统服务', tactic: 'TA0002' },
  T1648: { name: '无服务器执行', tactic: 'TA0002' },

  /* ── 持久化 ─────────────────────────────────────────── */
  T1505: { name: '服务组件', tactic: 'TA0003' },
  T1505_003: { name: 'Web Shell', tactic: 'TA0003' },
  T1136: { name: '创建账号', tactic: 'TA0003' },
  T1543: { name: '创建或修改系统进程', tactic: 'TA0003' },
  T1547: { name: '开机或登录自启', tactic: 'TA0003' },
  T1098: { name: '账号操纵', tactic: 'TA0003' },
  T1137: { name: 'Office 应用启动项', tactic: 'TA0003' },
  T1525: { name: '植入云实例镜像', tactic: 'TA0003' },

  /* ── 提权 ───────────────────────────────────────────── */
  T1068: { name: '利用漏洞提权', tactic: 'TA0004' },
  T1548: { name: '滥用提权控制机制', tactic: 'TA0004' },
  T1134: { name: '访问令牌操纵', tactic: 'TA0004' },
  T1484: { name: '域或租户策略修改', tactic: 'TA0004' },
  T1611: { name: 'Escape to Host（容器逃逸到宿主）', tactic: 'TA0004' },

  /* ── 隐匿（v20 起 Defense Evasion 改名 Stealth）──────── */
  T1070: { name: '清除主机痕迹', tactic: 'TA0005' },
  T1070_004: { name: '删除文件', tactic: 'TA0005' },
  T1027: { name: '混淆文件或信息', tactic: 'TA0005' },
  T1036: { name: '伪装', tactic: 'TA0005' },
  T1055: { name: '进程注入', tactic: 'TA0005' },
  T1014: { name: 'Rootkit', tactic: 'TA0005' },
  T1620: { name: '反射加载代码', tactic: 'TA0005' },
  T1622: { name: '调试器规避', tactic: 'TA0005' },
  T1497: { name: '虚拟化/沙箱规避', tactic: 'TA0005' },
  T1564: { name: '隐藏痕迹', tactic: 'TA0005' },
  T1610: { name: 'Deploy Container（部署容器）', tactic: 'TA0005' },
  T1218: { name: '签名二进制代理执行', tactic: 'TA0005' },
  T1542: { name: 'Pre-OS Boot（固件/引导前持久化）', tactic: 'TA0005' },
  T1140: { name: '去混淆/解码文件或信息', tactic: 'TA0005' },

  /* ── 破坏防御机制（v20 新增 TA0112）────────────────────
     与 Stealth 的区别：Stealth 是"让自己不被看见"，Defense Impairment 是
     "把防守方的机制搞坏/搞瞎"（关 EDR、删日志管道、清告警、破坏备份）。
     老文档把这两类都塞进"防御规避"，v20 起要分开 —— 混着写在按现行标准核对时会对不上。 */
  T1562: { name: '削弱防御', tactic: 'TA0112' },
  T1562_001: { name: '禁用或修改工具', tactic: 'TA0112' },
  T1562_008: { name: '禁用或修改云日志', tactic: 'TA0112' },
  T1490: { name: '禁止系统恢复', tactic: 'TA0112' },

  /* ── 凭据访问 ───────────────────────────────────────── */
  T1003: { name: '操作系统凭据转储', tactic: 'TA0006' },
  T1003_001: { name: 'LSASS 内存', tactic: 'TA0006' },
  T1003_002: { name: 'SAM 数据库', tactic: 'TA0006' },
  T1003_003: { name: 'NTDS.dit', tactic: 'TA0006' },
  T1558: { name: '窃取或伪造 Kerberos 票据', tactic: 'TA0006' },
  T1558_001: { name: 'Golden Ticket', tactic: 'TA0006' },
  T1558_002: { name: 'Silver Ticket', tactic: 'TA0006' },
  T1558_003: { name: 'Kerberoasting', tactic: 'TA0006' },
  T1558_004: { name: 'AS-REP Roasting', tactic: 'TA0006' },
  T1552: { name: '不安全存储的凭据', tactic: 'TA0006' },
  T1552_001: { name: '文件中的凭据', tactic: 'TA0006' },
  T1555: { name: '从密码存储处获取凭据', tactic: 'TA0006' },
  T1040: { name: 'Network Sniffing（网络嗅探）', tactic: 'TA0006' },
  T1110: { name: '暴力破解', tactic: 'TA0006' },
  T1110_003: { name: '口令喷洒', tactic: 'TA0006' },
  T1187: { name: '强制认证', tactic: 'TA0006' },
  T1557: { name: '中间人攻击', tactic: 'TA0006' },
  T1528: { name: '窃取应用访问令牌', tactic: 'TA0006' },
  T1606: { name: '伪造凭据', tactic: 'TA0006' },

  /* ── 发现 ───────────────────────────────────────────── */
  T1087: { name: '账号发现', tactic: 'TA0007' },
  T1018: { name: '远程系统发现', tactic: 'TA0007' },
  T1046: { name: '网络服务发现', tactic: 'TA0007' },
  T1016: { name: '系统网络配置发现', tactic: 'TA0007' },
  T1083: { name: 'File and Directory Discovery（文件与目录发现）', tactic: 'TA0007' },
  T1082: { name: '系统信息发现', tactic: 'TA0007' },
  T1057: { name: '进程发现', tactic: 'TA0007' },
  T1518: { name: '软件发现', tactic: 'TA0007' },
  T1526: { name: '云服务发现', tactic: 'TA0007' },
  T1613: { name: '容器与资源发现', tactic: 'TA0007' },
  T1619: { name: '云存储对象发现', tactic: 'TA0007' },

  /* ── 横向移动 ───────────────────────────────────────── */
  T1021: { name: '远程服务', tactic: 'TA0008' },
  T1021_001: { name: '远程桌面协议', tactic: 'TA0008' },
  T1021_002: { name: 'SMB/Windows 管理共享', tactic: 'TA0008' },
  T1021_004: { name: 'SSH', tactic: 'TA0008' },
  T1550: { name: '使用备用认证材料', tactic: 'TA0008' },
  T1550_002: { name: 'Pass the Hash', tactic: 'TA0008' },
  T1570: { name: '横向工具传输', tactic: 'TA0008' },
  T1563: { name: '远程会话劫持', tactic: 'TA0008' },

  /* ── 收集 ───────────────────────────────────────────── */
  T1005: { name: '本地系统数据', tactic: 'TA0009' },
  T1039: { name: '网络共享数据', tactic: 'TA0009' },
  T1114: { name: '邮件收集', tactic: 'TA0009' },
  T1185: { name: 'Browser Session Hijacking（浏览器会话劫持）', tactic: 'TA0009' },
  T1213: { name: '信息存储库数据', tactic: 'TA0009' },
  T1530: { name: '云存储数据', tactic: 'TA0009' },
  T1560: { name: '归档收集数据', tactic: 'TA0009' },
  T1074: { name: '暂存数据', tactic: 'TA0009' },

  /* ── 命令与控制 ─────────────────────────────────────── */
  T1071: { name: '应用层协议', tactic: 'TA0011' },
  T1071_001: { name: 'Web 协议', tactic: 'TA0011' },
  T1090: { name: '代理', tactic: 'TA0011' },
  T1090_001: { name: '内部代理', tactic: 'TA0011' },
  T1090_003: { name: '多跳代理', tactic: 'TA0011' },
  T1572: { name: '协议隧道', tactic: 'TA0011' },
  T1571: { name: '非标准端口', tactic: 'TA0011' },
  T1105: { name: '入站工具传输', tactic: 'TA0011' },
  T1102: { name: 'Web 服务', tactic: 'TA0011' },
  T1568: { name: '动态解析', tactic: 'TA0011' },
  T1008: { name: '备用信道', tactic: 'TA0011' },

  /* ── 外带 ───────────────────────────────────────────── */
  T1041: { name: 'C2 信道外带', tactic: 'TA0010' },
  T1048: { name: '替代协议外带', tactic: 'TA0010' },
  T1567: { name: 'Web 服务外带', tactic: 'TA0010' },

  /* ── 影响 ───────────────────────────────────────────── */
  T1485: { name: '数据破坏', tactic: 'TA0040' },
  T1486: { name: '影响数据的加密', tactic: 'TA0040' },
  T1489: { name: 'Service Stop（停服务，勒索前置）', tactic: 'TA0040' },
  T1491: { name: '内外涂改', tactic: 'TA0040' },
  T1531: { name: '账号访问移除', tactic: 'TA0040' },
}

/* 编号写法归一：T1059.001 / T1059-001 / T1059_001 都认。
   为什么要归一：技能里手写容易加小数点，一张表里两种写法会让"查不到"变成假红。 */
export function normalizeTechniqueId(raw) {
  const s = String(raw || '').trim().toUpperCase()
  if (s === '') return ''
  const m = /^(T\d{4})(?:[.\-_](\d{3}))?$/.exec(s)
  if (m === null) return s
  return m[2] === undefined ? m[1] : `${m[1]}_${m[2]}`
}

/** 查一条技术：返回 { id, name, tactic, tacticName } 或 null（不存在）。 */
export function lookupTechnique(raw) {
  const id = normalizeTechniqueId(raw)
  const t = TECHNIQUES[id]
  if (t === undefined) return null
  const tac = TACTICS.find((x) => x.id === t.tactic) || null
  return { id, name: t.name, tactic: t.tactic, tacticName: tac === null ? '' : tac.zh }
}

/** 展示用编号：内部键 T1059_001 → 标准写法 T1059.001 */
export function displayTechniqueId(raw) {
  return normalizeTechniqueId(raw).replace('_', '.')
}