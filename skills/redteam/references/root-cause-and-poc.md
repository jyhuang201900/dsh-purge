# 从补丁到 POC：n-day 快速利用

> 被 `patch-diff-exploit` 引用。核心是**从补丁找出「修了什么」**，
> 再反推出「怎么触发」。不是读整个 diff，而是找关键那几行。

## 一、读 diff 的顺序（反直觉，但有效）

```
1. 先看改了哪些**文件**     → 判断漏洞面（解析器/网络/权限检查）
2. 再看改了哪些**函数**     → 缩小到具体功能
3. 最后看**关键行**         → 通常只有 3-10 行是真问题
4. 忽略：重构、格式化、注释、变量重命名（占 diff 的 80%）
```

```bash
# 1) 拿补丁（三种来源）
# Git 仓库：两个 tag 之间的 diff
git diff v1.2.3..v1.2.4 --stat
git diff v1.2.3..v1.2.4 -- <suspect-file>

# 发布包：解包后二进制 diff
# 用 bindiff / Diaphora 比对两个版本的同一个 .so/.exe

# 只有补丁文件
patch -p1 --dry-run < fix.patch   # 看它想改哪里
```

## 二、从补丁反推漏洞类型（对照表）

| 补丁里的改动 | 对应的漏洞 | 怎么触发 |
| --- | --- | --- |
| 加了长度检查 `if (len > MAX) return` | 缓冲区溢出 / 越界读 | 传超长输入 |
| 加了 `if (ptr == NULL)` | 空指针解引用 | 构造让上游返回 NULL 的输入 |
| 把 `strcpy` 换成 `strncpy` | 溢出（栈或堆） | 传超长字符串 |
| 加了整数溢出检查 `if (a > SIZE_MAX - b)` | 整数溢出导致小分配大拷贝 | 两个大数相加 |
| 补了权限校验（新增 `if (!is_admin)`） | 越权访问 | 直接调接口不带凭据 |
| 改了 SQL 拼接为参数化 | SQL 注入 | 在参数位置注入 |
| 加了类型检查（`instanceof`/`isa`） | 类型混淆 | 传错误类型的对象 |
| 加了路径规范化（`realpath`） | 路径穿越 | `../../` |
| 加了对符号链接的检查 | TOCTOU / 符号链接攻击 | 竞态替换文件 |
| 增加了引用计数操作 | UAF / 双重释放 | 触发提前释放 |

**判据**：改动**新增了某个 `if`**，那个 `if` 的条件就是漏洞的触发条件。

## 三、从「关键 if」到「触发输入」

```c
// 补丁片段
-    memcpy(dst, src, len);
+    if (len > sizeof(dst)) return -EINVAL;
+    memcpy(dst, src, len);
```

反推：

```
1. dst 多大？          → 找 dst 的声明（可能是栈数组或堆分配）
2. len 从哪来？        → 追调用链，找到用户可控的位置
3. 谁能控制 len？      → 那个输入就是攻击面
4. 触发条件：len > sizeof(dst) 且能到达这行
```

```bash
# 追调用链（二进制：交叉引用）
r2 -A -q -c "axt @ <memcpy地址>" lib.so
# 源码：grep 调用点
grep -rn "vuln_func(" src/ | head
```

## 四、POC 构造四步

```
1. 最小触发      先让它崩（不算漏洞，只证明路径可达）
2. 定位偏移      崩溃时看 RIP/EIP 是否被控制
3. 控制内容      用可控字节填充，确认能控制执行流
4. 稳定复现      同一输入跑 10 次，10 次都成功
```

```python
# 最小触发模板（做偏移探测）
from pwn import *
import sys

def try_len(n):
    p = process(["./vuln", "/dev/stdin"])
    p.send(b"A" * n)
    try:
        p.wait(timeout=2)
        return p.poll() is not None
    except:
        p.kill()
        return False

# 二分找崩溃阈值
lo, hi = 0, 10000
while lo < hi:
    mid = (lo + hi) // 2
    if try_len(mid): hi = mid
    else: lo = mid + 1
print("崩溃阈值:", lo)
```

**偏移探测**：

```bash
# 用 cycle pattern 精确定位覆盖到返回地址的偏移
python3 -c "
from pwn import *
print(cyclic(2000, n=8).decode('latin1'))
" > pattern.txt
./vuln < pattern.txt        # 崩，看崩溃地址
python3 -c "
from pwn import *
print(cyclic_find(0x6161616161616161))   # 换成实际崩溃值
"
```

## 五、从崩溃到可控（四阶段，不能跳）

```
[1] 崩溃（Crash）              进程异常终止 —— 只证明路径可达，不算漏洞
[2] 可控崩溃（Controlled）     崩溃时 RIP/EIP 来自你的输入 —— 证明能控执行流
[3] 可控执行（Control flow）   能跳到指定地址 —— 证明有重定向能力
[4] 完整利用（Code execution） 执行任意代码/拿到 shell —— 才是 RCE
```

每一步的判定命令：

```bash
# [1] 是否真崩（而不是程序正常返回错误）
./vuln poc.bin; echo "exit=$?"
# exit=139（SIGSEGV）/ 134（SIGABRT）→ 崩了
# exit=1 → 是校验拒绝，不是崩溃
```

```bash
# [2] 崩溃点是否可控
gdb -q ./vuln
(gdb) run < poc.bin
(gdb) info registers rip rax rbx rdi rsi rsp
(gdb) x/4i $rip
(gdb) bt
```

