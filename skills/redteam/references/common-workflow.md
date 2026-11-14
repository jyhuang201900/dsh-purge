# .NET 逆向通用工作流：从判定到重签名

> 被 `dotnet-reverse` 引用。这是一条**顺序敏感**的流水线：
> 判定 → 脱壳 → 静态 → 动态 → patch → 重签名。每一步都有"做错的代价"。

## 一、六阶段流水线与门闩

```text
               门闩（不过就别进下一阶段）
[1] 判定托管  ── CLR directory 非零 + BSJB ─────┐
[2] 识别保护  ── DIE 有明确 protector 结论 ────┤
[3] 脱壳      ── 方法体完整可读 + 能加载 ──────┤
[4] 静态定位  ── 找到入口 + 关键方法地址 ──────┤
[5] 动态验证  ── 运行时值与静态推断一致 ───────┤
[6] patch     ── 行为改变（不是文件保存成功）──┘
```

| 阶段 | 失败的最贵代价 | 常见误判 |
| --- | --- | --- |
| 1 判定 | 在 native PE 上耗整天 | 看到 `.NET` 字样就认定 |
| 2 识别 | 用错脱法破坏元数据 | DIE 没结论就直接 de4dot |
| 3 脱壳 | 在坏元数据上做分析，结论全废 | "能打开"当成"脱干净" |
| 4 静态 | 逆了错误的函数 | 从 `Main` 顺序读，忽略反射入口 |
| 5 动态 | 静态结论无法验证 | 断点没命中就说"没调用" |
| 6 patch | 破坏样本且不知为何 | 保存成功 = 成功 |

## 二、阶段 1：判定托管（见 `sharp-tools.md` §二）

```bash
python3 - <<'PY'
import struct
d = open("target.exe","rb").read()
pe = struct.unpack_from("<I", d, 0x3c)[0]
opt = pe + 24
pe32p = struct.unpack_from("<H", d, opt)[0] == 0x20b
dd = opt + (112 if pe32p else 96)
rva, size = struct.unpack_from("<II", d, dd + 14*8)
print("CLR RVA=0x%x size=%d -> %s" % (rva, size, "MANAGED" if rva else "NATIVE"))
print("BSJB present:", b"BSJB" in d[:0x2000] or b"BSJB" in d[max(0, len(d)//2):len(d)//2+0x2000])
PY
```

**四种"看起来像 .NET 但不是"的形态**：

| 形态 | 为什么容易误判 | 正确判定 |
| --- | --- | --- |
| NativeAOT | 有 `System.Private.CoreLib` 字符串 | CLR dir = 0 → native 逆向 |
| 单文件 bundle | host 有 `deps.json` 字符串 | 解 bundle 后看内层 dll |
| C++/CLI 混合 | 有 CLR 头，但主逻辑在 native | 检查哪个方法真正被调用 |
| .NET 壳（如 Reactor） | 磁盘文件 IL 可读但被加密 | 能打开 ≠ 能读 |

## 三、阶段 2–3：保护识别与脱壳

```bash
# 2. 识别
diec target.exe
de4dot target.exe -v                 # 日志里会打印 "Detected ..."，据此判断认出了什么

# 3. 脱壳（多层就重复）
cp target.exe target.orig.exe       # ★ 必须先备份
de4dot target.orig.exe -o stage1.exe --dont-rename
de4dot stage1.exe -o stage2.exe     # 第二层

# 验证"脱干净"的三个硬指标
ilspycmd -p -o ./src stage2.exe && find ./src -name "*.cs" | wc -l
grep -rc "throw null" ./src | awk -F: '$2>0' | head     # 有就是 body 没解
ilspycmd stage2.exe | grep -c "class "                  # 类型数量应合理（几十~几千）
```

| 检查项 | 合格 | 不合格说明 |
| --- | --- | --- |
| `.cs` 文件数 | > 10（业务程序） | 只有 1–2 个 → 还是 stub |
| `throw null` 出现 | 0 | 方法体加密未解 |
| 类型名可读性 | 部分是 `A.B.C` 属正常 | 全 `\u0001` → 元数据未解 |
| 能否加载运行 | `[Assembly]::LoadFrom()` 成功 | 抛 `BadImageFormatException` → 脱坏了 |

## 四、阶段 4：静态定位（找入口的三条路）

```text
路 1：常规入口
  □ ilspycmd -p 出工程 → grep "static void Main" / "static async Task Main"
  □ <.cctor> (Module 构造器) —— 混淆器常把真入口藏在这里
  □ App.xaml.cs / Startup.cs（WPF/WinForms）

路 2：字符串驱动（最有效）
  □ grep -rn "flag\|password\|verify\|check\|license\|encrypt" ./src
  □ 找到使用点 → 反向追调用者 → 找到判断分支

路 3：API 驱动
  □ grep -rn "HttpClient\|WebClient\|Socket\|Dns\." ./src    网络
  □ grep -rn "Registry\|File\.Write\|Process\.Start"         落地/执行
  □ grep -rn "Aes\|Rijndael\|SHA256\|MD5\|RSA"               加密
  □ grep -rn "Assembly\.Load\|Invoke("                        反射加载
```

