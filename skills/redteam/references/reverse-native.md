# 原生二进制逆向路线：静态、动态与验证

> 被 `ctf-sandbox-orchestrator` 引用（覆盖 reverse / malware / DFIR / native / pwn 五类子域）。
> 核心是**按证据强度选路线**：静态给结构，动态给真值，两者必须对齐才算"看懂了"。

## 一、路由：先判断这是哪一类题

| 子域 | 判据 | 首选手法 | 关键产出 |
| --- | --- | --- | --- |
| **算法还原**（reverse） | 只有一个 exe/so，输入输出固定 | 静态 + 少量动态验证 | 算法伪代码 + 复现脚本 |
| **恶意样本**（malware） | 有网络/持久化/加密配置特征 | 静态分诊 → 沙箱动态 | IOC + 行为链 |
| **取证**（DFIR） | 给的是磁盘/内存/日志，不是"程序" | 见 `forensics-triage.md` | 时间线 + 证据 |
| **原生 binary**（native） | 目标是理解真实软件的某个功能 | 符号 + xref + 动态 | 功能映射 + 调用链 |
| **pwn** | 有输入点 + 内存破坏 | 见 `reverse-pwn.md` / `pwn-chain.md` | exploit |

```bash
# 30 秒路由
file sample && checksec --file=sample 2>/dev/null
strings -a sample | head -30
# 有 socket/registry/persistence → malware
# 只有 scanf/printf + 算法常量 → reverse（算法题）
# 有 read + 栈数组 + 无校验 → pwn
# 是镜像/dump/日志 → DFIR
```

## 二、静态 vs 动态：选择表

| 场景 | 静态 | 动态 |
| --- | --- | --- |
| 有符号表 / 未剥离 | ✅ 首选 | 补充 |
| 加壳 / 混淆 | 先脱（见 `obfuscators.md` / `ollvm`） | dump 内存更快 |
| 反调试强 | 会被打断 | 需要先过反调试 |
| 算法有大量常量表 | ✅ 常量表是签名 | 可验证输入输出 |
| VM / 解释器 | 必须先逆语义 | 用 trace 验证 opcode |
| 需要真实密钥/配置 | 拿不到（运行时生成） | ✅ 断点取 |
| 时间紧 | 慢但可并行 | 快但环境依赖 |

```text
决策规则：
  1. 能静态看清 → 静态（可复现、可交付）
  2. 静态被阻断（壳/反调试/运行时解密）→ 动态
  3. 两者都行 → 静态定位 + 动态取值（最稳）
  4. 只动态 → 结论必须用"输入→输出对"固化，否则不可复现
```

## 三、符号恢复（四个层次）

| 层次 | 手段 | 覆盖范围 |
| --- | --- | --- |
| 1. 原生符号表 | `nm` / `readelf -sW` / `objdump -t` | 未剥离的 `symtab` |
| 2. 动态符号 | `readelf --dyn-syms` / `nm -D` | 导出函数（`.so` 常有） |
| 3. 语言元数据 | Go pclntab、Rust panic 串、ObjC runtime | 见 `go-rust-notes.md` |
| 4. 结构推断 | FLIRT / Lumina / 签名库 / 手动 | 剥净的样本 |

```bash
# 1) 原生符号
nm -C ./sample | head -40                    # -C demangle C++
readelf -sW ./sample | awk '$4=="FUNC"' | head -40
objdump -t ./sample | grep " F .text"

# 2) 导出（so/dll）
readelf --dyn-syms ./lib.so | grep FUNC
objdump -p ./lib.so | sed -n '/Export/,/^$/p'

# 3) FLIRT / 函数签名（IDA）
#    File → Load File → Parse C Offsets / Apply Sig File
#    库签名：mssdk / vc6rt / libc 签名库
# Ghidra：可用 .fidb 或 FID 插件

# 4) 用"字符串 + xref"反推名字（最通用）
strings -a -t x ./sample | grep -iE "error|failed|invalid|usage"
# 拿到偏移 → 在反汇编里找引用 → 那附近就是相关函数
```

**手工命名的规范**（不规范的命名等于没恢复）：

