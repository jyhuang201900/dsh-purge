# 反分析技术总览：检测点、绕过、残留

> 被 `malware-analysis` 引用。反分析不是"一个开关"，而是**一串检查点**。
> 分析者的工作顺序是：**先枚举检查点（不绕）→ 再逐个绕 → 最后记录绕不过的**。
> 绕不过不等于样本无害，要写进证据。

## 一、检测点全景（按出现频率排序）

| 类别 | 具体手段 | 触发后果 | 绕过难度 |
| --- | --- | --- | --- |
| 反调试 | `ptrace(PTRACE_TRACEME)` / `IsDebuggerPresent` / `CheckRemoteDebuggerPresent` | 退出/走假逻辑 | 低 |
| 反调试 | `NtQueryInformationProcess(ProcessDebugPort/Flags/Object)` | 同上 | 中 |
| 反调试 | 时序检测（`rdtsc`/`GetTickCount`/`QueryPerformanceCounter`） | 判定"被单步" | 中 |
| 反调试 | 硬件断点检测（DR0-DR7 / `GetThreadContext`） | 判定"有断点" | 中 |
| 反调试 | 异常驱动控制流（VEH/SEH + `int3`/`int 0x2d`） | 隐藏真实路径 | 高 |
| 反调试 | 自调试（自己 `CreateProcess` + `DebugActiveProcess`） | 独占调试端口 | 高 |
| 反虚拟机 | CPUID hypervisor 位（`0x40000000` leaf） | 退出 | 低 |
| 反虚拟机 | 硬件指纹（MAC OUI、磁盘序列号、BIOS 字符串） | 退出 | 中 |
| 反虚拟机 | 注册表/文件/进程名（VMware Tools / VBoxService） | 退出 | 低 |
| 反沙箱 | 用户交互（鼠标移动、窗口数） | 等待/退出 | 中 |
| 反沙箱 | 开机时长（`GetTickCount` < N 分钟） | 延迟/退出 | 低 |
| 反沙箱 | 文件数/最近文档/桌面文件 | 判定"新环境" | 低 |
| 反沙箱 | 域名/用户名黑名单（`sandbox`/`virus`/`malware`） | 退出 | 低 |
| 反分析 | 进程/窗口名扫描（`ollydbg`/`x64dbg`/`ida`/`wireshark`） | 退出 | 低 |
| 反分析 | 父进程检查（`explorer.exe` vs `python.exe`） | 退出 | 中 |
| 反分析 | 模块枚举（`EnumProcessModules` 找注入的 dll） | 退出 | 中 |
| 反分析 | 工具特征（窗体类名 `ID` / `OLLYDBG`） | 退出 | 低 |
| 反混淆 | 自修改代码 / 运行时解密 | 静态看不到 | 中 |
| 反混淆 | 加壳（VMProtect/Themida/UPX） | 静态不可读 | 高 |
| 反混淆 | 字符串加密（每字符串一个解密函数） | 静态无情报 | 低 |
| 反取证 | 日志清理 / 时间戳篡改 | 取证断链 | 中 |

## 二、反调试：检测点与绕过（成对给）

### 2.1 Linux（ELF）

```bash
# 枚举检测点（静态）
strings -a sample | grep -iE "TracerPid|/proc/self/status|ptrace"
objdump -d sample | grep -E "call.*ptrace|syscall" | head -20

# 找 ptrace 调用（x86-64: syscall 101）
objdump -d -M intel sample | grep -B3 -A3 "syscall" | grep -E "eax.*101|rax.*0x65"
```

| 检测 | 实现 | 绕过 |
| --- | --- | --- |
| `PTRACE_TRACEME` 失败 | 已被 gdb 附加时返回 -1 | `LD_PRELOAD` 覆盖 `ptrace` 返回 0 |
| `/proc/self/status` 的 `TracerPid` | 读文件解析 | hook `open/read` 返回伪造内容 |
| `/proc/self/maps` 含 `frida`/`gdb` | 扫 maps | hook read 过滤 |
| `getppid` 是 `gdb`/`python` | 读 `/proc/<ppid>/comm` | 改名/用 wrapper 启动 |
| `personality(ADDR_NO_RANDOMIZE)` | 反 ptrace | 少见 |

