# 调试接口判型：UART / JTAG / SWD / SPI Flash 的识别与命令

> 被 `hardware-security` 引用。硬件调试的第一步永远是**找地（GND）**，因为所有信号都以它
> 为参考。找不到 GND，后面全是猜。

## 一、通用起点：找 GND 与电压

```bash
# 万用表（蜂鸣档）测通断
# 1) 黑表笔接 USB 外壳/屏蔽罩/大电容负极（公认地）
# 2) 红表笔逐个点排针，响 → 是 GND
# 3) 量到多个 GND 是正常的（板子内部连通）
```

```bash
# 上电后测每个针脚的电压（万用表直流档，黑笔接 GND）
# 3.3V / 5V / 1.8V 是电源；0V 可能是 GND 或未激活的信号
# 悬空针（浮动的 1.5-2.5V）通常是未定义/未使用
```

| 电压 | 含义 |
| --- | --- |
| 3.3V 稳定 | VCC（主供电） |
| 0V 且与外壳通 | GND |
| 3.3V 且**上电瞬间有跳变** | 可能是 UART TX（启动时打印日志） |
| 1.8V | 低压逻辑（部分 SoC） |
| 0V 但上电后变 3.3V | 使能/复位脚 |

## 二、UART：四步识别

### 2.1 找 TX（最关键）

**方法 A：上电瞬间看跳变**

```bash
# 用万用表（直流档）或示波器
# 目标：找到上电时电压抖动的针 —— 那是 TX（打印启动日志）
# RX 通常保持高电平不动
```

**方法 B：逻辑分析仪 + 自动波特率**

```bash
# 用 Saleae / sigrok 抓 4 个候选针，上电
sigrok-cli -d saleae-logic16 --channels D0,D1,D2,D3 --time 5s -o uart_capture.sr
# 用 PulseView 打开，加 UART 解码器，试 9600/115200
```

```bash
# 更省事：用 Arduino/ESP 做 UART 嗅探（不需要逻辑分析仪）
# 把候选针接到 Arduino 的 RX，跑下面的 sketch，尝试多个波特率
```

```cpp
// Arduino UART sniffer
void setup() {
  Serial.begin(115200);          // 到电脑
}
void loop() {
  const long bauds[] = {9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600};
  for (long b : bauds) {
    Serial1.begin(b);            // 接目标 TX 的引脚
    unsigned long t = millis();
    while (millis() - t < 500) {
      if (Serial1.available()) {
        Serial.print("[baud "); Serial.print(b); Serial.print("] ");
        while (Serial1.available()) Serial.write(Serial1.read());
        Serial.println();
      }
    }
    Serial1.end();
  }
}
```

**方法 C：直接试（最常见）**

```bash
# 用 USB-TTL（CH340/CP2102/FT232），只接 GND + TX（先不接 RX，避免冲突）
# 波特率试：115200 → 9600 → 57600 → 38400 → 230400
picocom -b 115200 /dev/ttyUSB0
# 或
screen /dev/ttyUSB0 115200
# 或
minicom -D /dev/ttyUSB0 -b 115200
```

```powershell
# Windows：用 PuTTY 或
# 找 COM 口
Get-WmiObject Win32_SerialPort | Select-Object DeviceID, Description
```

```bash
# 一条命令自动试所有波特率
for b in 115200 9600 57600 38400 230400 460800 921600; do
  echo "--- $b"
  timeout 3 stty -F /dev/ttyUSB0 $b raw -echo && \
  timeout 3 cat /dev/ttyUSB0 | head -c 200 | strings
done
```

### 2.2 找 RX（需要发数据才知道）

```bash
# 接上 TX 后能收到日志，但要交互（如按回车进 shell）需要 RX
# 方法：把候选针接 USB-TTL 的 TX，用串口发回车，看是否有反应
```

```bash
# 用 python 脚本逐个试 RX 针（需要配合继电器/手动换线）
python3 - <<'PY'
import serial, time
s = serial.Serial('/dev/ttyUSB0', 115200, timeout=1)
time.sleep(0.2)
s.write(b'\r\n')
time.sleep(0.5)
print(s.read(4096))
PY
```

### 2.3 常见引脚布局

| 布局 | 说明 |
| --- | --- |
| 4 pin 一排：`VCC TX RX GND` | 最常见（丝印常标） |
| 4 pin 一排：`GND RX TX VCC` | 反序，需实测 |
| 3 pin：`GND TX RX` | 无 VCC（板子自供电） |
| 6 pin（含 DTR/CTS） | 可能带流控 |
| 2.54mm 排针 | 标准 |
| 1.27mm / 焊盘 | 需探针或飞线 |

### 2.4 UART 常见坑

