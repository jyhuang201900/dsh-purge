# EDR Hook 侦查：发现、归类、出表

> 被 `edr-bypass-re` 引用（该技能第 78/93 行直接指向本文顶部的指纹表）。
> 侦查的目的不是"知道有 hook"，而是**出一张可执行的覆盖表**：
> 哪个函数、被谁 hook、hook 类型、绕它的代价。

## 一、EDR 指纹表（靠 hook 覆盖特征反推产品）

| 覆盖特征 | 高度疑似 |
| --- | --- |
| `ntdll` 上大量 `Nt*`/`Zw*` 都被改（前 5 字节 `jmp`） | CrowdStrike Falcon / SentinelOne |
| 只 hook 少数关键 API（`NtCreateThreadEx`/`NtMapViewOfSection`） | Microsoft Defender（MpEngine + WdFilter 更多靠内核） |
| `kernel32`/`kernelbase` 也被改，且有 `jmp` 到非模块地址 | Elastic EDR / Trellix |
| `amsi.dll!AmsiScanBuffer` 被 patch + `Nt*` hook | Defender + ASR 规则环境 |
| 大量 `Ldr*`/`Rtl*` 也被 hook（加载器级监控） | SentinelOne / Cybereason |
| `EtwEventWrite` 被改，或 `ntdll!Etw*` 有跳转 | 多数现代 EDR（ETW-TI 消费方） |
| 存在 `wdfilter`/`WdFilter.sys` minifilter | Defender |
| `CSFalconService` + `CkFltDrv` 驱动 | CrowdStrike |
| `SentinelAgent` + `SentinelDeviceControl` | SentinelOne |
| `elastic-agent`/`ElasticEndpoint` + `ElasticElam` | Elastic |
| `CSAgent`（Trend Micro） | Trend Micro Apex One |
| `ekrn`/`eamonm`（ESET） | ESET |
| `SysmonDrv` + `Sysmon64` | Sysmon（不是 EDR，但会记 Event ID 1/7/8/10） |

```powershell
# 驱动与服务的粗筛（不依赖 hook 侦查）
Get-CimInstance Win32_SystemDriver | Where-Object {$_.State -eq 'Running'} |
  Select-Object Name,PathName | Sort-Object Name

fltmc filters              # minifilter：看 altitude 与名字
fltmc instances            # 挂在哪些卷上
driverquery /v /fo csv | ConvertFrom-Csv | Where-Object {$_.State -eq "Running"} |
  Select-Object "Module Name","Display Name"
```

| minifilter | 归属 | altitude 特征 |
| --- | --- | --- |
| `WdFilter` | Defender | 328010 |
| `CSAgent`/`CkFltDrv` | CrowdStrike | 321410 附近 |
| `SentinelMonitor` | SentinelOne | 高 altitude |
| `eamonm` | ESET | — |
| `FileInfo`/`luafv` | Windows 内置 | — |

## 二、用户态 hook 发现：磁盘 vs 内存比对

### 2.1 原理

```
磁盘上的 ntdll.dll 是干净的（除非被 patch）。
进程内的 ntdll.dll 的 .text 被 EDR 改写（jmp 到 EDR 的 DLL）。
→ 逐字节比对 .text 段，不一致处即 hook。
```

### 2.2 用 pe-sieve（最省事）

```powershell
# 下载 pe-sieve（hasherezade）
pe-sieve64.exe /pid 4321 /shellc 1 /modules 1 /data 1 /dir C:\dump\pid4321

# 关键输出目录：
#   <dir>\<pid>\modules\   ← 模块的磁盘副本与内存副本
#   <dir>\<pid>\hooked\    ← 检测到的 hook 点
# 输出 CSV 里看 "Suspicious" / "Hooked" 标记
```

```powershell
# 只看 hook，不看 shellcode
pe-sieve64.exe /pid 4321 /shellc 0 /data 0 /modules 1 /dmode 3 /dir C:\dump\hooks
# /dmode 3 = 详细模块信息（含 section 对比）
```

