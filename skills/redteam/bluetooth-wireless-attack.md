---
name: bluetooth-wireless-attack
description: Use for authorized Bluetooth/BLE and RFID assessment — BLE enumeration and GATT read/write, classic Bluetooth pairing attacks, BLE HID injection, RFID/NFC cloning, and debug-port extraction from wireless devices.
whenToUse: Use when the target includes BLE peripherals (locks, medical, wearables, industrial sensors), classic Bluetooth devices (speakers, keyboards, car units), or RFID/NFC access control — and you need to test pairing, GATT permissions, or replay.
source: dsh-purge original（按本仓模板撰写）
---

# 蓝牙 / BLE / RFID 近距无线攻击

`wifi-wireless` 讲 802.11；`hardware-security` 讲物理与固件；
**本技能专讲「短距无线协议」**：BLE、经典蓝牙、RFID/NFC。

**为什么必须单列**：短距无线是**唯一不需要接触目标网络**就能进入的通道 ——
不需要 IP、不需要凭据、甚至不需要在同一网段。而它的安全模型（配对/绑定/GATT 权限）
与 Web/AD 完全不同，混在无线技能里会被 802.11 的内容淹没。

## 适用场景

- 授权范围内的 BLE 设备评估（智能锁、医疗设备、可穿戴、工业传感器）
- 经典蓝牙设备（音箱、车机、键鼠）的配对与劫持测试
- RFID/NFC 门禁卡、工牌、支付卡（**仅在明确授权下**）
- 无线外设作为进入内网的跳板（BLE HID 注入 → 控制配对主机）
- 设备固件从无线侧提取（配合 `hardware-security` 的调试口）

**不在本技能范围**：WiFi（见 `wifi-wireless`）、物理拆解与固件镜像（见 `hardware-security`）、
SDR/射频（见 `radio-sdr`）。

## 一、硬件前提（这一行最容易被忽略）

```text
能做 BLE 主动测试的硬件（三选一）：
  · 专用适配器：nRF52840 Dongle（约 ¥100，支持 sniffer + 注入，最推荐）
  · ESP32 开发板（约 ¥30，能跑 BLE 扫描与 HID 注入，性价比高）
  · 手机（Android 有 nRF Connect，能力受限但够做枚举）

**笔记本内置蓝牙只能做「被动扫描」，不能做注入/嗅探。**
判据：如果只有内置蓝牙，就只做 GATT 枚举与配对测试，不做 HID 注入与抓包。
```

```bash
# Linux 下的基础工具（本机是 Windows，需要 WSL 或一台 Linux）
sudo apt install bluez bluez-tools bluetooth
hciconfig                      # 确认适配器
sudo hcitool lescan            # BLE 扫描（被动）
sudo hcitool scan              # 经典蓝牙扫描
```

## 二、BLE 枚举（第一步，零风险）

### 2.1 扫描与识别

```bash
# 被动扫描（不发任何包，只听广播）
sudo hcitool lescan --duplicates
# 输出：MAC + 设备名（设备名可能为空，那是「不愿被发现」模式）

# 更好用：btlejack / bettercap 的 ble 模块
sudo bettercap -iface hci0
> ble.recon on
> ble.show
```

**判据（怎么从广播里判断设备类型）**：

| 广播内容 | 说明 |
| --- | --- |
| Service UUID `0x180F` | 电池服务（几乎都有，无信息量） |
| Service UUID `0x1809` | 健康温度计（医疗设备） |
| Service UUID `0x1812` | HID over GATT（**键鼠，注入目标**） |
| Service UUID `0x1815` | 自动化 IO（工业） |
| Service UUID `0xFEXX` | 厂商自定义（这里才是关键业务逻辑） |
| 设备名为空 + 可连接 | 常见于智能锁、工业传感器（不想被发现） |

### 2.2 GATT 枚举（读属性表）

```bash
# gatttool（经典，交互式）
sudo gatttool -b <MAC> -I
> connect
> primary                 # 列出所有 service
> characteristics         # 列出所有特征值（含权限位！）
> char-read-hnd 0x0016    # 读某个 handle
```

