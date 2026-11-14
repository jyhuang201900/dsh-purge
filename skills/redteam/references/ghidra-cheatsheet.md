# Ghidra 实操速查：headless、脚本、反编译器

> 被 `ghidra-reverse` 引用。IDA 不在手时的主力路径。核心是**把 Ghidra 当命令行工具用**，
> 而不是当 GUI 点。所有路径以 `$GHIDRA_HOME` 表示安装根目录（如
> `/opt/ghidra_11.1_PUBLIC`、`C:\ghidra_11.1_PUBLIC`）。

## 一、环境最小确认（先跑这三条，不确认后面全是猜）

```bash
echo "$GHIDRA_HOME"                                  # 空就说明没导出
ls "$GHIDRA_HOME/support/analyzeHeadless"            # *nix 无扩展名
ls "$GHIDRA_HOME/support/analyzeHeadless.bat"        # Windows
java -version                                        # Ghidra 11.1/11.2 需 JDK 17+；11.3+ 需 JDK 21
"$GHIDRA_HOME/support/analyzeHeadless" -help 2>&1 | head -40
```

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `JAVA_HOME is not set` | JDK 未装或版本过低 | 装 Temurin 21（或按版本选 17），`export JAVA_HOME=/usr/lib/jvm/temurin-21-jdk` |
| `Unable to locate Ghidra` | 用了软链或相对路径 | 用绝对路径调用，别 `cd` 进去再调 |
| 中文路径报错 | JVM 文件名编码 | `-vmargs -Dfile.encoding=UTF-8`，或把样本挪到 ASCII 路径 |
| 首次运行卡住 | 要建 `~/.ghidra` 配置 | 先跑一次 GUI 或 `-help` 完成初始化 |

## 二、headless 完整参数表

```bash
"$GHIDRA_HOME/support/analyzeHeadless" <project_location> <project_name> [选项]
```

| 参数 | 作用 | 实战注意 |
| --- | --- | --- |
| `-import <file\|dir>` | 导入文件或目录（可多次） | 目录**不会**递归，要递归加 `-recursive` |
| `-recursive` | 目录递归导入 | 大目录会非常慢，先 `find -name '*.exe'` 收敛 |
| `-overwrite` | 同名程序覆盖 | 不加会报 `already exists` 并跳过 |
| `-process <file\|dir>` | 用已有程序跑脚本，不重新导入 | 改脚本只跑 `-process` + `-noanalysis` 最快 |
| `-noanalysis` | 跳过自动分析 | 只做导入/导出时用；跳过后续脚本拿不到函数 |
| `-processor <lang>` | 强制指定语言/架构 | 裸 bin 必用，如 `x86:LE:64:default` |
| `-loader <class>` | 指定加载器 | 裸 bin 用 `BinaryLoader`，固件用 `BinaryLoader` + 基址 |
| `-cspec <id>` | 编译器规格 | 影响调用约定识别，如 `gcc-64` |
| `-scriptPath <dir>` | 追加脚本搜索目录 | 脚本不在默认目录必须加，否则 `Cannot find script` |
| `-preScript` | 分析前脚本 | 常用于打补丁/改基址 |
| `-postScript <name> [args...]` | 分析后脚本，可重复 | 脚本名后的 token 全是脚本自己的 argv |
| `-analysisTimeoutPerFile <sec>` | 单文件分析超时 | 批量必设，默认 300 容易卡死在巨型样本 |
| `-deleteProject` | 结束后删项目 | 批量扫样本必加，否则磁盘爆 |
| `-readOnly` | 只读打开 | 多进程共用同一项目时防锁冲突 |
| `-max-cpu <n>` | 限制线程 | CI 容器里防 OOM |
| `-log <file>` / `-scriptlog <file>` | 日志落盘 | `-scriptlog` 只收脚本 `println`，最干净 |
| `-vmargs -Xmx8g` | JVM 堆 | 大样本 `OutOfMemoryError` 就是它 |

