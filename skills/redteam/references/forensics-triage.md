# 取证三角：易失性顺序、关键工件、时间线与证据完整性

> 被 `digital-forensics` 引用。核心是**顺序**：先取会消失的，再取会变的，最后取不变的。
> 顺序错了，你拿到的数据已经被自己的操作污染了。

## 一、易失性顺序（RFC 3227 的实战版）

| 顺序 | 对象 | 为什么最先 | 采集命令 | 污染风险 |
| --- | --- | --- | --- | --- |
| 1 | CPU 寄存器 / 缓存 | 断电即失 | 一般放弃（除内存取证） | — |
| 2 | **内存** | 关机即失；含密钥/进程/网络 | `winpmem` / `avml` / `LiME` | 采集工具会改内存（先记录工具名与 hash） |
| 3 | **网络状态** | 连接随时断 | `netstat -ano`、`ss -antp`、`arp -a` | 查询本身不改连接 |
| 4 | **运行进程** | 进程会退出 | `pslist`/`Get-Process`/`/proc` | 读 `/proc` 一般无污染 |
| 5 | 临时文件 / 交换 | 会被覆盖 | 复制到外部 | 复制改变 atime（先记 `stat`） |
| 6 | **磁盘** | 相对稳定 | 镜像（`dd`/`FTK Imager`） | **必须只读挂载 + 写保护** |
| 7 | 日志 / 归档 | 会被轮转 | 导出 | 导出会改 atime |
| 8 | 备份 / 离线介质 | 最稳定 | 后续处理 | — |
| 9 | 配置 / 拓扑 | 文档 | 记录 | — |

```text
"三不"原则：
  □ 不关机（除非要 dump 加密密钥/内存）
  □ 不在原盘上操作（一律镜像后分析）
  □ 不执行目标系统上的不可信程序（会改状态）
```

## 二、Windows 关键工件表

| 工件 | 路径 | 内容 | 解析工具 |
| --- | --- | --- | --- |
| **注册表 hive** | `C:\Windows\System32\config\{SAM,SECURITY,SYSTEM,SOFTWARE}` | 账户/策略/服务/驱动/软件 | `regipy`、RegRipper、`python-registry` |
| **用户 hive** | `C:\Users\<u>\NTUSER.DAT`、`UsrClass.dat` | 用户配置/Run/最近文档 | 同上 |
| **EVTX** | `C:\Windows\System32\winevt\Logs\*.evtx` | 事件日志 | `evtx_dump`、`python-evtx`、EvtxECmd |
| **Prefetch** | `C:\Windows\Prefetch\*.pf` | 程序执行（含首次/次数） | PECmd、`prefetch-parser` |
| **Shimcache（AppCompatCache）** | SYSTEM hive `...\ControlSet001\Control\Session Manager\AppCompatCache` | 曾存在的可执行文件（**存在≠执行**） | `shimcache`（Zimmerman）、RegRipper |
| **Amcache** | `C:\Windows\AppCompat\Programs\Amcache.hve` | 执行过的程序（含 SHA1） | AmcacheParser、`regipy` |
| **BAM/DAM** | SYSTEM hive `...\Services\bam\State\UserSettings\<SID>` | 后台活动（执行时间） | `regipy` 自定义解析 |
| **SRUM** | `C:\Windows\System32\sru\SRUDB.dat` | 网络/资源使用（按 app） | SrumECmd |
| **USN Journal** | `$Extend\$UsnJrnl:$J` | 文件系统变更流水 | `MFTECmd`、`usn.py` |
| **$MFT** | `$MFT` | 文件记录（含 MACB） | `MFTECmd`、`analyzeMFT` |
| **LNK** | `C:\Users\<u>\AppData\Roaming\Microsoft\Windows\Recent\*.lnk` | 最近打开的文件 | LECmd |
| **JumpList** | `...\Recent\AutomaticDestinations\*.automaticDestinations-ms` | 应用跳转列表 | JLECmd |
| **回收站** | `C:\$Recycle.Bin\<SID>\` | 删除的文件（`$I` 元数据 + `$R` 内容） | RBCmd |
| **浏览器** | `...\AppData\Local\{Google\Chrome,Microsoft\Edge}\User Data\Default\History` | 访问/下载 | `hindsight`、DB Browser |
| **WMI 持久化** | `C:\Windows\System32\wbem\Repository\OBJECTS.DATA` | WMI 订阅 | `WMI_Forensics`（python） |
| **任务计划** | `C:\Windows\System32\Tasks\*` + `System32\config\SOFTWARE\...\TaskCache` | 计划任务 | 直接读 XML + 注册表 |
| **服务** | SYSTEM hive `...\Services\<name>` | 服务配置/二进制路径 | RegRipper |
| **PowerShell 日志** | `...\winevt\Logs\Microsoft-Windows-PowerShell%4Operational.evtx` | 脚本块（4104） | `evtx_dump` |
| **Defender 日志** | `...\winevt\Logs\Microsoft-Windows-Windows Defender%4Operational.evtx` | 检测/扫描 | 同上 |
| **RDP 痕迹** | `...\Terminal Server\Client` 键、`Microsoft-Windows-TerminalServices-*` | 来源 IP/用户 | 注册表 + EVTX |

```powershell
# 采集（只读取，不改文件）
# 1) hive（被占用需先 copy 或用 reg save）
reg save HKLM\SYSTEM  C:\out\SYSTEM.hiv
reg save HKLM\SOFTWARE C:\out\SOFTWARE.hiv
reg save HKLM\SAM C:\out\SAM.hiv
reg save HKLM\SECURITY C:\out\SECURITY.hiv
reg save HKU\<SID> C:\out\NTUSER.hiv

