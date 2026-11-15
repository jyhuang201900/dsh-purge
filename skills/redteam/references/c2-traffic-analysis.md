# C2 流量分析（从防守方视角反推怎么改）

被 `c2-framework-ops` 引用。**这一篇的用法是反的**：先知道防守方抓什么，再回头改 profile。
不做这一步就改 profile，等于闭着眼睛调参数。

---

## 一、检测的五个层次（按「多难绕过」排序）

| 层 | 检测什么 | 绕过难度 | 说明 |
| --- | --- | --- | --- |
| **L1 TLS 指纹（JA3/JA4）** | TLS 栈特征 | **极难** | 由 TLS 库决定，改 profile 无效 |
| **L2 流量形态** | 心跳周期、包大小、URI | 易 | profile 可改 |
| **L3 头部一致性** | UA vs Accept vs sec-ch-ua | 易 | profile 可改 |
| **L4 内容特征** | 特定字符串、证书特征 | 中 | 需改 implant 或框架 |
| **L5 行为链** | 首次回连时间、命令间隔 | 中 | 需改工作方式 |

**结论**：**L1 是绕不过的**（除非用 uTLS 伪造 ClientHello，成本极高）。
所以选框架时就该考虑：**目标环境里本来就有什么 TLS 指纹**。

---

## 二、L1：TLS 指纹（最难，也最容易被忽略）

### JA3 / JA4 是什么

```text
JA3 = MD5( TLS版本,密码套件列表,扩展列表,椭圆曲线,EC点格式 )
JA4 = JA3 的改进版（更稳定，且区分 QUIC）

同一个 TLS 库，指纹基本固定：
  · Go crypto/tls     → 一种固定指纹（Sliver 用的）
  · Java JSSE         → 另一种固定指纹（Cobalt Strike 用的）
  · OpenSSL（curl）   → 又一种
  · Chrome/Edge       → 各家浏览器自己的
```

**判据**：**现代 NDR 会「JA3 归类」** —— 不是黑名单，是「这个指纹在当前环境里出现过吗」。
一个内网 5000 台机器从没出现过的 JA3，突然有 3 台在用 → 异常。

### 怎么利用这个认知

```text
① 先看目标环境有什么（如果拿得到流量）
   目标内网有大量 Go 服务（k8s 组件、自研服务）→ Sliver 的 Go 指纹不显眼
   目标内网全是 .NET → 用 C# 写的 implant（指纹融入）
   目标内网全是 Java → CS 的指纹不显眼

② 拿不到目标流量时的默认策略
   用最常见的那个（Chrome 的指纹）—— 但注意：
   你的 implant 不可能真的用 Chrome 的 TLS 栈，除非用 uTLS 伪造

③ 验证自己的指纹
   tshark 可以算 JA3（需 Lua 脚本或用 Zeek）
   或直接看 https://ja3er.com 之类的在线库
```

```bash
# 用 tshark 抓自己的 C2 握手并算 JA3
tcpdump -i eth0 -w c2.pcap 'tcp port 443' &
# ... 等一次心跳 ...
# JA3 需要 tshark 的 ja3 插件或 zeek
zeek -r c2.pcap 2>/dev/null && cat ssl.log | head
```

**这条最容易自欺**：**改 UA 和 URI 完全不影响 JA3**。
很多人以为"profile 改好了就隐蔽了"，实际 TLS 指纹还是原样。

---

## 三、L2：流量形态（profile 能改的部分）

### 正常流量 vs C2 流量的对照

| 特征 | 真浏览器 | 典型 C2 | 判据 |
| --- | --- | --- | --- |
| 请求间隔 | 完全无规律 | **固定周期** | 方差/均值比 < 0.1 = 机器 |
| 请求大小 | 变化大（图片/JS/HTML） | **几乎恒定** | 包长标准差 < 10 字节 = 可疑 |
| URI 多样性 | 一次页面几十个不同 URI | **同一个 URI** | 单 URI 占比 > 90% = 可疑 |
| 并发 | 多个连接并行 | 单连接串行 | |
| 会话时长 | 秒级到分钟级 | 长连接（长轮询） | |
| 上下行比例 | 下载远大于上传 | **上传≈下载** | 比例接近 1 = 可疑 |

### 具体调优

```text
① 心跳间隔 —— 60s 起步，不要更短
   理由：5s 间隔的周期性太明显（一天 17000 次，任何统计都能看出来）

② 抖动 —— ≥30%
   Sliver: --http-c2-jitter 35
   理由：真人的操作间隔有天然抖动；固定间隔是机器特征

③ 请求大小 —— 变化
   框架通常难以控制（包大小由命令输出决定）
   缓解：把大输出分片（每次 ≤ 一定大小），看起来像分页请求

④ URI —— 单一 URI 是最大的形态特征
   缓解：把命令下发和结果回传分开到不同 URI
   或者用「一个看起来像静态资源的 URI + POST body」
```

### 检测方怎么抓（反推）

```text
防守方的三条简单规则（不需要机器学习就能抓到大部分 C2）：
  1) 同一 (src_ip, dst_host, uri) 三元组的请求数 > N/小时，且间隔方差小
  2) 请求包长标准差 < 阈值（内容固定）
  3) 上下行字节比在 0.7-1.3 之间（双向对称）
满足两条 = 高度可疑。

所以规避的核心是：**让这三条都不成立**。
  · 抖动打断周期性（第 1 条）
  · 分片改变包长（第 2 条）
  · 只在有命令时回连（降低频率；第 3 条因为总量小而失效）
```