| 坑 | 现象 | 解决 |
| --- | --- | --- |
| **TX/RX 接反** | 收不到任何东西 | 对调 |
| **只接地没接 TX** | 收到乱码或空 | 检查 GND 是否真通 |
| **波特率不对** | 乱码（如 `ÿØÿà`） | 逐个试（见上） |
| **电平不匹配** | 收到乱码/无 | 3.3V 板用 3.3V TTL，别用 5V（会烧） |
| **RX 接了但没反应** | 有日志但不接受输入 | 可能需要按回车/特定字符；或 RX 是另一根针 |
| **启动日志只打一次** | 错过就没了 | 上电瞬间开始录；或触发复位 |

## 三、JTAG：引脚识别与 OpenOCD

### 3.1 JTAG 的五个必需信号

| 信号 | 全称 | 作用 |
| --- | --- | --- |
| **TCK** | Test Clock | 时钟（其他信号同步于它） |
| **TMS** | Test Mode Select | 状态机控制 |
| **TDI** | Test Data In | 数据输入 |
| **TDO** | Test Data Out | 数据输出 |
| **TRST** | Test Reset | 可选 |
| GND | — | 必须 |

### 3.2 识别方法

**方法 A：JTAGulator（专用工具）**

```bash
# 接上候选针（最多 24 个），自动扫
# JTAGulator 串口交互：
> j                        # JTAG 扫描
> 1 2 3 4 5 6 7 8         # 指定引脚
# 输出：TDI=..., TDO=..., TCK=..., TMS=...
```

**方法 B：识别 IDCODE（最可靠）**

```bash
# 用 OpenOCD 试多种 pin 组合（较慢，但对已知芯片很快）
# 先查芯片手册的 JTAG 引脚（最快）
```

```bash
# OpenOCD 配置（以 STM32 为例）
openocd -f interface/ftdi/ft232h.cfg \
        -c 'transport select jtag' \
        -c 'adapter speed 1000' \
        -f target/stm32f4x.cfg
# 输出 "Info : stm32f4x.cpu: hardware has 6 breakpoints" → 连上了
```

**方法 C：从丝印/手册查**

```
丝印 "J1" 旁边有 20 pin → 可能是标准 ARM JTAG (20-pin)
丝印 "SWD" → SWD（两线）
丝印 "JTG" / "DEBUG" → JTAG
```

### 3.3 标准 20-pin JTAG 布局（ARM）

```
Pin 1  = VTREF      Pin 2  = NC
Pin 3  = nTRST      Pin 4  = GND
Pin 5  = TDI        Pin 6  = GND
Pin 7  = TMS        Pin 8  = GND
Pin 9  = TCK        Pin 10 = GND
Pin 11 = RTCK       Pin 12 = GND
Pin 13 = TDO        Pin 14 = GND
Pin 15 = nRESET     Pin 16 = GND
Pin 17 = NC         Pin 18 = GND
Pin 19 = NC         Pin 20 = GND
```

```bash
# 用万用表验证：Pin 4/6/8/10/12/14/16/18/20 应全部与 GND 通
# Pin 1 应是 3.3V（VTREF）
```

## 四、SWD：两线调试

| 信号 | 引脚 | 说明 |
| --- | --- | --- |
| **SWDIO** | 通常与 JTAG 的 TMS 复用 | 双向数据 |
| **SWCLK** | 通常与 JTAG 的 TCK 复用 | 时钟 |
| **SWO** | 可选 | 单向外设输出（printf 调试） |
| nRESET | 可选 | 复位 |
| GND | 必须 | — |

```bash
# OpenOCD 连 SWD（最常见的 ST-Link）
openocd -f interface/stlink.cfg -f target/stm32f1x.cfg

# 或 J-Link
openocd -f interface/jlink.cfg -c 'transport select swd' -f target/nrf52.cfg

# 成功后可以：
# - 读 flash：dump_image / flash read_bank
# - 下断点、改内存
```

```bash
# 用 OpenOCD 的 telnet 接口交互
telnet 127.0.0.1 4444
> halt
> mdw 0x08000000 16        # 读 16 个字（内存）
> flash banks
> dump_image firmware.bin 0x08000000 0x100000
> resume
> exit
```

```bash
# 读保护（RDP）的芯片会拒绝连接：
# "Error: init mode failed (unable to connect to the target)"
# 处理：部分芯片可用 "解锁"（会擦除全片）——这是破坏性操作，须授权
```

## 五、SPI Flash 直读

### 5.1 识别 Flash 芯片

```bash
# 看芯片丝印（8 pin SOP-8 最常见）
# 例：W25Q128JVSIQ → Winbond 128Mbit (16MB) SPI Flash
# 常见：W25Q64 (8MB)、W25Q128 (16MB)、MX25L25635F (32MB)、S25FL128
```

```bash
# 查数据手册确认引脚（8-pin SOP-8 的标准布局）：
# 1 = /CS    2 = DO (MISO)   3 = /WP   4 = GND
# 5 = DI (MOSI)  6 = CLK     7 = /HOLD 8 = VCC
```

### 5.2 用 CH341A 编程器直读