| 前缀 | 含义 | 例 |
| --- | --- | --- |
| `sub_` / `FUN_` | 未知 | 保留 |
| `chk_` | 校验 | `chk_license` |
| `dec_` / `enc_` | 加解密 | `dec_config` |
| `net_` | 网络 | `net_send_beacon` |
| `cfg_` | 配置 | `cfg_parse` |
| `vm_` | VM 相关 | `vm_dispatch` |
| `w_` | wrapper/thunk | `w_printf` |

## 四、算法识别：常量表是签名

| 算法 | 常量 / 特征 | 定位方法 |
| --- | --- | --- |
| **AES** | S-box `63 7c 77 7b f2 6b 6f c5`；Rcon `01 02 04 08 10 20 40 80 1b 36` | `grep -c` 二进制；IDA 搜立即数 |
| **DES** | 初始置换表、8 个 S-box（每个 64 项） | 找 64 字节表 ×8 |
| **SM4** | S-box `d6 90 e9 fe cc e1 3d b7` | 中文样本常见 |
| **ChaCha20/Salsa20** | `"expand 32-byte k"` / `"expand 16-byte k"` | `strings` 直接命中 |
| **RC4** | 256 字节表 + 两次 swap 循环 | 找 `for i<256` + `swap` |
| **Base64** | 64 字符表 `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef...` | `strings` 命中 |
| **MD5** | 初始值 `67452301 efcdab89 98badcfe 10325476`；`0xd76aa478` 系列 K 表 | 搜 4 个魔数 |
| **SHA1** | `67452301 EFCDAB89 98BADCFE 10325476 C3D2E1F0` | 同上 |
| **SHA256** | `6a09e667 bb67ae85 3c6ef372 a54ff53a` | 搜初始 hash |
| **CRC32** | 多项式 `0xEDB88320` 或 256 项表 | 搜该常数 |
| **TEA/XTEA** | `0x9e3779b9`（黄金比例） | 极高频 |
| **XXTEA** | 同上 + `6 + 52/n` 的循环 | 看循环结构 |

```bash
# 常量表扫描（十六进制搜二进制）
xxd -p ./sample | tr -d '\n' | grep -o "637c777bf26b6fc5" | head -1   # AES S-box
# 或用 python 直接搜
python3 - <<'PY'
data = open("sample","rb").read()
sigs = {
 "AES_SBOX": bytes.fromhex("637c777bf26b6fc53001672bfed7ab76"),
 "MD5_IV":   bytes.fromhex("0123456789abcdeffedcba9876543210"),
 "SHA256_IV":bytes.fromhex("67e6096a85ae67bb72f36e3c3af54fa5"),
 "TEA_DELTA":bytes.fromhex("b979379e"),   # 0x9e3779b9 little-endian
}
for name, s in sigs.items():
    i = data.find(s)
    print(name, "found at 0x%x" % i if i >= 0 else "not found")
PY
```

**关键认知**：常量表命中 ≠ 用了该算法。
必须验证"表被谁引用、输入输出是否符合算法"。常见假阳性：
字符串 `"AES"` 只是错误提示；S-box 是**被复制了一份**但实际用了变体（如 AES-NI 指令）。

```bash
# 检查是否用了硬件指令（AES-NI）
objdump -d ./sample | grep -cE "aesenc|aesdec|aeskeygenassist"
# > 0 说明走 CPU 指令，没有 S-box 表
```

## 五、控制流平坦化的还原

### 5.1 识别

```text
OLLVM CFF 的稳定形态：
  □ 一个 while(1) { switch(state) { case C1: ...; state = C2; ... } }
  □ state 变量被赋值为不连续的大常数（如 0x3A2B1C4D）
  □ 真实逻辑被切成小基本块，每块结尾只改 state
  □ 有一个"分发器"块（switch 头），被绝大多数块跳回
```

```bash
# 统计特征：单函数基本块数异常多 + 跳转目标集中
objdump -d ./sample | sed -n '/<main>:/,/^$/p' | grep -c "jmp"
# OLLVM 后的 main 常有几百个 jmp
```

### 5.2 还原（三条路，按成本）

