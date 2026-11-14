# 沙箱编排：样本投递、行为采集、反沙箱对抗、结果解读

> 被 `malware-analysis` 引用。沙箱的价值在于**行为**，不在"跑没跑起来"。一次运行产生的
> 网络/进程/文件三条线，每条都要有归属。

## 一、四个平台的选择

| 平台 | 类型 | 优势 | 限制 |
| --- | --- | --- | --- |
| **CAPE** | 开源自建 | 完整 API hook、可定制、无样本外泄 | 需自建维护 |
| **Cuckoo**（旧） | 开源自建 | 生态成熟 | 已停维护，建议用 CAPE |
| **Joesandbox / Any.run** | 云 | 开箱即用 | 样本上传（保密性） |
| **本地 VM + 手工** | 自建 | 完全可控 | 需要人工分析 |

```bash
# CAPE 最小部署（docker compose）
git clone https://github.com/kevoreilly/CAPEv2.git
cd CAPEv2 && docker compose up -d
# 提交样本
curl -F "file=@sample.exe" http://localhost:8000/apiv2/tasks/create/file/
```

**选择原则**：

- 敏感样本 → 自建（CAPE）
- 快速初筛 → 云沙箱（注意保密条款）
- 需要精细控制 → 本地 VM + Procmon/Wireshark

## 二、样本投递

```bash
# 提交到 CAPE
curl -s -F "file=@sample.exe" http://127.0.0.1:8000/apiv2/tasks/create/file/ | jq .
# {"task_id": 1, "status": "ok"}

# 查结果
curl -s http://127.0.0.1:8000/apiv2/tasks/get/report/1/ | jq '.behavior.processes[].process_name' | head
curl -s http://127.0.0.1:8000/apiv2/tasks/get/report/1/ | jq '.network.hosts'

# 下载 pcap
curl -s -o dump.pcap http://127.0.0.1:8000/apiv2/tasks/get/pcap/1/

# 下载全量文件
curl -s -o files.zip http://127.0.0.1:8000/apiv2/tasks/get/dropped/1/
```

**投递时的五个控制项**：

| 项 | 建议 |
| --- | --- |
| 运行时长 | 3-5 分钟（短的会漏延迟行为） |
| 是否联网 | 先不联网看本地行为，再联网看 C2 |
| 是否需要交互 | 有些样本等用户点击（需要模拟） |
| 快照清理 | 每次运行前恢复快照（避免污染） |
| 反 VM 检测 | 见 §4 |

## 三、行为采集：三条线

### 3.1 进程线

```bash
# CAPE 报告里的进程树
curl -s http://127.0.0.1:8000/apiv2/tasks/get/report/1/ \
  | jq -r '.behavior.processes[] | "\(.process_id) \(.process_name) \(.command_line)"' | head -20
```

```powershell
# 本地手工：Sysmon 事件 1（进程创建）+ 3（网络）+ 11（文件创建）
Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' |
  Where-Object {$_.Id -in 1,3,11,22} | Select-Object -First 50 |
  ForEach-Object { $_.Message }
```

**关键观察**：

- 父进程链（`winword.exe → cmd.exe → powershell.exe` 是宏文档落地）
- 命令行（含编码的 PowerShell、`-enc`、`IEX`）
- 注入（`CreateRemoteThread`、`QueueUserAPC`、`Process Hollowing`）
- 伪装（`svchost.exe` 但路径不在 `System32`）

### 3.2 网络线

```bash
# CAPE 的网络摘要
curl -s http://127.0.0.1:8000/apiv2/tasks/get/report/1/ \
  | jq '{hosts: .network.hosts, dns: .network.dns, domains: .network.domains}'

# pcap 分析
tshark -r dump.pcap -q -z conv,tcp | head -20
tshark -r dump.pcap -Y 'dns.flags.response==0' -T fields -e dns.qry.name | sort -u
tshark -r dump.pcap -Y 'tls.handshake.extensions_server_name' -T fields -e tls.handshake.extensions_server_name | sort -u
```

**关键观察**：

- 首次外联的域名/IP（C2 候选）
- 心跳间隔（固定 60s 是 C2 特征）
- 数据外传（大流量 POST）
- 非标准端口/协议（`data` 协议）

### 3.3 文件线

```bash
# CAPE 的落地文件列表
curl -s http://127.0.0.1:8000/apiv2/tasks/get/report/1/ \
  | jq -r '.target.file.created[]' | head -20

# 下载并分析落地文件
curl -s -o dropped.zip http://127.0.0.1:8000/apiv2/tasks/get/dropped/1/
unzip -o dropped.zip -d dropped/
for f in dropped/files/*; do file "$f"; done
```

**关键观察**：

- 落地位置（`%APPDATA%`/`%TEMP%`/`Startup`/`System32`）
- 自启动（Run 键、计划任务、服务）
- 加密/加壳的二次载荷
- 配置文件（C2 地址、密钥）

## 四、反沙箱对抗（四类）