**最有效的策略**：**长睡眠 + 按需唤醒**。
不心跳，只在需要下命令时才连（框架叫 "interactive mode" 或 "checkin on demand"）。
代价是操作延迟，但检测难度显著上升（没有周期性就没有统计特征）。

---

## 四、L3：头部一致性（最容易做，也最常被漏）

```text
C2 的请求常常是这样（UA 改对了，其他全缺）：
  GET /api/v1/updates HTTP/1.1
  Host: cdn.your-domain.com
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131...

真浏览器是这样：
  GET /api/v1/updates HTTP/1.1
  Host: cdn.your-domain.com
  Connection: keep-alive
  sec-ch-ua: "Chromium";v="131", "Not_A Brand";v="24"
  sec-ch-ua-mobile: ?0
  sec-ch-ua-platform: "Windows"
  Upgrade-Insecure-Requests: 1
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131...
  Accept: text/html,application/xhtml+xml,...
  Sec-Fetch-Site: none
  Sec-Fetch-Mode: navigate
  Sec-Fetch-User: ?1
  Sec-Fetch-Dest: document
  Referer: https://cdn.your-domain.com/
  Accept-Encoding: gzip, deflate, br
  Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
```

**判据**：**「UA 说 Chrome 但缺 sec-ch-ua」比不改 UA 更可疑**。
因为正常 Chrome 一定发 `sec-ch-ua`，缺了就是"伪装"。

```bash
# 最省事的做法：用真浏览器抓一次目标站，把完整 header 抄到 profile 里
curl -s -D - -o /dev/null https://目标站/ | head -20
```

---

## 五、L4：内容特征

| 特征 | 检测方怎么看 | 怎么改 |
| --- | --- | --- |
| 固定 Cookie 值 | 同值不同主机 | 随机化/不设 |
| 证书 self-signed | 证书链不完整 | 用 Let's Encrypt（有效链） |
| 证书 SAN 与访问域名不符 | 明显异常 | 证书必须匹配域名 |
| 特定字符串（框架默认） | YARA/Sigma 规则 | 改 URI/magic bytes |
| 请求体 base64 且固定长度 | 结构一致性 | 变长/压缩后再编 |

**框架默认字符串的坑**：每个框架的默认 profile 都有已知特征（公开在检测规则里）。
例如某些框架默认 URI 是 `/submit.php`、某些的 cookie 名固定。
**上线前必查：你用的框架的默认特征是什么**（搜 `<framework> detection sigma rule`）。

---

## 六、L5：行为链

```text
防守方还会看「行为顺序」：
  · 首次回连时间（implant 落地后多久回连 —— 太快说明是自动执行的）
  · 命令间隔（人为操作的间隔 vs 脚本的固定间隔）
  · 命令内容（`whoami` → `ipconfig` → `net user` 是教科书式的侦察序列）

规避：
  · 不要一上线就执行侦察脚本（等一会儿，或者只做一条命令）
  · 命令之间加人工延迟
  · 不要在同一个 session 上把所有侦察命令跑一遍
```

**判据**：**这是最容易被忽略但最有效的一层**。
防守方的 SOC 会看「一台机器上线 5 分钟内连发 20 条侦察命令」这种模式 —— 这是自动化特征。
人做不到那么快。

---

## 七、验证自己的 profile（必做）

```bash
# ① 抓自己的流量
tcpdump -i eth0 -w mine.pcap 'tcp port 443' &
sleep 130   # 等 2 个心跳
kill %1

# ② 看形态
tshark -r mine.pcap -Y "tls.handshake.type==1" -T fields -e ip.dst | head
tshark -r mine.pcap -Y "http.request" -T fields \
  -e http.request.uri -e http.request.full_uri -e http.user_agent

# ③ 算间隔方差
#    两个心跳之间的时间差是否恒定 → 恒定 = 需要加抖动

# ④ 对比真浏览器
#    把同一 URI 用 curl 访问一次，对比 header 集合
diff <(tshark -r mine.pcap -Y http.request -V | grep -E "^\s+[A-Z].*:") \
     <(curl -s -D - -o /dev/null https://cdn.your-domain.com/api/v1/updates | grep -E "^[A-Z]")
# 判据：diff 越小越像正常流量
```

---

## 八、常见坑

1. **以为改 UA 就够了** —— UA 只是几十个特征里最弱的一个。缺 sec-ch-ua 反而更可疑。
2. **改了 profile 但忘了验证** —— 用上面第七节的流程实测，不要凭感觉。
3. **忽略 JA3** —— 这是最硬的检测点，改 profile 完全无效。
4. **心跳间隔 5s** —— 一天 17000 次请求，任何统计都能看出来。
5. **上下行对称** —— C2 的请求/响应大小接近 1:1，真浏览器的下载远超上传。
6. **一上线就跑侦察脚本** —— 行为链特征。等一会儿，慢点。
7. **用默认 profile** —— 一定有公开检测规则。必改。
8. **同一个 URI 用到底** —— 单一 URI 占比 100% 是最简单的检测规则。