---
name: plc-controller-attack
description: Use for authorized 工控(OT) PLC and RTU controller assessment (含 IEC-104 遥控面判定) — firmware version fingerprinting, ladder/project file analysis, unauthenticated write paths, and controller-level persistence on Siemens/Rockwell/Schneider.
whenToUse: Use when the target has reachable PLC/RTU controllers (S7-1200/1500, ControlLogix, Modicon) and you need to judge what an attacker could do to the controller itself — not just whether port 102 is open.
source: dsh-purge original（按本仓模板撰写）
---

# PLC / RTU 控制器专项

`ot-ics` 讲的是整体方法论与红线；**本技能只讲控制器这一层**：
固件版本怎么判、工程文件怎么读、哪些写路径真的能用、以及写进去之后怎么不被发现。

**先读 `ot-ics` 的安全铁律**。这里所有"能写"的描述都是**判定能力**，不是操作许可 ——
写 PLC 寄存器在生产环境等于让阀门动，这个后果不由技术判断兜底。

## 适用场景

- 靶标里出现 102（S7）/ 44818（EtherNet/IP）/ 502（Modbus）且确认为真实控制器
- 需要回答"这台 PLC 能不能被改写程序/逻辑"
- 拿到工程文件（`.ap16` / `.L5X` / `.ACD`）需要离线分析
- 需要判断控制器固件版本对应的已知漏洞
- 授权演练中要在控制器上做持久化（极少，且必须单独授权）

**不在本技能范围**：工艺过程影响评估（要工艺工程师，不是安全工程师）、
安全仪表系统 SIS（任何时候不做，见 `ot-ics` 红线）。

## 一、先确认「真的是控制器」而不是 honeypot

OT 环境里蜜罐比 IT 环境多得多（很多厂商的 OT 安全产品会主动部署）。
**假控制器有三个稳定特征**：

```bash
# 1) 响应时间过于稳定 —— 真 PLC 的响应有工艺周期带来的抖动
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{time_total}\n" "http://$TARGET/" 2>/dev/null
  sleep 1
done
# 真设备：抖动 5-50ms 且随负载变化；蜜罐：几乎恒定（<1ms 抖动）

# 2) 标识信息「太完整」—— 真设备的 S7 型号串常有缺项或厂商定制后缀
nmap -Pn -p 102 --script s7-info "$TARGET"
# 蜜罐常返回教科书式完美字段（"CPU 1516-3 PN/DP" 一字不差 + 无任何定制）

# 3) 写入路径全部「可写但改不动」
#    蜜罐会 accept 写请求再回 OK，但重读值没变 —— 这个必须实测（见第四节验伤）
```

**判据**：三条里命中两条以上就是蜜罐，**立刻停手**（在蜜罐上打会污染你的报告，
也浪费时间）。真设备通常只有一条不符。

## 二、固件与型号指纹（决定后面能打什么）

```bash
# ── Siemens S7（102）──
nmap -Pn -p 102 --script s7-info "$TARGET"
# 输出含：Module type / Plant identification / Copyright / Serial number / Firmware
# 判据：Serial number 与 Firmware 是后面查 CVE 的输入，必须记全

# ── Rockwell / Allen-Bradley（44818 EtherNet/IP）──
nmap -Pn -p 44818 --script enip-info "$TARGET"
# 输出含：Vendor / Product Name / Revision（Revision 是固件主次版本）
# 判据：Product Name 里的型号（如 "1756-L71"）比 Revision 更重要

# ── Schneider Modicon（502）──
python3 - <<'PY'
from pymodbus.client import ModbusTcpClient
c = ModbusTcpClient("TARGET")
r = c.read_device_identification(unit=1)   # FC 43，只读，最安全的一步
print(r)
PY

# ── 通用：从 HTTP/HTTPS 管理面拿版本（很多新 PLC 有 Web 界面）──
curl -s -k "https://$TARGET/" | grep -iE "version|firmware|model" | head -5
```

### IEC 60870-5-104（2404）—— 电力行业（变电站 / 调度主站）

**为什么单列**：中国电力系统的变电站与调度主站用 IEC-104，
它在电力靶标里的出现率**高于 Modbus**。而且它和 Modbus 有一个致命差别：