# 2) EVTX
wevtutil epl Security C:\out\Security.evtx
wevtutil epl System C:\out\System.evtx
wevtutil epl "Microsoft-Windows-Sysmon/Operational" C:\out\Sysmon.evtx

# 3) 文件（用 robocopy 保留时间戳）
robocopy C:\Windows\Prefetch C:\out\Prefetch /E /COPYALL /R:0
robocopy "C:\Users\alice\AppData\Roaming\Microsoft\Windows\Recent" C:\out\Recent /E /COPYALL
```

```bash
# Linux 侧解析
pip install python-registry evtx
# EVTX → XML/JSON
evtx_dump.py Security.evtx > Security.xml
evtx_dump.py --format json Security.evtx > Security.json

# hive → 键值（regipy）
regipy-dump SYSTEM.hiv --as-json > SYSTEM.json
# 或指定路径
regipy-query SYSTEM.hiv -k 'ControlSet001\Services\bam\State\UserSettings'
```

## 三、Linux 关键工件

| 工件 | 路径 | 内容 |
| --- | --- | --- |
| 认证日志 | `/var/log/auth.log`（Debian）/ `/var/log/secure`（RHEL） | sshd/sudo/su |
| journald | `/var/log/journal/<machine-id>/` | 结构化系统日志 |
| 二进制日志 | `/var/log/wtmp`（登录）、`btmp`（失败）、`lastlog` | `last`/`lastb` 读 |
| shell 历史 | `~/.bash_history`、`~/.zsh_history`、`~/.python_history` | 命令（可被清空/HISTFILE 改） |
| 进程审计 | `auditd` → `/var/log/audit/audit.log` | execve/syscall |
| cron | `/etc/crontab`、`/etc/cron.*`、`/var/spool/cron/` | 持久化 |
| systemd | `/etc/systemd/system/*.service`、`~/.config/systemd/user/` | 持久化 |
| SSH | `/etc/ssh/sshd_config`、`~/.ssh/authorized_keys` | 后门/持久化 |
| 包管理 | `/var/log/{dpkg.log,apt/history.log,yum.log}` | 安装记录 |
| 用户 | `/etc/passwd`、`/etc/shadow`、`/etc/sudoers` | 账户变更 |
| 内核 | `dmesg`、`/var/log/kern.log` | 崩溃/OOM/模块 |
| 容器 | `/var/lib/docker/containers/*/`、`/var/log/pods/` | 容器日志 |
| 文件时间 | `stat` 的 atime/mtime/ctime/btime | 时间线 |

```bash
# 保全（只读采集）
sudo dd if=/dev/sda of=/evidence/disk.img bs=4M status=progress conv=noerror,sync
sudo sha256sum /dev/sda | tee /evidence/disk.sha256     # 原始设备 hash
sha256sum /evidence/disk.img >> /evidence/disk.sha256   # 镜像 hash（应与上面一致）

# 只读挂载
sudo mount -o ro,noatime,noload,loop /evidence/disk.img /mnt/ev

# 日志导出
sudo journalctl --since "2026-05-01" --until "2026-05-02" -o json > journal.json
sudo cp -a /var/log/auth.log* /evidence/logs/
sudo last -F -a > /evidence/last.txt
sudo lastb -F -a > /evidence/lastb.txt

