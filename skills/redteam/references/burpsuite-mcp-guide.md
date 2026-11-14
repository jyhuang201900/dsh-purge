# Burp 与 MCP 协作：API 暴露面、批量请求、扫描器触发

> 被 `pentest-tools` 引用。Burp 的自动化能力有三层：**REST API（官方）**、**扩展 API（Java/
> Python）**、**MCP Server（第三方）**。三层的适用场景不同。

## 一、三层能力对照

| 层 | 入口 | 能做什么 | 稳定性 |
| --- | --- | --- | --- |
| **REST API** | `http://127.0.0.1:1337/<endpoint>` | 读 scope/sitemap、发起扫描、导出 | 稳定（官方） |
| **扩展 API** | Java/Python（Jython）插件 | 拦截/修改请求、加 Scanner 检查 | 稳定（需写代码） |
| **MCP Server** | `burp-mcp` / `mcp-burp`（第三方） | 让 LLM 直接调 Burp | 视实现 |

```bash
# 确认 REST API 开着
curl -s http://127.0.0.1:1337/ | head -c 200
# 若返回 JSON（如 {"burp_version":"..."} 或 404 带 JSON）→ 开了
# 若连接被拒 → 在 Burp 里开：Settings → Network → REST API → 勾选
```

## 二、REST API：核心端点

```bash
# 官方 API 的常用端点（Burp 2023+）
# 列出可用端点
curl -s http://127.0.0.1:1337/ | jq .

# 注意：不同版本的端点路径不同，先用 / 探
```

| 端点 | 用途 |
| --- | --- |
| `GET /` | 版本与端点列表 |
| `GET /v0.1/scope` | 读 scope |
| `PUT /v0.1/scope` | 设 scope |
| `GET /v0.1/sitemap` | 读 sitemap（所有已发现的 URL） |
| `POST /v0.1/scan` | 对某 URL 发起扫描 |
| `GET /v0.1/scan/{id}` | 查扫描状态 |
| `GET /v0.1/scan/{id}/issues` | 读扫描结果 |

```bash
# 读 sitemap（最有用的一个：拿到所有已抓到的 URL）
curl -s http://127.0.0.1:1337/v0.1/sitemap | jq -r '.[].url' | sort -u > urls.txt

# 设 scope
curl -s -X PUT http://127.0.0.1:1337/v0.1/scope \
  -H 'Content-Type: application/json' \
  -d '{"include":[{"enabled":true,"protocol":"https","host":"target.example.com","port":443}]}'

# 发起主动扫描
curl -s -X POST http://127.0.0.1:1337/v0.1/scan \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://target.example.com/api/v1/users"]}' | jq .
```

**注意**：REST API 的路径在版本间有变化。先 `GET /` 拿真实路径，不要照抄教程。

## 三、批量请求（三种方式）

### 3.1 Repeater 批量（手工但可控）

```
Burp → Repeater → 右键 → "Send to Repeater" 多个请求
或用 Tab 分组，Ctrl+Enter 逐个发
```

### 3.2 Intruder 批量（参数化）

```
Positions: 标 payload 位置
Payloads: 列表/规则
Options: 并发数（默认 1，改 10-20）、延迟
```

```bash
# 从 REST API 或扩展批量发（更可控）
# 例：用 Python 直连目标（不经过 Burp），但复用 Burp 抓到的 cookie
python3 - <<'PY'
import requests
s = requests.Session()
s.headers.update({'Cookie': 'session=...'})
for uid in range(1000, 1020):
    r = s.get(f'https://target/api/v1/users/{uid}')
    print(uid, r.status_code, len(r.content))
PY
```

### 3.3 Turbo Intruder（并发场景必用）

```python
# Turbo Intruder 的 gate 机制：所有请求同时放行
def queueRequests(target, wordlists):
    engine = RequestEngine(endpoint=target.endpoint,
                           concurrentConnections=1,
                           engine=Engine.BURP2)     # HTTP/2
    for w in wordlists.getWordlist():
        engine.queue(target.req, w, gate='g1')
    engine.openGate('g1')

def handleResponse(req, interesting):
    table.add(req)
```