```text
Modbus：读写「寄存器」，语义要靠工程文件反推
IEC-104：报文自带**明确的 TypeID**，一看就知道是遥测还是遥控
         → 攻击者不需要读懂工程文件，就知道哪个包能让断路器动作
         → 所以它既是最好判的，也是最危险的
```

**只读 vs 控制（TypeID 全表，这张表必须记住）**：

| TypeID | 名称 | 性质 | 能不能碰 |
| --- | --- | --- | --- |
| 1 / 3 | 单点/双点遥信 | 读 | ✅ 安全 |
| 9 / 13 | 归一化/短浮点遥测 | 读 | ✅ 安全 |
| 30 / 36 | 带时标的遥信/遥测 | 读 | ✅ 安全 |
| **45** | **单点命令 C_SC_NA（遥控合/分）** | **控制** | ❌ **断路器动作** |
| **46 / 47** | 双点命令 / 步调节 | **控制** | ❌ |
| **48 / 49 / 50** | 设定值命令（归一化/标度化/短浮点） | **控制（改定值）** | ❌ |
| **103** | 时钟同步 | **写时钟** | ❌ 时间错乱让事件顺序全乱 |

**判据（最硬的一条）**：**TypeID 45–50 与 103 绝对不碰**。
TypeID 45 在变电站里执行就是**拉合断路器** —— 这不是"技术风险"，
是**人身与设备安全风险**。正确做法是**只做被动流量分析 + 报告「理论上可发遥控」，绝不发**。

```bash
# ── 零风险判定：从 pcap 看有没有 104 设备 ──
tshark -r capture.pcap -Y "tcp.port==2404" -T fields -e ip.src -e ip.dst -e _ws.col.Info | head -20
# 判据：出现 "IEC 60870-5-104" 或 0x68 开头的 APCI = 有

# ── 从流量读工艺（只读，零风险）──
tshark -r capture.pcap -Y "tcp.port==2404" -V | grep -A3 "Type ID" | head -40
# 判据：能看到 ASDU 里的 IOA（信息对象地址）与值 → 这就是真实遥测量

# ── 主动探测（授权且限速才有意义）：先只发 STARTDT 看设备是否回确认 ──
nmap -Pn -p 2404 -sV "$TARGET"
# 手工帧：STARTDT act = `68 04 07 00 00 00`；设备回 `68 04 0B 00 00 00` = 是 104 设备
```

**报告价值**：能说清「哪个 IOA 对应哪路遥测」比「我能连上 2404」有价值得多。
IOA 的语义要对方提供点表；拿不到就用「IOA 12345 在 5 分钟内持续变化」这种客观描述。

**检测视角**：IEC-104 的**只读面完全不可检测**（从流量看），
但**控制面一旦碰就是即时可见的事故**（断路器变位会触发调度告警）。
所以这类靶标的正确做法写在 `references/industrial-protocol-deep.md` 第五之二节。

**型号 → 已知漏洞的映射必须查官方公告**，不要凭记忆。两类最常被记错：

| 设备 | 常被记错的点 |
| --- | --- |
| S7-1200 vs S7-1500 | 两者漏洞不通用。S7-1200 的多数 CVE 不影响 1500，反之亦然 |
| ControlLogix 各系列 | 1756-L6x 与 L7x 的固件分支不同，同一 CVE 的修复版本号不一样 |

## 三、工程文件离线分析（不需要碰设备，风险最低）

拿到 `.ap16`（TIA Portal）/ `.L5X`（Studio 5000）/ `.ACD` 后：

```bash
# ── TIA Portal 项目（.ap16 / .ap17 / .zap16）──
# 本质是 zip + SQLite。解压后看 ProjectFiles 下的 db
unzip -o project.ap16 -d tia_out/
find tia_out -name "*.db" | head
# 判据：含 PLC 逻辑的 db 通常是 "ProgramBlocks" 相关；用 sqlite3 打开看表名
sqlite3 tia_out/ProjectFiles/*.db ".tables" 2>/dev/null | head

# ── Studio 5000（.L5X 是 XML，直接读）──
grep -oE '<Tag Name="[^"]+"' project.L5X | head -20
grep -oE '<Routine Name="[^"]+" Type="[^"]+"' project.L5X | head -20
# 判据：Tag 名能看出工艺语义（如 "Valve_3_Position"、"Pump_Start"）→ 这些是可写的危险点

# ── 老式项目（.ACD 是二进制）──
# 需要 RSLogix 导出成 L5X；或 strings 粗看
strings project.ACD | grep -iE "recipe|setpoint|interlock" | head -20
```