| 路线 | 做法 | 适用 |
| --- | --- | --- |
| **动态 trace** | 在 dispatcher 处下断点，记录 state 序列，按执行序重排基本块 | 任意 CFF，最可靠 |
| **符号执行** | angr + `SimState` 走 state 变量，恢复可达序列 | 小函数 |
| **反平坦化脚本** | IDA 的 `D-810` / `ollvm-deobfuscator` / Triton 脚本 | 标准 OLLVM 模式 |
| **手工** | case < 20 时按 state 常量串联 | 最省时 |

```python
# 动态 trace 的骨架（Linux + gdb batch）
# 断在 dispatcher 的 switch 指令上，每次命中打印 state
# gdb -q -x trace.py ./sample
# 脚本内：
#   b *0x401234                      # dispatcher
#   commands
#     silent
#     printf "state=%d\n", $eax      # 或读栈上的 state 变量
#     c
#   end
```

```bash
# 用 perf/ltrace 类手段粗看执行路径（无 gdb 时）
perf record -e instructions ./sample; perf report --stdio | head -40
# 只给"热点函数"，不给块序列——对 CFF 不够，但能确认 dispatcher 位置
```

### 5.3 还原后的验证

| 检查 | 期望 |
| --- | --- |
| 执行顺序是否形成"直线逻辑" | 还原出的伪代码有 `if/for` 而非 `while+switch` |
| 输入输出是否不变 | 用原始样本和"还原后的重实现"跑同一批输入，结果一致 |
| state 常量是否都被覆盖 | 有未覆盖的 case 说明 trace 不全（分支没走到） |

## 六、动态工具选择

| 工具 | 平台 | 适用 |
| --- | --- | --- |
| **gdb + pwndbg/GEF** | Linux | 用户态、pwn、精细寄存器控制 |
| **x64dbg** | Windows | GUI 断点、内存断点、脱壳 |
| **WinDbg Preview** | Windows | 内核、崩溃分析、TTD 录制 |
| **frida** | 全平台 | 函数级 hook、无需重编译 |
| **ltrace/strace** | Linux | 库调用 / 系统调用序列 |
| **rr** | Linux | 录制回放（时序 bug、CFF trace） |
| **QBDI / Triton** | 跨平台 | 指令级 trace（百万级） |
| **Intel PIN / DynamoRIO** | 跨平台 | 插桩（重） |

```bash
# gdb 常用（批处理，便于脚本化）
gdb -q ./sample \
  -ex "set pagination off" \
  -ex "b *0x401000" \
  -ex "run < input.bin" \
  -ex "x/10i \$rip" \
  -ex "info registers rax rdi rsi" \
  -ex "bt" \
  -batch

# frida（不改二进制，直接 hook）
frida -f ./sample -l hook.js --no-pause
```

```javascript
// frida hook 一个导出/内部函数（内部函数要按偏移）
const base = Module.findBaseAddress("sample");
const target = base.add(0x1234);          // 静态分析得到的偏移
Interceptor.attach(target, {
  onEnter(args) {
    console.log("arg0=", args[0].toInt32(), "arg1=", args[1].readUtf8String());
  },
  onLeave(retval) { console.log("ret=", retval.toInt32()); }
});
```

## 七、验伤信号：怎么证明"逆对了"

必须用**独立复现**，不能用"看起来对"。

| 层级 | 验证方式 | 通过标准 |
| --- | --- | --- |
| 单函数 | 用 Python/C 重写该函数，与样本输出比对 | 1000 组随机输入全等 |
| 算法 | 提取常量 + 结构，用标准库（openssl/pycryptodome）复现 | 密文逐字节相同 |
| 协议 | 抓包 → 按逆出的格式解析 | 字段全部合理（长度自洽、校验通过） |
| 整体 | 用原样本产生"输入→输出"对，让自己的实现匹配 | 端到端一致 |

```python
# 单函数验证模板：把样本当 oracle 用
import subprocess, os
def oracle(inp: bytes) -> bytes:
    r = subprocess.run(["./sample"], input=inp, capture_output=True, timeout=5)
    return r.stdout

def mine(inp: bytes) -> bytes:
    # 你逆出来的实现
    ...

cases = [os.urandom(n) for n in (8, 16, 32, 64)]
for c in cases:
    a, b = oracle(c), mine(c)
    assert a == b, f"mismatch on {c.hex()}: {a.hex()} != {b.hex()}"
print("OK", len(cases))
```

