---
name: subdomain-bruteforce
description: 爆破类重活：子域爆破（ksubdomain/OneForAll/dnsx）、全端口与大网段扫描（naabu/masscan），含限速与泛解析过滤
whenToUse: 被动源收不全、或需要把全端口/大网段扫干净时——这类活噪声大，先确认在授权范围内
role: recon
enabled: true
---

# 子域爆破与全端口扫描（重活，先确认范围）

这一档是**噪声最大**的动作：字典一开就是几万到几百万个查询/包。被动源（crt.sh、subfinder、FOFA）收不全时才上，**上之前确认目标在范围内**，否则就是在替别人做全网站点普查。

## 先探工具在不在（别假装有）

```bash
TK=$DSH_HOME/redteam/toolkit
ls $TK/ksubdomain/ksubdomain $TK/oneforall/OneForAll-0.4.5 $TK/dnsx/dnsx $TK/naabu/naabu 2>/dev/null
command -v masscan || where.exe masscan 2>/dev/null || echo "masscan 缺"
# Windows / 无工具箱的机器上这些路径不存在：改用 nmap / Resolve-DnsName / 自写并发脚本，并如实写"缺"
```

## 子域爆破

**① ksubdomain（无状态，最快，不吃本地解析器）**

```bash
$TK/ksubdomain/ksubdomain -d example.com \
  -f /usr/share/seclists/Discovery/DNS/subdomains-top1million-20000.txt \
  --skip \
  -o runs/ksub-example.txt
# 需要 root（自己发原始包）。不能 root 就退回 dnsx。
# 先 2 万条字典过一遍，再决定要不要上 10 万条——top1million 直接跑会把噪声拉满。
```

**② OneForAll（慢但全，自带子收集 + 暴力 + 内容发现）**

```bash
cd $TK/oneforall/OneForAll-0.4.5
test -d .venv || python3 -m venv .venv
.venv/bin/pip install -r requirements.txt 2>/dev/null
.venv/bin/python oneforall.py --target example.com run
# 结果在 results/example.com.csv；有 API 配额时先配 configs/api.py，没配也能跑（会缺若干源）
```

**③ dnsx 爆破 + 泛解析过滤（不能 root 时的主力）**

```bash
# 先测有没有泛解析：随机三级域有解析 = 有
$TK/dnsx/dnsx -d example.com -wd random-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n') -silent
# 有泛解析必须带 -wd（wildcard domain），否则结果全是噪声
cat runs/wordlist-domains.txt | $TK/dnsx/dnsx -silent -a -resp -wd example.com -o runs/dnsx-brute.txt
```

**字典选择**（从小到大，别一上来就最大的）：

```text
/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt     先过一遍
/usr/share/seclists/Discovery/DNS/subdomains-top1million-20000.txt    主力
/usr/share/seclists/Discovery/DNS/dns-Jhaddix.txt                     带常见业务前缀
自建：把已发现子域的高频前缀（api / oa / test / git / jenkins / vpn）拼字典再补一轮
```

## 全端口与大网段

```bash
# 单 IP 全端口（65535）
$TK/naabu/naabu -host 1.2.3.4 -p - -rate 1000 -silent -o runs/ports-full.txt
# 不能 SYN 就 TCP 连：-scan-type c（慢，但无 root 可用）

# 大网段先摸面：masscan 极快，但必须限速率
masscan 10.0.0.0/16 -p1-10000 --rate 10000 -oJ runs/masscan.json
# 拿到开放端口后再交给 nmap 定版本（技能 active-scan），别用 masscan 直接判服务

# 域名清单批量端口
$TK/naabu/naabu -l runs/alive-domains.txt -top-ports 1000 -silent -o runs/ports-top1000.txt
```

**速率红线**：`naabu -rate` 从 1000 起，`masscan --rate` 从 10000 起。**先小范围试 1 分钟看有没有把出口打满或被封**，再放大网段。全端口扫 /16 是几十小时级的活，别默认它会跑完。

## 合并去重

```bash
cat runs/subfinder-*.txt runs/ksub-*.txt runs/dnsx-*.txt 2>/dev/null \
  | tr 'A-Z' 'a-z' | sed 's/\.$//' | sort -u > runs/all-subdomains.txt
# 只保留能解析的（爆破结果一半是死域）
cat runs/all-subdomains.txt | $TK/dnsx/dnsx -silent -a -resp -wd example.com | awk '{print $1}' | sort -u > runs/final.txt
wc -l runs/final.txt
```

## 失败分支

- **爆破 0 结果** → 先确认不是泛解析被 `-wd` 误杀，再确认字典路径存在（`ls /usr/share/seclists/...`），最后换 DNS 服务器（`dnsx -r 1.1.1.1,8.8.8.8`）。
- **ksubdomain 报权限错** → 没 root 或没有原始套接字：改 `dnsx` 或 `nmap --script dns-bruteforce`。
- **naabu 全开所有端口** → 本机出口有透明代理 / 或 `-scan-type c` 连不上被判开：换 SYN，或加 `--verify-host`。
- **masscan 无输出** → 接口/网关不对：`masscan --version` 后加 `-e <iface>`，并确认目标不在同二层（同网段要 `-c 1` 关 ARP 缓存问题）。
- **扫到一半被封** → 立刻降速并改分时段；把已出结果先落库，不要重头再来。

## 落库要求

- 每个新解析到的子域一条 `redteam_asset_add`：`provenance=active`、`tool` 写实际命令（`ksubdomain` / `oneforall` / `dnsx-brute`）、`note` 写"爆破命中，字典 <名字>"。
- 端口结果并进同一资产的 `ports`，**不要为同一 IP 建两条资产**。
- `redteam_chain_add`：`stage_code=recon`，`tool` 写命令原文，`result` 写"字典 N 条 → 命中 M 个 → 可解析 K 个"。
- 爆破量级要如实报：**跑了多大字典、多久、命中几个**——"扫了一圈没有"和"只过了 5000 条"是两个结论。