**从工程文件里要提取什么**（这决定报告质量）：

```text
□ 哪些 Tag 是**设定值**（setpoint）—— 改它影响工艺，最高危
□ 哪些 Tag 是**联锁**（interlock / permissive）—— 改它绕过安全保护
□ 哪些 Tag 是**状态只读**（position / status）—— 改它无意义但会误导操作员
□ 有哪些 HMI 可写的 Tag —— 这些是「不需要 PLC 密码也能改」的入口
□ 工程文件里有没有硬编码凭据（连接 HMI/历史库的账号）
```

## 四、写路径：四种，按「需要什么前提」排序

> **这一节描述的是判定方法。** 实际执行写操作必须单独授权，
> 且在授权范围内优先用「读回来验证」而不是「改工艺值」。

### 4.1 HMI 可写 Tag（前提最低，最现实的路径）

不需要 PLC 密码 —— 只需要 HMI 的访问权（很多时候 HMI 是弱口令或无认证）。

```text
判据：工程文件里找 HMI 画面绑定的 Tag（通常在 "HMI Tags" 或画面 XML 里）
      这些 Tag 在本机 HMI 上可改，也就意味着能以操作员身份改
现实价值：改「设定值」让工艺偏移 —— 这是 OT 攻击最常见的目的
风险：操作员立刻会发现（画面数值变了）
```

### 4.2 PLC 无保护写（S7 的 "protection level" 为 None）

```bash
# 判据：S7 的 protection level
nmap -Pn -p 102 --script s7-info "$TARGET" | grep -i "protection"
# "Protection: 0" 或无该字段 = 无保护，可写
# 有保护时，能读到 block 列表但不能下载（下载需要密码）

# 只读探测（安全）：读 block 列表
python3 - <<'PY'
import snap7
c = snap7.client.Client()
c.connect("TARGET", 0, 1)          # rack 0, slot 1（S7-1500 通常是 0/1，300 是 0/2）
print("CPU state:", c.get_cpu_state())            # 只读
print("Block list:", c.list_blocks())             # 只读，能看到 DB/OB/FB 结构
c.disconnect()
PY
# 判据：list_blocks 能列出 = 至少读权限；写要用 db_write 或 download（危险，需授权）
```

### 4.3 固件级持久化（极少做，风险最高）

理论上存在（改固件镜像再刷回去），但：

```text
不做的三个理由：
1) 刷固件失败 = 设备变砖，这是物理损坏，不是"可回滚的配置修改"
2) 多数现代 PLC 有固件签名（S7-1500、ControlLogix 新版），改了刷不进去
3) 演练不需要走到这一步 —— 「理论上可刷」写进报告就够，不需要真做
```

### 4.4 网络层面持久化（不进控制器）

```text
在控制器和 HMI/工程站之间插入中间人（ARP 欺骗 / 改交换机配置），
长期截获或篡改工艺数据。**这比改 PLC 更隐蔽**（PLC 本身完好无损）。
但：ARP 欺骗在 OT 环境是高危动作（见 ot-ics 红线），必须单独授权。
```

## 五、验伤（OT 场景最不能自欺的地方）

**「写请求返回 OK」在 OT 里完全不代表成功** —— 很多控制器对非法写入也回 OK。

```text
唯一可靠判据：**写完之后重读，值真的变了**。
  · Modbus：FC 6 写寄存器 → 用 FC 3 重读同一个寄存器 → 值等于你写的
  · S7：db_write → db_read 同一 DB/offset → 值对
  · 蜜罐特征：写回 OK，重读还是原值（这就是第一节第 3 条说的"可写但改不动"）

第二层验伤：**变了之后能不能恢复**。
  · 记录原值 → 写入 → 验读 → **立刻写回原值** → 再验读
  · 只在维护窗口做，且不做"改设定值"这类会影响工艺的测试（改一个不在用的备用寄存器即可）
```

**三类假成功**：

