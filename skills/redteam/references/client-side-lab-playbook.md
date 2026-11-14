# 客户端实验手册：本地靶场、代理配置、插件、复现模板

> 被 `pentest-tools` 引用。客户端漏洞（DOM XSS、原型污染、CSRF、postMessage）**必须**在
> 可控环境里验证。本文件给一套能跑起来的本地实验配置。

## 一、本地靶场（三条路，按复杂度排）

### 1.1 Docker + vulhub（最快）

```bash
# 装 vulhub（含大量现成靶场）
git clone https://github.com/vulhub/vulhub.git
cd vulhub

# 起一个靶（例：Node.js 原型污染）
cd node/CVE-2020-XXXX && docker compose up -d
docker compose ps
# 访问 http://127.0.0.1:8080

# 用完清理
docker compose down -v
```

```bash
# 一条命令起 DVWA（最经典的 Web 靶）
docker run --rm -it -p 8080:80 vulnerables/web-dvwa

# juice-shop（OWASP，现代 SPA 靶，适合客户端漏洞）
docker run --rm -p 3000:3000 bkimminich/juice-shop

# WebGoat（Java，含完整教程）
docker run --rm -p 8080:8080 webgoat/goatandwolf

# PortSwigger 的 labs（需在线，但有 Docker 版）
# 用 https://portswigger.net/web-security/all-labs
```

### 1.2 静态页面 + 手写漏洞（最适合 DOM XSS/原型污染）

```bash
mkdir -p /tmp/lab && cd /tmp/lab
cat > index.html <<'EOF'
<!DOCTYPE html>
<html><body>
<h1>DOM XSS Lab</h1>
<div id="out"></div>
<script>
  // 漏洞点：从 hash 取值直接 innerHTML
  const name = decodeURIComponent(location.hash.slice(1));
  document.getElementById('out').innerHTML = 'Hello ' + name;
</script>
</body></html>
EOF
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/#<img src=x onerror=alert(1)>
```

```bash
# 原型污染靶
cat > proto.html <<'EOF'
<!DOCTYPE html><html><body><div id="r"></div>
<script>
function merge(a, b) {
  for (const k in b) {
    if (typeof b[k] === 'object') { a[k] = a[k] || {}; merge(a[k], b[k]); }
    else a[k] = b[k];
  }
  return a;
}
const params = new URLSearchParams(location.search);
const obj = {}; for (const [k,v] of params) obj[k] = v;
merge({}, JSON.parse(params.get('cfg') || '{}'));
document.getElementById('r').textContent = JSON.stringify({}, null, 2);
</script></body></html>
EOF
# http://127.0.0.1:8000/proto.html?cfg={"__proto__":{"polluted":"yes"}}
```

### 1.3 起一个代理捕获 + 改包的最小服务

```javascript
// intercept.js — 用 mitmproxy 的 addon 改响应（比 Burp 更适合脚本化）
// mitmproxy -s intercept.js
const { flow } = require('mitmproxy');
```

```python
# mitm_addon.py — mitmproxy 的 Python addon：注入 JS / 改响应头
from mitmproxy import http

def response(flow: http.HTTPFlow):
    if "text/html" in flow.response.headers.get("content-type", ""):
        flow.response.text = flow.response.text.replace(
            "</body>", "<script>console.log('injected')</script></body>")

def request(flow: http.HTTPFlow):
    if flow.request.path.startswith("/api/"):
        flow.request.headers["X-Debug"] = "1"
```

```bash
# 启动
mitmdump -s mitm_addon.py -p 8081
# 或带 UI
mitmproxy -s mitm_addon.py -p 8081
```

## 二、代理配置（Burp + 浏览器）

### 2.1 Burp 侧

```
Proxy → Options → Proxy Listeners → Add
  Bind to port: 8080
  Bind to address: 127.0.0.1（仅本机，别开 0.0.0.0）
  ☑ Support invisible proxying（处理非代理感知的客户端）

Proxy → Options → Import/Export CA certificate
  → Export → DER → 保存 cacert.der
```

```bash
# 转成 PEM（部分工具需要）
openssl x509 -inform DER -in cacert.der -out cacert.pem

# 看证书内容（确认是 Burp 的）
openssl x509 -in cacert.pem -noout -subject -issuer -dates
```

### 2.2 浏览器侧（三条路）

**路 A：独立 profile（推荐，不污染日常浏览器）**

