# 工业协议深度手册：Modbus / DNP3 / S7 / EtherNet/IP / OPC UA

被 `plc-controller-attack`、`scada-hmi-attack`、`industrial-protocol-recon` 引用。
**这一篇只讲协议本身**：帧结构、功能码、只读与写的精确边界。

> **每条"写"的描述都是判定能力，不是操作许可。** 写 PLC 寄存器在生产环境等于让阀门动作。

---

## 一、Modbus（502 / 502 UDP 少见）

最简单，也最没有安全设计 —— **协议本身没有认证**（还有一个 Modbus Security 的 TLS 版本，极少部署）。

### 数据模型

| 区 | 地址范围 | 位/字 | 读写 | 功能码 |
| --- | --- | --- | --- | --- |
| Coils（线圈） | 00001-09999 | 位 | 读写 | 1 / 5 / 15 |
| Discrete Inputs（离散输入） | 10001-19999 | 位 | **只读** | 2 |
| Input Registers（输入寄存器） | 30001-39999 | 字 | **只读** | 4 |
| Holding Registers（保持寄存器） | 40001-49999 | 字 | 读写 | 3 / 6 / 16 |

### 功能码全表（只读的一侧标 ✓）

| FC | 名称 | 读/写 | 备注 |
| --- | --- | --- | --- |
| 1 | Read Coils | ✓ 读 | 一次最多 2000 位 |
| 2 | Read Discrete Inputs | ✓ 读 | |
| 3 | Read Holding Registers | ✓ 读 | 一次最多 125 字 |
| 4 | Read Input Registers | ✓ 读 | |
| 5 | Write Single Coil | ✖ 写 | **让阀门动** |
| 6 | Write Single Register | ✖ 写 | **改设定值** |
| 15 (0x0F) | Write Multiple Coils | ✖ 写 | 批量写，最危险 |
| 16 (0x10) | Write Multiple Registers | ✖ 写 | 批量写 |
| 22 (0x16) | Mask Write Register | ✖ 写 | 位掩码写（隐蔽修改单个位） |
| 23 (0x17) | Read/Write Multiple | ✖ 写 | 读+写合一 |
| 43 (0x2B) | Read Device Identification | ✓ 读 | **最安全的第一步**，返回厂商/型号/版本 |

### 帧结构（TCP）

```text
MBAP Header（7 字节）
  Transaction ID (2) | Protocol ID (2, 恒 0) | Length (2) | Unit ID (1)
PDU
  Function Code (1) | Data (N)
```

### 只读探测的完整代码

```python
from pymodbus.client import ModbusTcpClient

c = ModbusTcpClient("10.0.0.10", port=502, timeout=3)
c.connect()

# ① 设备标识（FC 43）—— 最安全，只读元数据
r = c.read_device_identification(unit=1)
print("Vendor:", r.information.get(0), "Product:", r.information.get(1), "Version:", r.information.get(2))

# ② 读少量保持寄存器（FC 3）—— 只读，但会暴露工艺数据
r = c.read_holding_registers(address=0, count=10, slave=1)
print("Registers 0-9:", r.registers)

# ③ 读线圈状态（FC 1）
r = c.read_coils(address=0, count=16, slave=1)
print("Coils:", r.bits)

c.close()
```

**注意**：`unit` vs `slave` 参数名在不同 pymodbus 版本不一样（3.x 用 `slave`，旧版用 `unit`）。
报 `TypeError: unexpected keyword` 就是版本差异，不是设备问题。

### 写的验伤（必须重读）

```python
# ① 先读原值（记录，用于回滚）
orig = c.read_holding_registers(address=100, count=1, slave=1).registers[0]

# ② 写（仅在授权且用备用寄存器时）
c.write_register(address=100, value=1234, slave=1)

# ③ **等一个扫描周期再读**（PLC 逻辑可能立刻覆盖）
import time; time.sleep(0.2)
after = c.read_holding_registers(address=100, count=1, slave=1).registers[0]
assert after == 1234, f"写失败或已被逻辑覆盖（读回 {after}）"

# ④ 立刻回滚
c.write_register(address=100, value=orig, slave=1)
```