1. **写请求成功但被 PLC 逻辑覆盖** —— 有的 PLC 有周期性逻辑会立刻把寄存器改回。
   判据：写完后隔一个扫描周期（通常 10-100ms）再读。
2. **写的是"影子寄存器"** —— 有些 DB 是给 SCADA 读的镜像，改了不影响真实控制。
   判据：对比工程文件，看这个 DB 是否被逻辑块引用。
3. **HMI 显示变了但 PLC 没变** —— HMI 有本地缓存。判据：从 PLC 直读，不看 HMI。

## 六、检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 端口扫描 | 交换机 NetFlow / OT 安全平台 | 单源对多 PLC 的 102/502/44818 短连接 |
| 读 block / 设备标识 | 控制器诊断缓冲区（S7 Diagnostic Buffer） | 异常连接来源 IP；非常规时段访问 |
| 写寄存器 | 控制器诊断 + 工艺曲线 | 工艺值跳变；HMI 报警；操作员记录本 |
| 改逻辑下载 | 控制器诊断（**下载事件必记录**） | "Download to CPU" 事件；CPU 短暂 STOP |
| ARP 欺骗 | 交换机日志 / OT IDS | 同一 MAC 对应两个 IP；ARP 表频繁变化 |
| 工程文件外带 | 工程站 EDR / 文件审计 | 大体积工程文件被复制到非工程站 |

**实用推论**：**OT 的检测点集中在「控制器诊断缓冲区」**，而不是日志服务器。
S7 的 diagnostic buffer、ControlLogix 的 controller log 都记录了「谁在什么时候连过」。
所以演练时要专门测：**对方的 OT 安全平台有没有在读这些缓冲区**（多数组织没读）。

## 七、工具链

| 工具 | 用途 | 本机状态 / 说明 |
| --- | --- | --- |
| `snap7`（python-snap7） | S7 读写、状态、block 列表 | `pip install python-snap7`；**本机没有，需装**；只读部分依赖 libsnap7 库 |
| `pymodbus` | Modbus 读写（含 FC 43 设备标识） | `pip install pymodbus`；纯 python |
| `nmap` NSE（s7-info / enip-info / modbus-discover） | 指纹 | ✓ 本机 toolkit 内有 |
| Studio 5000 / TIA Portal | 工程文件官方解析 | 需 Windows + 授权；离线用 |
| `binwalk` / `radare2` | 固件镜像分析 | `binwalk` 本机未装（pip 装）；`radare2` ✓ |

> **本机实测**：`nmap` 在 toolkit 里（`~/.dsh/redteam/toolkit/nmap/nmap.exe`），
> 但 **NSE 脚本目录需要额外确认**（`--script s7-info` 找不到脚本时附上
> `--script-updatedb` 或指定 `--datadir`）。`snap7` / `pymodbus` 都要 pip 装。

## 参考（深水区，按需加载）

- `references/ot-safe-assessment.md` —— **必读先读**：红线清单、只读功能码表、
  探测限速参数。任何 OT 动作前先看它。
- `references/industrial-protocol-deep.md` —— Modbus/DNP3/S7/EtherNet/IP 四协议的
  帧结构、功能码全表、以及各自的「写」路径与验伤方法。
- `references/plc-project-analysis.md` —— TIA Portal / Studio 5000 工程文件结构、
  Tag 语义提取、以及从工程文件反推攻击面（哪些 Tag 可写、哪些是联锁）。

**什么时候翻哪个**：要做任何探测前 → `ot-safe-assessment.md`；
要具体命令与功能码 → `industrial-protocol-deep.md`；
拿到工程文件 → `plc-project-analysis.md`。

## 落库要求

- `redteam_chain_add`：`stage_code=internal`（OT 通常在拿到内网入口后才有），
  `tool` 写实际命令（`nmap --script s7-info` / `pymodbus FC43`）。
- 固件版本、型号、序列号必须进 `detail` —— 这是后续查 CVE 的唯一输入。
- 写操作（若授权）必须记：原值、写入值、是否恢复。**未恢复的写操作是事故，不是战果。**

## 任务完成自检

