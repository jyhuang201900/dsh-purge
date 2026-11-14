# .NET 工具链：dnSpy / ILSpy / de4dot 选择与集成

> 被 `dotnet-reverse` 引用。核心问题只有三个：**是不是托管**、**用什么看**、**怎么让 AI 也能操作**。

## 一、工具安装矩阵

| 工具 | 平台 | 安装 | 用途 | 备注 |
| --- | --- | --- | --- | --- |
| dnSpyEx | Win（.NET Framework 4.8） | `choco install dnspyex -y` 或 GitHub release 解压 | 反编译 + **调试器** + IL 编辑 + 保存 | 首选 GUI，能改能调 |
| ILSpy / `ilspycmd` | Win/Linux/macOS | `dotnet tool install -g ilspycmd` | 命令行反编译整个程序集 | CI 批量、给 grep 提供文本 |
| dotPeek | Win | JetBrains 官网 | 只读浏览、反编译到工程 | 转 VS project 好用，不能存 IL |
| de4dot / de4dot-cex | Win（.NET Fx） | GitHub `de4dot` / `de4dot-cex` release | 去混淆 | cex 版支持 ConfuserEx 1.x/2.x 更新 |
| DIE (diec) | 全平台 | `choco install die` / release | 壳与编译器识别 | 先跑它决定要不要 de4dot |
| `dotnet-ildasm` | 全平台 | `dotnet tool install -g dotnet-ildasm` | dump IL | 比 `monodis` 好装 |
| `monodis` | Linux | `apt install mono-utils` | IL + 元数据表 dump | 看 MethodDef/TypeDef 表结构 |
| ScyllaHide / TitanHide | Win | 插件 | 反反调试 | dnSpy 反调试失败时用 |
| ExtremeDumper | Win | release | dump 内存中的 .NET assembly | 强壳/加密加载时兜底 |

```powershell
# 一次装齐（Windows）
choco install dnspyex de4dot-cex die dotnet-sdk-8.0 -y
dotnet tool install -g ilspycmd
dotnet tool install -g dotnet-ildasm
# 验证
dnSpy.exe --help 2>$null; ilspycmd --version; de4dot --help
```

## 二、第一步：判定「是不是托管」（错了后面全白干）

```bash
# 1) 最可靠：CLR 运行时头（Data Directory[14]）
python3 - <<'PY'
import struct,sys
d=open("target.exe","rb").read()
pe=struct.unpack_from("<I",d,0x3c)[0]
opt=pe+24
magic=struct.unpack_from("<H",d,opt)[0]
pe32p = magic==0x20b
dd = opt + (112 if pe32p else 96)          # DataDirectory 起始
rva,size = struct.unpack_from("<II", d, dd+14*8)
print(f"CLR dir RVA=0x{rva:x} size={size} -> {'MANAGED' if rva else 'NATIVE'}")
PY
```

```powershell
# 2) 反射加载（能在 .NET 里打开就是托管）
try { [System.Reflection.AssemblyName]::GetAssemblyName("target.exe") } catch { "not managed" }
```

```bash
# 3) 字符串/导入旁证
strings -a target.exe | grep -m5 -iE "mscoree|_CorExeMain|mscorlib|System\.Private\.CoreLib|BSJB"
# BSJB = 元数据签名根（0x424A5342），出现即托管
```

| 结果 | 结论 | 走哪 |
| --- | --- | --- |
| CLR dir 非零 + `BSJB` | 纯 IL 托管 | dnSpy 直接开 |
| CLR dir 非零 + 有 native 段（`.text` 极短、有 packer 段） | 混合/加壳 | 先 de4dot 或 dump 内存 |
| CLR dir 为零 + 有 `System.Private.CoreLib` | **NativeAOT** | 走 IDA/Ghidra，本 skill 只做识别 |
| CLR dir 为零 + 无 CLR 字符串 | 原生 PE | 走 `ida-reverse` / `ghidra-reverse` |
| 单文件 exe（>30MB，多 bundle） | .NET 单文件打包 | 先解 bundle（见 §五） |