**Turbo Intruder 是竞态测试的唯一正确工具**（见 `race-condition-state-drift`）。

## 四、Scanner 的手动触发

```bash
# ① 对单个 URL 扫描（REST API）
SCAN_ID=$(curl -s -X POST http://127.0.0.1:1337/v0.1/scan \
  -H 'Content-Type: application/json' \
  -d '{"urls":["https://target/api/v1/users/1001"]}' | jq -r '.scan_id')
curl -s "http://127.0.0.1:1337/v0.1/scan/$SCAN_ID" | jq '{status, issue_events}'
curl -s "http://127.0.0.1:1337/v0.1/scan/$SCAN_ID/issues" | jq '.issues[] | {name,severity,url}'
```

```
# ② 从 Repeater 手动触发
右键请求 → "Scan" → 选择 audit/scan → 等结果出现在 Dashboard
```

```
# ③ 从 Proxy 历史批量选
Proxy → HTTP history → 选中多条 → 右键 → "Scan selected items"
```

**scanner 的两个开关**（决定跑不跑）：

```
Settings → Scanner → Attack insertion points（要不要测参数）
Settings → Scanner → Scan accuracy（Fast / Normal / Thorough）
```

## 五、MCP Server（让 LLM 直接操作 Burp）

### 5.1 常见的 MCP 实现

| 项目 | 能力 |
| --- | --- |
| `burp-mcp`（社区） | 读 sitemap、发请求、取扫描结果 |
| `mcp-burp`（社区） | 类似，接口不同 |
| Burp 官方 MCP（新版） | 官方支持的子集 |

```json
// 配置示例（Claude Desktop / 通用 MCP 客户端）
{
  "mcpServers": {
    "burp": {
      "command": "npx",
      "args": ["-y", "burp-mcp"],
      "env": {
        "BURP_API_URL": "http://127.0.0.1:1337",
        "BURP_API_KEY": "your-api-key"
      }
    }
  }
}
```

```bash
# 验证 MCP 是否连通
# 在客户端里让它调 "list burp endpoints" 或 "get sitemap"
```

### 5.2 MCP 的适用与不适用

| 适合 | 不适合 |
| --- | --- |
| 批量读 sitemap/扫描结果 | 需要精确控制时序的（竞态） |
| 让 LLM 汇总扫描发现 | 需要改包细节的（用 Repeater） |
| 快速探活/枚举 | 高并发（用 Turbo Intruder） |
| 生成报告草稿 | 需要判断的利用链 |

**关键限制**：MCP 通常是"薄封装"，能力受限于 Burp 的 REST API。REST API 没有的能力
（如精确的并发控制、请求拦截）MCP 也没有。

## 六、扩展 API（写插件）

### 6.1 Java 扩展骨架

```java
// BurpExtender.java
import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.http.HttpHandler;

public class BurpExtender implements BurpExtension {
    @Override
    public void initialize(MontoyaApi api) {
        api.extension().setName("MyExt");
        api.http().registerHttpHandler(new HttpHandler() {
            @Override
            public RequestToBeSentAction handleHttpRequestToBeSent(HttpRequestToBeSent req) {
                // 在请求发出前修改
                if (req.url().contains("/api/")) {
                    return RequestToBeSentAction.continueWith(
                        req.withAddedHeader("X-Debug", "1"));
                }
                return RequestToBeSentAction.continueWith(req);
            }
        });
    }
}
```

```bash
# 编译（需要 burp-extender-api.jar）
javac -cp burp-extender-api.jar BurpExtender.java
jar cf myext.jar BurpExtender.class
# 加载：Extensions → Add → Java → 选 myext.jar
```

### 6.2 Python（Jython）扩展

