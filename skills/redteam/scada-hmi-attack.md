---
name: scada-hmi-attack
description: Use for authorized 工控(OT) SCADA and HMI layer assessment — thick-client HMI credentials, historian databases, OPC UA/DA exposure, and engineering-workstation lateral movement.
whenToUse: Use when the target has SCADA supervisory systems, HMI panels, historians (PI/InfluxDB/Historian), or OPC servers — the layer above PLCs, where credentials and process data concentrate.
source: dsh-purge original（按本仓模板撰写）
---

# SCADA / HMI 监督层专项

`plc-controller-attack` 讲控制器（现场层）；**本技能讲监督层** ——
HMI、SCADA 服务器、历史库、OPC 服务器、工程师站。

**为什么这一层比 PLC 更好打**：PLC 通常是嵌入式实时系统（协议简单、无 OS）；
而 SCADA/HMI 跑在 **Windows/Linux 上**（有 OS 就有漏洞、有账号、有文件）。
OT 里 90% 的"打进去"发生在这一层，不是控制器。

## 适用场景

- 靶标有 HMI 面板（触摸屏工控机，常见于现场机柜）
- SCADA 服务器（iFIX / WinCC / Citect / Ignition / Wonderware）
- 历史库（OSIsoft PI / InfluxDB / Wonderware Historian / 时序数据库）
- OPC UA（4840）/ OPC DA（135 + DCOM）
- 工程师站（装工程软件的 Windows 机器）—— OT 里的**身份中枢**（域成员 + 到全部 PLC 可达）

## 一、先定位这一层的资产（比打更重要）

OT 网络里，「哪台是 HMI」通常不写在端口上（HMI 可能是 3389 也可能是 80）。
按**三种信号**交叉确认：

```bash
# ── 信号 1：工业软件特征端口 ──
nmap -Pn -p 4840,135,102,502,44818,8080,443,3389,1433,5432 "$TARGET" -sV
# 4840 = OPC UA（最高价值：常无认证）
# 135  = DCOM（OPC DA 的依赖，能从这里横向到 OPC 服务器）

# ── 信号 2：HTTP 面指纹（HMI 的 Web 界面）──
curl -s -k "https://$TARGET/" | grep -iE "wincc|ignition|citect|ifix|wonderware|hmi|scada" | head -5
# 命中任一 = 确认是 HMI/SCADA

# ── 信号 3：主机名/域信息（工程师站通常是域成员）──
nmap -Pn -p 445 --script smb-os-discovery "$TARGET"
# 输出含域名 + 主机名；工程师站的主机名常含 "ENG"/"EWS"/"PROG"
```

**判据**：三种信号里命中两种才确认为监督层资产。只看端口会把普通 Web 服务器误判成 HMI。

## 二、HMI 面板（现场触摸屏）—— 最容易被忽略的入口

现场机柜里的 HMI 面板（Siemens Comfort Panel / Allen-Bradley PanelView / Pro-face）
常有以下问题：

| 问题 | 怎么测 | 现实价值 |
| --- | --- | --- |
| **传输/运行模式切换** | 面板上按键组合进设置（Siemens Comfort：Control Panel → Transfer） | 能进 Windows CE 底层 → 有文件系统 → 可放工具 |
| **默认口令** | `1000`/`1000`（部分老 PanelView）；或工程软件默认 | 直接进设置 |
| **USB 口可用** | 插 U 盘看是否执行 autorun | 物理接触时最快路径 |
| **网线直连无认证** | 从面板的第二个网口直连笔记本 | 常常是同一 OT 网段的旁路 |

```text
Siemens Comfort Panel 的关键路径（需物理接触或网络访问设置页）：
  Control Panel → Transfer → 可改 IP、可开 "Remote Control"
  → 开 Remote Control 后用 SM@RTClient 远程接管画面
  → 从画面能操作所有 HMI 上可操作的 Tag（等于操作员权限）
```