## 三、`ilspycmd` 批量反编译（给 grep / AI 用）

```bash
# 整个程序集反编译成目录（每个类型一个 .cs）
ilspycmd -p -o ./src_out target.exe
# -p = project 模式（生成 .csproj，可直接 build）

# 只要 IL（不还原 C#）
ilspycmd -il target.exe > target.il

# 指定类型
ilspycmd -t Namespace.ClassName target.exe

# 反编译单个方法（配合 grep 定位后精读）
ilspycmd target.exe | grep -n "void Verify" 

# dump 元数据表（要 mono）
monodis --typedef  target.exe | sort -k3 | head -40
monodis --method   target.exe | grep -i "decrypt\|verify\|check"
monodis --manifest target.exe            # 依赖程序集清单
```

**批量场景**：`ilspycmd -p` 输出的 `.cs` 目录是给 AI/`grep` 的最佳输入——
比在 GUI 里翻快十倍。定位到具体方法后再回 dnSpy 看 IL / 调试。

## 四、dnSpyEx 关键操作

| 操作 | 路径 | 用途 |
| --- | --- | --- |
| 打开程序集 | `File → Open` | 拖入即反编译 |
| 切 IL / C# | 编辑器底部下拉 / `Ctrl+I` | **关键判断必须看 IL** |
| 编辑方法 | 右键方法 → `Edit Method (C#)` / `Edit IL Instructions` | 改逻辑，IL 更可靠 |
| 编辑类 | 右键类 → `Edit Class (C#)` | 加/删成员 |
| 保存模块 | `File → Save Module...` | 写回磁盘，未签名则直接可跑 |
| 启动调试 | `Debug → Start`（指定 exe） | 断点、看局部变量 |
| 附加调试 | `Debug → Attach to Process` | 挂已运行进程 |
| 断点 | 方法体行号左侧点击 | .NET 断点按方法+IL 偏移 |
| 异常设置 | `Debug → Exceptions` | 打开 CLR 异常中断，抓 anti-debug |
| 搜索 | `Ctrl+Shift+K` | 搜类型/方法/字符串/成员引用 |
| 分析器 | `View → Analyzer` | 找未使用代码、可疑调用 |

**IL 编辑的实用改法**：

| 目的 | IL 改法 |
| --- | --- |
| 把 false 改 true | `ldc.i4.0` → `ldc.i4.1` |
| 跳过校验 | 方法体整体替换为 `ldc.i4.1 / ret`（返回 true） |
| 直接返回原值 | `ldarg.0 / ret`（返回 this） |
| 清空方法 | 只留 `ret`（void） |
| 改字符串常量 | 点 `ldstr "..."`，编辑 operand |
| 让循环不执行 | 把循环条件 `blt` 改 `br` 无条件跳 |

> **保存未签名的程序集**：dnSpy 保存后签名失效，若目标强名称校验会拒绝加载。
> 处理见 §七。多数样本不强校验，直接跑。

## 五、单文件 vs IL-only：最容易搞错的分界

.NET 5+ 的 **single-file publish** 把 runtime + 所有 dll 打进一个 host exe。
直接丢 dnSpy 只能看到 host（一个 native stub），看起来"没有托管代码"。

```bash
# 判断是不是单文件 bundle
strings -a app.exe | grep -m3 -E "\.deps\.json|\.runtimeconfig\.json|DOTNET_BUNDLE_EXTRACT_BASE_DIR"
# 有这些基本就是单文件

# 抽 bundle：用 dotnet 自带机制直接跑出来
DOTNET_BUNDLE_EXTRACT_BASE_DIR=/tmp/bundle ./app.exe   # 运行后会在该目录解出全部 dll
ls /tmp/bundle/*/                                       # 拿里面的目标 dll 再分析

# 或离线抽（不执行）：dotnet-single-file-extractor / sfextract
sfextract app.exe -o ./extracted
```

