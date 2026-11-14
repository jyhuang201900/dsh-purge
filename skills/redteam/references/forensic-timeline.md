# 时间线重构：时钟源、MACB、跨源对齐

> 被 `competition-forensic-timeline` 引用。时间线的核心不是"排序"，
> 而是**证明每个时间戳的可信度**，以及**用标识符而非时间建立因果**。

## 一、时钟源清单（先问"这个时间是谁写的"）

| 时间戳来源 | 精度 | 时区 | 可信度 | 可被谁改 |
| --- | --- | --- | --- | --- |
| 文件 mtime（ext4/NTFS） | ns / 100ns | 无（UTC 存储） | 高 | 用户（`touch`/`SetFileTime`） |
| 文件 ctime（inode） | ns | 无 | **高**（用户态不能直接改） | 只有内核（改元数据时） |
| 文件 btime（birth） | ns | 无 | 高 | 不能改；部分 fs 无 |
| NTFS `$SI` 四时间 | 100ns | UTC | **中**（可被 API 改） | `SetFileTime` |
| NTFS `$FN` 四时间 | 100ns | UTC | **高** | 内核在重命名/移动时更新 |
| EVTX `SystemTime` | ms | **UTC** | 高 | 需 SYSTEM 权限改文件 |
| Sysmon `UtcTime` | ms | **UTC** | 高 | 同上 |
| Linux `auth.log` | s | **本地时区** | 中 | root 可改 |
| journald | µs | 存 UTC，展示本地 | 中高 | root 可改 |
| `~/.bash_history` | 无（除非开 `HISTTIMEFORMAT`） | — | **低** | 用户随时改/清 |
| 浏览器 History | µs（Chrome 用 1601 epoch） | UTC | 中 | 用户可删 |
| Prefetch | 100ns | UTC | 中高 | 可删 |
| 网络设备日志 | s | 通常 UTC | 高 | 需设备权限 |
| 内存中的进程启动时间 | — | — | 高（实时） | — |

```text
第一个问题永远是：这个时间戳是谁写的、用什么时区、精度多少。
答不出来 → 不能用于因果推断，只能作为"参考"。
```

### 1.1 各系统的 epoch 起点（换算必踩）

| 系统 | epoch | 换算 |
| --- | --- | --- |
| Unix / Linux / EVTX / Sysmon | 1970-01-01 UTC | 秒或毫秒 |
| Windows FILETIME | 1601-01-01 UTC | 100ns 间隔 |
| Chrome/Edge History | 1601-01-01 UTC | **微秒**（`(t/1e6)-11644473600` = Unix 秒） |
| FAT | — | 本地时间，2s 精度 |
| macOS HFS+ | 1904-01-01 | 秒 |
| macOS APFS | 1970 | ns |

```python
# Windows FILETIME → Unix
def filetime_to_unix(ft: int) -> float:
    return ft / 10_000_000 - 11644473600

# Chrome timestamp（微秒自 1601）
def chrome_to_unix(ct: int) -> float:
    return ct / 1_000_000 - 11644473600

# 验证：Chrome 的 13300000000000000 应约为 2022 年
print(chrome_to_unix(13300000000000000))    # ~1640995200
```

## 二、MACB 的含义与篡改可能

```
M = Modified（内容修改）
A = Accessed（访问）
C = Changed（MFT entry 变更 / inode 变更）
B = Birth（创建）

Windows $MFT 有两套：
  $STANDARD_INFORMATION (SI): 可被 SetFileTime 直接改 → 可伪造
  $FILE_NAME (FN):            内核维护，仅在文件名/父目录变更时更新 → 难伪造
```

| 篡改形态 | $SI 表现 | $FN 表现 | 判断 |
| --- | --- | --- | --- |
| Time stomping（前推） | Creation 被改成很早 | FN 的 Creation 仍是真实值 | **SI 早于 FN 很多 → 可疑** |
| Time stomping（后推） | Creation 被改成未来 | FN 是真实值 | SI 晚于"当前时间" → 明显 |
| 复制文件 | SI 保留原时间（`COPYALL`） | 目标 FN 是新的 | FN 远晚于 SI → 正常（复制） |
| 移动文件（同卷） | SI 不变 | FN 更新 | 正常 |
| 移动文件（跨卷） | SI 保留 | FN 新建 | 正常 |
| 加壳/打包 | — | — | 文件 mtime 是打包时间，不是原始 |

```bash
# 用 MFTECmd 导出，然后对比 SI 与 FN 两组时间
MFTECmd.exe -f '$MFT' --csv out --csvf mft.csv
# CSV 列：StandardInfoCreated / StandardInfoLastModified / FileNameCreated / FileNameLastModified
```

