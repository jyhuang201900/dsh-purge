# 侦察流水线：子域 → 解析 → 存活 → 指纹 → 目录，每步的输入输出

> 被 `pentest-tools` 引用。侦察的本质是**收敛**：
> 从"整个互联网"收敛到"几十个真实资产"。每一步都在做减法，减错了后面的攻击全打偏。

## 一、流水线全貌（含数据格式）

```text
① 根域收集      → domains.txt
② 子域枚举      → subs.txt         (subfinder / amass / ksubdomain)
③ 解析与验证    → resolved.txt     (dnsx：A/AAAA/CNAME，剔除通配)
④ 存活探测      → alive.txt        (httpx：状态码/title/tech)
⑤ 端口扫描      → ports.json       (naabu / nmap)
⑥ 指纹识别      → tech.json        (httpx -tech-detect / wappalyzer)
⑦ 目录与备份    → paths.txt        (ffuf / feroxbuster)
⑧ 截图与归档    → shots/           (gowitness / aquatone)
```

| 步骤 | 输入 | 输出 | 关键字段 |
| --- | --- | --- | --- |
| 子域 | `example.com` | 每行一个 FQDN | host |
| 解析 | subs.txt | `host ip cname` | 是否有 A 记录、是否 CNAME 到云 |
| 存活 | resolved.txt | `url status title tech` | 200/301/403、Server 头 |
| 端口 | alive hosts | `host:port proto service` | 非标端口 |
| 指纹 | alive urls | `tech[] cdn waf` | 框架/中间件/CDN |
| 目录 | alive urls | `path status size` | 200/403、`.git`/`.env`/备份 |

## 二、① 根域与② 子域枚举

```bash
# 单域
subfinder -d example.com -all -recursive -o subs_sub.txt
amass enum -passive -d example.com -o subs_amass.txt
ksubdomain enum -d example.com -o subs_ksub.txt -b 5m    # 爆破模式，快

# 多域
subfinder -dL domains.txt -all -recursive -o subs_all.txt

# 合并去重（这一步必须有，否则后面重复扫）
sort -u subs_*.txt > subs.txt
wc -l subs.txt
```

**工具差异**：

| 工具 | 模式 | 优势 | 局限 |
| --- | --- | --- | --- |
| subfinder | 被动（API 聚合） | 覆盖广、快 | 依赖 API key（shodan/censys/virustotal） |
| amass | 被动 + 主动 | 关系图、组织级 | 慢；主动模式会发 DNS 查询 |
| ksubdomain | 爆破 | 极快（无状态） | 需要好字典 |
| dnsgen / alterx | 变异 | 从已知子域生成候选 | 需要组合 |

```bash
# 变异（从已知子域猜新的）
cat subs.txt | dnsgen - | sort -u > subs_candidates.txt
# 解析候选（ksubdomain 的字典爆破/校验请用 `ksubdomain -h` 确认当前版本语法）
dnsx -l subs_candidates.txt -a -resp-only -silent | sort -u
# 或
cat subs.txt | alterx -o subs_mut.txt
```

**判据**：`subs.txt` 里出现 `dev-`、`test-`、`staging-`、`admin-`、`api-`、`internal-`
前缀的，优先级最高（这些环境防护最弱）。

**失败回退**：

| 情况 | 回退 |
| --- | --- |
| subfinder 无结果 | 检查 API key；改用 `-all`；换 `amass -passive` |
| 目标是泛解析 | 见第四节"通配符剔除" |
| 没有根域只有 IP | 用 `fofa`/`shodan` 反查（cert 搜索：`ssl:"example.com"`） |

## 三、③ DNS 解析与验证（dnsx）

**这一步的意义**：过滤掉"存在但没解析"的子域（可能是历史遗留、内部域名），
并识别 CNAME 到云（= 可能有子域接管）。

```bash
# 基本解析
dnsx -l subs.txt -a -aaaa -cname -resp -o resolved.txt
#   -a A记录  -aaaa AAAA  -cname CNAME  -resp 显示响应

# 输出格式：
# www.example.com [1.2.3.4]
# api.example.com [cname.cloudfront.net]

# 只保留有 A 记录的
dnsx -l subs.txt -a -resp-only -silent | sort -u > ips.txt

# 找 CNAME 到可疑云服务（子域接管候选）
dnsx -l subs.txt -cname -resp | grep -iE 'cloudfront|herokuapp|azurewebsites|s3\.amazonaws|github\.io|trafficmanager'

# 查 SPF/DMARC（邮件安全）
dnsx -l domains.txt -txt -resp | grep -i 'v=spf1'
dig TXT _dmarc.example.com +short
```

**输出格式（用于后续）**：

```text
# resolved.txt
www.example.com [A] [1.2.3.4]
api.example.com [CNAME] [api.example.com.cdn.cloudflare.net]
dev.example.com [A] [10.0.0.5]         ← 内网 IP，注意
```