```bash
# Chromium/Chrome，用独立 profile + 代理
google-chrome --user-data-dir=/tmp/burp-profile \
  --proxy-server=http://127.0.0.1:8080 \
  --ignore-certificate-errors \
  http://burp

# 打开 http://burp 下载 CA，装到该 profile
# 或者直接 --ignore-certificate-errors（仅测试用，别用于日常）
```

**路 B：系统代理**

```powershell
# Windows：设系统代理
netsh winhttp set proxy 127.0.0.1:8080
# 或改 IE 设置（影响 Chrome/Edge）
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" `
  /v ProxyEnable /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" `
  /v ProxyServer /t REG_SZ /d "127.0.0.1:8080" /f
# 还原
netsh winhttp reset proxy
```

**路 C：Firefox（自带证书库，最省事）**

```
Firefox → Settings → Network Settings → Manual proxy → 127.0.0.1:8080
Firefox → Settings → Certificates → View Certificates → Import → cacert.pem
  ☑ Trust this CA to identify websites
```

### 2.3 证书固定的绕过

| 目标 | 方法 |
| --- | --- |
| Electron 应用 | 改 `asar` 里的 pinning 代码，或用 `--ignore-certificate-errors` |
| Android App | Frida hook `SSLContext`/`TrustManager`；或改 `network_security_config` |
| iOS App | Frida/objection；或用 SSL Kill Switch |
| 原生 Windows | Frida hook `CertVerifyCertificateChainPolicy` |
| Flutter | 需 hook BoringSSL 的 `ssl_crypto_x509_session_verify_cert_chain` |
| Go | 需 hook `crypto/tls.(*Conn).VerifyHostname` 或改二进制 |

```bash
# 快速验证是否 pinning：代理后访问，若连接失败但直连成功 → pinning
curl -x http://127.0.0.1:8080 https://target/ -v 2>&1 | grep -iE 'SSL|certificate|verify'
```

## 三、常用插件（Burp / 浏览器）

### 3.1 Burp 插件

| 插件 | 用途 |
| --- | --- |
| **Autorize** | 自动测越权（BOLA/BFLA），配置低权 cookie 后自动重放 |
| **AuthMatrix** | 多角色/多端点矩阵测试 |
| **Turbo Intruder** | 高并发、单包多请求（竞态必用） |
| **HTTP Request Smuggler** | 走私检测 |
| **Param Miner** | 隐藏参数/头爆破（找 `X-Forwarded-*`、缓存键） |
| **Collaborator Everywhere** | 自动在所有请求里插 OOB 域名 |
| **JWT Editor** | JWT 编解码/重签/攻击 |
| **SAML Raider** | SAML 断言编辑/XSW |
| **Logger++** | 全量请求日志 + 过滤 |
| **Hackvertor** | 编码/变换（多层 base64、unicode） |
| **Backslash Powered Scanner** | 基于行为差异的注入检测 |

```
安装：Burp → Extender → BApp Store → 搜索 → Install
（需先装 Jython 才能跑 Python 插件）
```

### 3.2 浏览器扩展

| 扩展 | 用途 |
| --- | --- |
| **Wappalyzer** | 技术栈识别 |
| **FoxyProxy** | 快速切代理 |
| **Cookie-Editor** | 改/加 cookie |
| **EditThisCookie**（旧版） | 同上 |
| **Postman Interceptor** | 捕获请求 |
| **HackBar**（旧） | 手工构造请求 |
| **DOM Invader**（Burp 内置浏览器） | **DOM XSS / 原型污染专用，强烈推荐** |

```
DOM Invader 用法：
Burp 内置浏览器 → 打开目标 → DevTools → DOM Invader 标签
  → 打开 "Canary" 注入，看哪些 sink 被污染
  → "Prototype pollution" 标签可自动检测 gadget
```

### 3.3 命令行工具

```bash
# 录请求（curl 格式）
# Burp → 右键 → Copy as curl command

# 批量重放
cat urls.txt | xargs -P 10 -I{} curl -s -o /dev/null -w '%{http_code} {}\n' -H 'Cookie: ...' {}

# 代理链：请求经 Burp
curl -x http://127.0.0.1:8080 https://target/api/me -H 'Cookie: ...'

# 抓 DNS/流量：用 mitmproxy 的 mitmdump 存 flow
mitmdump -w flows.mitm -p 8081
# 回放
mitmdump -r flows.mitm --set replay=true
```

## 四、复现步骤模板（写进报告用）

```markdown
### 复现步骤