### 2.3 手工比对（可控、可解释）

```powershell
# 1) 找到进程里 ntdll 的基址与大小
$p = Get-Process -Id 4321
# 用 PowerShell 读 PE 头（需要 P/Invoke）——更简单的方式：用 dumpbin 对磁盘版

# 2) dump 进程内 ntdll 的 .text
#    Process Hacker → 选进程 → Modules → ntdll.dll → 右键 → Save to file
#    或在 windbg: .writemem C:\mem_ntdll.bin <base> L?0x1000

# 3) 比对
fc /b C:\Windows\System32\ntdll.dll C:\mem_ntdll.bin > diff.txt
```

```python
# 更精确：用 pefile 解析两边的 .text 段做比对
import pefile

disk = pefile.PE(r"C:\Windows\System32\ntdll.dll")
# mem 是从内存 dump 出来的"裸映像"，需要按 ImageBase 重建
# 简化做法：直接比 .text 的原始字节（dump 时已是 mapped 形式）
mem_bytes = open("mem_ntdll_text.bin","rb").read()

for s in disk.sections:
    name = s.Name.rstrip(b"\x00").decode()
    if name != ".text":
        continue
    d = s.get_data()
    if len(d) != len(mem_bytes):
        print("size mismatch:", len(d), len(mem_bytes))
    diffs = [i for i in range(min(len(d), len(mem_bytes))) if d[i] != mem_bytes[i]]
    # 聚类：连续的 diff 归为一个 hook 点
    groups = []
    for i in diffs:
        if groups and i - groups[-1][-1] <= 8:
            groups[-1].append(i)
        else:
            groups.append([i])
    print("hook candidates:", len(groups))
    for g in groups[:40]:
        print("  off 0x%x len %d" % (g[0], len(g)))
```

### 2.4 在 windbg 里看"跳哪去了"

```
0:000> u ntdll!NtCreateFile L6
ntdll!NtCreateFile:
  4c8b d1              mov     r10,rcx
  b8 55000000          mov     eax,55h
  f6 04 25 ...         test    byte ptr gs:[...],...
  ...
# 若第一行就是 "jmp 00007ffb`12345678"，说明被 hook
0:000> u 00007ffb`12345678 L10
# 落在某个非微软模块的区间 → 该模块是 EDR 的 hook 引擎
0:000> lm a 00007ffb`12345678
```

| 看到的形态 | 说明 |
| --- | --- |
| `mov r10, rcx; mov eax, SSN; syscall; ret` | **干净**（原生 stub） |
| `jmp <far>` | inline hook（最常见） |
| `push <addr>; ret` | 另一种 inline hook |
| 前 5 字节是 `e9 xx xx xx xx`（x86） | inline hook（32 位） |
| 只有 `syscall` 但前面被改 | syscall stub 被改（用于改 SSN） |
| 整个函数被复制到别处执行 | trampoline hook |

### 2.5 找 hook 引擎模块

```powershell
# 列出所有非微软签名的模块（EDR 用户态组件）
Get-Process -Id 4321 -Module | Where-Object {
  $_.FileName -and $_.FileName -notlike "$env:SystemRoot\*"
} | Select-Object ModuleName, FileName, Size
```

```text
典型 EDR 用户态模块名：
  CSFalcon_* / CSFalconService  (CrowdStrike)
  SenDll / SentinelOne         (SentinelOne)
  mpedll / MpClient            (Defender)
  elastic-endpoint / libelastic (Elastic)
  cyvbrowser / cyorient        (Cybereason)
  ePacket / ems                (ESET)
```

## 三、SSDT / 内核回调

### 3.1 SSDT（老式 hook，现代少见）

```
SSDT = KeServiceDescriptorTable
每个表项是 SERVICE_DESCRIPTOR_ENTRY { KiServiceTable(偏移), Count, ... }

