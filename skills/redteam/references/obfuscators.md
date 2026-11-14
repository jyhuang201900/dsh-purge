# .NET 混淆器谱系：识别、脱壳、反制

> 被 `dotnet-reverse` 引用。**先识别到具体混淆器，再选脱法**——这一步错了，
> 后面所有反编译结果都是垃圾。混淆器不是黑盒，每个都有稳定的结构指纹。

## 一、总览：先分类再动手

| 类别 | 代表 | 是否加壳（native） | 主要伤害 | 脱法 |
| --- | --- | --- | --- | --- |
| IL 层重写 | ConfuserEx、Babel、Obfuscar、Eazfuscator | 否 | 控制流平坦化、字符串加密、代理调用 | de4dot + 手工补 |
| 商业保护（含 native） | .NET Reactor、Themida、VMProtect、Agile.NET | 是 | 方法体加密 → 运行时解密、anti-tamper | patch 后再 de4dot，或 dump 内存 |
| 仅符号混淆 | Obfuscar、Dotfuscator（默认配置） | 否 | 名字变 `A.B.C` | 无需脱，按行为分析 |
| 商业静态保护 | SmartAssembly、Dotfuscator Pro（control flow） | 部分 | 字符串编码、资源压缩、CFG | de4dot（SA 支持较好） |
| 自研/私有 | 恶意样本常用 | 视情况 | 混合 | 手工 + 动态 dump |

```bash
# 第一步永远是它
diec target.exe
# 关注输出的：Compiler / Protector / Linker 三栏
# 例：".NET executable (ConfuserEx 1.6.0)"  —— 直接点名
```

| DIE 输出关键字 | 判定 |
| --- | --- |
| `ConfuserEx` / `ConfusedByAttribute` | ConfuserEx（看版本，0.x/1.x/2.x 差异大） |
| `.NET Reactor` / `Eazfuscator` / `SmartAssembly` | 商业壳，多半有 native stub |
| `.NET executable` 且无 protector 标记 | 可能只是符号混淆，或私有混淆 |
| `Themida` / `VMProtect` | **强壳**，.NET 部分在 native 里，先 dump |

## 二、ConfuserEx（最常见的免费混淆器）

### 2.1 版本差异（决定脱法）

| 版本 | 特征 | 脱法 |
| --- | --- | --- |
| 0.6 / 0.x | 元数据顺序打乱、`ConfusedByAttribute` 存在于 assembly custom attribute | de4dot 直接过 |
| 1.0.0 | 引入 anti-tamper（压缩+加密段）、更强的 CFG | 先 patch anti-tamper，再 de4dot |
| 1.6.0 | anti-tamper 改版（`.cctor` 里 `Module.ResolveMethod`）、资源加密 | `de4dot-cex` 或 `ConfuserEx-Unpacker` |
| 2.0 / 2.x（分支版） | 新的 anti-tamper 与常量加密 | `de4dot-cex` + 手工；或 `NoFuserEx` |

### 2.2 指纹识别（不看 DIE 也能认）

```text
□ assembly 级 custom attribute 里有 "ConfusedByAttribute"（未删时）
□ 大量类型名形如 \u0001\u0002\u0003 或单字符 A/B/C
□ 存在方法 <Module>.() 或 <Module>.‮‭（bidi 控制字符名）
□ 每个方法开头有巨大的 switch（控制流平坦化）
□ 字符串字段是 byte[]/int[] 数组 + 静态初始化
□ #US 流长度异常大或极小（字符串被挪走）
□ 入口点被改成 <Module>.cctor 之后才调用真实 Main
```

```bash
# 快速判定（union 三个信号）
strings -a target.exe | grep -m3 -i "ConfusedBy"
monodis --assembly target.exe
monodis --typedef target.exe | awk '{print $NF}' | grep -cE '^[A-Za-z]$'   # 单字符类型数
monodis --method target.exe | grep -c "switch"                             # 大量 switch 是 CFF 迹象
```

