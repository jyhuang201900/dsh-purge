---
name: industrial-protocol-recon
description: Use for authorized 工控(OT) industrial protocol reconnaissance (IEC-104 / IEC104 / Modbus / DNP3 / S7 / EtherNet-IP / OPC) — passive traffic analysis, Purdue zoning discovery, cross-zone channel hunting, and safe read-only protocol fingerprinting across Modbus/DNP3/S7/EtherNet/IP/OPC.
whenToUse: Use when you need to map an OT network without touching production devices — passive pcap analysis, finding IT/OT boundary crossings, or fingerprinting protocols before deciding whether to do anything active.
source: dsh-purge original（按本仓模板撰写）
---

# 工业协议侦察（被动优先）

`plc-controller-attack` 与 `scada-hmi-attack` 都要"打"，**本技能只"看"**。
它存在的理由：OT 环境里，**被动看一眼的成本是零，主动碰一下的成本是产线停机**。
所以任何 OT 动作之前，先把这一套做完。

## 适用场景

- 拿到一个 OT 网段的镜像流量 / pcap，要判断里面有什么
- 需要画 Purdue 分区图（哪些是 L1/L2/L3，跨区通道在哪）
- 不确定该不该主动探测，先评估风险
- 要找 IT→OT 的跨界通道（通常就在某个双网卡主机上）
- 要给报告提供"资产清单"这一章

## 一、被动优先：三个数据源，按可得性排

| 数据源 | 怎么拿 | 能看到什么 | 风险 |
| --- | --- | --- | --- |
| **pcap / 镜像流量** | 交换机 SPAN、TAP、或已抓好的文件 | 全部协议、全部会话、周期性规律 | **零** |
| **NetFlow / IPFIX** | 路由器/交换机导出 | 谁和谁通信、频率、流量大小（无内容） | 零 |
| **ARP 表 / 交换机 MAC 表** | 只读 SNMP / 登录交换机 | 拓扑、设备厂商（MAC OUI） | 极低 |
| 主动扫描 | nmap 等 | 全（但可能打崩设备） | **高** |

**纪律**：前三个能回答的问题，绝不用第四个。

## 二、从 pcap 里提取资产（不需要碰任何设备）

```bash
# ── 1) 协议分布：先看有哪些工控协议 ──
tshark -r capture.pcap -q -z io,phs | head -40
# 判据：modbus / s7comm / dnp3 / enip / opcua / bacnet 出现哪个，就说明有哪类设备

# ── 2) 会话矩阵：谁在跟谁说话 ──
tshark -r capture.pcap -q -z conv,tcp | head -30
# 判据：按"包数"排序，包数最多的一对通常是 SCADA↔PLC（周期性轮询）
#       周期 100ms-1s 的稳定流量 = 控制回路；突发的 = 组态下载或报警

# ── 3) 设备发现：每个 IP 的协议角色 ──
tshark -r capture.pcap -Y "modbus || s7comm || dnp3 || enip || opcua" \
  -T fields -e ip.src -e ip.dst -e _ws.col.Protocol \
  | sort | uniq -c | sort -rn | head -20

# ── 4) 提取设备标识（Modbus FC43 / S7 的 SZL 查询都在流量里）──
tshark -r capture.pcap -Y "modbus.func_code == 43" -V | grep -iE "Vendor|Product|Model" | head
```

**从 pcap 能直接得到的**（不需要任何主动动作）：

```text
□ 资产清单（IP + 协议角色 + 厂商）
□ 通信关系图（谁轮询谁 = 层级关系 = Purdue 分区）
□ 轮询周期（判断哪条是控制回路，哪条是监视回路）
□ 功能码分布（有没有写操作在跑 → 平时谁在写）
□ 是否有明文凭据（DNP3 的 secure auth、SCADA 的登录）
```

**判据（这条是核心）**：**「谁在周期性轮询谁」就是 Purdue 层级**。
- 周期 100ms-1s、包大小固定、一问一答 → L1↔L2（PLC↔HMI/SCADA 的实时数据）
- 周期 5-60s、包较大 → L2↔L3（SCADA↔历史库/报表）
- 突发、大包、无周期 → 组态下载 / 固件更新 / 工程师操作

## 三、Purdue 分区图（从流量反推，不靠问卷）

```text
L0  现场设备（传感器/执行器）—— 通常看不到 IP
L1  控制器（PLC/RTU）—— 流量特征：被周期性轮询
L2  监督层（HMI/SCADA）—— 流量特征：轮询 L1 + 被 L3 查询
L3  站点运营（历史库/工程站/MES）—— 流量特征：查询 L2、偶发连外
L3.5 DMZ（OT 的对外窗口）—— 流量特征：双向（进 OT、出 IT）
L4  企业 IT —— 通常不在 OT 抓包范围内
```