**判据**：
- CNAME 指向**未认领**的云资源（`xxx.s3.amazonaws.com` 但桶不存在）= 子域接管
- A 记录是内网 IP（10./172./192.168.）= DNS 泄露内网，也可能是 SSRF 目标
- 解析到 CDN 的，直接扫 IP 无意义，要带 Host 头

## 四、通配符剔除（不做这步后面全是噪音）

泛解析域名会把任何随机子域解析到同一 IP，导致子域枚举结果全是假的。

```bash
# 手动判定
dig +short $(openssl rand -hex 8).example.com
# 返回 IP = 有泛解析

# massdns 剔除
# 生成随机子域做基线
for i in $(seq 1 20); do echo "$(openssl rand -hex 6).example.com"; done > wild.txt
dnsx -l wild.txt -a -resp-only | sort -u > wild_ips.txt

# 过滤：解析到 wild_ips 的都不算
dnsx -l subs.txt -a -resp -o /tmp/all_resp.txt
grep -vFf wild_ips.txt /tmp/all_resp.txt > resolved_clean.txt
```

**注意**：泛解析的 IP 可能是一个池（多个 IP 轮询），要收集全部 wildcard IP。

## 五、④ 存活与端口

```bash
# httpx（HTTP 存活 + 基础指纹）
httpx -l resolved_clean.txt \
  -ports 80,443,8080,8443,8000,8888 \
  -status-code -title -tech-detect -web-server -cdn -ip \
  -follow-redirects -threads 100 -timeout 10 \
  -json -o alive.jsonl
#   -json 便于后续 jq 处理

# 从 jsonl 提取 URL
jq -r 'select(.status_code != null) | .url' alive.jsonl | sort -u > alive_urls.txt

# 端口扫描（naabu 快，nmap 准）
naabu -list ips.txt -top-ports 1000 -rate 2000 -o ports.txt
# 或指定端口
naabu -list ips.txt -p 80,443,22,3306,6379,9200,27017,5000,8080 -o ports.txt
# 注意：-list 读文件、-host 读单个/逗号列表，以 `naabu -h` 为准

# nmap 精扫（只对 naabu 发现的开放端口）
nmap -Pn -sV -p $(awk -F: '{print $2}' ports.txt | sort -u | paste -sd,) -iL ips.txt \
  --version-light -T4 -oX nmap.xml
```

**为什么先 naabu 再 nmap**：naabu 是无状态 SYN 扫描，速度是 nmap 的 100 倍；
nmap 只用于对已开放端口做服务识别。

**失败回退**：

| 情况 | 回退 |
| --- | --- |
| httpx 全 000 | 目标可能只响应特定 Host/UA；加 `-H "Host: example.com"` |
| 端口全 filtered | 有防火墙；改用 `-sA`（ACK 扫描）判断是否有状态防火墙 |
| CDN 后面的站点 | 扫 IP 无用，改用子域 + Host 头；找源站 IP（历史 DNS、证书透明度） |

## 六、⑤ 指纹识别

```bash
# httpx 内置
httpx -l alive_urls.txt -tech-detect -json -o tech.jsonl
jq -r 'select(.tech != null) | "\(.url)\t\(.tech | join(","))"' tech.jsonl | head

# wappalyzer（Node）
npx wappalyzer-cli -u https://example.com

# whatweb（Ruby）
whatweb -a 3 https://example.com --log-json=whatweb.json

# 按指纹反查（nuclei 的技术识别模板）
nuclei -l alive_urls.txt -tags tech -o tech_nuclei.txt
```

**指纹 → 后续动作的映射表**：

| 指纹 | 下一步 |
| --- | --- |
| `WordPress` | `wpscan`，查插件/主题版本 |
| `Spring Boot` | 打 `/actuator/env`、`/actuator/heapdump` |
| `Nginx` + `X-Accel` | 查 alias 路径穿越 |
| `Jenkins` | `/script`、`/asynchPeople/` |
| `GitLab` | 版本 → CVE；`/explore` |
| `Swagger UI` | `/v3/api-docs` 拿全量 API |
| `Kubernetes`（`/version` 可访问） | 查匿名认证 |
| `Cloudflare` | 找源站，别硬打 |
| `GraphQL` | introspection |

```bash
# Swagger 快速验证
curl -s https://api.example.com/v3/api-docs | jq '.paths | keys | length'
curl -s https://api.example.com/swagger-resources
```

## 七、⑥ 目录与备份文件

