# radare2 速查：分析、xref、patch、调试、脚本化

> 被 `radare2` 引用。r2 的学习曲线在于**命令的字母缩写逻辑**：`i`=info、`a`=analyze、
> `p`=print、`w`=write、`d`=debug。记住这个，其余靠组合。

## 一、启动与第一轮（必做）

```bash
# 打开并自动分析（最常用）
r2 -A ./binary

# 打开不分析（大文件/加壳样本，先别分析）
r2 ./binary

# 指定架构/位数（分析失败时手动指定）
r2 -a x86 -b 64 ./binary
r2 -a arm -b 32 ./binary
r2 -a mips -b 32 ./firmware.bin

# 指定基址（裸二进制/固件）
r2 -a arm -b 32 -m 0x08000000 ./firmware.bin

# 写模式（patch 需要）
r2 -w ./binary

# 调试模式
r2 -d ./binary
r2 -d -A ./binary

# 远程调试（gdbserver）
r2 -d gdb://127.0.0.1:1234

# 一次性执行命令后退出
r2 -q -c 'aaa; afl' ./binary
r2 -A -q -c 'iz' ./binary
```

```bash
# 最常用的开场三连
r2 -A ./binary -c 'iI; afl; izz' -q
```

## 二、信息命令（`i` 系列）

| 命令 | 含义 |
| --- | --- |
| `iI` | 文件信息（架构、位数、类型、OS、语言、是否 PIE、是否 static） |
| `iS` | 段（sections）：地址、大小、权限（rwx） |
| `iSS` | 段（简化） |
| `iz` | 数据段里的字符串 |
| `izz` | **整个文件**的字符串（最常用） |
| `izzz` | 含零字节的字符串 |
| `iE` | 导出符号 |
| `ii` | 导入符号（IAT） |
| `iL` | 库依赖 |
| `iH` | 头信息 |
| `iC` | 类（C++/Java） |
| `ic` | 类（同 `iC`） |
| `iM` | 主函数地址 |
| `ie` | 入口点 |
| `ir` | 重定位 |
| `iR` | 资源 |
| `iV` | 版本信息 |
| `it` | 文件类型 |
| `iD` | 调试信息 |
| `ia` | 全部信息（一次输出所有） |
| `i~pattern` | 过滤（`~` 是 grep） |

```bash
# 实战组合
iI                      # 先看架构/位数/是否 PIE
iS~rwx                  # 找可写可执行的段（加壳特征）
izz~password            # 搜关键字
izz~http                # 找 URL
ii~system               # 找危险导入
iE                      # 导出函数（DLL 很有用）
```

```bash
# 过滤语法（`~` 后接 grep）
afl~main                # 名字含 main 的函数
afl~0x00401            # 地址含 0x401
izz~flag                # 字符串含 flag
iS~.text                # 只显示 .text 段
```

## 三、分析命令（`a` 系列）

| 命令 | 含义 |
| --- | --- |
| `aa` | 基础分析（快） |
| `aaa` | **深度分析**（推荐，含函数引用） |
| `aaaa` | 更激进（含实验性分析） |
| `aac` | 分析调用（仅 call 指令） |
| `aar` | 分析引用 |
| `aav` | 分析值（找函数指针） |
| `aae` | 分析入口 |
| `af` | 分析当前地址的函数 |
| `afn name` | 重命名函数 |
| `afvn old new` | 重命名变量 |
| `afvt var type` | 设置变量类型 |
| `afna` | 自动命名 |
| `afll` | 列出当前函数的局部变量 |
| `afg` | 显示函数图（文本） |
| `agf` | 显示函数图（ASCII 图，需 graphviz） |
| `afx` | 函数xref |
| `afl` | **列出所有函数**（地址、大小、名字） |
| `aflc` | 函数数统计 |
| `axt` | **找调用者**（xref to） |
| `axf` | **找被调用**（xref from） |
| `axg` | 全局xref |
| `axtj` | 同上但 JSON 输出 |
| `pdc` | 反编译（伪 C，r2dec 插件） |
| `pdg` | 反编译（Ghidra 插件） |
| `pdd` | 反编译（内置） |

