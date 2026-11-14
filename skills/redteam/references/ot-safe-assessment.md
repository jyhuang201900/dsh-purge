# OT / ICS 安全评估：只读优先的纪律与"绝对不做"清单

> 被 `ot-ics` 引用。**这一篇最重要的不是技术，是边界。**
> OT 环境里一次误写的后果可能是停产、设备损坏、人身伤害。
> 在 IT 里"打个包试试"是探索，在 OT 里是事故。

## 零、开工前的三个前置条件（缺一不可）

```text
□ 书面授权明确写了：哪些网段、哪些设备、允许的协议与功能码、时间窗
□ 有工艺/自控工程师在场（或可随时联系），知道哪些回路不能碰
□ 有回退方案：如果设备进入异常状态，谁去现场、怎么恢复
```

**如果只有一份"渗透测试授权书"没有 OT 专项条款，不要开始。** 
IT 授权书通常默认允许"利用漏洞"，而 OT 里"利用"可能意味着写 PLC 寄存器。

## 一、绝对不做的操作清单（红线）

| 红线操作 | 后果 | 替代做法 |
| --- | --- | --- |
| 对 PLC 写线圈/寄存器（Modbus FC 5/6/15/16） | 阀门动作、电机启停 | 只读 FC 1/2/3/4 |
| 对 PLC 下发 STOP/RUN（S7 `plc.stop`） | 产线停机 | 不执行；只记录"理论上可停" |
| 改设定值（setpoint） | 工艺参数越界 | 只读，报告里写"可写" |
| 强制 I/O（force） | 绕过联锁，可能损坏设备 | 绝不执行 |
| 触发固件更新 | 设备变砖 | 只做离线固件分析 |
| 广播类请求（Modbus broadcast unit 0） | 全站响应 | 严格单播 |
| 扫描器默认并发 | 老 PLC 通信栈崩溃 | 限速 + 单连接 |
| 对安全仪表系统（SIS）做任何主动测试 | 安全功能失效 | 完全不碰，只做文档审查 |
| ARP 欺骗 / 中间人 | 工艺数据错乱 | 只做镜像口被动监听 |
| 用 Nmap `-T4` / 默认脚本 | 大量并发打崩设备 | `-T1`/`-T2` + 单端口 |

**"完全不能碰"的设备类型**：

```text
SIS（安全仪表系统）：SIL 等级设备，任何时候不主动测试
DCS 控制器：除非厂家 + 业主双授权
安全网关/防火墙的配置：改了可能导致大面积断连
任何带 "safety" / "interlock" / "ESD" 字样的对象
```

## 二、只读探测：Modbus / DNP3 / S7 的真实命令

### 2.1 Modbus TCP（502）——只读功能码

| FC | 名称 | 读/写 | 可用 |
| --- | --- | --- | --- |
| 1 | Read Coils | 读 | ✅ |
| 2 | Read Discrete Inputs | 读 | ✅ |
| 3 | Read Holding Registers | 读 | ✅ |
| 4 | Read Input Registers | 读 | ✅ |
| 5 | Write Single Coil | **写** | ❌ |
| 6 | Write Single Register | **写** | ❌ |
| 15 | Write Multiple Coils | **写** | ❌ |
| 16 | Write Multiple Registers | **写** | ❌ |
| 43 | Read Device Identification | 读 | ✅ |

```bash
# 读设备标识（最安全的第一步）
pip install pymodbus
python3 - <<'PY'
from pymodbus.client import ModbusTcpClient
c = ModbusTcpClient('10.10.1.20', port=502, timeout=3)
c.connect()
print(c.read_device_information())     # 型号/厂商/版本
print(c.read_holding_registers(0, count=10, slave=1))   # FC3 只读
print(c.read_coils(0, count=8, slave=1))                # FC1 只读
c.close()
PY

# nmap 的 modbus 脚本也是只读的（discover 用 FC43）
nmap -Pn -p502 -T2 --script modbus-discover 10.10.1.20

# 限速与单连接（重要）
nmap -Pn -sT -p502 --max-rate 1 --max-parallelism 1 10.10.1.20
```

**注意 `pymodbus` 的 `slave=` 参数**：3.x 用 `slave=`，2.x 用 `unit=`。写错会抛 `TypeError`，
很多人以为是设备不通。

### 2.2 S7comm（102）——只读