```bash
# ffuf（最快）
ffuf -u https://example.com/FUZZ -w /usr/share/wordlists/dirb/common.txt \
  -mc 200,204,301,302,307,401,403 -fs 0 -t 100 -o ffuf.json -of json

# feroxbuster（递归）
feroxbuster -u https://example.com -w wordlist.txt -d 3 -t 50 --json -o ferox.jsonl

# 排除通配响应（必须）
ffuf -u https://example.com/FUZZ -w wordlist.txt -fs $(curl -s https://example.com/random123 | wc -c)
#   -fs 指定"响应大小"，与随机路径一致的就是 404 页面

# 备份与敏感文件（单独一轮）
ffuf -u https://example.com/FUZZ -w backups.txt -mc all -fc 404 -t 50
```

**backups.txt 必须有这些**：

```text
.git/HEAD
.git/config
.env
.env.bak
config.php.bak
web.config.bak
backup.zip
backup.tar.gz
db.sql
dump.sql
www.zip
.DS_Store
.svn/entries
composer.lock
package-lock.json
```

```bash
# 快速验证（不用字典，直接试）
for p in .git/HEAD .env backup.zip db.sql .DS_Store; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://example.com/$p")
  [ "$code" = "200" ] && echo "FOUND: $p"
done

# .git 泄露 → 恢复源码
git-dumper https://example.com/.git/ ./dumped
git -C dumped log --oneline | head
```

**判据**：`.git/HEAD` 返回 200 且内容以 `ref: refs/heads/` 开头 = 真泄露。
返回 200 但是 HTML（SPA 的 fallback）= 假。

## 八、输出收敛（把 5 万行变成 20 个目标）

```bash
# 优先级打分
python3 - <<'PY'
import json
score = []
for line in open('alive.jsonl'):
    d = json.loads(line)
    s = 0
    t = ' '.join(d.get('tech') or [])
    if d.get('status_code') == 200: s += 1
    if any(k in t for k in ['Jenkins','GitLab','Spring','Swagger','WordPress']): s += 3
    if any(k in d['url'] for k in ['admin','api','dev','test','internal','staging']): s += 2
    if d.get('cdn'): s -= 1
    score.append((s, d['url'], d.get('title','')[:40]))
for s,u,t in sorted(score, reverse=True)[:30]:
    print(f"{s}\t{u}\t{t}")
PY
```

## 九、检测视角（防守方）

| 步骤 | 日志 | 信号 |
| --- | --- | --- |
| 子域枚举 | DNS 服务器日志 / 云 DNS 查询日志 | 短时间大量 NXDOMAIN，来自单一源 |
| 爆破 | DNS 日志 | 每秒数百次查询 |
| 端口扫描 | 防火墙 / VPC Flow | 单源对多端口，SYN 无后续 |
| 存活探测 | WAF / web 日志 | 相同 UA（httpx）大量请求 |
| 目录爆破 | web 日志 | 404 洪水，同一 IP |
| `.git` 访问 | web 日志 | `/\.git/` 路径 |
| 指纹识别 | WAF | 请求头里缺正常浏览器特征 |

```bash
# 快速自查（防守方）
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head    # 高频源 IP
grep -c '404' access.log
grep -E '\.git|\.env|backup' access.log | head
```

## 十、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 子域有效 | `dnsx` 有 A 记录，且 `httpx` 返回该域名的真实页面 | 只有 DNS 记录但 HTTP 无响应（可能是内部域名） |
| 存活 | `status_code` 是 200/301/401 且有 `title` | 返回 000（连接失败）或 403 的 CDN 拦截页 |
| 指纹正确 | `tech` 里有版本号，且能访问该技术的特征路径（如 `/actuator`） | 只看到 `Server: nginx`（那是反代，不是应用） |
| 目录存在 | 200 + 内容长度与随机路径不同 | 200 但是 SPA 的 index.html（所有路径都 200） |
| .git 泄露 | `git-dumper` 能完整恢复 `.git` 目录 | 只有 `.git/HEAD` 200，其他 404 |

## 十一、常见坑

1. **不做通配剔除**。泛解析会让子域结果从 200 条膨胀到 5 万条假数据。
2. **httpx 不跟随重定向**。默认 `-follow-redirects` 要显式加，否则看到的全是 301。
3. **扫 CDN 后的 IP**。Cloudflare 的 IP 扫出来全是 CF 的端口，与服务无关。
4. **目录爆破不做 `-fs` 过滤**。SPA 会对所有路径返回 200 + index.html，结果全是假阳性。
5. **忘记扫非标端口**。很多管理后台在 8080/8443/9000，只扫 80/443 会漏。
6. **naabu 的 `-top-ports 1000` 不含 8080**。要显式 `-p` 加常见非标端口。
7. **指纹只看 `Server` 头**。`Server: nginx` 只说明反代，应用框架要看 cookie 名、
   HTML 特征、特定路径。
8. **子域枚举结果不去重**。多个工具输出合并时必须 `sort -u`，否则后续步骤重复计算。