```c
// 覆盖 ptrace（Linux，编译成 so）
#define _GNU_SOURCE
#include <stdarg.h>
long ptrace(int req, ...) { return 0; }
// gcc -shared -fPIC -o noptrace.so noptrace.c
// LD_PRELOAD=./noptrace.so ./sample
```

```javascript
// frida 版：hook libc 的 ptrace + open
const ptrace = Module.findExportByName(null, "ptrace");
Interceptor.replace(ptrace, new NativeCallback(() => 0, 'long', ['int','pointer','pointer','pointer']));
// open 的伪造（按需）
const openat = Module.findExportByName(null, "openat");
Interceptor.attach(openat, {
  onEnter(a) { this.path = a[1].readUtf8String(); },
  onLeave(r) { if (this.path && this.path.includes("status")) console.log("open", this.path, "->", r); }
});
```

### 2.2 Windows（PE）

```powershell
# 静态：找反调试 API 导入
dumpbin /imports sample.exe | findstr /i "IsDebuggerPresent CheckRemoteDebugger NtQueryInformationProcess OutputDebugString"
# 或
strings -a sample.exe | findstr /i "IsDebuggerPresent NtQueryInformationProcess DebugActiveProcess"
```

| API | 语义 | 绕过 |
| --- | --- | --- |
| `IsDebuggerPresent` | PEB.BeingDebugged | patch PEB / hook 返回 0 |
| `CheckRemoteDebuggerPresent` | `NtQueryInformationProcess` | hook 返回 TRUE + FALSE 值 |
| `NtQueryInformationProcess` (7/0x1E/0x1F) | DebugPort/DebugFlags/DebugObject | hook 填 0 |
| `OutputDebugString` | 用 `GetLastError` 判断是否有调试器 | 少见 |
| `NtSetInformationThread(HideFromDebugger)` | 线程对调试器隐身 | 少见于恶意样本 |
| `QueryPerformanceCounter` 差分 | 时序 | patch / 加速 |
| `GetThreadContext` 读 DRx | 硬件断点检测 | 清 DR（ScyllaHide 做） |
| `NtQuerySystemInformation(SystemKernelDebuggerInformation)` | 内核调试器 | hook |

```text
Windows 反反调试工具：
  □ ScyllaHide（x64dbg/IDA 插件，profile 里勾选要绕的项）
  □ TitanHide（驱动级，隐藏调试器）
  □ PE 里直接 patch：把 IsDebuggerPresent 的 call 改成 xor eax,eax; nop
  □ 更彻底：用 hypervisor（如 SimpleVisor）做隐身——成本高，慎用
```

**x64dbg + ScyllaHide 最小配置**：

```text
1. Options → Preferences → ScyllaHide → 选 profile（VMProtect / Themida / 通用）
2. 勾 "Hide debugger" + "Protect DRx" + "NtQueryInformationProcess"
3. 若样本查 PEB：勾 "Fix PEB.BeingDebugged"
4. 启动后如果仍退出：说明有更早的检测（TLS 回调）。
   → 在 TLS 回调处下断（EntryBreakpoint 之前），先 patch 再继续
```

## 三、反虚拟机 / 反沙箱：指纹清单