### 2.3 anti-tamper 的机制与 patch

ConfuserEx anti-tamper 的流程：

```text
1. 编译时把原始 metadata（#~/#Strings/#US/#Blob）压缩 + 加密，
   放进一个 <Extra> 资源或新加的段里
2. Module .cctor 里调用解密 routine，把明文元数据写回内存中的 PE 映像
3. 解密后的 metadata 覆盖当前模块的内存结构 → 之后所有反射调用看到"正确"的元数据
4. 磁盘上的文件本身是坏的：直接反编译看到乱码/缺方法
```

**patch 思路（两条路）**：

```text
路线 A（首选）：让解密先跑完，再 dump
  1. 用 dnSpy 打开（能看到部分类，说明 de4dot 前已能读一点）
  2. 启动调试，在 <Module>::.cctor 返回后 break
  3. Debug → Modules 窗口 → 右键目标模块 → "Dump to disk"
  4. 对 dump 出来的文件跑 de4dot

路线 B：静态 patch 掉校验，直接用 de4dot-cex
  1. de4dot-cex target.exe -o out.exe   （新版能直接处理多数 1.x anti-tamper）
  2. 失败则先手工找 anti-tamper 的入口（<Module>.cctor 中第一个大方法）
  3. patch 掉"校验失败就 crash"的分支（通常是比较 hash 后的 bne.un）
```

```bash
# de4dot-cex 全参数实战
de4dot-cex target.exe -o target-clean.exe \
  --dont-rename \                 # 保留原名，便于比对
  -v                              # verbose，看它识别成什么
# 输出里出现 "Detected ConfuserEx 1.6.0" 才算识别成功
```

| 现象 | 真因 | 处置 |
| --- | --- | --- |
| de4dot 输出 `Unknown obfuscator` | anti-tamper 还没解，元数据是坏的 | 走路线 A（动态 dump） |
| 脱完能打开但方法体全空 | 方法体在运行时才解（body 加密） | 动态 dump 或 hook `ResolveMethod` |
| 脱完运行报 `TypeLoadException` | 脱壳破坏了泛型/嵌套类型签名 | 用 `--dont-rename` 重试；或只脱字符串 |
| 每次运行结果不同 | 有反调试/环境校验 | 见 §六 |

### 2.4 控制流平坦化（CFF）的识别与还原

CFF 的形态：一个 `while(true) switch(state)`，每个 case 结尾改 `state`，真实逻辑被打散成基本块。

```csharp
// 平坦化后的典型形态
int num = 0x1a3f;
while (true) {
    switch (num) {
        case 0x1a3f: x = a + b; num = 0x77c1; break;
        case 0x77c1: if (x > 10) num = 0x2b90; else num = 0x9e04; break;
        ...
    }
}
```

| 识别信号 | 说明 |
| --- | --- |
| 方法里有 `switch` 且 case 数 > 5，且每个 case 只做两三件事 | 典型 CFF |
| 存在一个"状态变量"被反复赋值成魔数 | 状态机 dispatcher |
| 方法体大小骤增 10 倍以上 | 平坦化的代价 |
| 出现 `goto` 到 switch 开头 | dispatcher 的 loop |

**还原办法（按可行性排序）**：

1. **动态 trace 求状态序列**（最可靠）：在 dispatcher 处断点，记录 state 序列，
   按执行序重建真实控制流。
2. **`de4dot` 的 CFF 还原**：只对部分混淆器有效（ConfuserEx 的 CFF 它处理有限）。
3. **符号执行/反平坦化脚本**：`D-810`（IDA 插件）、`obfuscator-io-deobfuscator`（JS 用，不适用 .NET）、
   `de4dot` 分支 `ConfuserEx-Unpacker` 里有部分实现。
4. **手写简化**：如果 dispatcher 的 case 数 < 20，手工把 case 按 state 顺序串起来，
   比任何工具都快。

