---
name: active-scan
description: 主动端口与服务扫描（nmap/masscan/naabu），严格遵守授权范围与限速
whenToUse: 需要确认资产存活、开放端口与服务版本时
role: recon
enabled: true
---

# 主动端口与服务扫描（nmap / masscan / naabu）

## 前置检查

1. 确认目标 CIDR 在授权范围内（写进回报，不要口头假设）。
2. 确认时间窗口允许主动扫描；全端口 / masscan 属于**高噪声**动作。
3. 确认权限：`nmap -sS`、`naabu` SYN 需要 root，否则 `naabu` 加 `-scan-type c`、`nmap` 退 `-sT`。

## 选型（先想清楚再开枪）

| 场景 | 用什么 | 命令 |
| --- | --- | --- |
| 小网段存活 | `nmap -sn` | `nmap -sn 10.0.1.0/24 -oG runs/live.gnmap` |
| 大网段快速摸端口 | `masscan` | `masscan 10.0.0.0/16 -p1-10000 --rate 10000 -oJ runs/masscan.json` |
| 域名清单存活+端口 | `naabu` | `~/.dsh/redteam/toolkit/naabu/naabu -l runs/alive.txt -top-ports 100 -silent -o runs/ports.txt` |
| 单 IP 全端口 | `nmap` | `nmap -sS -p- --min-rate 1000 -T4 -oX runs/nmap-full.xml <target>` |
| 定版本 / 抓 banner | `nmap` | `nmap -sV -sC -p <ports> -oX runs/nmap-svc.xml <target>` |
| 单端口族 JSON 输出 | `naabu` | `~/.dsh/redteam/toolkit/naabu/naabu -host <ip> -p - -rate 1000 -json -o runs/naabu.jsonl` |

## 命令

```bash
# 全端口（限速，别把机房打死）
nmap -sS -p- --min-rate 1000 -T4 <target> -oX runs/nmap-full.xml

# 只扫 top1000 再定版本（推荐顺序：先摸面，再定点）
nmap --top-ports 1000 -oX runs/nmap-top1000.xml <target>
grep '<port state="open"' runs/nmap-top1000.xml | grep -oE 'portid="[0-9]+"' | cut -d'"' -f2 | paste -sd, - \
  | xargs -I{} nmap -sV -sC -p {} -oX runs/nmap-svc.xml <target>

# UDP 抽查（只抽高价值端口，全 UDP 极慢）
nmap -sU -p 53,123,161,500,1194 -T4 <target>

# 防火墙疑似丢包时：分片 + 随机化 + 慢一点
nmap -f --resume -sS --version-intensity 2 -T2 <target>
```

## 本地已备好的工具（绝对路径，优先用它们，不要手搓）

| 用途 | 命令 |
| --- | --- |
| 端口扫描 | `nmap` / `masscan` / `~/.dsh/redteam/toolkit/naabu/naabu`（SYN 需 root，否则加 `-scan-type c`） |
| 内网综合扫描 | `~/.dsh/redteam/toolkit/fscan/fscan`（技能 fscan-intranet） |
| 内网测绘/指纹 | `~/.dsh/redteam/toolkit/gogo/gogo`（技能 gogo-intranet） |
| HTTP 探测（ProjectDiscovery） | `~/.local/bin/pd-httpx`（**注意：`/usr/bin/httpx` 是 Python httpx 库的 CLI，不是这个**） |
| 子域/解析 | `~/.dsh/redteam/toolkit/subfinder/subfinder`、`~/.dsh/redteam/toolkit/dnsx/dnsx` |
| POC 扫描 | `nuclei`（模板已在 `~/.local/nuclei-templates`） |
| 目录爆破 | `ffuf`、`feroxbuster`、`~/.dsh/redteam/toolkit/dirsearch/dirsearch` |
| 隧道 | `~/.dsh/redteam/toolkit/suo5/suo5-linux-amd64`、`toolkit/chisel/chisel`、`toolkit/frp/{frpc,frps}` |
| 完整清单 | `~/.dsh/redteam/toolkit/清单.md`、`技能工具清单.md` |

`setup.sh` 不下载 dirsearch。`清单.md` 是说明文件，缺了不代表扫描器没装。Windows 与 ARM 构建也不在安装脚本里。

## 失败分支

- **SYN 全开 0 结果** → 权限或抓包设备问题：`naabu -scan-type c` / `nmap -sT` 重试；仍全开则目标在前端 LB 后面，改按服务端口打。
- **masscan 无输出** → 缺网卡或路由：`masscan --version` 后确认接口，必要时 `-e <iface>`。
- **nmap 卡住 / 超时** → 目标限连或防火墙丢包：加 `--open --min-rate 5000 -T4`，或改 `--top-ports 100` 先出结果。
- **无回显但端口确实开**（filter 掉） → 用 `pd-httpx` / `curl -v` 直接验服务层，别只信端口结论。

## 落库要求

- `provenance = active`，`tool = nmap` / `masscan` / `naabu`，记录 scan_run。
- 每个开放端口一条 `redteam_asset_add`：`ports` 里带 `service`、`version`、`product`；banner 原文进 `note`。
- 结论给指挥者时**给数字**：存活主机数 / 开放端口数 / 其中可定版本的服务数 / 疑似高价值项（管理台、数据库、内部服务）。
