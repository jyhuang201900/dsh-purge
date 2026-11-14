# 逆向 + pwn 结合题：从看懂到打通

> 被 `competition-reverse-pwn` 引用。这类题的失败**极少因为利用技术不足**，
> 而是**逆向没做够就急着写 exp**，或者**逆向结论没转成可验证的偏移**。
> 核心是三次交接：`行为 → 漏洞点 → 偏移 → 原语`。

## 一、题型光谱（先定位自己在哪种）

| 形态 | 逆向难点 | 利用难点 | 典型信号 |
| --- | --- | --- | --- |
| 自定义 VM / 解释器 | 理解 opcode 语义 | 找到 VM 内的越界/沙箱逃逸 | 大 switch、bytecode 数组、`ip` 指针 |
| 加壳/混淆的 ELF | 脱壳、平坦化还原 | 脱壳后的常规 pwn | 段异常、入口怪、`UPX!` 或自定义 stub |
| 定制协议服务 | 还原协议与状态机 | 用协议触发的边界错误 | `socket`/`recv` 后大 switch |
| 语言运行时题（Go/Rust） | 恢复符号、理解 runtime 结构 | 结构体内越界 | 体积大、pclntab/panic 字符串 |
| 算法题伪装成 pwn | 逆出算法（加密/校验） | 无内存漏洞，纯逻辑 | 无危险函数、只有计算 |
| 补丁差分题 | diff 两个版本找新增校验 | 绕过或复现 | 两文件近似、导出符号不同 |
| "无漏洞"题 | 逆出逻辑缺陷（整数/状态） | 逻辑利用 | 无 `strcpy/memcpy`，只有算术 |

```bash
# 30 秒分诊
file ./chall; checksec --file=./chall
strings -a ./chall | head -40
readelf -h ./chall | grep -E "Type|Entry"
# 看它是不是"网络服务"：本 skill 常见形态
strings -a ./chall | grep -iE "socket|bind|listen|accept|recv|send"
```

## 二、顺序：先逆后打，还是边逆边打？

| 判断 | 做法 |
| --- | --- |
| 有明确的输入点 + 危险函数（`strcpy`/`read`/`memcpy` + 栈数组） | **先打**，逆向只用来算偏移 |
| 输入格式复杂（TLV/JSON/自定义头） | **必须先逆**解析器，否则构造不出输入 |
| 逻辑题（无内存破坏） | **纯逆**，没有 pwn 阶段 |
| VM 题 | 必须把 VM 语义逆清（否则连"什么是越界"都定义不了） |
| 混淆/加壳 | 先脱，否则逆不动 |

**判定"能不能先打"**：

```bash
# 有栈缓冲 + 长度可控 = 可以直接试溢出
objdump -d -M intel ./chall | grep -B4 -A4 "call.*read\|call.*memcpy\|call.*strcpy" | head -60
# 看到 sub rsp, 0x??  + lea rax,[rbp-0x??] + read(0, rax, 大数) → 直接算偏移
```

## 三、找漏洞点：三条高效路径

### 3.1 危险函数交叉引用（最快）

```bash
# 1) 列危险导入
readelf -sW ./chall | grep -E "strcpy|strcat|sprintf|gets|read|memcpy|scanf|alloca"
# 2) 找它们的调用点
objdump -d -M intel ./chall | grep -E "call.*(strcpy|gets|sprintf)@plt"
# 3) 反汇编调用点前后，看目标缓冲大小
objdump -d -M intel ./chall --start-address=0x401200 --stop-address=0x401280
```

```python
# IDA/Ghidra 里更高效：所有 call 的 xref + 参数召回
# IDA: View → Open Subviews → Cross References；右键函数 → Callers
# Ghidra: Ctrl+Shift+F（Show References to）
```

### 3.2 长度/索引校验的缺失（逻辑漏洞）

```text
关注这几类模式：
  □ read(fd, buf, n) 里 n 来自用户（未与 sizeof(buf) 比较）
  □ idx 直接用于 buf[idx]，无 idx < size 检查
  □ size 参与分配但不参与后续访问（分配小、访问大）
  □ 有符号/无符号混用（负数索引绕过检查）
  □ 整数乘法溢出（size * count）
```

```c
// 典型形态（反编译产物）
read(0, buf, *(int *)(req + 8));        // 长度来自请求，buf 固定 0x100
*(long *)(obj + idx * 8) = val;         // idx 无上界
malloc(n * 4); ... arr[n]              // n*4 溢出后仍按 n 索引
```

### 3.3 污点追踪（复杂输入格式必备）