```bash
# 用 plcscan（只读，不写）
python2 plcscan.py 10.10.1.30

# snap7 读 PLC 信息（S7-300/400/1200/1500）
python3 - <<'PY'
import snap7
c = snap7.client.Client()
c.connect('10.10.1.30', 0, 1)          # rack 0, slot 1
print(c.get_cpu_info())                 # 型号/固件版本
print(c.get_cpu_state())                # Run/Stop —— 只读状态
# 读 DB（只读）
data = c.db_read(1, 0, 20)              # DB1, offset 0, 20 bytes
print(data.hex())
c.disconnect()
PY
```

**绝对不要**调 `c.plc_stop()` / `c.plc_hot_start()` / `c.write_area()`。
这些 API 存在本身就说明"理论上可停"，报告里写这一点即可，不要执行。

### 2.3 DNP3（20000）——只读

DNP3 的"读"是 Class 0/1/2/3 轮询，属于**正常主站行为**，但要注意：

```bash
# 用 dnp3 工具（如 opendnp3 的 master 示例）
# 只发 integrity poll（Class 0），不发 control
# 关键：不要发 Direct Operate / Select-Before-Operate（那是控制）
```

| DNP3 功能 | 性质 | 可用 |
| --- | --- | --- |
| Integrity Poll（FC 1） | 读 | ✅ |
| Class 1/2/3 Poll | 读 | ✅ |
| Direct Operate（FC 5） | **控制** | ❌ |
| Select/Operate（FC 3/4） | **控制** | ❌ |
| 冷/热重启（FC 13/14） | **破坏** | ❌ |
| 写时间对象（WRITE 到 Time and Date） | 改变设备时间，影响事件时序 | ⚠️ 谨慎，需授权 |
| 清事件缓冲（FC 9/10 类） | 破坏取证数据 | ❌ |

> DNP3 的功能码语义以 IEEE 1815 为准；上面"Is this read-only"的判断以**是否改变
> 从站状态或数据**为界，不以"功能码听起来像读"为界。

### 2.4 其它常见协议

| 协议 | 端口 | 只读操作 | 禁止 |
| --- | --- | --- | --- |
| EtherNet/IP (CIP) | 44818 | ListIdentity / ListServices | 写 tag、改模式 |
| PROFINET | 无 IP 层（二层） | 需镜像口 DCP identify | 改名、复位 |
| BACnet | 47808 | Who-Is / ReadProperty | WriteProperty、Who-Has 广播 |
| OPC UA | 4840 | Browse / Read | Write、Call 方法 |
| HMI 的 HTTP | 80/443 | GET 页面 | POST 控制 |

## 三、被动优先：为什么镜像口比扫描器好

| 维度 | 被动（镜像/SPAN） | 主动扫描 |
| --- | --- | --- |
| 设备风险 | 零 | 老 PLC 通信栈可能崩 |
| 可见性 | 只能看到有流量的设备 | 能发现静默设备 |
| 授权要求 | 只读流量，通常最低 | 需要明确允许"主动探测" |
| 时间成本 | 需要挂几天 | 几分钟 |

```bash
# 被动：镜像口抓包 + 协议解析
tcpdump -i eth1 -w ot.pcap -G 3600 -Z root 'port 502 or port 102 or port 20000'

# Wireshark 解析（离线）
tshark -r ot.pcap -Y 'modbus' -T fields \
  -e ip.src -e ip.dst -e modbus.func_code -e modbus.reference_num | head -20

# 统计功能码分布（判断谁在写）
tshark -r ot.pcap -Y 'modbus.func_code' -T fields -e modbus.func_code | sort | uniq -c | sort -rn
# 出现 5/6/15/16 = 有主站在写，这些流量的源 IP 就是"控制方"
```

**判据**：如果被动流量里出现了 FC 5/6/15/16，说明现场已有主站在写。
你要做的是**记录这些 IP**（它们是高价值目标），而不是自己发写请求。

```bash
# 资产清单（被动推导）
tshark -r ot.pcap -T fields -e ip.src -e ip.dst | tr '\t' '\n' | sort -u > hosts.txt
# 结合 MAC OUI 判厂商
tshark -r ot.pcap -T fields -e arp.src.proto_ipv4 -e eth.src | sort -u
```

## 四、主动扫描的正确姿势（如果授权允许）

```bash
# 1) 先做"最轻"的发现：ARP（二层，不发 IP 包）
arp-scan --interface=eth1 --localnet --retry=2 --timeout=500

# 2) 端口扫描：单端口、限速、单连接
nmap -Pn -sT -p502 --max-rate 1 --max-parallelism 1 --host-timeout 30s 10.10.1.0/24

# 3) 多端口但要更慢
nmap -Pn -sT -p502,102,20000,44818,47808,4840,80,443 \
  -T1 --max-rate 2 --max-retries 1 --host-timeout 60s 10.10.1.0/24

# 4) 绝不用 -sS（SYN 扫描）打老设备？其实 -sT 更安全（完整握手），但更慢
#    -sU 对某些设备（SNMP）也安全，但要限速
```