```bash
# 找跨区通道（L3.5 DMZ 的关键）：同时与两侧通信的主机
# 侧 A = 只跟 502/102/44818 通信的（OT 侧）
# 侧 B = 跟 80/443/135/445 通信的（IT 侧）
tshark -r capture.pcap -q -z conv,tcp -T fields 2>/dev/null > /dev/null
python3 - <<'PY'
import subprocess, collections, re
out = subprocess.run(["tshark","-r","capture.pcap","-q","-z","conv,tcp"],
                     capture_output=True, text=True).stdout
ot_ports = {"502","102","44818","20000","4840","2404","789"}
it_ports = {"80","443","135","445","3389","1433","53"}
peers = collections.defaultdict(lambda: {"ot":set(),"it":set()})
for ln in out.splitlines():
    m = re.match(r"\s*(\S+):(\d+)\s*<->\s*(\S+):(\d+)", ln)
    if not m: continue
    a,p1,b,p2 = m.group(1),m.group(2),m.group(3),m.group(4)
    for host,port,other in ((a,p1,b),(b,p2,a)):
        if port in ot_ports: peers[host]["ot"].add(other)
        if port in it_ports: peers[host]["it"].add(other)
cross = {h:v for h,v in peers.items() if v["ot"] and v["it"]}
print("跨区主机（OT 侧 + IT 侧都通信）：")
for h,v in cross.items():
    print(f"  {h}  OT对端 {len(v['ot'])} 个 / IT对端 {len(v['it'])} 个")
PY
```

**判据**：`ot` 与 `it` 两侧都有对端的主机 = **跨区通道**。
这些主机就是"从 IT 进 OT"的门 —— 通常是一台双网卡的历史库镜像机或跳板机。

## 四、只读主动探测（被动不够用时才做，且必须限速）

当选用的协议在 pcap 里没有（或需要确认当前在线状态）时，才做主动探测。
**参数选择比工具选择重要**：

```bash
# ── 关键：限速 + 单端口 + 单连接 ──
nmap -Pn -sT -T1 --max-rate 5 --max-retries 1 \
  -p 102,502,44818,4840,20000,2404 "$TARGET"
# -T1 = 最慢的时序模板（paranoid 是 T0，会太慢）
# --max-rate 5 = 每秒最多 5 个包（老 PLC 的通信栈缓冲区很小）
# --max-retries 1 = 不重试（重试会让设备累积半开连接）
# -sT = TCP connect（不用 SYN 半开，对嵌入式栈更友好）

# ── 绝对不要用这些参数 ──
# -T4 / -T5        并发太高，老 PLC 会通信栈崩溃
# --script 默认全集  很多 NSE 脚本会发送"探针"，对 PLC 是真实请求
# -sS（SYN 扫描）   部分嵌入式栈对半开连接处理有缺陷
```

**限速的依据（不是保守，是实测）**：多数老 PLC（S7-300 / MicroLogix / 早期 Modicon）
的 TCP 栈只有 4-8 个并发连接槽。超过就丢弃或复位 —— 表现为"扫描后设备离线"，
需要现场重启。这是 OT 扫描最经典的事故。

## 五、协议指纹（只读功能码）

```bash
# ── Modbus（502）FC 43 设备标识 —— 最安全 ──
python3 - <<'PY'
from pymodbus.client import ModbusTcpClient
c = ModbusTcpClient("TARGET"); c.connect()
r = c.read_device_identification(unit=1)     # FC 43，只读
print(r)
c.close()
PY

# ── DNP3（20000）链路层确认 —— 只发链路状态请求 ──
python3 - <<'PY'
# 最小 DNP3 链路层探测（不进入应用层，不读数据点）
# 帧：0x0564 + len + ctrl(0xC0=确认请求) + dst + src + CRC
# 实用做法：用 nmap 的 dnp3-info 脚本（只读）
PY
nmap -Pn -p 20000 --script dnp3-info "$TARGET"

# ── S7（102）SZL 查询 —— 只读 ──
nmap -Pn -p 102 --script s7-info "$TARGET"

# ── EtherNet/IP（44818）ListIdentity —— 只读，几乎无副作用 ──
nmap -Pn -p 44818 --script enip-info "$TARGET"

# ── OPC UA（4840）GetEndpoints —— 只读，不建立会话 ──
python3 - <<'PY'
from asyncua import Client
import asyncio
async def probe():
    c = Client("opc.tcp://TARGET:4840")
    eps = await c.connect_and_get_server_endpoints()
    for e in eps: print(e.EndpointUrl, e.SecurityPolicyUri)
asyncio.run(probe())
PY
```