### 常用组合（直接抄）

```bash
# 1) 单样本：分析 + 导出全部函数伪代码
"$GHIDRA_HOME/support/analyzeHeadless" /tmp/ghproj MyProj \
  -import /samples/target.exe -overwrite \
  -scriptPath /opt/ghscripts \
  -postScript ExportDecomp.java /tmp/out/target \
  -scriptlog /tmp/out/target.script.log \
  -analysisTimeoutPerFile 900 -deleteProject

# 2) 裸固件片段：无 ELF/PE 头，指定架构 + 基址（脚本里设）
"$GHIDRA_HOME/support/analyzeHeadless" /tmp/ghproj FwProj \
  -import /fw/blob.bin -processor "ARM:LE:32:Cortex" \
  -loader BinaryLoader -loader-baseAddr 0x8000 \
  -scriptPath /opt/ghscripts -postScript SetBase.py 0x08000000

# 3) 已有程序只跑脚本（改脚本迭代）
"$GHIDRA_HOME/support/analyzeHeadless" /tmp/ghproj MyProj \
  -process /samples/target.exe -noanalysis \
  -scriptPath /opt/ghscripts -postScript FindCrypto.py

# 4) 批量：目录内所有样本，各自独立项目名避免冲突
for f in /samples/batch/*.exe; do
  b=$(basename "$f")
  "$GHIDRA_HOME/support/analyzeHeadless" /tmp/ghproj "P_$b" \
    -import "$f" -overwrite -deleteProject \
    -postScript ExportStrings.java "/tmp/out/$b" \
    -analysisTimeoutPerFile 300 -max-cpu 4
done
```

> **批量别用 `-import /samples/batch` 一把梭**：一个样本崩溃会让整批退出，
> 且 `-deleteProject` 语义对多程序项目不友好。逐文件循环 + 独立项目名最稳。

## 三、脚本开发（Java / Python）

### Java 脚本骨架（最稳，跨版本兼容）

```java
//@category Export
//@keybinding
//@menupath
//@toolbar

import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;

public class ExportDecomp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String outDir = getScriptArgs().length > 0 ? getScriptArgs()[0] : "/tmp/out";
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);                 // 必须，否则 decompile 返回 null
        FunctionManager fm = currentProgram.getFunctionManager();
        for (Function f : fm.getFunctions(true)) {       // true = 按地址升序
            DecompileResults r = di.decompileFunction(f, 60, monitor);
            if (!r.decompileCompleted()) {
                println("FAIL " + f.getEntryPoint() + " " + r.getErrorMessage());
                continue;
            }
            println("// FUNC " + f.getEntryPoint() + " " + f.getName());
            println(r.getDecompiledFunction().getC());
        }
        di.dispose();
    }
}
```

要点：

- `openProgram(currentProgram)` 漏了就全是 `null`，这是新手第一大坑
- 超时单位是**秒**，巨型函数给 120–300
- `println` 进 `-scriptlog`；`printf` 也进，但 `System.out` 混在分析日志里
- `getScriptArgs()` 拿的是 `-postScript` 后面那串 token

### Python 脚本：先分清 PyGhidra 还是 Jython

| 版本 | 默认 Python | 判断方式 | import 写法 |
| --- | --- | --- | --- |
| Ghidra ≤ 11.2（默认） | Jython 2.7 | `python --version` 报 2.7 | `from ghidra.program.model.listing import Function` |
| Ghidra 11.3+ 且装了 PyGhidra | CPython 3 | 脚本头写 `#@runtime PyGhidra` | 同一套 `ghidra.*` API 可用，另可直接 `import requests` |

```python
#@category Export
#@runtime PyGhidra
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

di = DecompInterface()
di.openProgram(currentProgram)
mon = ConsoleTaskMonitor()
fm = currentProgram.getFunctionManager()
count = 0
for f in fm.getFunctions(True):
    r = di.decompileFunction(f, 60, mon)
    if r.decompileCompleted():
        print("// %s %s" % (f.getEntryPoint(), f.getName()))
        print(r.getDecompiledFunction().getC())
        count += 1
print("TOTAL %d" % count)
```