**判定"扫描把设备打挂了"的信号**：

```text
ping 不通 + 原本在线的资产从被动流量里消失
PLC 的 CPU 指示灯变红/闪烁异常
HMI 显示 "communication error"
```

一旦出现，**立即停止所有主动操作并通报现场工程师**。

## 五、物理后果评估（报告必须写）

每个发现都要回答："如果这个被利用，现场会发生什么？"

| 发现 | 物理后果 | 严重度 |
| --- | --- | --- |
| Modbus 无认证可写线圈 | 可开关阀门/启停电机 | 极高（可能人身伤害） |
| PLC 可被 STOP | 产线停机，重启需现场操作 | 高 |
| HMI 未授权访问 | 可改设定值 → 工艺越界 | 高 |
| 工程站可访问（编程软件端口） | 可下装恶意逻辑 | 极高 |
| 历史数据可读 | 泄露工艺配方 | 中 |
| 网络分区缺失（IT/OT 直通） | 勒索软件可直达 OT | 高 |

**写法示例**（这是报告里最值钱的一段）：

```text
发现: 10.10.1.20:502 Modbus TCP 无任何认证，且 FC5/FC6 可写（已验证可写 1 个测试点位，
     已获现场工程师许可，写后立即恢复原值）。
物理影响: 该 PLC 控制 X 号泵的启停线圈（coil 0）。若被恶意写入，泵会立即启停，
         下游管路压力会在 30 秒内超限，可能触发机械密封损坏；若与 Y 号阀联动，
         存在物料外泄风险。
建议: 在 PLC 与上位机之间部署单向网关；对 FC5/6/15/16 做白名单；
     关闭 PLC 的公网路由；将编程口（102）限制到工程站单 IP。
```

## 六、检测视角（防守方：怎么发现有人在测你）

| 行为 | 日志/信号 | 特征 |
| --- | --- | --- |
| 端口扫描 | 交换机 NetFlow / 防火墙 | 单源对多端口短时连接；502/102 的异常增量 |
| Modbus FC43 读取 | 被动流量 | `Read Device Identification` 请求（正常运维很少发） |
| S7 连接 | PLC 诊断缓冲区 | 非工程站 IP 的 S7 连接 |
| 异常功能码 | 被动流量 | 出现 FC 5/6 且源不是已知主站 |
| DNP3 完整性轮询 | 被动流量 | 非注册主站的 Integrity Poll |
| ARP 扫描 | 交换机 | 大量 ARP request |
| 抓包口被用 | 交换机 SPAN 配置 | 新增镜像会话 |

## 七、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 设备可未授权读 | 读到真实的寄存器值（能与现场 HMI 显示对上） | 返回 exception code 0x02（非法地址），不是"读到了" |
| 设备可写 | **只有在书面允许下**写了 1 个测试位并立即恢复，且现场确认动作 | 只是发了一个写请求，返回 0x00 但设备没反应 |
| 协议无认证 | 抓到了完整的 request/response，无需任何凭据 | 连上了但被 PLC 拒绝（返回 0x01/0x03） |
| 网络分区缺失 | 从 IT 网段能直达 OT 设备的 502 端口且握手成功 | 只有 ICMP 通（可能只是路由，不是应用可达） |

**注意**：CTF 环境里"写 PLC"是得分点，真实 OT 环境里是**红线**。
两者报告写法完全不同，不要混淆。

## 八、常见坑

1. **拿 IT 扫描器直接打**。`nmap -T4` 的默认并发会让老 PLC 的 TCP 栈溢出，
   表现为设备"失联"几分钟到永久。
2. **用 `-sS`（SYN 扫描）打老设备**。半开连接在部分老设备上不会被正确清理，
   导致连接表占满。用 `-sT`。
3. **Modbus 的 `unit id` 写错**。网关后面有多个从站，`unit=1` 可能不对，
   但**不要广播 `unit=0`**（会让所有从站响应）。
4. **DNP3 的 "read" 也会改状态**。某些实现里 Integrity Poll 会触发设备内部事件缓冲清空，
   严格说不是纯只读。要先问厂家。
5. **BACnet 的 Who-Is 是广播**。在有大网的楼宇里会引发风暴，先单播 Who-Is。
6. **以为抓到 502 流量就是"打通了"**。要证明**能读**（拿到真实值），
   而不是"看到了包"。
7. **忘了物理安全**。OT 评估常忽略"现场人员会看到你在插网线"，
   这在某些厂区会被当作工业间谍。