**判据（这条最重要）**：HMI 的「可操作范围」= 工程文件里绑到画面的所有 Tag。
拿到 HMI 控制权 ≈ 拿到这些 Tag 的写权限，**且不需要 PLC 密码**。
这是 OT 里最现实的「工艺影响」路径，比直接打 PLC 容易得多。

## 三、SCADA 服务器（Windows + 工业软件）

### 3.1 认证面

```bash
# ── 常见 SCADA 服务的默认/弱口令 ──
# Ignition（8088 网关 / 8043 SSL）：默认 admin/password（首次登录强制改，但很多没改）
curl -s -X POST "http://$TARGET:8088/main/system/webdev/login" \
  -d "username=admin&password=password" | head -c 200

# ── WinCC / iFIX / Citect 的 SQL 后端 ──
# 这些产品的历史数据常存在 MSSQL（1433）；SQL 账号常是 sa + 弱口令
nmap -Pn -p 1433 --script ms-sql-info "$TARGET"
```

**判据**：SCADA 的「配置库」和「历史库」通常共用同一个 SQL 实例。
拿到 SQL 写权限 ≈ 能改报警阈值、能改历史数据（**这是掩盖痕迹的关键**，见第五节）。

### 3.2 工程软件的文件面（比认证更好打）

```text
SCADA 工程通常是一个目录（含画面、脚本、Tag 库）：
  · WinCC: <项目名>.MCP + 一堆 .db
  · iFIX:  .IFD / .PDB
  · Ignition: 一个 SQLite（data/db/config.idb）
  · Citect: .CTZ / .DBF

判据：这些文件**通常不做完整性校验**。
  能写文件 = 能改逻辑（改脚本/改画面），下次 SCADA 重启就生效。
  这比打 PLC 隐蔽（PLC 有诊断缓冲区记录下载，SCADA 改文件可能只有文件审计）
```

### 3.3 OPC UA（4840）—— 常无认证

```bash
# OPC UA 的认证是可选的，很多部署是 "None" 安全策略
python3 - <<'PY'
from opcua import Client
c = Client("opc.tcp://TARGET:4840")
c.set_security_string("")   # 空 = None 策略
c.connect()
root = c.get_root_node()
print("Namespace:", root.get_namespace_array()[:5])
print("Children:", [n.get_browse_name() for n in root.get_children()[:10]])
c.disconnect()
PY
# 判据：能连上并浏览节点树 = 无认证，可读写所有 Tag
```

```text
OPC UA 无认证的价值：
  · 能读全部 Tag（工艺全貌）
  · **能写**（很多 OPC 服务器默认允许写）→ 直接改设定值
  · 而且 OPC 的写通常**不经过 PLC 的诊断缓冲区**（看起来像 SCADA 自己在写）

检测视角：OPC UA 的审计日志（如果开了）会记录 Write 请求；多数部署没开。
```

## 四、历史库（PI / InfluxDB / 时序库）—— 数据面，价值被低估

历史库存的是**全厂所有工艺参数的时间序列**。它比"当前值"有价值得多：

| 面 | 能拿到什么 | 为什么重要 |
| --- | --- | --- |
| 工艺基线 | 每个参数的历史曲线 | 能算出「正常范围」，从而知道改多少不会被发现 |
| 报警阈值 | 常存在历史库的配置表 | 知道阈值就能改到「刚好不报警」 |
| 人员作息 | 谁在什么时间操作 | 选时间窗（无人值守时段） |
| 事故记录 | 历史报警与事件 | 知道对方在意什么 |

```bash
# InfluxDB（8086）—— 常无认证或默认口令
curl -s "http://$TARGET:8086/query?q=SHOW+DATABASES" | head -c 400
# 判据：返回数据库列表 = 无认证

# OSIsoft PI（5450）—— 需要 PI 客户端；Web 面常在 443
curl -s -k "https://$TARGET/piwebapi/system/status" | head -c 200

# Wonderware Historian（MSSQL 后端）—— 走 SQL
# 表名常含 History / Tag / Analog
```