**三类假成功**：
1. 写请求回 OK 但值没变（只读设备/非法地址/蜜罐）。
2. 值变了但被 PLC 周期逻辑秒覆盖（等一个周期再读就发现）。
3. 写的是「影子寄存器」（SCADA 读的镜像，不影响控制）。

---

## 二、DNP3（20000）

北美电力/水务常用。比 Modbus 复杂，有链路层 + 应用层，且**有 secure authentication 扩展**（多数部署没开）。

### 分层

```text
链路层（Link Layer）
  0x0564 | Length | Control | Dest | Src | CRC
  Control: 0xC0=确认请求(只读)  0xC4=请求链路状态(只读)  0x40=用户数据(可含写)
应用层（Application Layer）
  Function Code | Object Group/Variation | Qualifier | ...
```

### 关键功能码

| FC | 名称 | 读/写 | 说明 |
| --- | --- | --- | --- |
| 1 | Read | ✓ 读 | 读对象（Class 0/1/2/3 轮询） |
| 2 | Write | ✖ 写 | **写对象**（改设定值/开合闸） |
| 3 | Select | ✖ 准备写 | 与 Operate 配对（SBO） |
| 4 | Operate | ✖ 写 | **执行控制** |
| 5 | Direct Operate | ✖ 写 | **直接执行，不先 Select** —— 最危险 |
| 6 | Direct Operate No Ack | ✖ 写 | 连确认都不要 |
| 13 | Cold Restart | ✖ **破坏** | 冷重启 |
| 14 | Warm Restart | ✖ **破坏** | 热重启 |
| 20 | Enable Unsolicited | ✖ 配置 | 让设备主动推送 |
| 21 | Disable Unsolicited | ✖ 配置 | |
| 23 | Delay Measurement | ✓ 读 | 安全的时间测量 |

### 只读探测

```bash
# nmap 的 dnp3-info 只做链路层状态请求，最安全
nmap -Pn -p 20000 --script dnp3-info "$TARGET"
```

```python
# 自定义链路层确认请求（只读，不改任何状态）
from scapy.all import *
# DNP3 需要外部贡献的图层；没有就用原始字节
# 链路层确认请求：05 64 05 C0 01 00 00 <CRC>
frame = bytes.fromhex("056405C0010000") + b"\x00\x00"  # CRC 需计算，示意
```

**判据**：DNP3 的「读」是 Class 0/1/2/3 轮询 —— 这本来就是主站的正常行为。
但 **`Direct Operate` / `Select-Before-Operate` 是控制**，任何情况下不做。

---

## 三、S7Comm（102）

Siemens S7-300/400/1200/1500。比其他协议"现代"，有连接建立（COTP）与保护等级。

### 结构

```text
TPKT (RFC1006) → COTP (连接建立) → S7 PDU (Job/Ack/Userdata)
```

### 保护等级（决定能不能写）

```bash
nmap -Pn -p 102 --script s7-info "$TARGET" | grep -iE "protection|module|serial"
```

| Protection Level | 含义 | 能写吗 |
| --- | --- | --- |
| 0 / 无该字段 | 无保护 | **能**（危险） |
| 1 | 写保护 | 不能写 |
| 2 | 读写保护 | 不能读不能写 |
| 3 | 完全保护 | 需要密码 |

### 只读操作（安全）

```python
import snap7

c = snap7.client.Client()
# rack/slot：S7-300/400 常用 0/2；S7-1200/1500 常用 0/1
c.connect("10.0.0.10", 0, 1)

print("CPU state:", c.get_cpu_state())        # 只读：S7CpuStatusRun/Stop
print("Connected:", c.get_connected())
blocks = c.list_blocks()                       # 只读：列出 OB/DB/FB/FC
print("Blocks:", blocks)
print("DB list:", c.db_get({}))                # 只读：DB 数量

c.disconnect()
```

### 读写 DB（危险，需授权）