```bash
# 更现代：bluetoothctl（ble 模式）
bluetoothctl
> connect <MAC>
> list-attributes         # 全部属性
> select-attribute /org/bluez/hci0/dev_XX/service001b/char001c
> read
> write "0x01"
```

### 2.3 从 GATT 权限位看攻击面（**这是 BLE 测试的核心判据**）

```text
每条 characteristic 都有权限标记，用 `characteristics` 命令能看到：
  · READ            → 能读（可能泄露信息）
  · WRITE           → 能写（可能改配置/触发动作）
  · WRITE_NO_RESP   → 能写且不确认（更危险，无反馈）
  · NOTIFY          → 设备主动推送（能被动收集）
  · INDICATE        → 类似 notify 但要确认
  · ENCRYPT_READ / ENCRYPT_WRITE  → **需要配对后才能读写**

判据：
  出现 WRITE 而没有 ENCRYPT_ 前缀 = **未授权可写**
  → 这是 BLE 最常见的问题（厂商图省事，把配对当可选）
```

```bash
# 验证「未授权可写」：不配对直接写
sudo gatttool -b <MAC> --char-write-req -a 0x0016 -n 01
# 判据：返回 "Characteristic value was written successfully" = 真的可写
# 返回 "Insufficient authentication" = 有保护（需要配对）
```

**三类假成功**：
1. **写入成功但设备没反应** —— 值写进了一个不触发动作的特征值（很多设备有多个可写点）。
   判据：确认这个 handle 对应的是「控制点」而不是「配置缓存」。
2. **写入被回滚** —— 设备固件周期性复位配置。判据：写完隔 5-10 秒再读。
3. **读到了值但那是示例数据** —— 判据：连续读两次、操作设备后再读，看值是否随状态变化。

## 三、经典蓝牙：配对与劫持

| 攻击 | 原理 | 前提 | 影响 |
| --- | --- | --- | --- |
| **PIN 码暴力** | 4 位 PIN 只有 10000 种 | 设备允许重复尝试 | 配对成功 → 完全控制 |
| **Just Works 配对降级** | 强制对方用无鉴权配对 | 能干扰首次配对 | 中间人 |
| **KNOB 攻击**（CVE-2019-9506） | 降级密钥长度为 1 字节 | 双方都未打补丁 | 可暴力破解会话密钥 |
| **BlueBorne**（CVE-2017-1000251） | 蓝牙栈 RCE | 未打补丁的 Linux/Android | 无需配对即可 RCE |
| **音频劫持**（车载/音箱） | 抢占用已配对连接 | 设备可被重新连接 | 播放任意音频/窃听 |

```bash
# PIN 暴力（需要 spooftooph / btproxy 或自写）
# 现代设备多用 SSP（Secure Simple Pairing），PIN 暴力已基本失效
# 判据：先看配对时手机是否弹出「数字比对」——弹了就是 SSP，PIN 暴力无效
```

**判据**：**先判配对模式，再选攻击**。
- 弹「数字比对」（6 位数字，两边一样就确认）→ SSP，PIN 暴力无效，转 KNOB 或中间人
- 要求输 4 位 PIN → 老设备，PIN 暴力可行
- 无任何提示直接连上 → Just Works，本身就是漏洞（无鉴权）

## 四、BLE HID 注入（最有实战价值的一条）

```text
原理：BLE 键盘（HID over GATT）不需要驱动，配对后就是一台键盘。
      如果目标主机已经配对过某个 BLE 键盘，你能冒充那个键盘 → 直接注入按键。

影响：等于物理接触。可以在锁屏界面执行命令（部分系统允许），
      或在已登录会话里打命令、开浏览器下载载荷。
```

```bash
# ESP32 方案（最便宜）：烧 Arduino 的 BLE Keyboard 示例
# 或 Linux + 支持 HID 的适配器：
sudo bettercap -iface hci0
> ble.recon on
> ble.show                 # 找已配对的 HID 设备
> ble.enum <MAC>           # 看它的 HID 特征值
# 然后用 hid 注入脚本发送按键序列
```

