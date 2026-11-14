---
name: active-scan
description: 主动端口与服务扫描（nmap/masscan/naabu），严格遵守授权范围与限速
whenToUse: 需要确认资产存活、开放端口与服务版本时
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



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`masscan`、`dirsearch`、`gogo`
- `masscan`：该仓库 release 无任何资产（只发源码）；Windows 上优先用 `naabu`
- `dirsearch`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `gogo`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：1 信息收集｜**角色**：`recon`
- **上游**（先做完这些再进来）：`recon-pipeline`
- **下游**（产出交给谁）：`web-fingerprint`、`nuclei-scan`
- **互补**（同类场景一起用）：`fofa-recon`、`passive-recon`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`asset` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_asset_stats`（收集收口先看断层：C 段数/存活/端口/服务/指纹/溯源条数）、`redteam_asset_get`（深入单个目标：全部端口服务+指纹+采集时间线）、`redteam_asset_graph`（C 段→资产→端口→域名 的拓扑，找横向路径用它而不是肉眼翻列表）、`redteam_asset_timeline`（发现时间线，判断哪些是新冒出来的）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 侦察 | T1595 | 主动扫描 |
| 侦察 | T1595.002 | 漏洞扫描 |
| 发现 | T1046 | 网络服务发现 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