**判据**：`FC 43` / `s7-info` / `enip-info` / `GetEndpoints` 这四个都是**只读且不改变设备状态**的。
安全边界在这四个之内。超出的（读寄存器内容、读数据点值）需要单独确认 ——
虽然技术上只读，但部分设备对非预期的 unit id / 地址会返回错误并记录异常。

## 六、检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 被动抓包 | **无法检测** | 镜像口不产生流量，交换机不记录 SPAN 会话（除非有人查配置） |
| 跨区主机识别 | 无 | 纯分析流量，无痕迹 |
| 主动扫描 | OT 安全平台 / 交换机 NetFlow | 单源多端口短连接；非常规源 IP |
| 协议指纹查询 | 控制器诊断缓冲区 | 非常规 IP 的连接；非轮询周期的请求 |

**实用推论**：**被动阶段完全不可检测** —— 这是它最大的价值。
所以演练里"我从流量里看到了什么"往往比"我打进了什么"更有说服力：
它证明的是「对方网络的可见性有多差」，而不是「我有多厉害」。

## 七、工具链

| 工具 | 用途 | 本机状态 / 说明 |
| --- | --- | --- |
| `tshark` | pcap 分析（协议分布、会话、字段提取） | 需装（Wireshark 命令行版）；**OT 分析的主力** |
| `nmap` + NSE | 主动指纹（限速参数是重点） | ✓ toolkit 内有 |
| `pymodbus` | Modbus FC43 / 读寄存器 | `pip install pymodbus` |
| `asyncua` | OPC UA GetEndpoints | `pip install asyncua` |
| `scapy` | 自定义工业协议帧（DNP3 等） | `pip install scapy`；灵活但需懂协议 |
| Zeek + ICC 脚本 | 被动协议解析（比 tshark 更适合长期跑） | 需自行部署 |

## 参考（深水区，按需加载）

- `references/industrial-protocol-deep.md` —— Modbus/DNP3/S7/EtherNet/IP 四协议的
  帧结构、功能码全表、只读 vs 写 的精确边界、以及每种协议的"安全探测请求"。
- `references/ot-safe-assessment.md` —— 红线清单与限速参数（任何主动动作前必读）。
- `references/pcap-protocol.md` —— pcap 分析的通用方法（不限于工控）。

## 落库要求

- `redteam_chain_add`：`stage_code=recon`（这一层是侦察），
  `tool` 写数据源（`tshark -z io,phs` / `nmap -T1`）+ 结论摘要。
- 资产清单 → `redteam_asset_add`（IP + 协议角色 + 厂商）。
- **工艺数据（寄存器值、数据点）不要入库** —— 只记「已提取，样本见附件」。

## 任务完成自检

- [ ] 能被动回答的问题，是不是都用被动回答了（不是一上来就扫）？
- [ ] 主动探测用了 `-T1 --max-rate 5 --max-retries 1`（不是默认参数）？
- [ ] 画出了 Purdue 分区图（不是只列 IP 清单）？
- [ ] 找到了跨区主机（`ot` + `it` 两侧都有对端的那台）？
- [ ] 报告里的"资产清单"是从流量来的，还是靠问卷抄的（后者不可信）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 侦察 | T1040 | Network Sniffing（被动抓包） |
| 侦察 | T1595 | Active Scanning（限速主动探测） |
| 发现 | T1046 | Network Service Discovery |
| 发现 | T1018 | Remote System Discovery（跨区主机） |
| 发现 | T1016 | System Network Configuration Discovery |
| 收集 | T1039 | Data from Network Shared Drive |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 第二发（主力打不出去时，按这个顺序换）

1. **pcap 拿不到**（没有镜像口）：转 NetFlow / ARP 表（零风险的替代）
2. **NetFlow 也没有**：只能主动探测，先做**单主机单端口**试探，确认设备不抖再扩
3. **跨区主机找不到**：转 `fscan-intranet`（从 IT 侧扫，找双网卡主机）
4. **需要确认某个协议在不在跑**：转 `industrial-protocol-deep.md`（自定义帧，最精准）

**纪律**：OT 里"再试一次"的成本是产线停机。**任何异常立刻停手并通报**。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：1 信息收集｜**角色**：`recon`
- **上游**（先做完这些再进来）：`fscan-intranet`、`ot-ics`
- **下游**（产出交给谁）：`plc-controller-attack`、`scada-hmi-attack`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`asset` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_asset_stats`（收集收口先看断层：C 段数/存活/端口/服务/指纹/溯源条数）、`redteam_asset_get`（深入单个目标：全部端口服务+指纹+采集时间线）、`redteam_asset_graph`（C 段→资产→端口→域名 的拓扑，找横向路径用它而不是肉眼翻列表）、`redteam_asset_timeline`（发现时间线，判断哪些是新冒出来的）

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`pip`
- `pip`：用 `python -m pip` 代替裸 `pip`

runnability:end -->