```python
# 读一个 DB 的字节（只读）
data = c.db_read(db_number=1, start=0, size=10)

# 写（危险）—— 必须授权 + 验伤 + 回滚
c.db_write(db_number=1, start=0, data=bytearray([0x01]))

# 验伤：重读
again = c.db_read(db_number=1, start=0, size=1)
assert again == bytearray([0x01])
```

**S7 特有的坑**：
- `rack/slot` 填错会连不上（不是"设备没开"）。S7-1500 通常是 0/1，S7-300 是 0/2。
- S7-1200/1500 默认**禁止 PUT/GET**（需在 TIA 里勾选「允许来自远程伙伴的 PUT/GET」）。
  没勾时 `db_read` 会超时，看起来像网络不通。
- `snap7` 依赖 `libsnap7` 原生库，pip 装 `python-snap7` 后还要单独放 dll/so。

---

## 四、EtherNet/IP（44818 TCP / 2222 UDP）

Rockwell / Allen-Bradley 系。基于 CIP（Common Industrial Protocol）。

### 关键服务

| 命令 | 代码 | 读/写 | 说明 |
| --- | --- | --- | --- |
| ListIdentity | 0x0063 | ✓ 读 | **最安全**，返回设备型号/版本/序列号 |
| ListServices | 0x0004 | ✓ 读 | |
| ListInterfaces | 0x0064 | ✓ 读 | |
| RegisterSession | 0x0065 | 会话 | 建立会话（CIP 通信前提） |
| SendRRData | 0x006F | 取决于内层 CIP | 封装 CIP 请求 |
| SendUnitData | 0x0070 | 取决于内层 CIP | 连接式 |

### 只读探测（ListIdentity 是最安全的单条请求）

```bash
nmap -Pn -p 44818 --script enip-info "$TARGET"
# 输出：Vendor / Product Name / Revision / Serial / Device Type
```

```python
# 手工发 ListIdentity（UDP 2222 或 TCP 44818 都支持）
import socket, struct
# 命令 0x0063，长度 0，会话 0，状态 0，context 0，选项 0
pkt = struct.pack("<HHII8sI", 0x0063, 0, 0, 0, b"\x00"*8, 0)
s = socket.create_connection(("10.0.0.10", 44818), timeout=3)
s.send(pkt)
resp = s.recv(1024)
print("Response bytes:", len(resp))   # 含厂商/型号明文
```

### CIP 层的写（最危险的一层）

```text
CIP 的写走 SendRRData 封装一个 CIP "Write Tag" 服务（0x4D）。
需要先 RegisterSession（会建立会话，留痕）。

判据：能 RegisterSession 成功 = 至少能建立 CIP 会话。
      但 Write Tag 还要求 tag 存在且未被保护。
```

**不做的事**：CIP 的 `Write Tag` 到生产 tag、`Start/Stop` 控制器。

---

## 五、OPC UA（4840）

现代标准，理论上最安全（有加密/签名），但**默认配置常是 None 安全策略**。

### 端点发现（只读，不建立会话）

```python
import asyncio
from asyncua import Client

async def probe():
    c = Client("opc.tcp://10.0.0.10:4840")
    eps = await c.connect_and_get_server_endpoints()
    for e in eps:
        print("URL:", e.EndpointUrl, "| SecurityPolicy:", e.SecurityPolicyUri)
    # 判据：出现 .../None = 无安全策略；出现 Basic256Sha256 = 有加密

asyncio.run(probe())
```

### 浏览节点树（需会话，但只读）

```python
async def browse():
    c = Client("opc.tcp://10.0.0.10:4840")
    # None 策略时不需要证书
    await c.connect()
    root = c.nodes.root
    children = await root.get_children()
    for ch in children[:10]:
        print(await ch.read_browse_name())
    # 典型结构：Objects → Server / DeviceSet → 各设备 → 各 Tag
    await c.disconnect()

asyncio.run(browse())
```

### 读 / 写