```python
# 找出 SI 与 FN 差异过大的记录（可疑篡改）
import csv
from datetime import datetime

with open("mft.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        try:
            si = datetime.fromisoformat(row["StandardInfoCreated"])
            fn = datetime.fromisoformat(row["FileNameCreated"])
        except Exception:
            continue
        delta = (si - fn).total_seconds()
        if abs(delta) > 86400 * 30:          # 差异超过 30 天
            print(f"{row['FileName']:60s} SI-FN={delta/86400:.1f}d")
```

## 三、跨源对齐：用标识符而不是时间

| 关联键 | 出现在 | 用途 |
| --- | --- | --- |
| **PID** | 4688 / Sysmon 1 / 内存 / 网络 | 进程生命周期 |
| **LogonID（十六进制）** | 4624 / 4634 / 4648 / 4672 | 会话 |
| **SubjectLogonId** | 4672 / 4648 | 提权/显式凭据 |
| **MessageID / InternetMessageID** | 邮件网关 / 邮箱审计 | 邮件链 |
| **GUID（TaskGuid / ServiceGuid）** | 注册表 / 计划任务 | 持久化对象 |
| **ProcessGuid（Sysmon）** | Sysmon 1/3/11/... | 同一进程的所有事件 |
| **Hash** | Amcache / Sysmon 1 / 文件 | 样本同一性 |
| **卷序列号 + FileID** | $MFT / USN / Sysmon 11 | 同一文件跨事件 |
| **IP + 端口 + 时间窗** | 防火墙 / NDR / 5156 | 网络会话 |
| **Session ID** | RDP / 4624 类型 10 | 远程会话 |

```text
对齐示例 1：文件落地 → 执行 → 外联
  Sysmon 11 (FileCreate)  TargetFilename=C:\Users\a\AppData\Local\Temp\x.exe
  Sysmon 1  (ProcessCreate) Image=...\x.exe   ParentImage=...\winword.exe
  Sysmon 3  (NetworkConnect) Image=...\x.exe  DestinationIp=1.2.3.4
  → 用 Image 路径 + ProcessGuid 串联，不看时间

对齐示例 2：凭据窃取 → 横向
  4624 类型 3  LogonID=0x3E7（源主机）
  4648           SubjectLogonId=0x3E7  TargetServer=DC01
  目标 4624 类型 3  LogonID 不同（目标侧新会话）但 TargetUserName/源 IP 一致
  → 用"账号 + 源 IP + 秒级时间窗"串联
```

## 四、工具链

### 4.1 plaso（超级时间线）

```bash
# 1) 解析（可指定过滤器减少 IO）
log2timeline.py --storage-file ev.plaso /evidence/disk.img
log2timeline.py --storage-file ev.plaso --parsers "winevtx,mft,prefetch" /evidence/

# 2) 查看状态
pinfo.py ev.plaso

# 3) 导出（dynamic = 人类可读列）
psort.py -o dynamic -w timeline.csv ev.plaso
psort.py -o json_line -w timeline.jsonl ev.plaso

# 4) 时间过滤（注意：过滤用 UTC）
psort.py -o dynamic -w window.csv ev.plaso \
  "date > '2026-05-01 08:00:00' AND date < '2026-05-01 12:00:00'"

# 5) 只看某类
psort.py -o dynamic -w evtx_only.csv ev.plaso "source_short == 'EVT'"
```

### 4.2 tln（Sleuthkit 轻量）

```bash
fls -m / -r -p /evidence/disk.img > bodyfile.txt
mactime -b bodyfile.txt -d -z UTC -y > timeline.csv
# -d = 日期格式；-z UTC = 时区归一；-y = ISO8601
```

### 4.3 其他

| 工具 | 用途 |
| --- | --- |
| `MFTECmd` | $MFT/$J/$Boot 解析（含 SI/FN 双时间） |
| `EvtxECmd` | EVTX → CSV（含 payload 展开） |
| `PECmd` | Prefetch 解析 |
| `AmcacheParser` | Amcache |
| `SrumECmd` | SRUM |
| `LECmd` / `JLECmd` | LNK / JumpList |
| `RBCmd` | 回收站 |
| `hindsight` | 浏览器 |
| Timesketch | 协作 + 可视化 |

## 五、因果关系判定（三个层次）