> **不要试图"完全自动化"CFF 还原**。实战里 80% 的收益来自
> "找到 dispatcher → 提取 state 常量 → 按 trace 排序"，剩下 20% 靠人读。

## 三、Babel .NET / Obfuscar / Eazfuscator

### 3.1 Babel .NET

| 项 | 内容 |
| --- | --- |
| 特征 | 方法体加密（body 在资源里，运行时解密）、字符串加密、控制流 |
| 指纹 | `Babel` 命名空间残留、`<PrivateImplementationDetails>` 大量 |
| 脱法 | `de4dot -p babel`，通常一遍过 |
| 残留 | 部分版本字符串仍是加密数组，要动态取 |

```bash
de4dot -p babel target.exe -o clean.exe
# 不指定 -p 则自动探测；日志里出现 "Detected Babel.NET" 才算识别成功
```

### 3.2 Obfuscar（开源，常被误判为"没混淆"）

| 项 | 内容 |
| --- | --- |
| 特征 | **只改名字**，不改逻辑。类型变 `A`、`B`、`C`，方法变 `A()`、`B()` |
| 风险 | 容易被当成"简单的样本"，实际逻辑完好，不需要脱 |
| 处理 | 不必 de4dot（会破坏可读性）；按**字符串/API 调用**定位，重命名回来 |
| 例外 | 开了 `HideStrings` 时字符串会被 base64+xor，需要解 |

```bash
# 判断是不是"只改名的混淆"：方法体是否正常
ilspycmd target.exe | grep -A3 "private void A()" | head -20
# 若方法体是正常逻辑（有 if/循环/调用），就是 Obfuscar 类，别浪费时间脱
```

**给 AI 读的策略**：Obfuscar 样本先 `ilspycmd -p` 出工程，
用字符串常量做锚点重建语义，再把 `A()` 重命名成 `CheckLicense()`，随后一切照常。

### 3.3 Eazfuscator.NET

| 项 | 内容 |
| --- | --- |
| 特征 | 字符串加密（`<PrivateImplementationDetails>` 里的 `byte[]` + 静态解密封装）、资源加密 |
| 指纹 | `Eazfuscator` 字符串、`#Strings` 里大量 `\u0001` 前缀 |
| 脱法 | `de4dot -p eaz`，新版（5.x+）常失败，需动态 |
| 动态取法 | 断点打在返回 string 的方法上，运行时读返回值 |

```text
Eazfuscator 加密字符串的调用形态（常见）：
  string s = Class45.smethod_12(0x1a2b3c);   // 参数是"字符串索引"
  → 在 smethod_12 的 return 处断点，直接读返回值
  → 若要批量取：把方法体改成"打印 index → value"，再让程序跑一遍
```

## 四、商业保护：.NET Reactor / SmartAssembly / Themida

### 4.1 .NET Reactor

| 项 | 内容 |
| --- | --- |
| 特征 | native stub + 方法体加密（Necrobit）+ anti-tamper + 反调试 |
| 指纹 | `Reactor` 字符串、入口是 native `_CorExeMain` 前先跑 stub、`#~` 流被压缩 |
| 脱法 | ① `de4dot -p dr` 对老版本；② 新版本必须动态 dump |
| 动态 dump | 启动进程 → 等 stub 解密完成 → `ExtremeDumper` / `MegaDumper` / `dnSpy Debug→Modules→Dump` |

```text
判断"是否已解密完成"的关键：
  □ 模块内存里的 metadata 大小恢复正常（#~ 流有值）
  □ 能在 Process Explorer 里看到 CLR 模块被加载
  □ 目标已显示主窗口/开始业务行为
太早 dump 得到的是未解密元数据，反编译仍是空的。
```

### 4.2 SmartAssembly

| 项 | 内容 |
| --- | --- |
| 特征 | 字符串编码（`GetString` + `byte[]`）、资源压缩、可选 CFG |
| 指纹 | `SmartAssembly` 字符串、`<PrivateImplementationDetails>{GUID}` 类 |
| 脱法 | `de4dot -p sa` 支持良好 |
| 残留 | 名称混淆（`A.B.C`）需人工重命名 |