> Jython 脚本里写 `print("a", "b")` 会被当成 tuple，用 `%` 格式化。
> 见到 `SyntaxError: mismatched input` 先怀疑 Python 版本搞错。

### 高频 API 对照

| 目的 | Java | Python |
| --- | --- | --- |
| 当前程序 | `currentProgram` | 同 |
| 按地址取函数 | `getFunctionAt(addr)` | 同 |
| 地址常量 | `toAddr(0x401000)` / `currentAddress` | 同 |
| 读内存 | `getBytes(toAddr(a), buf)` | 同 |
| 反汇编一条 | `disassemble(toAddr(a))` | 同 |
| 建函数 | `createFunction(addr, name)` | 同 |
| 改签名 | `f.setName("decrypt_cfg", SourceType.USER_DEFINED)` | 同 |
| 加注释 | `setPlateComment(addr, "...")` | 同 |
| 交叉引用 | `getReferencesTo(addr)` | 同 |
| 全部字符串 | `currentProgram.getListing().getDefinedData(true)` 过滤 `isString` | 同 |

## 四、反编译器使用技巧（静态质量的决定因素）

1. **先修签名再读逻辑**：`Edit Function Signature`（GUI 的 `F`）比读错参数的伪代码省十倍时间。
   栈传参被识别成 `undefined4` 时，手动指定 `int, char *` 后重新 Decompile，很多"怪逻辑"直接消失。
2. **数据类型先行**：`Data Type Manager` 里建 Structure（字段偏移对齐真实布局），
   再把指针变量 Retype 成该结构。Ghidra 的结构体一旦对上，`*(int *)(param_1 + 0x18)` 会变成 `ctx->flags`。
3. **Decompiler 三个开关按需关**：`Eliminate unreachable code` 会把混淆器造的死代码删掉（利好阅读、不利识别花指令）；
   `Simplify` 关掉能看到原始运算顺序，逆向加密常数时有用。
4. **`Decompiler Parameter ID` 分析器**要单独打开：它对虚函数/回调的参数恢复有效，但对混淆样本会跑很久，批量时考虑关掉。
5. **`Ctrl+Shift+F`（Show References to）** 是定位入口的唯一可靠手段：
   字符串 → xref → 使用它的函数 → 反编译。找不到 xref 说明字符串在数据段被间接引用，要顺指针链。
6. **Thunk/PLT 要看穿**：Ghidra 对外部调用常显示 `thunk_FUN_...`，跳到 thunk 目标才知道真实 API。
7. **重命名要带前缀**：`dec_` / `chk_` / `net_` / `cfg_`，否则一千个 `FUN_00401a30` 没法汇报。
   `Window → Function Call Graph` 配合重命名能把调用链讲清楚。

## 五、headless 常见报错 → 处置

| 报错原文 | 真因 | 处置 |
| --- | --- | --- |
| `Cannot find script: ExportDecomp.java` | 没加 `-scriptPath` 或扩展名写错 | 加 `-scriptPath`，脚本名带扩展名 |
| `No program file(s) found` | `-import` 路径含空格未引号 / 通配符被 shell 吃掉 | 加引号；用 `for` 循环逐个传 |
| `Program already exists` | 同名程序已导入 | `-overwrite` 或换项目名 |
| `java.lang.OutOfMemoryError: Java heap space` | 默认堆不够 | `-vmargs -Xmx8g`（放在参数最末） |
| `Analysis timed out` | 单文件超默认 300s | `-analysisTimeoutPerFile 1800 -max-cpu 2` |
| `LockException` / `Unable to lock project` | 另一个 headless 进程占着项目 | 每个并行任务用**独立 project_location** |
| 脚本跑完没输出 | `println` 没 flush 或看错日志 | 用 `-scriptlog` 单独收；确认脚本 `run()` 真的进了 |
| `Unrecognized language` | `-processor` 的 ID 拼错 | `-processor` 接受 `x86:LE:64:default` 形式；先用 GUI 看 Language ID |