**反例（看起来成功其实是假）**：

- 用**同一组输入**验证：只有一组样本，任何实现都能"对上"
- 只比长度不比内容：截断/填充错误被掩盖
- 用样本自己输出当输入（自反馈）：掩盖了边界错误
- 静态读代码就说"是 AES"：没验证 key 扩展/轮数，可能是 AES 变体（如 10 轮改 12 轮）

## 八、常见场景速查

### 8.1 只有一个输入框的算法题

```text
1. 找到输入读取与输出打印之间的所有函数（xref 串联）
2. 定位"比较"指令（cmp/strcmp/memcmp）→ 它的参数就是"正确值"
3. 逆"输入 → 正确值"的变换
4. 反向求解（若可逆）或用 z3/angr 约束求解
```

```python
# z3 求解（变换是线性的时极快）
from z3 import *
flag = [BitVec(f"c{i}", 8) for i in range(16)]
s = Solver()
for i, c in enumerate(flag):
    s.add(c >= 0x20, c <= 0x7e)
# 把逆出的约束逐条加上
s.add(flag[0] * 3 + flag[1] == 0x1a2)
if s.check() == sat:
    m = s.model()
    print(bytes([m[c].as_long() for c in flag]))
```

### 8.2 反调试挡住

```bash
# 常见反调试与绕过（Linux）
#   ptrace(PTRACE_TRACEME)  → 已被 gdb 附加时会失败，程序退出
#     → 用 LD_PRELOAD 覆盖 ptrace 返回 0
#   /proc/self/status 的 TracerPid
#     → hook open/read
#   rdtsc 时序
#     → patch 掉 rdtsc 比较，或在 gdb 里改返回值
```

```c
// LD_PRELOAD 覆盖 ptrace（Linux）
#define _GNU_SOURCE
#include <sys/ptrace.h>
long ptrace(int req, ...) { return 0; }
// gcc -shared -fPIC -o noptrace.so noptrace.c
// LD_PRELOAD=./noptrace.so ./sample
```

### 8.3 需要真实密钥

```text
静态拿不到时（密钥运行时生成/网络下发）：
  □ hook 加密函数入口，打印 key 参数
  □ hook 密钥派生函数（如 EVP_BytesToKey）
  □ 在密文生成前一刻 dump 内存里的 key buffer
  □ 抓包看密钥是否明文下发（少见但存在）
```

## 九、检测视角（真实环境）

| 动作 | 防守方可见 |
| --- | --- |
| 静态分析 | 无（离线） |
| 目标机上跑 IDA/Ghidra | 进程创建 + 大内存占用 + 读取目标文件 |
| frida 注入 | `frida-server` 进程 / 端口 27042 / `ptrace` 附加 |
| LD_PRELOAD | 进程环境变量（`/proc/<pid>/environ`）含非标准 so 路径 |
| gdb 附加 | `ptrace` 调用；`/proc/<pid>/status` 的 `TracerPid` 非 0 |
| 反复崩溃 | core dump 事件 / `dmesg` segfault |

## 十、常见坑

1. **静态读完就交结论**——没有输入输出验证的"算法还原"可信度接近 0。
2. **常量表命中就认定算法**——先查是否有 AES-NI/硬件指令，再看表被谁引用。
3. **CFF 用工具一把梭**——工具对非标准 CFF 失效，动态 trace 才是通用解。
4. **动态只在本地跑一次**——环境差异（libc/CPU/时序）会让结论不可移植。
5. **忽略编译器优化导致的"逻辑消失"**——`-O2` 下常量折叠、内联、死代码删除会让
   源码级结构消失；逆的是**编译器输出**，不是源码。
6. **把 thunk 当实现**——`jmp` 到 PLT 的函数只是跳板，真实逻辑在库/别处。
7. **验证用同一份样本自证**——必须"独立实现 vs 样本"，否则等于没验证。