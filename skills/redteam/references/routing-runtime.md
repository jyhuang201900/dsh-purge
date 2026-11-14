# Web 运行时判断：从响应特征认出框架、版本与 debug 模式

> 被 `competition-web-runtime` 引用。运行时判断的价值在于**把攻击面从"通用 payload"收窄到
> "这个版本已知的问题"**。判断错比不判断更糟——按错框架打会浪费整轮时间。

## 一、三层判据（从粗到细）

| 层 | 依据 | 可信度 | 例 |
| --- | --- | --- | --- |
| L1 语言/服务器 | `Server`、`X-Powered-By`、错误页格式 | 中（可伪造/可剥离） | `Server: nginx/1.24.0` |
| L2 框架 | cookie 名、错误页结构、静态资源路径、header 顺序 | 高 | `JSESSIONID` → Java；`_rails_session` → Rails |
| L3 版本 | 静态资源 hash、特定 header、错误页里的路径、行为指纹 | 中高（需交叉验证） | `/_next/static/<buildId>/` |

```bash
# 一次拿全基础特征
curl -sI https://target.example.com/ | tee headers.txt
curl -s https://target.example.com/ | head -c 2000 > body.html
curl -s -i https://target.example.com/nonexistent-xyz-123 | head -40 > err404.txt
cat headers.txt
```

## 二、L1：服务器与语言

```bash
# header 里的线索
curl -sI https://target/ | grep -iE 'server|x-powered-by|x-aspnet|x-runtime|x-generator|via|x-cache'
```

| 值 | 指向 |
| --- | --- |
| `Server: nginx/1.24.0` | nginx（版本号常被 `server_tokens off` 隐藏） |
| `X-Powered-By: PHP/8.1.2` | PHP（`expose_php=On` 时暴露） |
| `X-Powered-By: Express` | Node/Express |
| `X-AspNet-Version: 4.0.30319` | ASP.NET（.NET Framework） |
| `X-AspNetMvc-Version` | ASP.NET MVC |
| `Server: Kestrel` | ASP.NET Core |
| `Server: Werkzeug/2.2.2 Python/3.10.6` | Flask **开发服务器**（生产不该出现） |
| `X-Generator: Drupal 10` | Drupal |

**注意**：`Server` 可被任意伪造/剥离。只看它判断会错。必须与 L2 交叉。

## 三、L2：框架识别（cookie + 错误页 + 静态路径）

### 3.1 Cookie 名（最可靠）

| Cookie | 框架 |
| --- | --- |
| `JSESSIONID` | Java（Tomcat/Jetty/Spring） |
| `PHPSESSID` | PHP |
| `ASP.NET_SessionId` | ASP.NET（Framework） |
| `.AspNetCore.Session` / `.AspNetCore.Antiforgery.*` | ASP.NET Core |
| `connect.sid` | Express（`express-session`） |
| `_session_id` / `_<app>_session` | Rails |
| `laravel_session` / `XSRF-TOKEN` | Laravel |
| `django_session` / `csrftoken` | Django |
| `flask_session` | Flask（flask-session） |
| `ci_session` | CodeIgniter |
| `wordpress_*` / `wp-settings-*` | WordPress |
| `__Host-` / `__Secure-` 前缀 | 现代应用（安全属性） |

```bash
# 触发一次会设置 cookie 的请求
curl -sI https://target/login | grep -i set-cookie
curl -s -c jar.txt https://target/ -o /dev/null && cat jar.txt | grep -v '^#'
```

### 3.2 错误页结构

```bash
curl -s https://target/this-does-not-exist-xyz | head -60
```

| 特征 | 框架 |
| --- | --- |
| `Whitelabel Error Page` + `There was an unexpected error` | **Spring Boot** |
| 蓝色调试页 + `Traceback (most recent call last)` | **Django**（DEBUG=True） |
| `Werkzeug Debugger` + 交互式 console | **Flask**（debug 模式） |
| `Whoops! There was an error` | Laravel |
| `Yii Framework` / `yii\base\ErrorException` | Yii |
| `Rails` + `Routing Error` | Rails |
| `Cannot GET /path`（纯文本） | **Express** 默认 404 |
| `nginx` 的 `404 Not Found` 页（居中、`nginx/x.y.z`） | nginx 静态 |
| `Apache/2.4.x (Ubuntu) Server at ... Port 80` | Apache |
| `An error occurred` + `Request ID: ...` | Next.js / 通用 SSR |
| `Fatal error: Uncaught ... in /var/www/...` | PHP（display_errors=On） |