## 六、验伤信号（怎么证明分析真的成功）

| 声称 | 证据 |
| --- | --- |
| "已导入并分析" | 日志有 `ANALYZING` + `REPORT: ... Analysis succeeded`，且有函数数量输出 |
| "已反编译该函数" | 脚本日志出现该函数**入口地址 + 名字 + 非空 C 代码** |
| "识别出加密函数" | 伪代码里有常量表地址、循环、`^`/`*` 运算，且**能指出调用者** |
| "批量分析完成" | 输出目录里样本数 == 输入数，且失败的单独列了清单 |

**反例（看起来成功其实是假）**：

- 脚本打印 `TOTAL 0`——`openProgram` 没调或 `-noanalysis` 导致没有函数，**不是样本没问题**
- 每个函数都是 `undefined4 FUN_xxx(void)` 且只有一行 `return;`——分析超时被截断，函数体没反编译
- 输出里出现 `WARNING: Decompiler process died`——该函数结果不可信，必须重跑
- 用 `-import` 导入成功但项目里程序名是 `blob.bin` 而非预期——`-loader` 选错，按二进制加载了 PE

## 七、检测视角（防守方看到什么）

| 场景 | 信号 | 说明 |
| --- | --- | --- |
| 在目标主机上跑 headless | `java` 进程创建、命令行含 `analyzeHeadless`；大量读目标文件 | 4688 / Sysmon 1 直接留痕 |
| 大样本分析 | java 进程内存与 CPU 长时间占用 | EDR 的性能异常 |
| 项目目录落地 | 出现 `*.gpr`/`*.rep` 与 `~/.ghidra` | 文件创建事件 |
| ghidra-mcp 桥接 | 监听端口（如 8765）+ 反编译请求 | 网络连接 + 进程父子关系 |
| 批量导入 | 同一 java 进程短时间内打开大量样本 | 文件访问序列异常 |

> 逆向本身是**离线活动**：样本复制到分析机后，目标侧看不到。
> 真正被记录的是"**在受害机上分析**"与"**从受害机拉样本**"这两步。

## 八、GUI 侧高频操作（给人工复核用）

| 操作 | 快捷键 | 用途 |
| --- | --- | --- |
| Go to address | `G` | 跳转任意地址 |
| Decompile | `Ctrl+E` | 光标处函数反编译 |
| Rename | `L` | 重命名函数/变量 |
| Retype variable | `Ctrl+L` | 改变量类型 |
| Edit signature | `F` | 改函数原型 |
| Show refs to | `Ctrl+Shift+F` | 找谁调用了它 |
| Define data | `D` | 把字节定义成数据类型 |
| Create array | `[` | 连续数据变数组 |
| Patch bytes | 右键 → Patch Instruction | 改指令（做验证用） |
| Search strings | `Search → For Strings` | 最小/长度过滤要调小到 4 |

## 九、常见坑（按踩坑概率排序）

1. **用 demo 项目反复 import 同一文件**——Ghidra 项目里有同名程序就直接跳过，
   你以为分析了新样本，其实是旧结果。永远 `-overwrite` 或换 project_name。
2. **`-noanalysis` 后抱怨没函数**——它只导入不分析，函数列表为空是预期行为。
   迭代脚本时先用一次完整分析建好程序，后续才 `-process -noanalysis`。
3. **并行 headless 共用 project_location**——项目锁冲突，表现为随机失败。
   并行必须一任务一目录。
4. **裸 bin 不给 `-processor`**——Ghidra 猜成 x86 32 位，ARM 固件全错。
   `file` 只能告诉你"data"，架构要从固件头/CPU 型号推。
5. **把 Ghidra 反编译当源码读**——它不保留原始类型和变量名，别在报告里引用
   `local_18` 这种名字当"事实"，只引用地址与行为。