- [ ] 确认过不是蜜罐（三条判据都测了）？
- [ ] 固件/型号/序列号记全了（能查 CVE）？
- [ ] 所有主动动作都在授权的时间窗内、有工艺工程师在场？
- [ ] 声称"可写"时，是不是真的写+重读验证过（不是看到 protection=0 就断言）？
- [ ] 有写操作的话，原值记了、恢复了、验证恢复了？
- [ ] 报告里写清了物理/过程影响（不是只写"高危漏洞"）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1190 | 利用面向公众的应用（PLC Web 管理面） |
| 收集 | T1005 | 本地系统数据（工程文件） |
| 发现 | T1046 | 网络服务发现（协议指纹） |
| 横向移动 | T1021 | 远程服务（控制器协议） |
| 影响 | T1485 | 数据破坏（改工艺参数 / 篡改逻辑） |
| 影响 | T1489 | Service Stop（下发 STOP 停机） |
| 隐匿 | T1027 | 混淆文件或信息（工程文件藏匿） |

> **ICS 矩阵编号（T08xx）不在本表**：本仓的 ATT&CK 表只收录企业矩阵（v20.1，124 个顶层技术 + 24 个子技术），
> ICS 矩阵是独立的一套。所以 OT 动作在上表里用**企业矩阵的语义对应编号**（如「改工艺参数」
> → T1485 数据破坏）。报告里若要引用 ICS 矩阵独有的编号（如 Modify Parameter 这类），
> **另行注明「ICS 矩阵」，不要混进本表**——混进来会在「按 ATT&CK 复核」时被当成编造。

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 检测视角（补充：控制器诊断缓冲区）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 端口/协议扫描 | 交换机 NetFlow + OT 安全平台 | 单源对多控制器 102/502/44818 短连接；连接未完成握手即断 |
| 读 block 列表 / 设备标识 | **S7 Diagnostic Buffer** / ControlLogix Controller Log | 非常规源 IP 的连接；非轮询周期的请求；连接数与平时基线不符 |
| 读寄存器 / 数据点 | 控制器诊断 + 工艺曲线 | 读数后工艺值无变化（说明是"只读探测"不是正常轮询） |
| 写寄存器 / 改设定值 | 控制器诊断 + HMI 报警 + **操作员记录本** | 工艺值跳变；HMI 报警；操作员发现"参数自己变了" |
| 下载逻辑 / 改程序 | 控制器诊断（**下载事件必记录**） | "Download to CPU" 事件；CPU 短暂 STOP；程序块校验和变化 |
| 固件刷写 | 控制器诊断 + 厂商工具日志 | 固件版本变化；设备重启 |
| 工程站外带工程文件 | 工程站 EDR + 文件审计（多数没开） | 大体积工程文件被复制到非工程站；USB 插入 |

**实用推论**：**OT 的检测点集中在「控制器诊断缓冲区」，而不是日志服务器**。
S7 Diagnostic Buffer 和 ControlLogix Controller Log 是唯一能证明「谁在什么时候连过控制器」的证据源，
而多数组织的 OT 安全平台**根本没在读这两个缓冲区** —— 他们只看网络流量。
所以演练的核心问题是：**对方的 OT 平台有没有接控制器的诊断数据**。
答案是"没有"时，你的所有控制器级动作都不会被发现；这比"我改了一个寄存器"有价值得多。

## 第二发（主力打不出去时，按这个顺序换）

1. **控制器打不动**（有保护/固件签名）：转 `scada-hmi-attack`（HMI 通常防护弱得多）
2. **协议不通**（网络隔离）：转 `industrial-protocol-recon`（先看被动流量，找跨区通道）
3. **前提没满足就先回去**：`fscan-intranet` —— 没拿到 OT 网段的入口，本环再试也是空打
4. **只有一个 Web 面**：转 `nuclei-scan` + `web-vuln-payloads`（PLC 的 Web 界面本质是嵌入式 Web）

**纪律**：OT 里"再试一次"的成本是产线停机，不是请求失败。**任何异常立刻停手并通报**。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`industrial-protocol-recon`
- **下游**（产出交给谁）：`scada-hmi-attack`、`iot-iiot-netdev`
- **互补**（同类场景一起用）：`hardware-security`、`ot-ics`、`radio-sdr`、`scada-hmi-attack`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`binwalk`、`pip`
- `binwalk`：`python -m pip install binwalk`（新版是 python 包）；固件分析在本机做，不是目标机
- `pip`：用 `python -m pip` 代替裸 `pip`

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->