```bash
de4dot -p sa target.exe -o clean.exe --dont-rename
# 再跑一次不带 -p 的，让 de4dot 自动探测剩下层（多层混淆时）
de4dot clean.exe -o clean2.exe
```

### 4.3 Themida / VMProtect（强壳）

| 项 | 内容 |
| --- | --- |
| 本质 | .NET assembly 被包进 native 虚拟机，磁盘上**没有可用 IL** |
| 判断 | DIE 报 Themida/VMProtect；`strings` 有 `Themida`、`VMProtect`；入口是 native |
| 静态逆向 | 只能逆 native stub，成本极高 |
| 现实做法 | **动态 dump**：让程序完整解密后再从内存抽 assembly |
| dump 工具 | `ExtremeDumper`（专为 .NET 强壳设计）、`MegaDumper`、`ScyllaHide` 配合 `x64dbg` |
| anti-debug | 必须先过（ScyllaHide 的 VMProtect/Themida profile） |

```powershell
# ExtremeDumper 典型流程（GUI/CLI 均可）
ExtremeDumper.exe --name target.exe --dump-all --output C:\dump
# 或 GUI：选进程 → Modules → 选 CLR 模块 → Dump
```

> **强壳的现实边界**：如果不是必须，不要在这里投入。
> 先确认“有没有更便宜的路”——配置文件可能在外部、C2 可能在 pcap 里、
> 密钥可能通过动态 hook 拿到（不需要脱壳）。

## 五、字符串加密的通用还原法

这是**收益最高**的一步：字符串是定位逻辑的唯一锚点。

| 加密形态 | 识别 | 还原 |
| --- | --- | --- |
| 静态 `byte[]` + 解密函数 | `<PrivateImplementationDetails>` 有大数组 | 找到解密函数 → 用 dnSpy 写 C# 脚本批量调用 |
| 逐字符运算 | 方法体是 `for` + `^`/`+` + `char` 转换 | 直接抄算法到 Python 批量解 |
| 索引表 | `GetString(int)`，switch/数组查表 | 断点或伪造调用遍历所有 index |
| 运行时生成 | 方法体空，靠 `ResolveMethod` 动态解 | 只能动态取（断点 return） |
| StackString / span | 用 `stackalloc` + 逐字节写 | 反编译能看到，按顺序读 |

```csharp
// dnSpy 里"批量解密"的脚本（放在脚本编辑器，用 C# Interactive 或自建方法调用）
// 思路：反射调用目标的解密方法，遍历所有可能输入
var t = typeof(SomeObfuscatedClass);
var m = t.GetMethod("Decrypt", BindingFlags.Static | BindingFlags.NonPublic);
for (int i = 0; i < 500; i++) {
    try { Console.WriteLine(i + " => " + m.Invoke(null, new object[]{ i })); }
    catch { }
}
```

```python
# 若算法是 xor + 索引，直接 Python 批量（示例：key 逐字节 xor）
data = bytes.fromhex("1f2e3d4c")
key  = b"\x41\x42"
print(bytes(b ^ key[i % len(key)] for i, b in enumerate(data)))
```

**验伤**：解出来的字符串必须是**可读且有语义**的（URL、注册表路径、错误消息）。
如果解出乱码，说明算法抄错了（常见：`char` 有符号/无符号、循环边界 off-by-one）。

## 六、反调试与 anti-tamper 的反制