**判据（能不能打）**：
1. 目标主机**已经配对过**某 BLE 键鼠（否则冒充不了）。
2. 该键鼠**不在线**（在线时两者会冲突，且用户会发现）。
3. 主机允许在锁屏界面接收 HID 输入（Windows 允许，部分 Linux 不允许）。

**验伤**：注入一串 `Win+R` → `notepad` → 回车。
**看到记事本真的打开了才算成功**（"发送成功"的返回值只代表包发出去了）。

## 五、RFID / NFC

> **合规前置**：门禁卡、工牌、支付卡涉及个人身份与金融数据。
> 没有明确书面授权不要碰；授权范围内也**只验证「能否读取/克隆」，不验证消费**。

| 卡类型 | 频率 | 能否克隆 | 判据 |
| --- | --- | --- | --- |
| ID 卡（EM4100） | 125 kHz | **能**（无加密，UID 即全部） | 用 Proxmark3 `lf search` 能读出 |
| MIFARE Classic（M1） | 13.56 MHz | **能**（Crypto1 已被破） | `hf mf autopwn` 能拿到全部扇区密钥 |
| MIFARE DESFire | 13.56 MHz | 难（AES 认证） | 只能做中继 |
| CPU 卡 | 13.56 MHz | 很难 | 需要侧信道 |
| NFC 支付卡 | 13.56 MHz | **不要碰**（金融） | — |

```bash
# Proxmark3 的判据流程
proxmark3 /dev/ttyACM0
> lf search              # 看是不是 125kHz
> hf search              # 看是不是 13.56MHz
> hf mf autopwn          # M1 卡：自动破全部密钥（需要一段时间）
> hf mf dump              # 导出卡内容
```

**判据**：**能 dump 出扇区内容 = 可克隆**。
只读到 UID 不等于可克隆（DESFire 也能读 UID，但克隆出来刷不开）。

## 六、无线侧取固件（配合 hardware-security）

BLE 设备常有 OTA（空中升级）通道。如果 OTA **没有签名校验**，可以：

```text
1. 抓 OTA 过程（nRF Sniffer / btlejack）→ 拿到固件包格式
2. 构造自己的固件包（改配置或加后门）
3. 通过 OTA 刷进去

判据：OTA 包有没有签名段。没有签名 = 可刷任意固件。
这一条的价值在于：**不需要拆机、不需要焊接，纯无线就能改固件**。
```

**风险**：刷错固件 = 设备变砖（不可恢复，除非有调试口）。
所以在生产设备上**只验证「OTA 无签名」这个事实，不实际刷**。

## 七、工具链

| 工具 | 用途 | 本机状态 |
| --- | --- | --- |
| `bluez`（hcitool/bluetoothctl/gatttool） | BLE 扫描、GATT 读写 | Linux 自带；**Windows 本机没有** |
| `bettercap`（ble 模块） | BLE 侦察与枚举 | 需自行安装（Go） |
| `btlejack` | BLE 嗅探与注入（需专用硬件） | 需 Micro:bit 或 nRF 适配器 |
| `nRF Connect`（手机 App） | 快速 GATT 枚举（零成本） | 手机装即可 |
| `ESP32`（Arduino BLE 库） | HID 注入、伪造外设 | 硬件 + 烧录 |
| `Proxmark3` | RFID/NFC 读写与克隆 | 需硬件（约 ¥300） |
| `nRF52840 Dongle` | BLE sniffer（官方固件） | 需硬件（约 ¥100） |

> **本机（Windows）限制**：没有 Linux 的 bluez 工具链，也没有蓝牙专用适配器。
> 能做的是：用手机 App（nRF Connect）做枚举，或用 WSL 跑 bluez（需要 USB 直通适配器）。
> **判据：没有专用硬件时，BLE 测试只能做到「枚举 + 配对测试」，做不到嗅探与注入。**

## 参考（深水区，按需加载）

- `references/ble-gatt-attack.md` —— GATT 权限位详解、常见服务的 UUID 表、
  未授权写的判断与验伤、HID 注入的完整按键序列构造。