# auditd（若已启用）
sudo ausearch -ts 05/01/2026 00:00:00 -te 05/02/2026 00:00:00 -m EXECVE > execve.log
sudo aureport -au -i --summary
```

## 四、时间线构建

### 4.1 五个时间戳的含义（Linux）

| 时间 | 含义 | 谁改 |
| --- | --- | --- |
| **mtime** | 内容修改时间 | 写 → 变 |
| **atime** | 访问时间 | 读 → 变（`relatime` 下不总变） |
| **ctime** | inode 变更时间 | 改权限/属主/链接数 → 变（**不能直接改**） |
| **btime** | 创建时间（birth） | 只有 `statx` 能读，部分 fs 不支持 |
| crtime | 同上（macOS 叫法） | — |

```bash
stat /evidence/mnt/usr/bin/ps        # 一次看四个时间
statx /path 2>/dev/null || stat /path
# 输出示例：
#   Access: 2026-05-01 10:00:00.123456789 +0800
#   Modify: 2026-04-30 22:11:33.000000000 +0800
#   Change: 2026-04-30 22:11:45.000000000 +0800
#   Birth : 2026-04-28 09:00:00.000000000 +0800
```

### 4.2 Windows 的 MACB（$MFT 的两套时间）

```
$STANDARD_INFORMATION（$SI）：
  Creation / Modified / MFT-Modified(entry) / Accessed
  可由用户态 API 修改（SetFileTime）→ **可被篡改**
$FILE_NAME（$FN）：
  同一组四个时间，但由内核在文件名变更时更新 → **更难篡改**

篡改识别：$SI 与 $FN 的时间差异过大（尤其 $SI 比 $FN 早很多）→ 可疑 time stomping
```

```bash
# MFTECmd 输出会同时给 SI 与 FN 的时间
MFTECmd.exe -f 'C:\evidence\$MFT' --csv C:\out --csvf mft.csv
# 在 CSV 里对比 StandardInfo* 与 FileName* 两组时间
```

### 4.3 时区与精度

| 坑 | 说明 |
| --- | --- |
| 事件日志时间是 UTC | EVTX 里 `SystemTime` 是 UTC，展示时用本地时区 |
| Linux 日志默认本地时区 | `auth.log` 无时区前缀 → 要确认系统时区 |
| journald 存 UTC | `journalctl` 展示时转本地 |
| FAT32 精度 2 秒 | 时间戳只能精确到 2s |
| NTFS 精度 100ns | 但 API 常只写毫秒 |
| ext4 精度 ns | `stat` 显示纳秒 |
| DST 切换 | 同一本地时间可能出现两次 → 用 UTC 归一 |

```bash
# 统一到 UTC 再排序（最稳）
# Linux
TZ=UTC date -d "2026-05-01 10:00:00" +%s
# Windows（PowerShell）
[datetime]::Parse("2026-05-01 10:00:00").ToUniversalTime().ToString("o")
```

## 五、plaso / log2timeline / timesketch

```bash
# 1) 生成 plaso 存储（超级时间线）
log2timeline.py --storage-file /evidence/timeline.plaso /evidence/disk.img
# 大镜像加过滤（只取关键路径，避免爆盘）
log2timeline.py --storage-file /evidence/timeline.plaso \
  --filter "file:/(Windows|Users|var|etc|home)/" /evidence/disk.img

# 2) 导出 CSV / JSON
psort.py -o dynamic -w /evidence/timeline.csv /evidence/timeline.plaso
psort.py -o json_line -w /evidence/timeline.jsonl /evidence/timeline.plaso

# 3) 带过滤
psort.py -o dynamic -w /evidence/timeline.csv /evidence/timeline.plaso \
  "date > '2026-05-01 00:00:00' AND date < '2026-05-02 00:00:00'"

# 4) 导入 Timesketch（协作分析）
timesketch_importer --sketch_id 1 --timeline_name "host1" /evidence/timeline.csv
```

| 工具 | 用途 | 输入 |
| --- | --- | --- |
| `log2timeline.py` | 解析工件 → plaso 存储 | 镜像 / 目录 / 单个工件 |
| `psort.py` | 过滤/导出 | plaso 存储 |
| `pinfo.py` | 查看存储元信息 | plaso 存储 |
| Timesketch | Web 协作时间线 | CSV/JSONL |
| `tln`（Sleuthkit） | bodyfile 时间线 | `fls -m / -r` 输出 |

```bash
# Sleuthkit 的轻量路线（不需要 plaso）
fls -m / -r -p /evidence/disk.img > /evidence/bodyfile.txt
mactime -b /evidence/bodyfile.txt -d -z UTC > /evidence/timeline.csv
# -m / = 挂载点前缀；-r = 递归；-p = 显示全路径
```

## 六、因果关系判定（谁先谁后）

| 判据 | 说明 |
| --- | --- |
| 同一标识符 | PID / LogonID / GUID / MessageID 跨源对齐 |
| 时间邻接 + 逻辑必然后续 | 如 4688 创建进程 → 该 PID 的 Sysmon 1 → 其网络连接 |
| 因果链排除巧合 | "A 之后 B" ≠ "A 导致 B"，要找 A 的输出成为 B 的输入 |
| 缺失即证据 | 预期事件不存在（如登录成功但无 4624）本身是发现 |

```text
对齐示例（横向移动）：
  源主机 4624 类型 3（网络登录）  LogonID=0x12345
  → 源主机 4648（显式凭据）        同一 SubjectLogonId
  → 目标主机 4624 类型 3           同一时间窗（秒级）
  → 目标主机 4688（服务创建）      时间在其后
  四个事件用"账号 + 时间窗 + 目标 IP"串联，才算一条因果链。