| 手段 | 实现 | 反制 |
| --- | --- | --- |
| `Debugger.IsAttached` | 直接查 | patch 成 `return false` |
| `DebuggerHidden` / `DebuggerStepThrough` | 阻碍单步 | dnSpy `Debug → Options` 忽略 |
| `CheckRemoteDebuggerPresent` P/Invoke | Win32 查询 | patch 返回值 / ScyllaHide |
| 时序检测（`Stopwatch`） | 断点导致超时 → 走异常分支 | 关断点，改用日志/内存 dump |
| 异常驱动控制流 | 主动抛异常，catch 里判断栈 | 打开 CLR 异常中断，跟真实路径 |
| 模块校验（hash 自身） | 文件被 patch 就崩 | patch 校验方法（返回 true） |
| 反 ILDasm（`SuppressIldasmAttribute`） | 阻止 ildasm | 用 dnSpy / ilspycmd，无视它 |
| 调试器检测 + 自毁 | 检测到就删自身/退出 | 先断在检测前，patch |

```text
反制顺序（违反顺序会触发告警/自毁）：
1. 静态：找出所有校验方法（搜 IsAttached / CheckRemoteDebugger / GetCurrentProcess）
2. patch 所有校验 → 保存
3. 再启动调试（此时才安全）
4. 若一启动就崩，说明还有更早的校验（Module .cctor 里）→ 回到 1
```

## 七、检测视角（防守方怎么发现"有人在脱壳"）

| 行为 | 日志/信号 | 说明 |
| --- | --- | --- |
| 进程被 dump | EDR 的 `process_memory_read` / `minidump` 事件 | 大量 `ReadProcessMemory` 打在同一进程 |
| dnSpy 调试 | 目标进程出现 `Debugger` 端口、`IsDebuggerPresent` 被调用 | Sysmon 无直接事件，靠 API 监控 |
| 文件被改后重跑 | 文件 hash 变化 + 立即执行 | 结合签名失效告警 |
| de4dot 产物落地 | 文件名含 `-clean`/`-deobf`，同目录出现 | 文件创建事件 |
| 强名称验证被关闭 | 注册表 `HKLM\SOFTWARE\Microsoft\StrongName\Verification` 变化 | 注册表审计 4657 |

> 对红队而言：**脱壳动作本身是高噪声**。在真实评估中，
> 优先在隔离分析机做静态脱壳，只在目标机上做必要的动态取值。

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "识别出混淆器 X" | DIE 输出原文 + 至少一个结构指纹（如 `ConfusedByAttribute`） |
| "已脱壳" | 脱壳产物能**正常反编译出完整方法体**，且**能运行**（或至少能加载） |
| "字符串已解密" | 解出的字符串有语义，且与**使用它的方法**能对应上 |
| "CFF 已还原" | 给出还原后的控制流（如"if → 校验 → 成功/失败"），而不是"switch 变少了" |

**反例（看起来成功其实是假）**：

- `de4dot` 输出文件能打开 → 但方法体仍然只有 `throw null`：body 加密没解
- 字符串"解出来了"但全是 `\u0001\u0002`：解的是**被混淆的名字**，不是加密字符串
- 脱壳后能运行 → 但不能反编译：脱的是 native stub，IL 仍缺失
- 类型名恢复正常 → 但逻辑仍然不可读：CFF 未被处理，只脱了名字

## 九、常见坑

1. **不跑 DIE 就上 de4dot**——自动识别失败后乱猜 `--type`，
   会把好好的元数据搞坏。破坏性操作前必须备份。
2. **在 anti-tamper 未解时反复 de4dot**——每跑一次都可能进一步破坏元数据，
   第二次的输入已经不是原始样本。**永远从原始样本重来**。
3. **把 Obfuscar（只改名）当强壳**——花几小时找脱壳方法，
   实际只需重命名。判断标准是"方法体是否完整"。
4. **强壳太早 dump**——stub 还没解完就 dump，得到空 assembly。
   要等"模块内存 metadata 正常 + 业务已开始"。
5. **多层混淆只脱一层**——ConfuserEx 外层 + 内层 SmartAssembly 很常见，
   `de4dot` 要跑两遍（第二遍喂第一遍的输出）。
6. **patch 后忘记强名称失效**——保存成功但加载失败，
   误判成"patch 逻辑错"，实际是签名问题（见 `common-workflow.md` §五）。