```python
node = c.get_node("ns=2;s=Device1.Setpoint")
val = await node.read_value()            # 只读
await node.write_value(42.0)             # 写（危险！）
```

**OPC UA 的检测特点**：写操作在 OPC 服务器日志里（若开了审计），
但**不进 PLC 的诊断缓冲区** —— 看起来像 SCADA 自己在写。这是它比其他协议"隐蔽"的原因。

**判据**：`SecurityPolicyUri` 是 `None` 且 `MessageSecurityMode` 是 `None`
= 可匿名读写。这是 OT 里最常见的配置问题。

---

## 五之二、IEC 60870-5-104（2404）—— 电力行业专用

> 本仓此前**完全空缺**（1.1.123 覆盖矩阵实测命中 0）。
> 为什么必须补：IEC-104 是**中国电力系统（变电站/调度）的事实标准**，
> 在电力靶标里出现率高于 Modbus，而它的控制命令（遥控/遥调）比 Modbus 写寄存器危险得多。

### 与 Modbus 的根本差别

```text
Modbus：读写「寄存器」，语义要靠工程文件反推
IEC-104：报文自带**明确的类型标识**（TypeID），一看就知道是遥测、遥信、还是遥控
         → 攻击者不需要读懂工程文件，就知道哪个包能让断路器动作
         → 这也是它最危险的地方
```

### 类型标识（TypeID）—— 只读 vs 控制

| TypeID | 名称 | 性质 | 能不能碰 |
| --- | --- | --- | --- |
| 1 | 单点遥信 M_SP_NA | 读 | ✅ 安全 |
| 3 | 双点遥信 M_DP_NA | 读 | ✅ 安全 |
| 9 | 归一化遥测 M_ME_NA | 读 | ✅ 安全 |
| 13 | 短浮点遥测 M_ME_NC | 读 | ✅ 安全 |
| 30 | 单点遥信带时标 SP_TB | 读 | ✅ |
| 36 | 归一化遥测带时标 ME_TB | 读 | ✅ |
| 45 | **单点命令 C_SC_NA**（遥控合/分） | **控制** | ❌ **断路器动作** |
| 46 | **双点命令 C_DC_NA** | **控制** | ❌ |
| 47 | **步调节命令 C_RC_NA** | **控制（调档位）** | ❌ |
| 48 | **设定值命令 C_SE_NA**（归一化） | **控制（改定值）** | ❌ |
| 49 | **设定值命令 C_SE_NB**（标度化） | **控制** | ❌ |
| 50 | **设定值命令 C_SE_NC**（短浮点） | **控制** | ❌ |
| 100 | 总召唤 C_IC_NA | 请求（读全量） | ⚠️ 低风险但会刷流量 |
| 101 | 计数量总召唤 C_CI_NA | 请求 | ⚠️ |
| 103 | 时钟同步 C_CS_NA | **写时钟** | ❌ 时间错乱会让事件顺序全乱 |

**判据（最重要的一条）**：**TypeID 45–50 和 103 绝对不碰**。
TypeID 45 是「遥控」—— 在变电站里执行它就是拉合断路器，等同于一次真实的断电操作。
这不是"技术风险"，是**人身与设备安全风险**。

### 只读探测

```bash
# 判据 1：端口 2404 与 APCI 启动帧
nmap -Pn -p 2404 -sV "$TARGET"
```

```python
# 最小只读探测：建立 APCI 连接后发「总召唤」（TypeID 100），读全量遥测
# 需要 IEC-104 库：pip install lib60870-python（需编译）或用 scapy 手搓
from scapy.all import *
# 或者用现成工具（本机没有，需自行编译）

# 手工帧结构（判断是否 104 设备够用）：
# APCI: 0x68 | len(2) | control(4) | ASDU
# STARTDT act: 68 04 07 00 00 00   （启动数据传输）
# STARTDT con: 68 04 0B 00 00 00   （设备确认 → 是 104 设备）
```

**最安全的判断方式（不需要发任何帧）**：从 pcap 里看。