```

## 七、证据完整性（chain of custody）

| 环节 | 必做 | 记录内容 |
| --- | --- | --- |
| 采集 | 写保护（硬件/软件） | 采集人、时间、工具版本、设备序列号 |
| 镜像 | 计算 hash（采集前后各一次） | SHA256（原始设备 + 镜像文件） |
| 存储 | 只读介质、加密、双备份 | 存放位置、访问记录 |
| 分析 | 只在副本上操作 | 每步命令与输出 |
| 移交 | 签字 | 时间、经手人、用途 |

```bash
# 完整证据包
sha256sum /dev/sda > evidence/00_device.sha256
dd if=/dev/sda of=evidence/disk.img bs=4M conv=noerror,sync status=progress
sha256sum evidence/disk.img >> evidence/00_device.sha256
# 两次 hash 必须一致（证明镜像无损）

# 时间戳证明（证明你在某时刻拿到了它）
openssl ts -query -data evidence/disk.img -no_nonce -sha256 -out evidence/disk.tsq
# 提交到 TSA，得到 .tsr

# 分析产物也要 hash
find evidence/out -type f -exec sha256sum {} \; > evidence/01_outputs.sha256
```

| 反驳"证据被污染"的要点 | 说明 |
| --- | --- |
| 原始设备 hash | 采集时立即算 |
| 镜像 hash | 与原始一致 |
| 只读挂载参数 | `ro,noatime,noload` |
| 工具版本与命令 | 每次操作留命令历史 |
| 时间戳证明 | TSA / 区块链锚定 |

## 八、检测视角（防守方：怎么发现"有人在取证/反取证"）

| 行为 | 信号 |
| --- | --- |
| 大量文件读取（取证采集） | EDR 的文件访问量异常；`robocopy` 调用 |
| `reg save` / `reg export` | 命令行事件 |
| `wevtutil epl` / `cl` | 4688 + 日志通道变化 |
| `dd` / `dcfldd` | 4688（Windows WSL）/ auditd execve |
| 清日志 | 事件 104（System）+ 通道停止上报 |
| 时间戳篡改 | `SetFileTime` 调用（Sysmon 2）；$SI/$FN 差异 |
| VSS 删除 | `vssadmin delete shadows`（4688 + 卷影计数骤降） |
| USN Journal 删除 | `fsutil usn deletejournal`（4688） |

## 九、验伤信号

| 声称 | 证据 |
| --- | --- |
| "镜像完整" | 原始设备 SHA256 == 镜像 SHA256（两次都记录） |
| "时间线可信" | 时区已归一（UTC）、时间源已记录、$SI/$FN 已对比 |
| "找到执行痕迹" | Prefetch + Amcache + BAM 至少两处一致（不能只凭 Shimcache） |
| "确认横向移动" | 4624 类型 3 + 4648 + 目标侧 4624 + 后续 4688，四件套齐全 |

**反例（看起来成功其实是假）**：

- Shimcache 有记录就报"执行过" → Shimcache 只证明**文件存在过**（可能只是被扫描）
- Prefetch 无记录就报"没执行" → 可能被清理、或在 SSD 上禁用了 Prefetch
- `~/.bash_history` 为空就报"没操作" → 可用 `HISTFILE=/dev/null`、`unset HISTFILE` 规避
- 事件日志里的时间是"本地"直接比较 → 实际是 UTC，全部差 8 小时
- 镜像 hash 与设备 hash 不同 → 采集过程有问题（坏道/写保护失效），不能用于结论

## 十、常见坑

1. **先关机再取证**——内存里的密钥/进程/连接全丢。除非要保数据完整性，
   否则先 dump 内存。
2. **在原盘上 `mount` 读写**——atime 被改，时间线污染。必须 `ro,noatime`。
3. **时区不归一**——不同工件时区不同，直接混排会得出错误的因果。
4. **只用一个工件下结论**——单点证据最容易被推翻。至少两源交叉。
5. **忽略 `$SI` 与 `$FN` 的时间差异**——time stomping 的唯一直接证据。
6. **用 `stat` 的 ctime 当"创建时间"**——ctime 是 inode 变更时间，
   改权限也会变。创建时间要用 btime（`statx`）。
7. **没有 chain of custody**——证据在法庭/报告里不可采信，技术工作白做。