```text
手工污点：
  □ 标记"用户可控"的入口：read/recv/scanf 的目标内存
  □ 沿数据流看它经过哪些函数（寄存器/栈槽）
  □ 到"危险 sink"：内存写、长度参数、索引、函数指针
工具化：
  □ angr：符号化输入 → 找可达的危险指令
  □ Triton / Miasm：动态污点
  □ Ghidra 的 P-code 脚本可做简易数据流
```

```python
# angr 快速找"到达某地址"的输入（示例：找触发 memcpy 的路径）
import angr, claripy
p = angr.Project('./chall', auto_load_libs=False)
st = p.factory.entry_state()
sm = p.factory.simulation_manager(st)
sm.explore(find=0x401337)      # 危险指令 / 目标函数地址
if sm.found:
    print(sm.found[0].posix.dumps(0))   # stdin 内容
```

## 四、三次交接：逆向结论 → 可用数据

### 4.1 交接一：行为 → 漏洞点（必须给地址）

| 逆向说的 | 必须补成 |
| --- | --- |
| "有个栈溢出" | 缓冲在 `rbp-0x40`，`read` 长度 0x200，**偏移 0x48** |
| "索引没检查" | `idx` 来自 `req+0x8`，无上界，`obj` 是全局数组 `0x404060`，元素 8 字节 |
| "UAF" | `free(ptr)` 在 `0x4012a0`，之后 `ptr` 未置 NULL，`add` 在 `0x401310` 重分配同 size |

**没有地址的逆向结论不可用**。

### 4.2 交接二：漏洞点 → 偏移（必须可复现）

```bash
# 偏移三验：静态 + cyclic + gdb
# 1. 静态
objdump -d -M intel ./chall | sed -n '/<vuln>:/,+40p'
# 2. cyclic
python3 -c "from pwn import *;print(cyclic(300))" | ./chall
# 3. gdb corefile
gdb -q ./chall -ex "run" -ex "bt" -ex "info registers rip"
```

```python
from pwn import *
p = process('./chall')
p.send(cyclic(300))
p.wait()
core = p.corefile
off = cyclic_find(core.rip & 0xffffffff)     # 32 位要截断
print("offset:", off)
```

**对于非栈溢出**（堆/索引），"偏移"是另一层含义：

| 题型 | "偏移"指什么 | 怎么算 |
| --- | --- | --- |
| 堆 UAF | 目标字段在 chunk 内的偏移 | 逆结构体布局（`+0x10` 是 `ops` 等） |
| 索引越界 | 目标对象相对基址的索引差 | `(target - base) / elemsize` |
| 协议 | 字段在消息中的字节偏移 | 逆解析器，画出结构 |
| VM | opcode 在 bytecode 中的位置 | 逆 VM 的 `ip` 递增规则 |

### 4.3 交接三：偏移 → 原语（必须验证）

```text
"能控制 RIP" ≠ "能 ROP"
  □ 检查栈上是否有 \x00 截断（strcpy/scanf）
  □ 检查是否有 bad bytes 过滤（\n / \x00 / 白名单）
  □ 检查 gadget 是否都在同一段（PIE 下要 leak）
"能任意写" ≠ "能写任意值"
  □ 确认写的长度（1/2/4/8 字节）
  □ 确认是否被 canary/RELRO 限制
```

```bash
# 检查输入过滤（这类题最常见的坑）
strings -a ./chall | grep -iE "invalid|forbidden|bad|not allow"
# 逆出过滤函数后，看它检查哪些字节
objdump -d -M intel ./chall | grep -A20 "strchr\|memchr"
```

## 五、VM 题的专门流程

| 步骤 | 做什么 | 产出 |
| --- | --- | --- |
| 1 | 找 bytecode（数组/文件/嵌入字符串） | bytecode 起址 + 长度 |
| 2 | 找 dispatcher（大 switch / 跳转表） | opcode → handler 映射 |
| 3 | 逐 opcode 写语义表 | `op 0x01 = push imm` 之类 |
| 4 | **重点看内存类 opcode**（load/store/alloc） | 越界条件 |
| 5 | 把"要执行的 VM 程序"反写成 bytecode | 构造输入的脚本 |
| 6 | 用 VM 的漏洞（不是宿主程序的）利用 | exp |

```python
# 逆向出的 opcode 表（示例）→ 用 Python 汇编 bytecode
OPS = {0x01: ('push', 1), 0x02: ('pop', 0), 0x10: ('load', 0),
       0x11: ('store', 0), 0x20: ('add', 0), 0xff: ('halt', 0)}

def asm(code):
    out = b''
    for op, arg in code:
        out += bytes([op]) + (arg.to_bytes(4,'little') if arg is not None else b'')
    return out

prog = asm([(0x01, 0x100), (0x11, None), (0xff, None)])
```