现代 Windows 的 KiServiceTable 存的是"相对偏移"，且开启 KPTI/HVCI 后
SSDT 通常不可写 → 现在更常见的是：
  □ 内核 inline hook（patch 函数头）
  □ IRP hook（改 DriverObject->MajorFunction）
  □ 内核回调（PsSetCreateProcessNotifyRoutineEx 等）
  □ minifilter（文件）
  □ WFP callout（网络）
```

| 机制 | 枚举方法 | 谁常用 |
| --- | --- | --- |
| 进程/线程回调 | 内核调试下读 `PspCreateProcessNotifyRoutine` 数组 | 几乎所有 EDR |
| 映像加载回调 | `PspLoadImageNotifyRoutine` | EDR / Sysmon |
| 对象回调 | `\Callback\ObRegisterCallbacks`（用 `!object`） | 句柄保护（LSASS） |
| 注册表回调 | `CmpRegisterCallbackInternal` | EDR |
| minifilter | `fltmc filters` / `!fltkd.filters` | 文件 |
| WFP | `netsh wfp show filters` / `!wfp` | 网络 EDR |
| ETW provider | `logman query providers` | 遥测 |
| AMSI provider | `HKLM\SOFTWARE\Microsoft\AMSI\Providers` | Defender/第三方 |

```powershell
# 用户态可枚举的（无需内核调试）
fltmc filters
netsh wfp show state file=wfp.xml        # 然后读 wfp.xml
Get-ChildItem "HKLM:\SOFTWARE\Microsoft\AMSI\Providers"
logman query providers | Select-String -Pattern "Threat|Defender|AMSI|Kernel"
Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Services" |
  Where-Object {$_.PSChildName -match "EDR|Falcon|Sentinel|elastic|csagent"} |
  Select-Object PSChildName
```

```text
内核调试（需双机或 vmware 的 debug stub）下：
  0: kd> !object \Callback
  0: kd> dx -r1 ((nt!_OBJECT_TYPE*)...)
  0: kd> !for_each_process
  0: kd> !fltkd.filters
  0: kd> !wfp
```

## 四、ETW provider 枚举

```powershell
# 列出所有 provider（含 GUID）
logman query providers

# 找安全相关的
logman query providers | Select-String -Pattern "Threat Intelligence|Kernel-Process|Kernel-File|Kernel-Network|AMSI|Defender"

# 看某个 provider 的会话是否已启用
logman query -ets                         # 当前实时会话
xperf -providers K                        # 内核 provider 分组

# 关键 provider GUID（Threat Intelligence）
#   Microsoft-Windows-Threat-Intelligence {F4E1897C-BB5D-5668-F1D8-040F4D8DD344}
# 该 provider 需要 PPL/反恶意软件权限才能订阅（普通管理员也订阅不了）
```

```text
关键 ETW provider → 记录什么：
  Microsoft-Windows-Threat-Intelligence
    □ 内存分配/保护变更（VirtualAlloc 类）
    □ 跨进程写（WriteProcessMemory）
    □ 线程注入（QueueUserAPC / SetThreadContext）
  Microsoft-Windows-Kernel-Process
    □ 进程/线程创建退出
  Microsoft-Windows-Kernel-File
    □ 文件创建/写/删除
  Microsoft-Windows-Kernel-Network
    □ TCP/UDP 连接
  Microsoft-Windows-DotNETRuntime
    □ Assembly 加载、JIT
  Microsoft-Antimalware-Scan-Interface
    □ AMSI 扫描请求