| 类 | 手法 | 沙箱里的表现 | 应对 |
| --- | --- | --- | --- |
| **环境检测** | 查 VM 特征（注册表、进程、MAC、磁盘大小） | 样本不执行/立即退出 | 加固 VM（改 MAC、装 VMware Tools 或用裸机） |
| **时序检测** | 查启动后经过的时间 | 沙箱跑太快/太慢 | 延时执行（沙箱要跑够 5 分钟） |
| **交互检测** | 等鼠标移动/窗口点击 | 无交互 → 不触发 | 自动化交互（`pyautogui`/CAPE 的 human 模块） |
| **分析工具检测** | 查 Procmon/Wireshark/调试器 | 检测到就退出 | hook 掉这些检测；用内核级采集 |

```bash
# 常见的 VM 检测点（加固时逐项改）
# 1) 注册表
reg query "HKLM\HARDWARE\DESCRIPTION\System\BIOS" /v SystemManufacturer
# "VMware, Inc." / "innotek GmbH" / "QEMU" → 被识别

# 2) 进程
tasklist | findstr /i "vmtoolsd vboxservice qemu-ga"

# 3) MAC 前缀
getmac /v
# 00:0C:29 / 00:50:56 / 08:00:27 → VM

# 4) 磁盘大小
wmic logicaldisk get size,freespace,caption
# < 60GB 常被判定为沙箱

# 5) CPU 核数
wmic cpu get NumberOfCores
# 1-2 核 → 可疑

# 6) 内存
wmic ComputerSystem get TotalPhysicalMemory
# < 2GB → 可疑
```

```bash
# 反反沙箱的一些技巧（授权研究范围内）
# 1) 给 VM 更多资源（4 核 8GB 100GB 磁盘）
# 2) 改 SMBIOS（用 qemu 的 -smbios 参数）
qemu-system-x86_64 ... -smbios type=1,manufacturer="Dell Inc.",product="OptiPlex 7090"
# 3) 装常见软件（Office/Chrome/微信），让环境看起来"有人用"
# 4) 放一些用户文档在 Desktop/Documents
# 5) 保持一段时间的历史（浏览器历史、最近文件）
```

## 五、结果解读：哪些行为是真恶意

| 行为 | 恶意判据 | 可能无害 |
| --- | --- | --- |
| 创建进程 | 父进程异常（Office→cmd） | 正常安装器 |
| 网络外联 | 非常规端口 + 固定心跳 | 更新检查 |
| 文件写入 | 写到自启动位置 | 写日志/缓存 |
| 注册表修改 | `Run`/`Services` 键 | 正常配置 |
| 进程注入 | `CreateRemoteThread` 到非自身 | 某些保护软件 |
| 加密文件 | 大量文件被改名/加密 | 压缩/备份 |

```bash
# 一条命令汇总"高危行为"
curl -s http://127.0.0.1:8000/apiv2/tasks/get/report/1/ | jq '{
  injection: [.behavior.processes[] | select(.calls[]?.api | test("CreateRemoteThread|QueueUserAPC|WriteProcessMemory"))] | length,
  persistence: [.behavior.summary.write_keys[]? | select(test("CurrentVersion\\\\\\\\Run|Services"))] ,
  autostart: .behavior.summary.startup,
  c2: .network.domains
}'
```

## 六、验伤：沙箱结论的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 样本执行了 | 进程树有该样本 + 子进程 | 只有样本进程但立即退出 |
| 有 C2 | pcap 里有实际数据交换（非仅 DNS） | 只有 DNS 查询（可能是探活） |
| 有持久化 | 注册表键/计划任务真的被创建 | 只是调用了 API 但失败 |
| 有外传 | POST body 含数据 | 只有 GET 心跳 |
| 反沙箱 | 在加固环境里行为改变 | 一次偶然不执行 |

**核心判据**：**行为必须能与其它证据对应**（进程 → 网络 → 文件）。孤立的"调用了 API"
不算。

## 七、检测视角

| 手法 | 信号 |
| --- | --- |
| 样本投递 | 沙箱出口流量（云沙箱）；本地沙箱无 |
| 反沙箱检测 | 样本在 VM 里不执行（对比裸机） |
| C2 心跳 | 固定间隔的等长包 |
| 数据外传 | 大流量出站 + 非标准端口 |
| 持久化 | Run 键/计划任务/服务创建 |

## 八、常见坑

1. **运行时长太短**——很多样本延迟 2-5 分钟才行动。设 300 秒以上。
2. **不恢复快照**——第二次跑受第一次污染（文件已存在 → 样本走不同分支）。
3. **只看 CAPE 的"malicious"评分**——评分是启发式，要看具体行为。
4. **忽略 DNS**——很多样本只用 DNS 做 C2（DNS 隧道）。必须看 DNS 查询。
5. **不加固 VM**——样本检测到沙箱直接退出，得到"无害"的错误结论。
6. **样本外泄风险**——云沙箱上传前确认保密条款；敏感样本用自建。
7. **不采集内核层**——用户层 hook 会被绕过。CAPE 的 kernel 监控能补。
8. **不记录快照 ID**——复现需要知道"在哪个快照跑的"。每次记录基线快照。