```bash
# 标准分析流程
aaa                     # 分析
afl                     # 看所有函数（先过滤掉库函数）
afl~main                # 找 main
s main                  # 跳到 main
pdf                     # 打印整个函数反汇编

# 或直接反编译
s main
pdg                     # 需要 r2ghidra 插件
```

```bash
# 找"危险的调用链"：谁调用了 system
axt @ sym.imp.system
# 输出：每个调用点的地址

# 谁调用了这个自己写的检查函数
axt @ sym.check_password

# 这个函数调用了什么
axf @ sym.main
```

## 四、打印命令（`p` 系列）

| 命令 | 含义 |
| --- | --- |
| `pd` | 反汇编 N 条（`pd 20`） |
| `pdf` | **反汇编整个函数**（最常用） |
| `pdr` | 函数反汇编（含引用） |
| `pdi` | 反汇编（含指令细节） |
| `pdj` | JSON 输出 |
| `pD` | 反汇编 N 字节 |
| `px` | 十六进制 dump |
| `pxw` / `pxd` / `pxq` | 按 word/dword/qword dump |
| `ps` | 打印字符串 |
| `psz` | 打印零结尾字符串 |
| `pc` | 打印 C 数组 |
| `p8` | 打印原始字节（hex） |
| `pC` | 打印 C 字符串 |
| `pdc` | 伪 C 反编译 |
| `pdg` | Ghidra 反编译 |
| `pfo` | 按格式打印（如 `pfo elf64`） |
| `pt` | 打印类型（需 type 定义） |

```bash
# 常用
pdf                     # 当前函数全部反汇编
pdf @ main              # 指定函数
pd 30 @ 0x401000        # 从地址反汇编 30 条
px 64 @ 0x402000        # dump 64 字节
psz @ 0x402000          # 该地址的字符串
pxr 64 @ rsp            # 带引用的 dump（显示指针指向的字符串）
```

**`pxr` 是调试时的神器**：显示内存并解析其中的指针。

## 五、写/patch 命令（`w` 系列）

| 命令 | 含义 |
| --- | --- |
| `wx <hex>` | 写原始字节 |
| `wa <asm>` | 写汇编（r2 自动汇编） |
| `wao nop` | 用 nop 填充当前指令 |
| `wa nop` | 同 |
| `wv <val>` | 写 4 字节值（小端） |
| `wv2` / `wv4` / `wv8` | 2/4/8 字节 |
| `wz <str>` | 写零结尾字符串 |
| `wo` | 写操作（`woa` 加法等） |
| `wox` | 异或 |
| `wr` | 写重定位 |
| `wb` | 写位 |

```bash
# 经典 patch：把条件跳转改成无条件
s 0x401234
pdf                     # 看当前指令（例：je 0x401260）
wa jmp 0x401260         # 把 je 改成 jmp
# 或用字节 patch
wx eb              # 把 0x74 (je) 改成 0xeb (jmp)

# 把 call 改成 nop
wao nop                 # 用 nop 填充整个 call 指令

# 改字符串
s 0x402000
wz "NewString"
```

```bash
# patch 后要保存
# 方法 1：写回原文件（-w 模式打开时直接生效）
# 方法 2：用 wtf 导出
wtf! ./patched.bin

# 应用 patch 到文件
r2 -w -q -c 's 0x401234; wx eb; wq' ./binary
# wq = 保存并退出；q = 不保存退出

# 或用 r2 的 patch 脚本
r2 -w -q -c 's 0x401234; wa jmp 0x401260; wq' ./binary
```

**注意**：patch 会修改原文件（`-w` 模式）。先备份。

## 六、调试命令（`d` 系列）