| gdb 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `rip = 0x4141414141414141` | **完全可控**（覆盖了返回地址/函数指针） | 直接找 gadget |
| `rip` 合法，但 `rax = 0x41414141` | 部分可控（可能可经 `call [rax]` 利用） | 找间接调用 |
| `rip` 合法，崩在 `mov [rcx], rax` 且 `rcx` 可控 | **任意写** | 改 GOT/函数指针 |
| 崩在 `memcpy`/`strlen` 内部 | 读越界（信息泄露），通常不可控执行 | 转"泄露"利用路线 |
| `rip` 是合法代码，`bt` 显示深层递归 | 栈耗尽（DoS） | 不是 RCE |

```bash
# [3] 保护机制决定利用方式（先 checksec，再定策略）
checksec --file=./vuln
# 或手工
readelf -h ./vuln | grep Type                 # ET_DYN = PIE
readelf -l ./vuln | grep GNU_STACK            # RWE = 无 NX
readelf -d ./vuln | grep -E 'BIND_NOW|FLAGS'  # Full RELRO?
readelf -s ./vuln | grep __stack_chk_fail     # Canary?
```

| 保护组合 | 可用路径 |
| --- | --- |
| No PIE + No NX + No Canary | 直接跳 shellcode（最简单） |
| No PIE + NX | ret2libc / ROP |
| PIE + NX + Canary | 先泄露 canary + 基址，再 ROP |
| PIE + NX + Canary + Full RELRO | 需 info leak + 栈迁移/`setcontext` |

```bash
# [4] 稳定性的量化（必须 10 次以上）
for i in $(seq 1 10); do
  timeout 5 ./exploit.py > /dev/null 2>&1 && printf "." || printf "x"
done; echo
# ..........（10/10）→ 稳定
# ....x.x...        → 不稳定，必须排查
```

| 不稳定原因 | 排查方法 |
| --- | --- |
| ASLR 导致地址漂移 | 泄露基址后计算；或关闭 ASLR 只用于调试 |
| 堆布局不稳 | 多次 alloc/free 做 heap feng shui；或用 tcache 的确定性 |
| 时间窗口（竞态） | 加同步/重试；用 last-byte sync |
| 输入长度临界 | 测 `len == MAX`、`MAX-1`、`MAX+1` 三个值 |
| libc 版本不同 | 用目标环境的 libc（`ldd` 对齐） |

## 六、验伤：怎么证明 POC 真的可用

| 证据 | 判据 |
| --- | --- |
| 崩溃可稳定复现 | 同一输入 10/10 都崩（不是偶发） |
| 崩溃点可控 | 崩溃地址来自你的输入（`0x41414141`），不是随机地址 |
| 影响可证明 | 能读到越界数据（打印出来）/ 能控制执行流（跳到你指定地址） |
| 版本可对应 | 明确写出「影响版本 v1.2.3，修复版本 v1.2.4」，并在两个版本上各验一次 |

**反例（看起来成功其实是假）**：
- 只在没有 ASLR 的环境下能控制 EIP —— 换个环境就失败
- 「能崩溃」就宣布是 RCE —— 崩溃 ≠ 利用
- 只在 debug 版本有效 —— release 版本有优化，行为不同

## 七、检测视角（n-day 利用在威胁狩猎里长什么样）

| 阶段 | 信号 |
| --- | --- |
| 版本探测 | 针对特定 header/路径的高频请求（`/owa/`、`/remote/login`、`/cgi-bin/`） |
| 触发尝试 | 目标进程异常退出（coredump / Windows 事件 1000） |
| 成功利用 | 目标进程拉起异常子进程（`w3wp.exe → cmd.exe`）；非常规时间的服务重启 |
| 后利用 | 新增账户/计划任务/webshell 文件落地 |

```bash
# Linux：从 coredump 看是否被 n-day 打过
coredumpctl list
coredumpctl info <pid> | head -30
```

```powershell
# Windows：应用崩溃（事件 1000）
Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000} |
  Where-Object { $_.Message -match 'nginx|httpd|java|w3wp' } |
  Select-Object -First 10 TimeCreated, Message
```

**关键检测点**：`补丁发布后的 30 天内` 是针对未修补目标的集中攻击窗口。
这段时间对相关路径/端口的访问应重点监控。

## 八、常见坑

1. **读整个 diff** —— 80% 是噪音。先按文件/函数筛，只看关键行。用 `git diff -w` 忽略空白、
   `git diff --stat` 先看面。
2. **崩溃就宣布成功** —— 崩溃是 DoS，不是 RCE。要证明控制流或数据泄露（看 `rip`/写入地址）。
3. **忽略版本对应** —— 补丁可能只修了部分路径，老版本有其他入口。要在多个版本上验。
4. **不写清触发条件** —— 「传超长输入」不够，要写具体长度范围和位置（`len ∈ (1024, 65535]`）。
5. **忘了稳定性** —— 只成功一次不算。堆利用受布局影响，必须 10 次以上验证。
6. **不做最小化** —— 1000 字节的 POC 里有 900 字节是无用的，会掩盖真正起作用的偏移。
7. **只看新增的 `if`** —— 还要看「检查的位置/顺序变化」：有时补丁只是把校验从前移到后，
   但原来的后置校验仍可被绕过（双路径）。
8. **忽略编译选项差异** —— debug 版有 padding、release 版被优化掉，栈布局完全不同。
   偏移必须在目标编译选项下测。
9. **把"打崩服务"当成果** —— 生产环境打崩是事故，不是 PoC 成功。测试要在隔离环境。
10. **不记录"不可利用"的理由** —— 「能崩但不能控」本身是重要结论（决定风险等级是 DoS 还是 RCE）。