| 指纹 | 具体值 | 绕过 |
| --- | --- | --- |
| CPUID hypervisor | `CPUID.1:ECX[31] = 1`；`0x40000000` 返回 `VMwareVMware`/`KVMKVMKVM`/`VBoxVBoxVBox` | patch / 用物理机 |
| MAC 前缀 | `00:0C:29`(VMware) `08:00:27`(VBox) `00:15:5D`(Hyper-V) `52:54:00`(QEMU) | 改网卡 MAC |
| 磁盘型号 | `VMware Virtual S` / `VBOX HARDDISK` / `QEMU HARDDISK` | 改设备名（驱动层） |
| BIOS | `VMware` / `VirtualBox` / `SeaBIOS` | 换固件 |
| 注册表 | `HKLM\SOFTWARE\VMware, Inc.\VMware Tools`、`HKLM\HARDWARE\ACPI\DSDT\VBOX__` | 删/伪造 |
| 进程 | `vmtoolsd.exe` / `VBoxService.exe` / `VBoxTray.exe` / `xenservice.exe` | 结束进程（会露破绽） |
| 服务 | `VMTools` / `VBoxGuest` | 停服务 |
| 文件 | `C:\Windows\System32\drivers\vmmouse.sys` / `VBoxMouse.sys` | 删（不推荐） |
| 用户名 | 含 `sandbox`/`malware`/`virus`/`cuckoo`/`analysis` | 改用户名 |
| 计算机名 | 含 `SANDBOX`/`MALWARE`/`CUCKOO`/`ANALYSIS`/`VIRUS` | 改主机名 |
| 开机时长 | `GetTickCount() < 10*60*1000` | 长时间运行 / patch |
| 进程数 | `< 20` 判定为沙箱 | 多开进程 |
| 内存 | `< 2GB` | 给足内存 |
| CPU 核数 | `== 1` | 多核 |
| 屏幕分辨率 | `800x600` / `1024x768` 且无变化 | 真实分辨率 |
| 鼠标移动 | `GetCursorPos` 多次采样无变化 | 自动化移动鼠标 |
| 最近文档 / 桌面文件 | 空 → 新环境 | 造几个文件 |

```bash
# Linux 侧检查（沙箱/容器）
systemd-detect-virt                 # 输出 kvm/vmware/oracle/docker/none
cat /sys/class/dmi/id/product_name  # "VMware Virtual Platform" / "VirtualBox"
cat /sys/class/dmi/id/sys_vendor
ip link | grep -i "00:0c:29\|08:00:27\|52:54:00"
grep -c "" /proc/cpuinfo            # 核数
cat /proc/uptime                    # 开机时长（秒）
```

```powershell
# Windows 侧
Get-CimInstance Win32_ComputerSystem | select Manufacturer,Model
Get-CimInstance Win32_BIOS | select SerialNumber,Manufacturer
Get-CimInstance Win32_DiskDrive | select Model,SerialNumber
(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Get-Process | Measure-Object | select Count
```

**反沙箱的"行为延迟"**：现代样本会 `Sleep(600000)` 或用 `SetTimer` 延迟执行。
绕过不是"等 10 分钟"，而是：

```text
□ 加速时间：Frida hook Sleep/NtDelayExecution 直接返回
□ 修改系统时间：把 VM 的时间往前调（注意证书/日志也会受影响）
□ 用 x64dbg 的 "skip sleep" 插件
```

```javascript
// frida: 让 Sleep 立刻返回
const sleep = Module.findExportByName("kernel32.dll", "Sleep");
Interceptor.replace(sleep, new NativeCallback(() => {}, 'void', ['uint']));
```

## 四、反混淆与自修改代码

| 技术 | 表现 | 应对 |
| --- | --- | --- |
| **运行时字符串解密** | 静态无字符串；有 `xor` + 循环 | 断在解密函数返回处取明文 |
| **自修改代码（SMC）** | 代码段在运行时被写（需 `mprotect`/`VirtualProtect`） | 在 `mprotect` 后 dump 内存段 |
| **加壳** | 入口在非常规段；`UPX!`/`VMProtect`/`Themida` | 见 `obfuscators.md` |
| **API 哈希** | 无导入表，只有一串常数 + 循环 | 断 `GetProcAddress` / 模拟哈希算法 |
| **间接调用** | `call [rax]` 且 rax 运行时算 | 动态记录调用目标 |
| **花指令** | 大量 `jmp`/`call` 到无效字节 | 反汇编器会错位；手工修正或用 IDA 的 "force instruction" |
| **重叠节** | 两个节共享同一文件偏移 | PE-bear 看节表；按"执行时哪份生效"分析 |

```bash
# API 哈希的识别与还原
strings -a sample | grep -iE "GetProcAddress|LoadLibrary"   # 无 → 可能用了哈希
# 典型循环：rol/ror + add + xor，常数是 hash 种子
objdump -d -M intel sample | grep -B2 -A8 "ror\|rol" | head -60
```