```bash
# 硬件：CH341A + SOP8 夹子（需断电，最好取下芯片或用夹子）
# 软件：flashrom
flashrom -p ch341a_spi
# 输出应识别出芯片型号与容量

# 读取
flashrom -p ch341a_spi -r firmware.bin

# 读两次比对（确认稳定）
flashrom -p ch341a_spi -r fw1.bin && flashrom -p ch341a_spi -r fw2.bin && cmp fw1.bin fw2.bin
# 不一致 → 接触不良或芯片在跑（需断电/断 CS）

# 写回（授权范围内，谨慎）
flashrom -p ch341a_spi -w new.bin
```

```bash
# 若识别失败
# 1) 夹子接触不良（最常见）
# 2) 芯片被 SoC 占用（需断开 SoC 或拉住 /CS）
# 3) 电压不对（1.8V 芯片用 3.3V 会读错/损坏）
# 4) 芯片型号不在 flashrom 支持列表
```

```bash
# 手工指定芯片型号
flashrom -p ch341a_spi -c "W25Q128.V" -r fw.bin

# 列出支持的芯片
flashrom -L | grep -i w25q | head -20
```

### 5.3 分析读出的固件

```bash
# 判断文件系统/结构
binwalk firmware.bin
file firmware.bin

# 提取
binwalk -eM firmware.bin

# 找字符串
strings -n 8 firmware.bin | grep -iE 'password|admin|http|key' | head -20

# 熵分析（找加密/压缩段）
binwalk -E firmware.bin
```

## 六、其他接口

| 接口 | 引脚 | 用途 | 工具 |
| --- | --- | --- | --- |
| **I2C** | SDA/SCL | EEPROM、传感器 | `i2cdetect`（树莓派）、Bus Pirate |
| **SPI** | MOSI/MISO/CLK/CS | Flash、显示屏 | flashrom、逻辑分析仪 |
| **eMMC** | CLK/CMD/DAT0-7 | 大容量存储 | eMMC 读卡器、`mmc-utils` |
| **NAND** | 多线 | 大容量 Flash | NAND 读卡器 |
| **CAN** | CANH/CANL | 车载 | CANable、`candump` |
| **RS232/485** | TX/RX | 工业 | USB-485 转换器 |
| **BDM** | — | 老 Freescale | BDM 调试器 |

```bash
# I2C 扫描（树莓派）
sudo apt install i2c-tools
i2cdetect -y 1
# 输出矩阵里的数字是设备地址（如 0x50 = EEPROM）

# 读 EEPROM
i2cdump -y 1 0x50

# CAN 总线
sudo ip link set can0 up type can bitrate 500000
candump can0
```

## 七、验伤：调试接口的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| UART 找到 | 收到**可读的启动日志**（含版本、内核信息） | 收到乱码（波特率错） |
| UART shell | 能执行命令（`ls`/`cat` 有输出） | 只看到日志（只读） |
| JTAG/SWD 连上 | OpenOCD 报 `hardware has N breakpoints` | 报 `unable to connect`（引脚错/芯片锁） |
| 读到 Flash | 两次读取一致 + binwalk 能识别结构 | 读到全 FF（未连接）/全 00 |
| 提取到固件内容 | 解出文件系统（squashfs/cramfs） | 只有裸数据 |
| 找到凭据 | 明文口令 + **能用它登录** | 只是看到类似字符串 |

## 八、检测视角（硬件侧很难检测，靠物理与供应链）

| 手法 | 信号 | 特征 |
| --- | --- | --- |
| 调试接口接入 | 物理（无日志） | 需靠外壳防拆封条、灌封胶 |
| 固件读取 | 启动日志异常 | 若 BootROM 有日志，可能记录调试口激活 |
| JTAG 使能 | SoC 寄存器 | 部分芯片有 "debug disabled" 熔丝，可查 |
| Flash 改写 | 启动 hash 校验 | Secure Boot 会拒绝改过的固件 |
| 串口 shell | 设备日志 | 生产设备不应有可交互 shell |

## 九、常见坑

1. **没共地**——USB-TTL 的 GND 必须接目标 GND，否则收到乱码。
2. **5V TTL 接 3.3V 板**——会烧芯片。先量目标电压。
3. **TX/RX 接反**——收不到东西。对调再试。
4. **波特率只试 115200**——很多设备是 9600 或 57600。全试。
5. **JTAG 引脚猜错**——用 JTAGulator 或查芯片手册。硬猜浪费大量时间。
6. **SPI Flash 被 SoC 占用**——读出来全是 FF 或乱码。需断电、或拉住 /CS、或取下芯片。
7. **CH341A 的 3.3V/5V 跳线**——很多廉价 CH341A 默认输出 5V，接 3.3V 芯片会损坏。**先改跳线或改线**。
8. **SWD 的 nRESET 没接**——某些芯片需要复位才能连上。接上再试。
9. **固件读两次不一致**——接触不良或芯片在运行。重读、换夹子、断 CS。
10. **忘记记录引脚映射**——找到后立刻拍照 + 画图标注，否则换个角度就忘了。