```python
# burp_ext.py
from burp import IBurpExtender, IHttpListener

class BurpExtender(IBurpExtender, IHttpListener):
    def registerExtenderCallbacks(self, callbacks):
        self._cb = callbacks
        self._hp = callbacks.getHelpers()
        callbacks.setExtensionName("PyExt")
        callbacks.registerHttpListener(self)

    def processHttpMessage(self, tool, is_request, msg):
        if not is_request:
            return
        req = self._hp.bytesToString(msg.getRequest())
        if '/api/' in req and 'X-Debug' not in req:
            new = req.replace('\r\n\r\n', '\r\nX-Debug: 1\r\n\r\n', 1)
            msg.setRequest(self._hp.stringToBytes(new))
```

```
# 加载：Extensions → Add → Python → 选 burp_ext.py（需先配 Jython jar）
```

## 七、把 Burp 接进脚本流水线

```bash
# 场景：Burp 做代理，脚本做批量验证
# 1) Burp 监听 8080
# 2) 脚本通过 Burp 发请求（这样能在 Burp 里看到、能复用 session）
export http_proxy=http://127.0.0.1:8080
export https_proxy=http://127.0.0.1:8080

# requests 需要显式指定 proxies + verify=False
python3 - <<'PY'
import requests
proxies = {'http':'http://127.0.0.1:8080','https':'http://127.0.0.1:8080'}
r = requests.get('https://target/api/v1/me', proxies=proxies, verify=False,
                 headers={'Cookie':'session=...'})
print(r.status_code, r.text[:200])
PY
```

```bash
# 场景：从 Burp 导出 → 脚本批改 → 回灌
# 1) 从 Proxy history 导出（Save items）
# 2) 用 Python 批改
# 3) 用 curl/requests 重发
```

## 八、验伤：协作是否有效

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| REST API 可用 | `GET /` 返回端点列表 | 端口开着但需 API key |
| 批量请求生效 | 目标日志有对应请求 | 请求被代理拦（scope 外） |
| Scanner 真的跑了 | Dashboard 有 issue | 只加了扫描任务但没执行 |
| MCP 可用 | LLM 能列出 sitemap | 只连上但工具不可用 |
| 扩展生效 | 请求头里有你加的标记 | 扩展加载失败（看 Extender 输出） |

## 九、检测视角（Burp 流量在防守方看来）

| 信号 | 特征 |
| --- | --- |
| TLS 指纹（JA3/JA4） | Burp 的 Java TLS 栈与浏览器不同；JA3 有独特值 |
| 证书 | Burp 的 CA（`PortSwigger CA`）在客户端信任链里；若代理到目标则无影响 |
| UA | Burp 默认 `User-Agent` 会去掉部分浏览器特征（若配置不当） |
| 请求顺序 | Intruder/Turbo 的固定间隔与顺序 |
| 请求头顺序 | 大小写/顺序与浏览器不一致（`Host` 不在首位等） |
| `X-Forwarded-For` | 若 Burp 加了 `X-Forwarded-For: 127.0.0.1` |

```bash
# 检查自己经 Burp 发出的请求头顺序
curl -s -x http://127.0.0.1:8080 https://httpbin.org/headers | jq '.headers'
```

**降噪**：Burp 的 `Proxy → Options → Match and Replace` 可以把 UA/头顺序改得像浏览器。

## 十、常见坑

1. **REST API 端点路径照抄教程**——版本变了。先 `GET /` 拿真实路径。
2. **API key 没配**——REST API 默认可能要 key。看 Burp 的 REST API 设置页。
3. **scope 没设就批量打**——Burp 会拦 scope 外的请求（或 Scanner 不跑）。先 `PUT /scope`。
4. **Intruder 并发默认 1**——很慢。改到 10-20（但注意别触发 WAF）。
5. **Scanner 的 insertion points 没开**——只扫 URL 不扫参数，漏掉大部分注入。
6. **Jython 没配**——Python 扩展加载失败。Extensions → Settings → Python Environment 指向 jython jar。
7. **MCP 期待过高**——它只是 REST API 的封装，能力不会超过 REST API。
8. **Turbo Intruder 用 HTTP/1.1 做竞态**——必须 `Engine.BURP2`（HTTP/2）才能真并发。