| 形态 | 特征 | 处理 |
| --- | --- | --- |
| 纯 IL assembly | CLR 头 + `BSJB`，体积正常 | dnSpy 直开 |
| 单文件 bundle | host 是 native，`strings` 有 `deps.json` | 解 bundle 后分析内层 dll |
| ReadyToRun (R2R) | 有 IL **也有** precompiled native code | IL 可读，但真实执行走 native，patch IL 可能无效 → 需 patch native 或关 R2R |
| NativeAOT | 无 CLR 头 | 走 native 逆向 |
| 混合模式 (C++/CLI) | CLR 头 + 大量 native 段 | IJW，部分方法在 native；IL 只是壳 |

**R2R 是隐形坑**：`ilspycmd` 反编译出的 C# 看起来正常，但改 IL 后重新运行
可能仍走预编译 native 代码，**patch 不生效但你也看不到报错**。判断：

```bash
# R2R 程序集的 READYTORUN header 在 PE 的一个特殊 directory
python3 -c "
import struct;d=open('t.dll','rb').read()
print('ReadyToRun' if b'ReadyToRun' in d or b'R2R' in d[:0x400] else 'IL-only')"
strings -a t.dll | grep -m2 "ReadyToRun"
```

## 六、动态调试要点（dnSpy 断点）

```text
□ Debug → Start，Program = 目标 exe，Working Directory = 目标目录（缺 dll 会启动失败）
□ 断点打在这些地方：
   - 字符串解密函数（返回 string 的方法）→ 运行时看返回值
   - 配置解析入口（JsonConvert.DeserializeObject / XmlSerializer）
   - 网络发送前（HttpClient.SendAsync / WebClient.UploadString）
   - 校验判断（Verify / Check / Validate）
□ Debug → Exceptions → 勾选 Common Language Runtime Exceptions
   → anti-debug 常用异常驱动控制流，勾了才能看到真实路径
□ 局部变量窗口直接看 string / byte[]，右键可 hex view
□ 方法返回值：在 call 之后那一行设断点，看 Evaluate / Locals
```

**dnSpy 调试报错速查**：

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `Cannot start the debugging session: ...` | 缺依赖 dll / 位数不符 | Working Dir 设对；`Debug → Start` 里选 AnyCPU |
| 断点显示空心（未绑定） | 方法被 JIT 内联或未加载 | `Debug → Options` 关 `Enable Just My Code`；用 IL 断点 |
| `The debugger cannot attach` | 目标已附加别的调试器 / 有 anti-debug | 用 ScyllaHide；或用 `Debug → Attach` + 先 patch anti-debug |
| 一启动就退出 | 有 anti-tamper / 完整性校验 | 先 patch 校验方法，或 dnSpy `Debug → Options → 禁用模块校验` |

## 七、强名称重建（保存后无法加载时）

```bash
# 1) 检查是否强名称签名
sn -vf target.exe            # -v 验证，-f 强制
# 输出 "... is valid" 或 "is not strong named"

# 2) 若只是本地测试，注册验证跳过（需管理员，且仅本机生效）
sn -Vr *,*                   # 全局跳过所有强名称验证（危险，测完撤销）
sn -Vr target.exe            # 只跳过该文件
sn -Vu target.exe            # 撤销

# 3) 关掉 .NET Framework 的强名称验证（注册表，仅测试机）
reg add "HKLM\SOFTWARE\Microsoft\StrongName\Verification\*,*" /f
reg add "HKLM\SOFTWARE\Microsoft\StrongName\Verification\*,*" /f /reg:32   # 32 位进程

# 4) 用 ilasm 重新汇编 + 重新签名
ilspycmd -il target.exe > target.il
ilasm target.il /output=patched.exe /key=mykey.snk
```

```powershell
# 生成密钥对并签名（.NET Framework）
sn -k mykey.snk
# .NET Core 用 dotnet 的强名称工具或 ilasm 带 /key
```

