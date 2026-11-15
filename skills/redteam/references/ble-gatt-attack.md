# BLE GATT 攻击手册

被 `bluetooth-wireless-attack` 引用。

**BLE 的最大特点**：设备暴露的是「属性表」（GATT），每条属性自己声明权限。
所以测试的核心**不是「能不能连上」**（几乎都能），而是「**哪条属性没有权限保护**」。

---

## 一、GATT 结构（先理解层次）

```text
Device（设备，一个 MAC）
  └── Service（服务，一个功能域，有 UUID）
        └── Characteristic（特征值，可读写的最小单元，有 UUID + 权限位）
              └── Descriptor（描述符，如 CCCD 用于开关 notify）
```

**判据**：找有意义的攻击面，看 **Service UUID**：
- 标准 UUID（`0x180F` 电池、`0x180A` 设备信息）→ 通常只读，价值低
- **厂商自定义 UUID**（`0xFEXX` 或 128 位）→ **业务逻辑都在这里**，重点看
- `0x1812` HID → 键鼠，注入目标

## 二、权限位（本手册的核心）

`gatttool` 的 `characteristics` 输出形如：

```text
handle: 0x0016, char properties: 0x1a, char value handle: 0x0017, uuid: 0000fff1-...
```

`char properties` 是位掩码：

| 位 | 名称 | 含义 | 攻击价值 |
| --- | --- | --- | --- |
| 0x01 | Broadcast | 广播时可读 | 低 |
| 0x02 | **Read** | 可读 | **信息泄露** |
| 0x04 | **Write No Response** | 可写且不确认 | **最高危**（无反馈，不容易被发现） |
| 0x08 | **Write** | 可写（有确认） | **高危**（改配置/触发动作） |
| 0x10 | Notify | 主动推送 | 中（可被动收集） |
| 0x20 | Indicate | 推送+确认 | 中 |
| 0x40 | Auth Signed Write | 需签名写 | 低 |
| 0x80 | Extended Props | 扩展 | — |

**关键判据：权限位只说明「属性支持什么操作」，不说明「是否需要配对」。**
是否要认证由**上层**（characteristic 的 security requirement）决定，`gatttool` 不显示。
所以**必须实际试一次**：

```bash
# 不配对，直接写
gatttool -b <MAC> --char-write-req -a 0x0016 -n 01
# 三个结果：
#   "Characteristic value was written successfully"  → 未授权可写（漏洞）
#   "Insufficient authentication"                     → 需要配对（正常）
#   "Insufficient encryption"                         → 需要加密链路（正常）
```

## 三、按服务类型找攻击面

### 3.1 电池/设备信息服务（0x180F / 0x180A）

通常只读，但**能读出型号与固件版本** → 用于查 CVE。

```bash
gatttool -b <MAC> --char-read -a 0x003a    # 通常是 Manufacturer Name String
```

### 3.2 HID over GATT（0x1812）—— 注入目标

| Characteristic | 用途 |
| --- | --- |
| HID Information | 版本与国别 |
| **HID Control Point** | 挂起/退出 |
| **Report Map** | 描述按键映射的字节结构 |
| **Report** | 实际的按键数据（**这是注入点**） |
| Protocol Mode | 报告协议/启动协议 |

```text
注入原理：找到 Report characteristic（通常可写 + notify），
往它写入 HID report 字节 → 主机当作键盘按键处理。

难点：Report Map 描述了字节格式（modifier byte + keycode array）。
      不同键盘的 Report Map 不同，要按它构造。
      最简单的做法：冒充一个已知型号（如常见罗技键盘），用它的标准 8 字节格式。
```

### 3.3 自定义业务服务（0xFEXX）

这类没有标准，只能看 **UUID 的命名**与**读写行为**：

```bash
# 枚举全部属性并 dump
gatttool -b <MAC> -I
> connect
> primary
> characteristics
> char-read-hnd 0x0017    # 逐个读，看返回内容像什么（JSON/密钥/状态）
```

**判据（从返回值猜语义）**：
- 返回可读 ASCII → 可能是配置、序列号、token
- 返回固定长度二进制 → 可能是密钥/哈希
- 读出来在操作设备后变化 → 状态值（可用来确认写操作是否生效）

## 四、验伤（BLE 三类假成功）

1. **写入成功但设备没反应**
   值写进了「配置缓存」而不是「控制点」。判据：确认这个 handle 对应的 UUID 是不是控制类。
2. **写入被固件周期性复位**
   判据：写完隔 5-10 秒再读，看是不是回滚了。
3. **读到的是示例/默认值**
   判据：连续读两次 + 操作设备后再读，看是否随状态变化。

**最硬的验伤**：**让设备产生一个物理可观察的变化**（锁开了、灯亮了、电机转了）。
BLE 的返回值只代表「包发出去了并被 ACK」，不代表业务逻辑执行了。

## 五、常见厂商错误（按出现频率）

| 错误 | 后果 | 怎么判 |
| --- | --- | --- |
| 控制点可写但无认证 | 任意人可控制设备 | `char-write-req` 成功 |
| 配对用 Just Works（无鉴权） | 中间人可插入 | 配对时无数字比对提示 |
| 固定 PIN（0000/1234） | 可暴力 | 试默认 PIN |
| 读属性泄露密钥 | 可伪造设备身份 | 读到 16/32 字节二进制 |
| 无连接数限制 | 可拒绝服务 | 反复连接看是否拒绝新连接 |
| OTA 无签名 | 可刷任意固件 | 抓 OTA 包看有无签名字段 |

## 六、常见坑

1. **以为 `properties` 显示 Write 就能写** —— 实际还要过 security requirement。必须试。
2. **用笔记本内置蓝牙做注入** —— 内置蓝牙通常不支持 peripheral 模式（不能冒充设备）。
3. **忘记 MAC 是随机化的** —— 现代手机/设备用 RPA（可解析私有地址），MAC 会变。
   固定 MAC 的设备说明设计较老（更好打）。
4. **在设备在线时冒充** —— 会冲突，用户会发现。要等它断开。
5. **写入后立刻读回** —— 有些设备写入是异步的，要等 100-500ms。
6. **忽略 MTU** —— 默认 MTU 23 字节（有效载荷 20 字节）。长数据要协商 MTU 或分片。

## 七、最小工具集（不需要专用硬件时）

```text
手机装 nRF Connect（免费）：
  · 扫描 → 看广播里的 Service UUID（判设备类型）
  · 连接 → 展开 GATT → 每个 characteristic 都能直接读写
  · 能做的：枚举、单个读写、开 notify
  · 不能做的：嗅探、注入、伪造外设

判据：nRF Connect 能完成「枚举 + 未授权写验证」这两步 ——
      这已经能证明大部分 BLE 漏洞。剩下的是硬件门槛，不是技术门槛。
```