| 命令 | 含义 |
| --- | --- |
| `db <addr>` | 下断点（地址/符号） |
| `db` | 列出断点 |
| `db-<addr>` | 删断点 |
| `db-*` | 删所有断点 |
| `dc` | 继续执行 |
| `ds` | 单步（源码级，`ds` = step） |
| `dsi` | 单步到下一个 call 内部 |
| `dso` | 单步越过 call |
| `dS` | 单步（指令级） |
| `dbt` | 打印调用栈 |
| `dbtj` | 同上 JSON |
| `dr` | 打印寄存器 |
| `dr rip=0x401000` | 改寄存器 |
| `drr` | 带引用打印寄存器 |
| `dm` | 打印内存映射 |
| `dmm` | 内存映射（更全） |
| `dmp` | 在指定地址 dump |
| `dmh` | 堆信息 |
| `dml` | 加载的库 |
| `dd` | 读写数据（`dd <size> @ addr`） |
| `doo` | 重新打开（重跑） |
| `doos` | 重跑并单步到入口 |
| `dpe` | 执行到返回（类似 finish） |
| `dcu <addr>` | 执行到地址（continue until） |
| `dt` | 追踪（trace） |
| `dts` | 追踪 session |
| `de` | 执行命令（无 UI） |

```bash
# 标准调试流程
r2 -d -A ./binary
db main                 # 在 main 下断点
dc                      # 跑
dr                      # 看寄存器
pdf                     # 看当前函数
db 0x401234             # 再下断点
dc                      # 继续
drr                     # 寄存器 + 引用
pxr 32 @ rsp            # 看栈
dbt                     # 调用栈
```

```bash
# 关键断点
db sym.imp.strcmp       # 字符串比较（看比较的两个值）
db sym.imp.malloc       # 内存分配（看分配大小）
db sym.imp.system       # 命令执行

# 在断点处看参数（x86-64：rdi/rsi/rdx）
dr rdi
psz @ rdi               # rdi 指向的字符串
```

```bash
# 执行到指定地址（不用断点）
dcu 0x401234

# 执行到函数返回
s main
dpe
```

**参数寄存器的记忆**（x86-64 SysV）：

| 序号 | 寄存器 |
| --- | --- |
| 1 | rdi |
| 2 | rsi |
| 3 | rdx |
| 4 | rcx |
| 5 | r8 |
| 6 | r9 |

Windows x64：rcx, rdx, r8, r9。

## 七、搜索（`/` 系列）

| 命令 | 含义 |
| --- | --- |
| `/ string` | 搜字符串 |
| `/x <hex>` | 搜字节 |
| `/w <val>` | 搜 word |
| `/d <val>` | 搜 dword |
| `/q <val>` | 搜 qword |
| `/a <asm>` | 搜汇编 |
| `/r <addr>` | 搜引用 |
| `/i` | 指令搜索 |
| `/v` | 值搜索 |
| `/p` | 模式搜索 |
| `/c` | 加密/编码搜索 |
| `e search.in` | 搜索范围（`io.maps`/`raw`/`bin.sections`） |

```bash
# 常用
/x 4d5a90                # 搜 PE 头
/x 7f454c46              # 搜 ELF 头
/ flag                    # 搜 flag 字符串
/d 0x12345678            # 搜 dword
/a "mov eax, 1"          # 搜指令
/r 0x402000              # 搜引用了这个地址的所有地方（xref）
```

**`/r` 是最强的一个**：找"谁引用了这个字符串/函数"。这比 `axt` 更底层（扫原始字节）。

## 八、脚本化（r2pipe / r2 -c）

```bash
# 一次性命令链
r2 -A -q -c 'afl~main; s main; pdf' ./binary

# 执行脚本文件
r2 -A -q -c '. script.r2' ./binary
r2 -A -i script.r2 ./binary

# 多个 -c
r2 -q -c 'aaa' -c 'afl' -c 'q' ./binary
```

```python
# r2pipe（Python）
import r2pipe
r2 = r2pipe.open('./binary', flags=['-A'])
print(r2.cmd('iI'))
funcs = r2.cmdj('aflj')          # JSON 输出更易解析
for f in funcs[:5]:
    print(f['offset'], f['name'], f['size'])
r2.quit()
```

```python
# 批量：找所有调用 system 的函数
import r2pipe
r2 = r2pipe.open('./binary', flags=['-A'])
xrefs = r2.cmdj('axtj @ sym.imp.system') or []
for x in xrefs:
    print(f"{x['fcn_name']} @ {hex(x['from'])}")
r2.quit()
```

```python
# 循环：对每个函数反编译
import r2pipe
r2 = r2pipe.open('./binary', flags=['-A'])
for f in r2.cmdj('aflj'):
    if f['size'] > 200:
        r2.cmd(f"s {f['offset']}")
        print('=== ' + f['name'])
        print(r2.cmd('pdf')[:800])
r2.quit()
```