> **顺序**：patch → 保存 → 若加载失败 → `sn -Vr` 临时放行（仅实验机）→
> 需要交付时再用自己的 key 重签（公钥变了，若目标校验公钥则必然失败）。

## 八、AI 直接操作：dnSpy MCP

```json
// mcp 配置片段（字段名以实际 server 为准，下面是最小形状）
{
  "mcpServers": {
    "dnspy": {
      "command": "dnSpy.Mcp.Server.exe",
      "args": ["--port", "0", "--stdio"]
    }
  }
}
```

| 能力 | 典型工具名 | 用途 |
| --- | --- | --- |
| 打开程序集 | `dnspy_open` | 加载目标与依赖 |
| 反编译类型/方法 | `dnspy_decompile` | 拿 C# 文本给模型读 |
| 看 IL | `dnspy_inspect_il` | 关键判断的机器级真值 |
| 列类型 | `dnspy_list_types` | 类型清单 + 命名空间 |
| 搜索 | `dnspy_search` | 按字符串/方法名/调用 |
| 读元数据 | `dnspy_metadata` | AssemblyRef / TypeRef |
| 设断点 | `dnspy_breakpoint` | 动态验证 |
| 修改 | `dnspy_patch_method` | 写 IL 并保存 |

**MCP 的边界**：MCP 只省"我去点 GUI"的时间，**不能替代 IL 复核**。
凡是要写进报告的结论（判断逻辑、密钥、C2），必须有 IL 或动态证据。

## 九、Sharp* 系列工具：识别与分析

红队生态里的 `Sharp*` 工具几乎都是**单个 C# 文件 + 反射加载**，这决定了它们的分析方式。

| 工具 | 用途 | 识别特征 |
| --- | --- | --- |
| SharpHound | AD 采集 | 类型 `SharpHound`、`Ldap` 查询串、JSON 输出 `BloodHound` 格式 |
| Rubeus | Kerberos 攻击 | `Rubeus.Program`、字符串 `asktgt`/`s4u`/`ptt`、`KERB_` 结构 |
| SharpChisel / SharpSocks | 隧道 | 内嵌 `chisel` 客户端逻辑、WebSocket 代码 |
| SharpUp | 提权枚举 | 大量 `SeImpersonate`/`AlwaysInstallElevated` 检查字符串 |
| Seatbelt | 主机侦察 | 一堆 `Checks` 子类，输出制表符分隔报告 |
| SharpGPOAbuse | GPO 滥用 | `IGPM`/`GPMGPO` COM 接口调用 |
| Certify / ForgeCert | ADCS | `ICertRequest`、`CertificateTemplate`、`msPKI-` 属性 |
| SharpHound 变体/混淆版 | 免杀 | 类型名随机、字符串加密、`Assembly.Load` 自解码 |

### 分析套路（不必逐行读）

```text
□ 1. ilspycmd -p 出 C# 工程，grep 出所有 ldstr 常量（字符串是最强指纹）
□ 2. 看 AssemblyRef：引用了 System.DirectoryServices / System.Management.Automation
      基本可以断定"域内操作"或"PowerShell 调用"
□ 3. 找入口 Program.Main 的参数解析（Sharp* 都用 CommandLineParser 或手写 args switch）
□ 4. 找"执行动作"的分支：LDAP 查询 / Win32 API P/Invoke / WMI 查询
□ 5. 判断是否"反射加载型"：有 byte[] → Assembly.Load 且无磁盘落地
□ 6. 输出格式决定了它把结果送到哪（JSON 文件 / stdout / HTTP POST）
```

```bash
# 从 IL 里抽全部字符串常量（比 C# 视图更全，含拼接前的片段）
monodis --userstrings target.exe | sed 's/^[0-9a-f]*: //' | sort -u | head -80

# 找 P/Invoke（DllImport）——判断是否调用 Win32
monodis --implmap target.exe
strings -a target.exe | grep -E "^(ntdll|kernel32|advapi32|amsi)\.dll$"

# 找反射加载（免杀/内存马常用）
strings -a target.exe | grep -E "Assembly\.Load|Invoke\(|GetType\(" 
```