```python
# 常见 API 哈希（ROR13）还原
def ror13_hash(name: str) -> int:
    h = 0
    for c in name.upper().encode():
        h = ((h >> 13) | (h << (32 - 13))) & 0xffffffff
        h = (h + c) & 0xffffffff
    return h

# 用已知 API 列表反查
api = ["CreateFileA","VirtualAlloc","LoadLibraryA","GetProcAddress","CreateProcessA"]
print({a: hex(ror13_hash(a)) for a in api})
```

## 五、反取证（会破坏你的分析）

| 手段 | 影响 | 应对 |
| --- | --- | --- |
| 删除自身 / 日志 | 事后无法回溯 | 事先快照 + 只读挂载 |
| 时间戳篡改（`SetFileTime`） | 时间线错乱 | 用 `$MFT` 的 `$STANDARD_INFORMATION` 与 `$FILE_NAME` 双时间对比 |
| 清空事件日志 | 审计断链 | 卷影/备份日志/转发到 SIEM |
| 加密/擦除文件 | 数据丢失 | 内存 dump 优先 |
| 隐藏进程/文件（rootkit） | 枚举不到 | 交叉验证（`/proc` vs `ps`，`ps` vs netstat） |

## 六、检测视角（防守方看得见什么）

| 反分析动作 | 防守方信号 |
| --- | --- |
| `ptrace` 自附加 | `auditd` 的 `ptrace` 记录（可配 rule）；EDR 的进程行为 |
| 扫进程名 | 大量 `EnumProcesses`/`CreateToolhelp32Snapshot` |
| 读 `/proc/self/status` | 文件访问审计（`auditd -w /proc/self/status`） |
| CPUID 探测 | 通常无日志（硬件指令） |
| 查询 VM 注册表 | 注册表访问审计（4657 需开 SACL） |
| 检查开机时长 | 无直接日志 |
| 时序检测 | 无日志；可用 CPU 性能计数器侧面观察 |
| 反沙箱延迟 | 长时间无行为 → 沙箱产品会标 "no activity" |

> **对分析者的启示**：反分析本身也是**行为特征**。
> 在真实评估中，"样本大量探测环境"本身就是一条可汇报的发现。

## 七、验伤信号

| 声称 | 证据 |
| --- | --- |
| "识别出 N 个反分析检测点" | 每个都给**地址/API 名/触发条件**，不是"看起来有反调试" |
| "已绕过某检测" | 绕过前会退出 → 绕过后**继续执行到下一阶段**（有日志/断点证明） |
| "绕过失败" | 明确写出"卡在 X 检测，手段 Y 无效，因为 Z"——这也是有效结论 |
| "样本在沙箱里无行为" | 区分"真无害"与"检测到沙箱"，需给出反沙箱证据 |

**反例（看起来成功其实是假）**：

- 打了 `IsDebuggerPresent` 补丁、程序继续跑 → 其实只是"没退出"，真正逻辑可能走了假分支
  （要证明**走到真实分支**，比如看到了 C2 请求）
- `LD_PRELOAD` 生效但样本用的是 `syscall` 直调（绕过 libc）→ 覆盖无效，你以为绕过了
- 沙箱里"没有网络行为" → 可能是 DNS 解析失败被静默，不是样本没 C2
- 关掉反调试后样本崩溃 → 反调试是**控制流的一部分**（校验值参与解密），不能只 patch 判断

## 八、常见坑

1. **先绕再看**——不枚举检测点就直接 patch，会漏掉后续检测（执行到一半退出，
   你以为是新 bug）。**先静态列出所有检测点**。
2. **只 patch 返回值**——很多检测的结果参与后续解密（key 派生），
   patch 后逻辑全错。要先看返回值被谁用。
3. **忽略 TLS 回调 / `.init_array`**——检测可能在 `main` 之前就跑完了，
   在 main 下断点根本看不到。
4. **用错绕过层级**——样本用 `syscall` 直调，`LD_PRELOAD` 无效；
   用 `NtQueryInformationProcess`，patch `IsDebuggerPresent` 无效。
5. **反沙箱的等待当"样本无害"**——`Sleep(10min)` 后才有行为，
   时间盒到了就写"无行为"是错误结论。
6. **改 VM 指纹改太多**——同时改 MAC/BIOS/注册表会引入不一致
   （如 MAC 是 VMware 但 BIOS 是 Dell），高级样本能识别这种矛盾。