**判据**：历史库拿到之后，**先算工艺基线再动手改任何东西**。
这一步做与不做，决定了你的「隐蔽性」是否有依据 —— 否则改一下就被报警抓到。

## 五、工程师站（OT 里的身份中枢）

工程师站（EWS）是装工程软件的 Windows 机器，通常是：
- 域成员（能用域凭据横向）
- 有到所有 PLC 的网络通路（这就是你要的跳板）
- 本地管理员常是共用账号（`ENG`/`admin`/`Operator`）

```bash
# ── 从工程师站能直接看到所有 PLC ──
# 常见做法：拿到 EWS 后在那里跑 nmap 扫 102/502/44818
# 判据：EWS 通常能直达全部控制器，是 OT 里的最佳跳板

# ── EWS 的凭据在哪 ──
# 1) 工程软件保存的连接凭据（WinCC/iFIX 的连接串常明文或弱加密）
grep -riE "password|pwd|connectionstring" "C:\Program Files\Siemens\..." 2>/dev/null | head
# 2) Windows 凭据管理器
cmdkey /list
# 3) RDP 历史（指向其他 EWS/SCADA）
reg query "HKCU\Software\Microsoft\Terminal Server Client\Servers"
```

**这条链的价值**：`IT 边界 → EWS → 所有 PLC/SCADA`。
比「直接打 PLC」现实得多 —— PLC 常被隔离，而 EWS 必须双向可达（否则工程师没法下装）。

## 六、验伤（监督层的三类假成功）

1. **登录成功但只能看不能写** —— SCADA 常分「操作员/工程师/管理员」三级。
   操作员能看画面但改不了组态。判据：登录后找一个**只有工程师能改**的东西试（如报警阈值），
   403 或灰色 = 只是操作员。
2. **OPC 连上但写被拒** —— OPC UA 的服务端可以允许 browse 但禁 write。
   判据：真写一个**无害的**测试点（找一个不在用的 Tag），再读回来。
3. **改了 SCADA 但 PLC 没变** —— SCADA 有本地缓存/队列表。判据：从 PLC 直读确认。

**最有价值的一条验伤**：**改历史数据能不能不留痕**。
很多 SCADA 的历史库在 SQL 里，改数据会留 `UPDATE` 审计；
如果对方开了 SQL 审计，改历史 = 自己留证据。**这一步没测就别在报告里写"可掩盖痕迹"**。

## 七、检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| HMI 设置页进入 | HMI 本地日志 / 现场巡检 | 面板进入 Control Panel 的记录（多数不开日志） |
| SCADA 登录 | SCADA 审计（WinCC Audit / Ignition Audit） | 非工作时间登录；来自新 IP |
| SQL 直连 | SQL Server 审计 / 登录失败日志 | 从 SCADA 服务器以外的机器连 1433 |
| OPC UA 连接 | OPC 服务器日志（若开审计） | 新客户端证书 / 匿名会话 |
| 历史库查询 | 时序库日志 | 大批量 SELECT（拉全量历史是明显异常） |
| 工程文件修改 | 文件完整性监控（多数没开） | 工程目录文件 mtime 变化 |

**实用推论**：**这一层最大的检测空白是「文件完整性」**。
SCADA 工程目录的改动，绝大多数组织**没有任何监控**（只有少数上了 FIM）。
所以演练时要专门测：**改一个工程脚本，对方多久发现**（答案常是"永远不发现"）。

## 八、工具链

| 工具 | 用途 | 本机状态 / 说明 |
| --- | --- | --- |
| `opcua`（python-opcua / asyncua） | OPC UA 浏览与读写 | `pip install asyncua`；**本机没有** |
| `pymodbus` | 从 SCADA 侧读 PLC 数据 | `pip install pymodbus` |
| `impacket` | OPC DA 的 DCOM / 135 面 | `python -m pip install impacket`（装完用模块名） |
| `nmap` NSE（ms-sql-info / smb-os-discovery） | 指纹与 SQL 探测 | ✓ toolkit 内有 |
| `sqlmap` / `mssqlclient.py` | SQL 后端 | `sqlmap` 本机未装；`mssqlclient` 在 impacket 里 |
| `influx` CLI / curl | 时序库查询 | curl 够用 |