**Sharp* 免杀版的三种常见改法**（判断你拿到的是原版还是改版）：

| 改法 | 表现 | 处理 |
| --- | --- | --- |
| 字符串加密 | `ldstr` 全是乱码，有解密方法 `string X(string, int)` | 找解密方法，动态断点取返回值 |
| 类型/成员随机化 | 类名 `a.b.c`、方法名 `\u0001` | 按**行为**而非名字分析 |
| 拆分 + 反射加载 | 主 exe 只是一个 loader，payload 在资源 | dump 资源 → 二次分析内层 assembly |
| 替换 API 调用 | 用 `DInvoke`/`SharpDInvoke` 手动映射 syscall | 看到 `NtCreateThreadEx` 手工解析即可判定 |

## 十、检测视角（防守方）

| 行为 | 信号 |
| --- | --- |
| dnSpy 调试目标程序 | 目标进程被 `DebugActiveProcess` 附加；`IsDebuggerPresent` 返回真 |
| 保存被修改的模块 | 文件写事件 + 签名/哈希变化 + 立即执行 |
| `sn -Vr` 关闭强名称验证 | 注册表 `HKLM\SOFTWARE\Microsoft\StrongName\Verification` 变化（4657，需开 SACL） |
| 内存 dump 程序集 | 大量 `ReadProcessMemory` / minidump 事件 |
| Sharp* 工具执行 | 进程名为随机串、父进程 `powershell`/`cmd`、命令行含 base64 |
| 反射加载 | `Assembly.Load(byte[])` 后出现 JIT 提交的可执行内存（无 backing file） |

## 十一、验伤信号

| 声称 | 证据 |
| --- | --- |
| "确认是托管" | CLR dir 非零 + `BSJB` 或 dnSpy 成功打开类型树 |
| "已脱混淆" | de4dot 输出该类名恢复正常（`A.B.C` 而非 `\u0001\u0002`），且**能编译通过** |
| "找到校验逻辑" | 给出类型全名 + 方法签名 + IL 中的判断指令（`bne.un` / `brfalse`） |
| "patch 生效" | 改后重跑，**运行行为改变**（不再弹校验失败 / 输出变正确），不是"文件能保存" |
| "拿到了明文配置" | 明文与**解密函数地址**同时给出 |

**反例（看起来成功其实是假）**：

- dnSpy 能打开但只有一个 `<Module>`——加壳样本的 stub，真实程序集在内存/资源里
- de4dot 输出 "Detected X" 但产物跑不起来——anti-tamper 未先去，脱壳破坏了校验
- 改了 IL 保存成功但程序行为没变——R2R 走了预编译 native，或 patch 的是未被调用的重载
- `ilspycmd` 输出几乎为空——单文件 bundle 的 host，内层 dll 还没抽
- 断点没命中就断定"方法没调用"——JIT 内联 / 强名称校验提前退出都会造成假阴性

## 十二、常见坑

1. **拿 native PE 当 .NET**——只看到 `PE32 executable` 就开始找 IL，浪费时间。
   先查 CLR directory，一条命令的事。
2. **没先跑 DIE 就 de4dot**——不知道壳类型，de4dot 自动识别失败后乱试 `--type`，
   越脱越坏。顺序永远是 DIE → 判断壳 → de4dot。
3. **忘了保留原始样本**——de4dot 产物可能已破坏 anti-tamper，出问题没法回退。
   `cp target.exe target.orig.exe` 是第一步。
4. **强名称验证误判成"样本坏了"**——patch 后无法加载，八成是签名失效，
   不是你的 patch 逻辑错。
5. **保存的模块覆盖了正在调试的进程**——先停止调试再 Save Module，否则文件被占用。
6. **忽略 x86/x64**——dnSpy 调试器位数必须与目标一致，AnyCPU 的 exe 在 64 位
   系统上跑 64 位，用 x86 调试会 attach 失败。