```javascript
// r2 的 JavaScript 脚本（-j 加载）
// script.js
var funcs = JSON.parse(cmd('aflj'));
funcs.forEach(function(f) {
  if (f.size > 500) console.log(f.name + ' ' + f.size);
});
```

## 九、插件与增强

```bash
# 必装的三个插件（大幅提升体验）
r2pm -ci r2ghidra        # Ghidra 反编译（pdg）
r2pm -ci r2dec           # 另一个反编译器（pdc）
r2pm -ci r2pipe          # 脚本化

# 其他常用
r2pm -ci r2frida         # Frida 集成
r2pm -ci r2yara          # YARA 扫描
r2pm -ci r2mcp           # MCP 服务（AI 集成）
```

```bash
# 用 pdg 反编译（r2ghidra）
r2 -A -q -c 's main; pdg' ./binary

# 导出反编译结果
r2 -A -q -c 's main; pdg > /tmp/main.c' ./binary
```

## 十、验伤：分析结论的"成功"

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 找到关键函数 | 函数名 + 地址 + 反编译代码（含判断逻辑） | 只凭函数名猜（`sym.check` 可能是自动命名） |
| 找到 xref | `axt`/`/r` 给出**调用点地址**，且该处是 call/jmp | 搜到的是数据引用（不是代码） |
| patch 生效 | 改后**重新运行**，行为变了（过了校验/输出了 flag） | 改了文件但程序有 CRC 自校验 |
| 断点命中 | 断点触发且寄存器/栈有预期值 | 断点没触发（地址错/ASLR） |
| 算法还原 | 能用自己的脚本算出与程序一致的结果 | 只是看懂了大概 |

## 十一、检测视角（分析行为在防守方看来是什么）

r2 本身是本地工具，防守方看不到。但**分析行为会留下与被分析样本相关的痕迹**：

| 动作 | 防守方/环境信号 |
| --- | --- |
| 调试运行样本（`r2 -d`） | 样本进程被 `ptrace`(Linux)/`DebugActiveProcess`(Windows) 附加；EDR 会记录调试器存在 |
| 断点修改内存 | 代码段出现 `0xCC`（软件断点）；完整性校验会发现 |
| patch 后运行 | 文件哈希变化；签名失效（Authenticode） |
| 反复重跑 | 同一进程名的高频创建/退出（Sysmon 1 + 5） |
| 搜索大文件 (`/x`) | 大量文件读取（若开文件审计） |

```bash
# 分析自己的样本时，注意：patch 会破坏签名
osslsigncode verify -in patched.exe    # 验证签名是否还有效
```

## 十二、常见坑

1. **不加 `-A` 就 `afl`**——没分析就没函数列表。必须 `aaa` 或 `-A`。
2. **PIE/ASLR 导致地址对不上**——`iI` 看 `pic`/`pie`。调试时用 `db main`（符号）而非绝对地址；或 `e bin.baddr` 设基址。
3. **裸二进制/固件不设基址**——`r2 -a arm -b 32 -m 0x08000000`。否则 xref 全错。
4. **patch 前没备份**——`-w` 模式直接改文件。先 `cp`。
5. **`wa` 写汇编后长度不对**——`wa jmp 0x401260` 生成 5 字节（e9 + 4 字节相对偏移），替换原 2 字节的 `je` 会覆盖后续指令。要么用 `wao nop` 补，要么用 `wx` 精确控制。
6. **`axt` 找不到调用**——函数指针调用（间接调用）不会被 `axt` 捕获。用 `aav`（分析值）或 `/r` 搜地址。
7. **混淆/加壳样本直接分析**——`iS~rwx` 看到可写可执行段、`afl` 函数数极少 → 是加壳。先脱壳（见 `re-agent-workflow`）。
8. **`pdg` 报错**——没装 r2ghidra。`r2pm -ci r2ghidra`。
9. **`izz` 输出太多**——加过滤：`izz~http`、`izz~flag`，或用 `e bin.maxstrbuf` 限制长度。
10. **调试时断点不命中**——子进程 fork 了。加 `e dbg.follow.child=true`，或用 `dc` 前的 `doo`。