**入口被混淆器改过时的判断**：

```bash
# 看 PE 的 EntryPoint token 指向哪个方法
monodis --method target.exe | head -5         # token 0x06000001 常是入口
# 若入口是 <Module>::.cctor，说明真 Main 由它调用
ilspycmd -t "<Module>" target.exe | head -40
```

## 五、阶段 5：动态验证（dnSpy 调试）

```text
□ Debug → Start（Program=目标，Working Dir=目标目录）
□ 断点优先级：
   1. 解密/解密的返回值处（拿明文）
   2. 网络发送前的 URL/body 构造（拿 C2 与协议）
   3. 判断分支的 IL 指令（拿条件真值）
□ Debug → Exceptions → 勾 CLR exceptions（异常驱动控制流必需）
□ Locals 窗口看 string/byte[]，右键 → Hexadecimal View
```

**动态必须回答的三个问题**（回答不了就等于没做）：

1. 静态推断的"加密字符串"运行时是不是那个明文？（值对不上说明算法抄错/取错重载）
2. 静态推断的"校验通过条件"运行时实际是什么？（分支实际走向）
3. 静态推断的"C2 地址"是否真的出现在 socket 调用参数里？

## 六、阶段 6：patch 的四种写法

### 6.1 IL patch（首选，最可靠）

| 目的 | IL 改法 | 说明 |
| --- | --- | --- |
| bool 返回值改 true | 方法体替换为 `ldc.i4.1` + `ret` | 覆盖整个方法体 |
| int 校验改通过 | `ldc.i4.0` → `ldc.i4.1` | 只改常量 |
| 跳过分支 | `brfalse.s` → `br.s`（无条件跳） | 或 `nop` 掉整个 if 块 |
| 删掉一段校验 | 选中指令 → 右键 → `NOP Instructions` | 保留栈平衡 |
| 改字符串 | 双击 `ldstr` 的 operand | 长度可变 |
| 方法返回原参数 | `ldarg.0` + `ret` | 常用于"返回 this" |

**栈平衡是 IL patch 的唯一硬约束**：删指令后 stack depth 必须与 `maxstack` 一致，
否则抛 `InvalidProgramException`。删除 `call` 之类有返回值/参数的指令时，
要用 `pop` 平衡，或者干脆整段用 `nop` 替换（nop 不影响栈）。

### 6.2 C# patch（适合逻辑复杂时）

```text
右键类 → Edit Class (C#) → 直接改源码 → Compile
失败原因 Top 3：
  □ 缺引用（改了 using / 用了未引用的类型）
  □ 混淆后的字段名/类型名与源码不匹配（ILSpy 反编译的 C# 常不能直接编）
  □ 泛型/迭代器/async 状态机被编译器展开，手改后不匹配
```

> **结论：先试 IL，C# 只用于"逻辑大改"**。dnSpy 的 C# 编译器和真实 roslyn 有差异，
> 复杂代码常失败；IL 编辑几乎不会失真。

### 6.3 资源/配置 patch

```text
□ 配置在 .resources → 用 dnSpy 编辑资源，或 resgen/ResXResourceReader 外部改
□ 配置在嵌入文件（EmbeddedResource）→ 右键 → Export → 改 → Replace
□ 配置在 app.config/json → 直接文本编辑（注意是否被加密）
```

```bash
# 列出所有嵌入资源
monodis --manifest target.exe | grep -i "resource"
# 或用 dnSpy：展开 Resources 节点逐个 Export
```

### 6.4 直接二进制 patch（无 dnSpy 环境）

```bash
# 找 ldstr 的 token，在 #US 流里改字符串（等长替换最安全）
python3 - <<'PY'
data = bytearray(open("target.exe","rb").read())
i = data.find(b"http://evil.example/c2")
if i > 0:
    new = b"http://127.0.0.1:8080/"   # 必须等长或更短（补 \0）
    data[i:i+len(new)] = new
    open("patched.exe","wb").write(data)
    print("patched at 0x%x" % i)
PY
```

## 七、重签名与加载（patch 之后必踩）

### 7.1 判断是否需要重签

```bash
sn -vf patched.exe
# "is valid" → 不用管
# "is not strong named" → 不管
# "Failed to verify" → 签名已坏，需要处理
```

### 7.2 三种处理路径

| 场景 | 做法 | 副作用 |
| --- | --- | --- |
| 本机测试 | `sn -Vr patched.exe`（跳过验证） | 仅本机、需管理员；测完 `sn -Vu` |
| 全局测试环境 | 关 .NET Fx 强名称验证（注册表） | 影响整机所有 .NET 程序，测试机专用 |
| 需要交付/长期使用 | 用自己的 key 重签（`ilasm /key:`） | 公钥变了，若目标校公钥则失败 |