**VM 题的常见坑**：

- `ip` 的推进规则不是"固定 +1"（有变长指令），逆错了程序就跑飞
- 栈/内存的边界检查在**VM 层**而不是宿主层，所以宿主 `checksec` 好看也没用
- 有"寄存器"与"内存"两套空间，越界写的是哪一套要分清

## 六、加壳/混淆题的交接

```text
1. 先脱壳（ELF 常见 UPX / 自定义 stub）
   upx -d ./chall -o chall.unpacked        # UPX
   # 自定义 stub：找 OEP（pushad/popad 后 jmp），dump 内存
2. 脱完再 checksec —— 保护属性是脱壳后的（stub 的属性会骗你）
3. 混淆（OLLVM）→ 见 ollvm-deobfuscation；不还原也能打，但找漏洞点慢
4. 脱壳后必须验证：文件能跑（或至少 IDA 能正确反编译 main）
```

```bash
# UPX 判定
strings -a ./chall | grep -m1 "UPX!"
upx -d ./chall -o ./chall.u && chmod +x ./chall.u && ./chall.u
# 若 upx -d 失败（改过 magic），用 upx 修复或手工 dump
```

## 七、验伤信号

| 声称 | 证据 |
| --- | --- |
| "找到了漏洞点" | 函数地址 + 指令地址 + 可控字节数 |
| "偏移正确" | cyclic 崩在 `cyclic_find` 的值，两次复现 |
| "能控制 RIP" | corefile 里 `rip` == 你写入的标记值 |
| "getshell" | 交互后 `id` 的真实输出 |
| "远程稳定" | 连续 20 次成功（fork 服务要 20 次，不是 1 次） |

**反例（看起来成功其实是假）**：

- `rip` 是 `0x41414141` 但程序没崩而是"正常退出" → 那是 `exit` 前的日志，不是真的控流
- 本地 `system("/bin/sh")` 出现 shell，但远程无回显 → 远程 stdout 没接回来，
  或者 `/bin/sh` 不存在（用 `/bin/cat /flag` 试）
- leak 到地址但每次运行都变 → 服务是 `fork` 前 leak 的（父进程），
  或根本没开 ASLR（本地）而远程开了
- "绕过校验"但 flag 不对 → 校验有第二层（校验和 / 服务器端二次验证）

## 八、检测视角（真实评估场景）

| 阶段 | 信号 |
| --- | --- |
| 逆向 | 目标主机上无信号（离线）；若在目标机跑 IDA，则进程/文件事件异常 |
| 触发崩溃 | 服务端 core dump / crash 日志；`dmesg` 的 segfault 记录 |
| 利用成功 | 服务进程的 `execve` 到 `/bin/sh`（EDR 可见）；反向 shell 的出站连接 |
| 反复尝试 | 同一服务短时间内多次崩溃 → 典型的"exploit 调试"特征 |

## 九、常见坑（这类题特有的）

| 坑 | 表现 | 处置 |
| --- | --- | --- |
| 反编译结论对、偏移错 | 本地崩在随机地址 | 用 cyclic + corefile 双确认 |
| 忘了服务是 fork 的 | 父进程 leak 不到、每次地址不同 | 利用 fork 继承：leak 是稳定的 |
| 输入格式没完全逆 | 服务无响应 / 直接断开 | 逆解析器的长度字段与校验和 |
| 长度字段含 `\x00` | `send` 被截断 | 用 `p.send` 而非 `sendline`，注意 `\n` |
| 逻辑题当 pwn 打 | 找不到任何溢出 | 回头逆算法（可能是"满足条件即给 flag"） |
| 打了宿主程序而非 VM | 触发 VM 自己的检查退出 | 漏洞在 VM 实现的 `load/store` |
| 多阶段（先 leak 再打）忘了回 main | 第二次输入没机会 | 检查返回地址是否回到主循环 |

## 十、五分钟检查表

```text
□ file + checksec + strings 三件套跑过
□ 入口函数确认（main / 自定义入口 / VM dispatcher）
□ 所有危险函数调用点列出来了（有地址）
□ 输入格式逆清（至少能构造一个合法输入）
□ 崩溃点与偏移有两套独立证据
□ 保护机制对应的绕过方案明确（canary/PIE/RELRO/NX）
□ 本地 exp 连续 5 次成功
□ 远程 exp 连续 20 次成功
□ 拿到的是目标 uid + flag 内容（不是"看起来有 shell"）
```