| 层次 | 问题 | 判据 |
| --- | --- | --- |
| L1 时间邻接 | A 在 B 之前？ | 时间戳比较（前提：时区/精度已归一） |
| L2 标识关联 | A 与 B 是同一对象？ | PID / GUID / hash / 路径 |
| L3 因果必然 | A 导致 B？ | A 的输出是 B 的输入（数据流），或技术机制上必然 |

```text
只有到 L3 才能写"攻击者执行了 X 导致 Y"。
L1 + L2 只能写"在 A 之后观察到 B，且二者关联同一 PID"。
```

| 常见错误推断 | 正确表述 |
| --- | --- |
| "Prefetch 时间 = 首次执行" | Prefetch 记首次与最近一次，但可能被清理/禁用 |
| "文件创建时间 = 落地时间" | 复制会保留源时间，要对比 FN |
| "登录后立刻就有进程" | 中间可能有计划任务/服务触发，要看父进程 |
| "日志 A 在 B 之前" | 两台机器时钟可能不同步（NTP 偏差） |

## 六、时钟偏移校正

```text
现象：两台主机日志相差几十秒，因果链断开。
处理：
  1. 找"同一事件"在两台机器上的记录（如同一 SMB 会话、同一 Kerberos 请求）
  2. 计算偏移（Δt）
  3. 用 NTP 日志验证偏移是否恒定（`w32time` 事件 35/37、`chronyd` 日志）
  4. 归一后再排序
```

```powershell
# Windows 时间服务日志（证明时钟是否被调过）
Get-WinEvent -LogName System -FilterXPath "*[System[Provider[@Name='Microsoft-Windows-Time-Service']]]" -MaxEvents 20 |
  Select-Object TimeCreated, Id, Message
```

```bash
# Linux 时钟同步
timedatectl                      # 当前时区/NTP 状态
chronyc tracking                 # 偏移量（若用 chrony）
ntpq -p                          # 若用 ntpd
journalctl -u systemd-timesyncd --since "2026-05-01" | head -20
```

| 偏移来源 | 识别 |
| --- | --- |
| NTP 未同步 | `timedatectl` 显示 "System clock synchronized: no" |
| 手动改时间 | `w32time` 事件 / `auditd` 的 `settimeofday` |
| 虚拟机暂停/快照 | 时钟跳变（VMware Tools 同步事件） |
| 时区误设 | 所有日志整体偏移整数小时 |

## 七、检测视角（防守方：时间线自身的完整性）

| 攻击者行为 | 时间线痕迹 |
| --- | --- |
| 改文件时间 | `SetFileTime`（Sysmon 2）；SI/FN 不一致 |
| 清日志 | 事件 104；时间线出现"空洞" |
| 改系统时间 | `w32time` / `settimeofday` 事件；NTP 偏移异常 |
| 删除 USN | `fsutil usn deletejournal`；$J 出现断层 |
| 关机绕过 | 事件 6005/6006/6008（启动/关闭/异常）；uptime 重置 |
| 卷影删除 | `vssadmin` 命令行 + 卷影数量骤降 |

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "时间线可信" | 时区已归一（UTC）、时钟偏移已校正、SI/FN 已对比 |
| "A 导致 B" | 标识符串联（PID/GUID/路径）+ 机制必然性，不只看时间 |
| "证据被篡改" | SI 与 FN 差 > 30 天 + `SetFileTime` 事件，两者齐全 |
| "日志被清" | 事件 104 + 时间线空洞 + SIEM 侧断流 |

**反例（看起来成功其实是假）**：

- 时间线看起来"完整"但全部用本地时区混排 → 实际因果反了
- "文件创建于 X" → 那是复制过来的源文件时间，落地是 FN 时间
- "Prefetch 证明执行了" → Prefetch 缺失不代表没执行（可禁用）
- "登录后 3 秒就有 C2 连接" → 两台机器时钟差 1 分钟，实际是登录前
- 用 `mactime` 输出直接下结论 → 它不区分 SI/FN，看不到篡改

## 九、常见坑

1. **不归一 UTC**——最常见的错误。Linux 日志本地、EVTX 是 UTC，混排必错。
2. **把 ctime 当"创建时间"**——ctime 是 inode 变更时间，改权限就变。
3. **忽略文件系统精度**——FAT32 只有 2 秒，纳秒排序无意义。
4. **只用一个时间源**——单源时间线无法交叉验证，必须有第二源。
5. **plaso 默认解析全盘**——IO 爆掉。用 `--parsers` 或 `--filter` 收敛。
6. **忘了 VM 快照导致的时钟跳变**——虚拟化环境的"恢复快照"会让时间倒退，
   表现为"未来时间的事件"。
7. **因果靠"看起来合理"**——必须有标识符串联；时间邻接只是必要条件。