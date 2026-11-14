---
name: email-security
description: Use for authorized email security review including phishing analysis, header authentication (SPF/DKIM/DMARC), BEC patterns, and mailbox token abuse research.
whenToUse: Use for authorized email security review including phishing analysis, header authenticatio
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Email Security & Phishing Analysis

## 适用场景

- 钓鱼邮件拆解与 IOC
- SPF/DKIM/DMARC 配置评估
- BEC 商务邮件欺诈模式
- OAuth 应用钓鱼 / 邮箱令牌滥用（联合 llm/cloud 身份）
- 安全意识演练设计（授权）

## 工作流

### 1. 先读原始头（结论都在这 30 行里）

别在客户端界面上分析——界面会隐藏关键字段。拿原始头：

```bash
# Gmail / Outlook 网页版：「显示原始邮件 / View message source」，复制全文存 eml
# 已有 eml 文件时，按 Received 链从下往上读（最下面是发信方，最上面是收信方）
grep -iE "^(Received|Return-Path|From|Reply-To|Message-ID|Authentication-Results|ARC-)" mail.eml
```

**三个必查一致性**（不一致就是伪造的直接证据）：

| 检查 | 正常 | 异常含义 |
| --- | --- | --- |
| `From` 域 vs `Return-Path` 域 | 相同（除营销 ESP 代发） | 不同 = 退信地址被替换，常见于钓鱼 |
| `From` 域 vs `Reply-To` 域 | 相同 | 不同 = **BEC 典型特征**（回复劫持到攻击者邮箱） |
| `Message-ID` 里的域 | 与发信域一致 | 用免费邮箱 ID 冒充企业域 = 伪造 |

### 2. 认证三件套（SPF / DKIM / DMARC）——看"对齐结果"，不看"有没有记录"

这是最容易做错的一步：**有 SPF 记录 ≠ 通过 SPF**。判定要读 `Authentication-Results` 里的 `spf=pass`/`dkim=pass`/`dmarc=pass`，而不是自己去查 DNS 猜。

```bash
# 查发信域的策略（评估配置强弱，不是判定这封信）
dig +short TXT <domain> | grep -E "v=spf1|v=DMARC1"
dig +short TXT _dmarc.<domain>
dig +short TXT <selector>._domainkey.<domain>   # selector 从 DKIM-Signature 头的 s= 取
```

**四条判据**（按危害从高到低）：

1. `v=spf1 +all` 或 `?all` → 任何人都能冒充该域发信（`-all` 才是拒绝）
2. `p=none`（DMARC）→ 只监控不拦截，冒充可送达
3. `sp=none` 且子域未单独配 DMARC → 打子域比打主域容易（`sp` 继承规则）
4. DKIM `s=` 指向的 selector 查不到公钥 → 签名无法验证，等于没签

**注意 `Authentication-Results` 是收信方写的**：如果它缺失或被伪造（自己给自己写 pass），说明投递路径本身可疑，先怀疑中间有邮件网关被绕。

### 3. 链接与附件（不要在本机点）

```bash
# 链接：先解出真实域名，再判是否仿冒（IDN 同形字、连字符、子域欺骗）
grep -oE "https?://[^\"'<> ]+" mail.eml | sort -u
# 仿冒检测：把域名按「注册域」聚合，看是否与品牌域仅差同形字符
python3 -c "
import sys,re
from urllib.parse import urlparse
for u in sys.argv[1:]:
    h=urlparse(u).hostname or ''
    print(u,'->',h)
" $(grep -oE "https?://[^\"'<> ]+" mail.eml | head -20)
```

**三条仿冒特征**：① 同形字（`rn`→`m`、`0`→`o`、西里尔 `а`）；② 品牌名出现在子域（`brand.evil.com`）；③ 超长随机子域（绕过黑名单）。

附件静态分析交给 `malware-analysis`，**不要在本机双击**。先看类型与宏：

```bash
file attachment.*; exiftool attachment.*   # 真实类型可能与扩展名不符
olevba attachment.docm 2>/dev/null | head -40   # 宏源码
```

### 4. 邮箱侧的横向面（比钓鱼本身更值钱）

邮件系统往往是**身份系统的入口**，打进去等于拿到 SSO 的钥匙：

- **OAuth 应用同意钓鱼**：诱导用户给一个恶意应用授权 `Mail.Read`，之后无需口令即可读信。检查租户里 `oauth2PermissionGrants` 有没有异常应用。
- **邮箱委派/转发规则**：攻击者常留一条隐藏转发规则长期收信。查 `Get-InboxRule`、`Get-MailboxPermission`。
- **令牌滥用**：拿到 refresh token 后不依赖 MFA 就能续期。检查异常 `sign-in` 的 `IP/设备` 与 `tokenIssuer`。

```powershell
# Exchange Online（需授权租户）
Get-InboxRule -Mailbox victim@corp.com | Where-Object {$_.ForwardTo -or $_.RedirectTo}
Get-MailboxPermission -Identity victim@corp.com | Where-Object {$_.AccessRights -match "FullAccess"}
```

**判断口径**：钓鱼邮件只是一次投递；**持久化在邮箱侧的规则/委派/授权才是"打进去住下来"**。报告里两者要分开写。

### 5. 自建演练时的合规边界

- **只对自己拥有的域/租户**发测试信，或用户书面授权的目标
- 测试信正文必须带可识别标记（演练编号），便于对方邮件网关放行与事后核对
- 不要用真实品牌 logo/域名做仿冒素材，改用明显虚构的近似域（`examp1e.com`）
- 收件人清单最小化，不发全员

## 检测视角（防守方在哪个日志看到你）

| 手法 | 日志位置 | 信号 |
| --- | --- | --- |
| 批量投递钓鱼 | 邮件网关 / M365 `MessageTrace` | 同主题高频、同发送 IP、收件人跨度大 |
| SPF/DKIM 失败仍送达 | `Authentication-Results` + DMARC 聚合报告 | `spf=fail` 但 `dmarc=pass`（对齐但未认证） |
| 隐藏转发规则 | Exchange `MailboxAudit` / `Set-InboxRule` 事件 | 新建规则 `ForwardTo` 外部域且未告知用户 |
| OAuth 同意 | Entra ID `Consent to application` 审计 | 新应用授予 `Mail.Read`/`offline_access` |
| 同形域 | DNS/代理日志 | 请求域与品牌域编辑距离 ≤2 且注册时间 <30 天 |

## 工具链

| 工具 | 用途 |
|------|------|
| 邮件客户端「查看原始邮件」 | 拿完整头（**第一步，别跳过**） |
| dig / nslookup | SPF / DMARC / DKIM selector 记录 |
| urlscan / 在线沙箱 | 链接与附件动态（隔离环境） |
| olevba / exiftool | 附件宏与元数据静态 |
| Exchange Online PowerShell | 转发规则、委派权限审计 |

## 参考

- `references/email-auth-checklist.md`
- `../malware-analysis/` `../attack-chain/`（钓鱼阶段） `../windows-ad/`（令牌）

## 路由上下文

**上游**: MASTER R36  
**MUST NOT**: 未授权对第三方域群发测试钓鱼

## 任务完成自检

- [ ] 头认证结论是否完整？
- [ ] IOC 是否可检测化（联合 threat-hunting）？
- [ ] Checklist？



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`code-audit`、`database-security`、`llm-security`、`supply-chain-security`

2. **前提没满足就先回去**：`recon-pipeline` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`recon-pipeline`
- **下游**（产出交给谁）：`credential-attack`
- **互补**（同类场景一起用）：`code-audit`、`database-security`、`llm-security`、`supply-chain-security`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