### 3.3 静态资源路径（版本线索最强）

| 路径模式 | 框架 | 版本线索 |
| --- | --- | --- |
| `/_next/static/<buildId>/_buildManifest.js` | Next.js | buildId 可用于对比已知漏洞 |
| `/static/js/main.<hash>.js` | Create React App | hash 对应构建版本 |
| `/assets/index-<hash>.js` | Vite | — |
| `/packs/js/application-<hash>.js` | Rails Webpacker | — |
| `/_nuxt/<hash>.js` | Nuxt | — |
| `/build/assets/...` | Laravel Vite | — |
| `/site_media/static/...` | Django（旧） | — |
| `/static/admin/css/base.css` | Django admin | `base.css` 内容含版本注释 |
| `/wp-content/`, `/wp-includes/` | WordPress | `/wp-includes/js/wp-emoji-release.min.js` 里有 `wp-emoji-release` 版本串 |
| `/sites/default/files/` | Drupal | — |

```bash
# Next.js 的 buildId
curl -s https://target/ | grep -oE '"buildId":"[^"]+"' | head -1
curl -s https://target/_next/static/$(curl -s https://target/ | grep -oE '"buildId":"[^"]+"' | head -1 | cut -d'"' -f4)/_buildManifest.js | head -c 500

# WordPress 版本（多种来源）
curl -s https://target/ | grep -oE 'content="WordPress [0-9.]+"' | head -1
curl -s https://target/readme.html | grep -oE 'Version [0-9.]+' | head -1
curl -s https://target/wp-includes/js/wp-emoji-release.min.js | head -c 100

# Django admin 的版本
curl -s https://target/static/admin/css/base.css | grep -oE 'Django v[0-9.]+' | head -1
```

## 四、Debug 模式的六个特征

这是最高价值的判断：debug 模式等于**信息泄露 + 常常等于 RCE**。

| 特征 | 怎么看 | 后果 |
| --- | --- | --- |
| 详细堆栈 | 触发异常看响应 | 泄露路径、依赖版本、源码片段 |
| 环境变量 | `/debug`、`/actuator/env`、Django 的 settings 页 | 密钥、DB 口令 |
| 交互式 console | Flask 的 `Werkzeug Debugger` 有 `>>>` | **直接 RCE** |
| SQL 回显 | 触发 DB 错误 | 表结构、注入辅助 |
| 模板源码 | 触发模板错误 | 模板路径、可用对象 |
| 配置页 | `/__debug__/`（Django Debug Toolbar） | 全量 SQL、settings |

```bash
# 触发一个异常（找会 500 的输入）
curl -s "https://target/api/items/abc" | head -60
curl -s "https://target/api/items/%00" | head -60
curl -s -X POST https://target/api/items -H 'Content-Type: application/json' -d '{"id":[]}' | head -60
```

```bash
# Spring Boot Actuator（最高价值）
for e in env health info mappings beans heapdump threaddump configprops loggers; do
  printf '%-12s ' "$e"
  curl -s -o /dev/null -w '%{http_code}\n' "https://target/actuator/$e"
done

# env 里找关键项
curl -s https://target/actuator/env | jq -r '.. | objects | select(.value?) | "\(.value)"' 2>/dev/null | grep -iE 'password|secret|key|token' | head
```

```bash
# Django DEBUG=True 的判定：故意 404 一个不存在的 URL
curl -s https://target/nonexistent-abc/ | grep -cE 'Traceback|DEBUG = True|You.re seeing this error because you have'
# >=1 → DEBUG 开启
```

```bash
# Flask 的 Werkzeug console（交互式）
curl -s "https://target/console" | grep -c 'Werkzeug Debugger'
# 若能拿到 console 的 PIN，就能执行任意 Python
# PIN 算法：machine-id + mac + cgroup 等，见 werkzeug 源码
```

```bash
# Laravel 的 debug（APP_DEBUG=true）
curl -s https://target/nonexistent | grep -cE 'Whoops|Ignition|APP_DEBUG'
```

## 五、版本确认的交叉验证

单点判断极易错。用**三个独立信号**确认同一个结论：

```bash
# 例：确认 Spring Boot
# ① 错误页
curl -s https://target/xyz | grep -c 'Whitelabel Error Page'
# ② cookie
curl -sI https://target/ | grep -c JSESSIONID
# ③ 静态资源
curl -sI https://target/webjars/springfox-swagger-ui/ | head -1
# ④ Actuator
curl -s -o /dev/null -w '%{http_code}\n' https://target/actuator/health
```