```

```powershell
# 自建会话观察会被记录什么（研究用途）
logman create trace "etwprobe" -p "Microsoft-Windows-Kernel-Process" 0x10 -o probe.etl -ets
# ... 执行动作 ...
logman stop "etwprobe" -ets
# 用 Windows Performance Analyzer 或 tracerpt 解析
tracerpt probe.etl -o probe.csv -of CSV
```

## 五、输出：hook 覆盖表（交付物格式）

| 函数 | 模块 | hook 类型 | 目标跳转 | 归属 | 绕过代价 |
| --- | --- | --- | --- | --- | --- |
| `NtCreateFile` | ntdll | inline (`jmp`) | `0x7ffb1234...` (CSFalcon) | CrowdStrike | 中（fresh copy + 直接 syscall） |
| `NtCreateThreadEx` | ntdll | inline | 同上 | CrowdStrike | 中 |
| `NtMapViewOfSection` | ntdll | inline | 同上 | CrowdStrike | 中 |
| `AmsiScanBuffer` | amsi | head patch (`mov eax, 0x80070057`) | — | Defender | 低 |
| `EtwEventWrite` | ntdll | head patch (ret) | — | Defender/EDR | 低（但会告警） |
| `NtProtectVirtualMemory` | ntdll | 未 hook | — | — | 无（可直接用） |
| `NtWriteVirtualMemory` | ntdll | 未 hook | — | — | 无 |

```text
交付要求：
  □ 每行必须有"证据"（dll 偏移 / 反汇编片段 / 模块归属）
  □ 必须区分 "未 hook" 与 "hook 但未知归属"
  □ 必须注明"该 EDR 是否消费 ETW-TI"（决定 unhook 是否会被发现）
```

## 六、检测视角（防守方）

| 侦查动作 | 防守方信号 |
| --- | --- |
| 读另一个进程的 ntdll | `PROCESS_VM_READ` 句柄打开事件（对象回调会记录） |
| `pe-sieve` 运行 | 其自身行为（读大量进程）会被 EDR 标记为可疑工具 |
| 枚举 minifilter | `fltmc` 调用通常无日志；但工具哈希可能被列入黑名单 |
| 订阅 Threat-Intelligence | 该 provider 需要特殊权限，普通进程订阅会被拒绝并记录 |
| 内核调试 | 需要禁用 DSE/开启测试签名；会留下 bcdedit 变化 |

## 七、验伤信号

| 声称 | 证据 |
| --- | --- |
| "识别出 EDR 是 X" | 驱动名/minifilter 名/用户态模块路径（三者之一）+ hook 特征吻合 |
| "N 个函数被 hook" | 每个给偏移 + 反汇编对比（磁盘 vs 内存） |
| "hook 归属是 X" | 跳转目标落在 X 的模块区间（`lm a` 输出） |
| "某函数未被 hook" | 内存里是原生 stub（`mov r10,rcx; mov eax,SSN; syscall`） |

**反例（看起来成功其实是假）**：

- `pe-sieve` 报 "hooked" 但 diff 是**版本差异**（内存里的 ntdll 与磁盘版本不同）
  → 必须先确认版本一致
- 看到的 `jmp` 是**合法的 hotpatch 区**（`mov edi,edi; push ebp` 之类），不是 hook
- 函数头的 `jmp` 是**重定位/CFG guard**（`__guard_dispatch_icall`），不是 EDR
- 只跑 `fltmc` 就断言"没有 EDR" → 用户态 hook 型 EDR（如部分版本的 SentinelOne）不装 minifilter
- 在**已 unhook 的进程**里做比对 → 差异为 0，误判"没有 hook"（要先确认进程未被处理过）

## 八、常见坑

1. **内存 vs 磁盘版本不一致**——Windows 更新后磁盘 ntdll 与已运行进程的不同，
   diff 全是"假 hook"。先核对版本号（`GetFileVersionInfo`）。
2. **把 CFG/hotpatch 当 hook**——`__guard_check_icall`、`mov edi,edi` 是编译器产物。
3. **只看 ntdll**——现代 EDR 也 hook `kernel32`/`kernelbase`/`win32u`/`amsi`，
   甚至 `Ldr*`。
4. **以为"没有 SSDT hook"就安全**——主流早已转内核回调 + minifilter + ETW。
5. **在 32 位进程里看 64 位 ntdll**——WOW64 有两份 ntdll，hook 情况不同。
6. **忽略 PPL 保护**——部分 EDR 组件是 PPL（Protected Process Light），
   普通管理员**无法读其内存**，也就无法比对它的 hook 引擎。
7. **只做一次性侦查**——EDR 会更新、hook 会变；每次评估都要重新采集。