```bash
# 本机放行
sn -Vr *,*                              # 所有（危险，仅隔离机）
sn -Vr patched.exe                      # 指定文件
sn -Vu patched.exe                      # 撤销

# 注册表关验证（.NET Framework，32/64 都要写）
reg add "HKLM\SOFTWARE\Microsoft\StrongName\Verification\*,*" /f
reg add "HKLM\SOFTWARE\Microsoft\StrongName\Verification\*,*" /f /reg:32

# 重签（需要 ildasm + ilasm，或 ilspycmd 出的 IL）
ilspycmd -il patched.exe > patched.il
sn -k mykey.snk
ilasm patched.il /output=resigned.exe /key=mykey.snk /dll   # 是 dll 时加 /dll
```

**注意**：.NET Core / .NET 5+ **默认不校验强名称**（只当身份标识，不做安全边界）。
所以 `dotnet` 跑的程序 patch 后通常直接能跑，只有 .NET Framework 的 GAC 加载才严格。

### 7.3 加载失败排查表

| 异常 | 真因 |
| --- | --- |
| `BadImageFormatException` | 位数不匹配 / 文件被截断 / IL 损坏 |
| `FileLoadException: Strong name signature could not be verified` | 强名称失效 → §7.2 |
| `TypeLoadException` | 类型签名被改坏（常见于手改 IL 的类型引用） |
| `MissingMethodException` | 调用了一个被删/被改名的方法 |
| `InvalidProgramException` | IL 栈不平衡（最常见于删除指令） |
| `SecurityException` | 目标有 `StrongNameIdentityPermission` 或 CAS 检查 |

## 八、状态机识别（async/await 与迭代器）

混淆器常把 async 方法展平成状态机，反编译出 `MoveNext()` 里巨大的 switch。

```text
识别：
  □ 类型实现 IAsyncStateMachine 或有 <MethodName>d__N 命名
  □ 有 int <>1__state 字段
  □ MoveNext() 里 switch(state)，每个 case 结尾设 state 并 return

读法：
  □ case -1 = 初始；case -2 = 结束（或反之，看编译器版本）
  □ await 点是 "保存 state → 调 GetAwaiter → 若未完成 return"
  □ 真实业务逻辑在 case 0,1,2... 的直线代码里
```

```bash
# 快速列出所有状态机类型
monodis --typedef target.exe | grep -E "d__[0-9]+|StateMachine"
ilspycmd target.exe | grep -n "IAsyncStateMachine\|<>1__state" | head
```

## 九、检测视角（防守方）

| 阶段 | 防守方可见信号 |
| --- | --- |
| 判定/静态分析 | 无（纯离线） |
| 动态调试 | 进程被 `DebugActiveProcess` 附加；`IsDebuggerPresent` 调用；EDR 的 debug 事件 |
| dump | 大量 `ReadProcessMemory` + `MiniDumpWriteDump` |
| patch 后执行 | 文件 hash 与签名不匹配；`sn -Vr` 注册表变化（4657） |
| 反射加载 | `Assembly.Load(byte[])` + 无文件落地；`VirtualAlloc` + `CreateThread`（CLR JIT 特征） |

## 十、验伤信号

| 声称 | 证据 |
| --- | --- |
| "已脱壳且可分析" | 方法体完整（无 `throw null`）+ 类型数合理 + 能加载 |
| "定位到关键方法" | 给出 `Namespace.Type.Method` 全名 + 文件行号 + IL 关键指令 |
| "动态确认了逻辑" | 运行时变量值 + 与静态推断的对应关系 |
| "patch 生效" | **行为改变**（跑起来输出不同 / 校验不再拦）且**可重复** |

**反例（看起来成功其实是假）**：

- `ilspycmd` 成功输出 → 但只是一堆 `// Failed to decompile`，说明没脱干净
- `sn -Vr` 后能跑 → 就报"patch 成功"：那只是关掉了验证，patch 逻辑是否生效未验证
- dnSpy 里改了 IL 并保存 → 但启动的还是旧的（进程未重启 / 单文件 bundle 里有内层副本）
- C# 编辑编译通过 → 运行时崩溃：dnSpy 编译器与真实编译器行为不一致

## 十一、常见坑

1. **patch 前不备份**——de4dot + patch 多轮后已无原始样本，无法重来。
   `cp target.exe target.orig.exe` 是第 0 步。
2. **在 `throw null` 的方法体上做分析**——这说明 body 未解，
   任何"逻辑推断"都是凭空。先回到 §三。
3. **C# patch 优先于 IL patch**——反编译出的 C# 经常编不过（缺引用、名字不匹配），
   浪费时间。IL 是唯一真值。
4. **忘了 .NET Framework vs .NET Core 的签名策略差异**——在 Core 上 patch 直接能跑，
   在 Framework 上要处理强名称，别把环境差异当 patch 错误。
5. **单文件 bundle 里改了外层**——内层 dll 是独立副本，改 host 没用。
   先解 bundle。
6. **R2R 程序集 patch IL 无效**——执行走预编译 native 代码，
   需要 patch native 或删 R2R 头。
7. **把 `obfuscator 的名字变了`当脱壳完成**——名字 ≠ 逻辑，
   CFF 和字符串加密才是难的部分。