**四项里有 3 项命中 → 结论可信**。只有 1 项 → 存疑，继续找。

```bash
# 用 whatweb / wappalyzer（批量）
whatweb -a 3 https://target
# 或用 nuclei 的 tech detect 模板
nuclei -u https://target -t http/technologies/ -silent
```

## 六、判断错误后的纠正

| 误判 | 症状 | 纠正动作 |
| --- | --- | --- |
| 以为是 Java，实际是 Node（反向代理伪装） | Spring payload 全 400，但 Express 的 `Cannot GET` 出现 | 直接打 `/nonexistent` 看 404 文案 |
| 以为是 PHP，实际是 Java（PHP 后缀路由） | `.php` 返回 404 但 `.jsp` 也 404 | 看 cookie；看 `X-Powered-By` 是否为空 |
| 版本判断错（`Server` 被改） | 按旧版本 payload 打不通 | 用静态资源 hash/内容做版本判断 |
| 把 CDN 当源站 | 所有路径都返回 CDN 的错误页 | 找源站 IP（证书透明度、DNS 历史、子域） |
| debug 模式判断错（自定义错误页） | 以为有堆栈，实际是设计好的错误页 | 触发**多种**异常（类型/参数/SQL），看是否有差异 |

```bash
# 绕过 CDN 找源站
# ① 证书透明度日志
curl -s "https://crt.sh/?q=target.example.com&output=json" | jq -r '.[].name_value' | sort -u
# ② 历史 DNS
# ③ 子域里找非 CDN 的
for s in origin direct backend internal dev staging; do
  ip=$(dig +short $s.target.example.com)
  [ -n "$ip" ] && echo "$s -> $ip"
done
```

## 七、验伤：运行时判断的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 框架是 X | ≥3 个独立信号一致（cookie + 错误页 + 静态路径） | 只有 `Server` 头 |
| 版本是 Y | 静态资源内容里有版本串，或行为与该版本一致 | 只看 `Server: nginx/1.24`（这是 nginx 版本，不是应用版本） |
| debug 开启 | 响应里有**真实堆栈**（含文件路径、行号） | 自定义错误页含 "error" 字样 |
| Actuator 暴露 | `/actuator/env` 返回 JSON 且含敏感值 | 返回 404 页但状态码 200（SPA fallback） |
| console 可用 | 能执行代码（如 `1+1` 返回 `2`） | 只看到 console 页面但 PIN 锁着 |

## 八、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 框架探测 | WAF | 大量请求打到 `/nonexistent`、`/actuator/*`、`/.env` |
| 错误页触发 | 应用日志 | 短时间内多种异常类型（参数/类型/SQL） |
| Actuator 探测 | 应用审计 | `/actuator/env`、`/actuator/heapdump` 访问 |
| debug console | 应用日志 | `/console` 访问；Werkzeug 的 PIN 尝试 |
| 静态资源枚举 | CDN/网关 | 对 `_next/static/*` 的大量 404 |
| 版本指纹收集 | 无直接信号 | 需靠 WAF 规则匹配 UA/请求模式 |

## 九、常见坑

1. **只看 `Server` 头**——它常被改、被剥离、或被 CDN 覆盖。`Server: nginx` 只说明边缘是 nginx。
2. **把 CDN 的错误页当源站**——Cloudflare 的 1020/1015 页面与源站无关。先确认是否在 CDN 后面。
3. **版本判断用 `Server` 的应用版本**——`nginx/1.24` 是 nginx 版本，不是 PHP/Java 版本。应用版本要从静态资源/错误页/`X-Powered-By` 拿。
4. **SPA fallback 干扰判断**——所有路径都 200 + HTML。用 `Accept: application/json` 区分。
5. **debug 判断只试一种异常**——有些错误页是定制的，只有特定异常（如 SQL）才出堆栈。多试几种。
6. **`/actuator` 返回 200 就是暴露**——可能是 SPA fallback。看 `Content-Type: application/json` 和实际内容。
7. **忽略 header 顺序**——某些框架的 header 顺序固定（如 Tomcat 的 `Content-Type` 在前），可作为辅助指纹。
8. **判断完不记录**——判断结论必须写进证据（"基于 cookie JSESSIONID + Whitelabel 错误页 + /actuator/health 200 判定 Spring Boot"），否则无法复核。