## 参考（深水区，按需加载）

- `references/scada-hmi-tradecraft.md` —— HMI 面板控制面板路径、SCADA 工程目录结构
  （WinCC/iFIX/Ignition/Citect 四家）、OPC UA 无认证利用、历史库基线提取的具体查询。
- `references/industrial-protocol-deep.md` —— OPC UA 的节点树结构与写方法；
  Modbus/S7 的读方法（从 SCADA 侧验证）。
- `references/ot-safe-assessment.md` —— 红线清单（任何主动动作前必读）。

## 落库要求

- `redteam_chain_add`：`stage_code=internal`，`tool` 写实际入口
  （`opcua browse` / `WinCC 工程目录写入` / `InfluxDB 无认证`）。
- 拿到的凭据（SCADA 账号、SQL sa、OPC 证书）→ `redteam_credential_add`。
- **工艺基线数据不要入库**（那是客户的敏感生产数据），只记「已提取，样本见附件」。

## 任务完成自检

- [ ] 三种信号交叉确认了是监督层资产（不是普通 Web）？
- [ ] 判断过 HMI 的可操作 Tag 范围（= 工艺影响面）？
- [ ] OPC UA 测了"能不能写"，不是只测"能不能连"？
- [ ] 历史库的工艺基线算了吗（隐蔽性的依据）？
- [ ] 声称"改工程文件不被发现"时，是不是真验证过对方没有 FIM？
- [ ] 报告里区分了「能看」与「能改」（这两件事在 SCADA 里差三个权限级）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1078 | 有效账号（SCADA/HMI 默认口令） |
| 初始访问 | T1190 | 利用面向公众的应用（SCADA Web 面） |
| 收集 | T1005 | 本地系统数据（工程文件、历史数据） |
| 收集 | T1039 | 网络共享数据（工程共享目录） |
| 横向移动 | T1021 | 远程服务（RDP 到工程师站） |
| 影响 | T1485 | 数据破坏（改工艺参数 / 篡改历史数据） |
| 隐匿 | T1027 | 混淆文件或信息（改 HMI 显示误导） |

> **ICS 矩阵编号（T08xx）不在本表**：本仓 ATT&CK 表只收录企业矩阵（v20.1，含 24 个子技术），
> ICS 是独立矩阵。上表用企业矩阵的语义对应编号；引用 ICS 独有编号时须注明「ICS 矩阵」。

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 第二发（主力打不出去时，按这个顺序换）

1. **SCADA 认证过不去**：转 `plc-controller-attack`（PLC 协议常无认证）
2. **OPC UA 有认证**：转 `industrial-protocol-recon`（从被动流量里找跨区通道）
3. **只有 HMI 面板**：转物理接触路径（`hardware-security` 的 BadUSB / 网线直连）
4. **前提没满足就先回去**：`fscan-intranet` —— 没拿到 OT 网段入口

**纪律**：OT 里"再试一次"的成本是产线停机。**任何异常立刻停手并通报**。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`industrial-protocol-recon`、`plc-controller-attack`
- **下游**（产出交给谁）：`lateral-movement`、`digital-forensics`
- **互补**（同类场景一起用）：`plc-controller-attack`、`radio-sdr`、`wifi-wireless`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`sqlmap`、`impacket`、`pip`
- `sqlmap`：`python -m pip install sqlmap`（本机有 python）；或用 `python sqlmap.py -u <url>` 从源码目录跑
- `impacket`：`python -m pip install impacket`（本机有 python）；装完直接用 `python -m impacket.examples.wmiexec` 等模块名，别指望有 `impacket-*` 在 PATH
- `pip`：用 `python -m pip` 代替裸 `pip`

runnability:end -->