**环境**
- 目标：https://target.example.com（版本 x.y.z，从 `/actuator/info` 确认）
- 身份：普通用户 alice（user_id=1001），已登录
- 工具：Burp Suite 2024.x，Chrome 120

**前置条件**
- 需要两个账号：alice（受害者）、bob（攻击者）
- bob 的 token 已获取（见附录 A）

**步骤**
1. 以 alice 登录，访问 `GET /api/v1/orders`，记录自己的订单 ID `1001`
2. 以 bob 登录，获取 token：`POST /api/v1/auth/login`（见附录 B）
3. 用 bob 的 token 请求 alice 的订单：
   ```
   GET /api/v1/orders/1001 HTTP/1.1
   Host: target.example.com
   Authorization: Bearer <bob_token>
   ```
4. 观察响应：`200 OK`，body 含 `{"id":1001,"user_id":1001,"total":299.00,"address":"..."}`

**预期结果**
- 应返回 `403 Forbidden`
- 实际返回 `200` + alice 的完整订单数据

**证据**
- 请求/响应原文：`evidence/bola_1001.txt`
- 时间戳：2024-01-15 10:23:41 UTC
- 重复验证 3 次均成功（避免偶发）

**影响**
- 任意登录用户可读取任意订单（含收货地址、金额）
- 订单 ID 是自增整数，可全量枚举（估算 120 万条）

**修复建议**
- 在 `OrderController.get()` 中加入 owner 校验：
  `where id = ? and user_id = current_user.id`
- 或在 DAO 层统一加租户/属主过滤
```

## 五、验伤：客户端漏洞的证明

| 漏洞 | 证据 | 假象 |
| --- | --- | --- |
| DOM XSS | `alert()` 弹出 / `document.domain` 被改 / cookie 被读出 | 只是 `<script>` 出现在 HTML 里但没执行（被 CSP 拦/在注释里） |
| 存储型 XSS | 另一浏览器/另一用户打开页面时执行 | 只在提交者自己的页面执行（自我 XSS） |
| 原型污染 | 污染后**有 gadget 触发**（如 `fetch` 被劫持到你的域） | 只是 `Object.prototype` 有值但无影响 |
| CSRF | 从攻击者域发起请求，服务端执行了操作 | 请求发出但被 SameSite/CSRF token 拦 |
| postMessage | 从 iframe 拿到受害者的数据 | 只验证了消息被接收（没看内容） |
| 点击劫持 | 诱导点击后执行了操作 | 只是 iframe 能嵌入（没说清后果） |

**DOM XSS 必须证明"执行"**：

```javascript
// 最硬的证据：把执行结果写到能被外部观测的地方
// 1) 弹窗（人工可验证）
// 2) 请求你的 collector
// 3) 改 document.title（截图可见）
```

## 六、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| 代理探测 | WAF | 异常的 `User-Agent`（Burp 默认 UA）；TLS 指纹不匹配 |
| 客户端漏洞扫描 | WAF | 大量含 `<script>`、`{{`、`__proto__` 的请求 |
| OOB 探测 | DNS/HTTP 日志 | 应用服务器向 Collaborator 域发起请求 |
| 高频重放 | 网关 | 单 IP 高频请求同一端点（Autorize/Intruder） |
| 证书固定绕过 | 客户端 | TLS 校验失败率突增（若客户端上报） |

## 七、常见坑

1. **Burp 的 CA 没装到正确的 profile**——多 profile 时只有当前 profile 生效。用 `--user-data-dir` 隔离。
2. **设备/浏览器缓存了旧证书**——清缓存或换 profile。
3. **HTTPS 站点全红**——CA 没装或装在错误的证书库（Firefox 用自己的库）。
4. **`--ignore-certificate-errors` 后看不到修改的流量**——这个参数让浏览器忽略错误，但仍走代理，应该能看到。若看不到，检查 proxy 设置。
5. **测试污染了生产**——DOM XSS 的 `alert` 在生产环境会骚扰用户。用本地靶场验证技术，生产只做最小证明。
6. **原型污染的 payload 没触发 gadget**——污染本身不等于漏洞。要找代码里会读该属性的地方（`fetch` 的 `headers`、模板引擎的 `escape`）。
7. **CSRF 测试忘了 SameSite**——`SameSite=Lax` 会拦跨站 POST。要测 GET 型操作或 `SameSite=None` 的场景。
8. **报告里没有原始报文**——只写"发现越权"不算。必须有完整的请求行 + 头 + body + 响应的关键片段。