- `references/rfid-nfc-cloning.md` —— 五种卡型的判据与克隆流程，
  含「读到 UID 不等于可克隆」的验证方法。
- `references/wireless-lab-rules.md` —— 无线测试的合规要求（频段/功率/干扰限制）。

## 落库要求

- `redteam_chain_add`：`stage_code=recon`（枚举）或 `exploit`（注入/克隆），
  `tool` 写设备类型 + MAC 前缀（**不要写完整 MAC**，报告对外时是敏感信息）。
- 未授权可写的特征值 → 记 `redteam_vuln_add`，detail 写 handle + UUID + 能触发的动作。
- 克隆出的卡 → **不落库**（涉及个人身份，只在报告里写「已证明可克隆」）。

## 任务完成自检

- [ ] 有专用适配器吗？只有内置蓝牙就只做枚举（不要声称做了嗅探）？
- [ ] GATT 枚举看的是**权限位**，不是只看能不能连？
- [ ] 声称「可写」时，真的写进去并**观察设备反应**了？
- [ ] HID 注入的验伤是「目标上真的出现了动作」，不是「包发送成功」？
- [ ] RFID 只验证读取/克隆，没做消费类验证？
- [ ] 刷固件只验证「无签名」这个事实，没实际刷（除非授权明确允许）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1200 | Hardware Additions（硬件植入与伪造外设） |
| 初始访问 | T1078 | 有效账号（配对即认证，配对成功等于拿到设备信任） |
| 收集 | T1005 | 本地系统数据（HID 注入后的操作与读取） |
| 发现 | T1046 | 网络服务发现（BLE 广播与 GATT 枚举） |
| 凭据访问 | T1552 | 不安全存储的凭据（GATT 可读特征值里的密钥/令牌） |
| 影响 | T1485 | 数据破坏（改设备配置 / 刷写固件） |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| BLE 扫描 | **通常无法检测**（被动收广播） | 无（这是它最大的优势） |
| 连接尝试 | 设备日志（多数不记） | 连接数异常、配对失败次数 |
| GATT 未授权写 | 设备日志（少数记） | 配置被改、设备行为变化 |
| HID 注入 | 主机 HID 驱动日志 + EDR | 锁屏状态下出现键盘输入；非常规时间的人机交互 |
| RFID 读取 | 门禁系统日志 | 同卡在异常时间/地点刷卡 |
| 克隆卡使用 | 门禁日志 | **同 UID 在两个读卡器短时间出现**（物理上不可能） |

**实用推论**：**短距无线的检测面极窄** —— 多数 BLE 设备根本不记日志，
主机侧也只能从「人机交互异常」反推 HID 注入。所以这类测试的价值不在于"打进去"，
而在于**证明「对方对这条通道完全无感知」**。
报告里最有用的结论是：**「我们能在 30 米内、不接触任何网络、不被任何日志记录地控制这台设备」**。

## 第二发（主力打不出去时，按这个顺序换）

1. **GATT 全要配对**（ENCRYPT_ 前缀）：转 `hardware-security`（拆机取调试口更快）
2. **没有 BLE 适配器**：只用手机 nRF Connect 枚举，转 `passive-recon` 看其他面
3. **设备强加固**（配对+绑定+签名 OTA）：转 `radio-sdr`（看射频层有没有其他通道）
4. **目标是有线外设**：转 `hardware-security`（USB/BadUSB 路径）
5. **需要进入内网**：BLE HID 注入成功后转 `lateral-movement`

**纪律**：**不要在有他人使用的设备上做 HID 注入**（会直接影响使用者）。
先在离峰时段、或已授权且无人使用的设备上验证。

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

（此节由 `scripts/inject-runnability.mjs` 生成，见文件末尾）

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

（此节由 `scripts/build-skill-graph.mjs` 生成，见文件末尾）

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`hardware-security`、`passive-recon`
- **下游**（产出交给谁）：`hardware-security`、`lateral-movement`
- **互补**（同类场景一起用）：`hardware-security`、`ot-ics`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`bettercap`
- `bettercap`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->