```bash
# 从镜像流量判是否有 104 设备（零风险）
tshark -r capture.pcap -Y "tcp.port==2404" -T fields -e ip.src -e ip.dst -e _ws.col.Info | head -20
# 判据：出现 "IEC 60870-5-104" 或 0x68 开头的 APCI = 有
```

### 从流量里读工艺（只读，零风险）

```bash
# TypeID 1/3/9/13 的报文载荷就是遥测值
tshark -r capture.pcap -Y "tcp.port==2404" -V | grep -A3 "Type ID" | head -40
# 判据：能看到 ASDU 里的 IOA（信息对象地址）与值 → 这就是一次真实的遥测量
```

**报告价值**：能说清「哪个 IOA 对应哪路遥测」，比「我能连上 2404」有价值得多。
IOA 的语义要对方提供（点表），拿不到就用「IOA 12345 在 5 分钟内持续变化」这种客观描述。

### 检测视角

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 连接 2404 | 变电站网关日志 / 调度主站 | 新 IP 建立 APCI 连接（`STARTDT`） |
| 总召唤 | 主站日志 | 非计划时刻的 TypeID 100 请求（正常只在启动时发） |
| **遥控（TypeID 45）** | **网关 + 一次设备动作记录 + 调度告警** | **断路器变位 → 这是会立刻被人发现的** |
| 时钟同步 | 设备日志 | 非主站 IP 发 TypeID 103 |

**实用推论**：IEC-104 的**只读面完全不可检测**（从流量看），
但**控制面一旦碰就是即时可见的事故**（断路器动作会触发调度告警）。
所以这类靶标的正确做法是：被动看流量 + 报告「理论上可发遥控」，
**绝对不发**。这也是 `ot-safe-assessment.md` 红线清单里最硬的一条。

---

## 六、跨协议的「只读安全等级」排序

从最安全到最危险，**按这个顺序试探**：

| 序 | 动作 | 协议 | 副作用 |
| --- | --- | --- | --- |
| 1 | ListIdentity | EtherNet/IP | 无（UDP 单包） |
| 2 | FC 43 设备标识 | Modbus | 无 |
| 3 | s7-info（SZL 查询） | S7 | 无（只读元数据） |
| 4 | GetEndpoints | OPC UA | 无（不建会话） |
| 5 | dnp3-info（链路状态） | DNP3 | 无 |
| 6 | 读寄存器/数据点 | Modbus/S7/OPC | 低（暴露工艺数据，部分设备记异常日志） |
| 7 | **RegisterSession + 浏览** | EtherNet/IP / OPC | 中（建立会话，留痕） |
| 8 | **任何写** | 全部 | **高（工艺影响）** |
| 9 | 固件/逻辑下载 | S7/CIP | **极高（可能变砖）** |

**纪律**：只在授权范围内走到第 7 步。第 8 步需要单独授权 + 工艺工程师在场 + 回滚方案。

---

## 七、常见坑

1. **`pymodbus` 的 `unit` / `slave` 参数名随版本变** —— 报 `TypeError` 是版本问题，不是设备。
2. **`snap7` 的 rack/slot 填错** —— S7-1500 是 0/1，S7-300 是 0/2。连不上先查这个。
3. **S7-1200/1500 默认禁 PUT/GET** —— 需在 TIA 里勾选。不勾时 `db_read` 超时，看起来像网络问题。
4. **Modbus 的地址有 0-based / 1-based 两种习惯** —— 文档说 40001 在代码里是 address=0。
5. **OPC UA 的 `ns=2` 索引会变** —— 不同服务器的命名空间索引不同，硬编码 `ns=2` 常失败。
   应该用 `get_namespace_index("urn:your:namespace")` 动态取。
6. **DNP3 的 CRC 是双字节且分块计算** —— 手写帧最容易在这里错。优先用现成库。
7. **EtherNet/IP 的 ListIdentity 用 UDP 2222 也响应** —— 只扫 TCP 44818 会漏。
8. **任何协议的"写成功"都要重读验证** —— 见第一节的三类假成功。