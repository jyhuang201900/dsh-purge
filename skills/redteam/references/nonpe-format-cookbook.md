# 非 PE 格式菜谱：ELF / Mach-O / DEX / WASM / APK

> 被 `apk-reverse`、`js-reverse`、`malware-analysis` 引用。
> **每种格式先给"一条命令认出它"，再给"哪几个字段是命门"**。
> 不要一上来就丢 IDA——先确认容器，再决定拆哪一层。

## 〇、先判容器（30 秒）

```bash
file sample.bin
# 输出关键字 → 格式
#   ELF 64-bit LSB pie executable, x86-64        → ELF
#   Mach-O 64-bit arm64 executable               → Mach-O
#   Dalvik dex file version 035                 → DEX
#   WebAssembly (wasm) binary module version 1  → WASM
#   Zip archive data, at least v2.0             → APK/JAR/DOCX（看内部）
#   data                                        → 裸 bin / 固件 / 加密载荷

xxd -l 64 sample.bin          # 魔数最可靠
binwalk sample.bin            # 嵌套/附加数据（stego、固件、打包器）
```

| 魔数（hex） | 格式 | 备注 |
| --- | --- | --- |
| `7f 45 4c 46` | ELF | `\x7fELF` |
| `fe ed fa ce` / `fe ed fa cf` / `ce fa ed fe` / `cf fa ed fe` | Mach-O | 32/64、大/小端；`ca fe ba be` 是 FAT 头 |
| `64 65 78 0a` | DEX | `dex\n` |
| `00 61 73 6d` | WASM | `\0asm` |
| `50 4b 03 04` | ZIP | APK/JAR/XAPK/AAB 外皮 |
| `1f 8b` | gzip | 常见于附加数据 |

## 一、ELF：节表、PLT/GOT、init_array

### 1.1 结构与最小命令集

```bash
readelf -h sample                 # ELF header：类型(PIE/EXEC)、机器、入口
readelf -l sample                 # program headers：LOAD 段、GNU_RELRO、GNU_STACK(NX)
readelf -S sample                 # section headers：.text/.plt/.got/.init_array/.fini_array
readelf -d sample                 # 动态段：NEEDED、RPATH、BIND_NOW、FLAGS
readelf -r sample                 # 重定位表（分析 GOT 何时被写）
readelf -sW sample | head -50     # 符号（-W 不截断名字）
readelf -n sample                 # note：build-id、ABI tag、GNU property
```

| 关键字段 | 位置 | 为什么重要 |
| --- | --- | --- |
| `e_type` | ELF header | `ET_DYN` + `INTERP` = PIE；`ET_EXEC` = 固定基址 |
| `e_entry` | header | 入口不是 `main`，是 `_start` |
| `PT_GNU_STACK` 的 `RWE` 位 | program header | 是否有 NX |
| `PT_GNU_RELRO` | program header | 部分 RELRO；有 `BIND_NOW`（`-z now`）才是 Full RELRO |
| `.init_array` / `.fini_array` | section | **构造函数**，恶意代码常藏这里（先于 main 执行） |
| `.plt` / `.plt.sec` | section | 外部调用跳板（CET 启用时有 `.plt.sec`） |
| `.got` / `.got.plt` | section | 解析后的函数地址，**GOT 劫持的目标** |
| `.dynamic` 中 `DT_RPATH` | dynamic | 劫持库搜索路径的老手法 |
| `.note.gnu.build-id` | note | 跨样本去重用 |

```bash
# 常见场景速查
# 1) 看构造函数（恶意 .init_array 注入）
readelf -x .init_array sample
objdump -d --section=.init_array sample
# 或用 r2：aaa; afl~entry0; iS~init

# 2) 看 PLT 表（哪些外部函数被调用）
objdump -d -j .plt sample | head -40
readelf -r sample | grep -i "JUMP_SLOT"        # GOT 里会被填的槽

# 3) 判断 PIE / NX / RELRO / Canary / FORTIFY —— 一条命令
checksec --file=sample          # pwntools 自带
# 或
readelf -h sample | grep Type
readelf -l sample | grep -A1 GNU_STACK
readelf -d sample | grep -E "BIND_NOW|FLAGS"
readelf -sW sample | grep -c "__stack_chk_fail"     # >0 有 canary
readelf -sW sample | grep -c "_chk"                 # >0 有 FORTIFY

# 4) 静态链接判断（静态链接的样本难靠 PLT 定位）
readelf -d sample | grep NEEDED        # 空 = 可能静态
file sample | grep "statically linked"
```

### 1.2 PLT/GOT 的读法

```text
调用外部函数的机器码形态（x86-64，懒绑定）：
  call 0x401030        ← 跳到 .plt 条目
  0x401030: jmp [rip+0x2f52]   ← 跳 GOT 槽
  0x401036: push 0x1           ← 未解析时：压重定位索引
  0x40103b: jmp 0x401020       ← 跳 PLT0（dl_runtime_resolve）

解析后 GOT 槽 = 真实 libc 地址，此时不能再改回 PLT（除非整段重写）
```

| 现象 | 结论 |
| --- | --- |
| `.plt` 里 goto 到 `dl_runtime_resolve` | 懒绑定（未 `-z now`）→ 可 GOT 劫持 |
| `.got.plt` 在 `PT_GNU_RELRO` 范围内且 `BIND_NOW` | Full RELRO → GOT 只读 |
| `call [rip+...]` 直接跳 GOT（无 PLT） | 用了 `-fno-plt`，静态更容易看清导入函数 |

### 1.3 `.init_array` 与恶意持久化

```bash
# 恶意样本常在 .init_array 里塞一个"main 前执行"的函数（反调试、解密）
readelf -x .init_array sample
# 输出是地址数组（小端 8 字节一组）
# 每个地址 → 反汇编看它干了什么
objdump -d --start-address=0x4011a0 --stop-address=0x401260 sample
```

## 二、Mach-O：LC_ 命令、加密信息、arm64e

### 2.1 结构与命令

```bash
file sample
# Mach-O 64-bit arm64 executable
otool -hV sample             # header：magic/cputype/filetype/flags（V=详细）
otool -l sample              # 全部 load commands（最重要）
otool -L sample              # 链接的 dylib（LC_LOAD_DYLIB）
otool -tV sample             # 反汇编 .text（-V 带符号）
otool -ov sample             # ObjC 段（类/方法/属性列表）★
otool -Iv sample             # 间接符号表
nm -m sample                 # 符号 + 归属（是否 undefined/external）
codesign -d --entitlements :- sample    # entitlements（★ 权限声明）
codesign -dv --verbose=4 sample         # 签名信息（TeamID、identifier、是否 ad-hoc）
```

| LC 命令 | 含义 | 逆向价值 |
| --- | --- | --- |
| `LC_SEGMENT_64 __TEXT` | 代码段 | 基址（通常 0x100000000） |
| `LC_SEGMENT_64 __DATA` / `__DATA_CONST` | 数据段 | 字符串、ObjC 元数据 |
| `LC_ENCRYPTION_INFO(_64)` | **加密信息** | `cryptid=1` 表示砸壳前不可静态分析 |
| `LC_LOAD_DYLIB` | 依赖库 | 判断是否用了 CommonCrypto/Network.framework |
| `LC_CODE_SIGNATURE` | 代码签名 | 存在即必须重签才能改 |
| `LC_RPATH` | 运行时库搜索路径 | 劫持入口（`@executable_path`） |
| `LC_MAIN` | 入口（现代） | 取代 `LC_UNIXTHREAD` |
| `LC_DYLD_INFO(_ONLY)` | 绑定信息 | 谁绑定了哪个符号 |
| `LC_BUILD_VERSION` | 构建 SDK | 判断 iOS 版本要求 |

### 2.2 加密判断（砸壳的第一步）

```bash
otool -l sample | grep -A4 LC_ENCRYPTION_INFO
# cryptoff / cryptsize / cryptid
# cryptid 0 = 未加密（已砸壳）；1 = 加密（App Store 分发形态）
```

| cryptid | 含义 | 行动 |
| --- | --- | --- |
| 0 | 明文 | 直接静态分析 |
| 1 | 加密（`__TEXT` 的 cryptoff 起 cryptsize 字节） | 必须动态砸壳（`frida-ios-dump`） |

### 2.3 arm64e 与指针认证

```bash
otool -hV sample | grep -i "arm64e\|cpusubtype"
# cpusubtype 2 = arm64e（带 PAC）
```

- arm64e 的指针带 PAC（Pointer Authentication Code），`blraa`/`braa` 等指令做签名/校验
- 反编译时 Ghidra/IDA 需要识别 PAC 指令，否则控制流图断裂
- 越狱设备上 `arm64e` 二进制可能因 PAC 不匹配直接崩溃（重签时要去掉 arm64e 或转 arm64）

### 2.4 FAT / Universal 二进制

```bash
lipo -info sample             # 列出架构
lipo -thin arm64 sample -output sample_arm64    # 抽单架构
lipo -create a b -output fat                    # 合并
```

## 三、DEX：header、方法索引、反编译

### 3.1 header 字段表

```bash
xxd -l 112 classes.dex
# 或
dexdump -f classes.dex | head -40      # 需 Android SDK build-tools
# 或
jadx --version && jadx -d out classes.dex
```

| 偏移 | 字段 | 含义 |
| --- | --- | --- |
| 0x00 | magic | `dex\n035\0`（Android 5–6）/ `037`（7+）/ `038`（8+）/ `039`（9+） |
| 0x08 | checksum | adler32（**校验，改文件必须重算**） |
| 0x0C | signature | SHA-1（20 字节，同样要重算） |
| 0x20 | file_size | 文件总长 |
| 0x24 | header_size | 固定 0x70 |
| 0x28 | endian_tag | `0x12345678` = 小端 |
| 0x2C | link_size/off | 动态链接（一般 0） |
| 0x34 | map_off | map 列表（每种结构的偏移） |
| 0x38 | string_ids_size/off | 字符串表 |
| 0x40 | type_ids_size/off | 类型表 |
| 0x48 | proto_ids / field_ids / method_ids | 原型/字段/方法索引 |
| 0x60 | class_defs_size/off | 类定义（**反编译入口**） |
| 0x68 | data_size/off | 数据区（含 code_item） |

**三个索引的意义**（理解 DEX 才能读 smali）：

```text
method_idx (4 字节) → method_ids[] → { class_idx(u16), proto_idx(u16), name_idx(u32) }
                                    ↓                    ↓            ↓
                                 type_ids[]          proto_ids[]   string_ids[]
                                    ↓
                              string_data_item（MUTF-8，可变长）
```

### 3.2 反编译与 smali

```bash
# 反编译成 Java（jadx 最稳）
jadx -d out --show-bad-code classes.dex
jadx-gui classes.dex

# 反编译成 smali（apktool，适合 patch）
apktool d app.apk -o app_decoded -f

# 直接 dump（无 apktool）
baksmali d classes.dex -o smali_out

# 重新打包（patch 后）
apktool b app_decoded -o app-patched.apk
# 必须重签
apksigner sign --ks my.keystore --ks-pass pass:test app-patched.apk
```

| 修改 DEX 后的必做两件事 | 命令 |
| --- | --- |
| 重算 checksum + signature | `apktool b` 自动做；手工改要 `dexfixer` / 自己算 adler32+SHA1 |
| 重签 APK | `apksigner sign`（v2/v3 都要）；`jarsigner` 只做 v1 |

### 3.3 多 DEX 与 65536 限制

```bash
unzip -l app.apk | grep "classes.*dex"
# classes.dex / classes2.dex / classes3.dex ...
# 每个 dex 独立反编译，但类引用跨 dex 存在
jadx -d out app.apk        # jadx 自动处理多 dex
```

## 四、WASM：段落、导入导出

### 4.1 段落结构

```bash
wasm-objdump -h module.wasm         # 段落列表（-h = headers）
wasm-objdump -x module.wasm         # 详细：类型/导入/导出/函数/内存/全局
wasm2wat module.wasm -o module.wat  # 转可读文本
wasm-decompile module.wasm -o module.dcmp   # 伪 C 反编译（wabt 自带）
```

| 段 id | 名称 | 内容 |
| --- | --- | --- |
| 0 | custom | 自定义（`name` 段常有函数名，`producers` 有工具链） |
| 1 | type | 函数签名（参数/返回类型） |
| 2 | import | 导入（JS 侧提供的函数） |
| 3 | function | 函数类型索引 |
| 4 | table | 函数表（间接调用，`call_indirect`） |
| 5 | memory | 线性内存（`(memory 256 256)`） |
| 6 | global | 全局变量（栈指针常在 0 号） |
| 7 | export | 导出（入口 `_start`/`main`/`memory`） |
| 8 | start | 启动函数 |
| 9 | element | 表初始化（间接调用目标） |
| 10 | code | 函数体（**真正逻辑**） |
| 11 | data | 数据段（字符串、常量表） |

```bash
# 快速拿字符串（wasm 里字符串在 data 段，无 \0 结尾，需按引用推断）
strings -a module.wasm | head -40
wasm-objdump -x module.wasm | grep -A20 "Data\["

# 拿导入函数（判断它依赖什么 JS API —— 加密/网络/文件）
wasm-objdump -x module.wasm | sed -n '/Import\[/,/Function\[/p'
```

### 4.2 逆向要点

| 现象 | 含义 |
| --- | --- |
| 无 `name` 段 | 被 strip，函数名全丢，靠 **导出名 + 调用图** 恢复 |
| `call_indirect` 密集 | 有虚表/函数指针，等价于 C++ vtable，按 `element` 段还原 |
| `memory.grow` 频繁 | 有堆分配器（emscripten 的 `malloc`），可按 dlmalloc 布局分析 |
| 存在 `__wasm_call_ctors` | emscripten 产物，构造函数在这里 |
| 大量 `f64` 运算 + 无外部调用 | 可能是加密/算法密集（如 wasm 实现的签名） |

```bash
# emscripten 产物识别（有内存初始化 + ctors）
wasm-objdump -x module.wasm | grep -E "__wasm_call_ctors|emscripten|stackSave"
# 找到 malloc/free 可定位堆操作
wasm-objdump -x module.wasm | grep -iE "malloc|free|memcpy"
```

## 五、APK：zip 结构、dex 分布、manifest

### 5.1 zip 结构与关键条目

```bash
unzip -l app.apk | head -30
# 关键条目：
#   AndroidManifest.xml      （二进制 AXML，需 aapt2/apkanalyzer 解）
#   classes*.dex             （代码）
#   res/                     （资源，含混淆的字符串）
#   lib/<abi>/lib*.so        （native 库）
#   assets/                  （任意载荷：配置、dex、so、加密 blob）
#   META-INF/                （v1 签名 + 证书）
#   resources.arsc           （资源索引，二进制）
```

```bash
# 解 manifest（二进制 → 文本）
aapt2 dump xmltree app.apk --file AndroidManifest.xml | head -60
# 或
apkanalyzer manifest print app.apk
# 或（最全）
apktool d app.apk -o dec && cat dec/AndroidManifest.xml
```

| manifest 关键属性 | 为什么看 |
| --- | --- |
| `package` | 包名（hook 时的进程名） |
| `android:debuggable="true"` | 可直接 `run-as` / 附加调试 |
| `android:extractNativeLibs` | false 时 so 直接从 apk 映射（`/data/app/.../lib/`） |
| `android:usesCleartextTraffic` | 明文流量 |
| `<activity android:exported="true">` + intent-filter | 外部可达入口（deeplink 攻击面） |
| `<provider android:exported>` + `grantUriPermissions` | 文件泄露面 |
| `<meta-data>` | SDK key、配置开关 |
| `targetSdkVersion` / `minSdkVersion` | 决定哪些绕过手段可用 |

### 5.2 so 与 ABI 分布

```bash
unzip -l app.apk | grep "lib/"
# lib/arm64-v8a/libnative.so   ← 现代设备主用
# lib/armeabi-v7a/libnative.so
# lib/x86_64/libnative.so      ← 模拟器
# 若只有某 ABI 有 so → 该 ABI 才是关键路径
```

```bash
# so 里找 JNI 注册
strings -a libnative.so | grep -E "Java_|JNI_OnLoad"
# 动态注册（RegisterNatives）→ 静态看不到 Java_ 前缀，要靠 IDA 找 JNI_OnLoad
```

### 5.3 完整性：APK 签名方案 v1/v2/v3/v4

| 方案 | 存放 | 覆盖范围 | 影响 |
| --- | --- | --- | --- |
| v1 (JAR) | `META-INF/*.SF/*.RSA` | 逐文件 | 可只改部分文件（"Janus"类问题） |
| v2 | APK Signing Block（zip 中央目录前） | 整个 zip | 改任何字节都会失效 |
| v3 | 同 v2 块，带密钥轮换 | 整个 zip | 同上 |
| v4 | 独立 `.idsig` 文件 | 增量安装 | 一般不影响静态改包 |

```bash
apksigner verify -v --print-certs app.apk
# 输出 Verified using v1/v2/v3 scheme: true/false
# 只要 v2+ 存在，apktool b 后必须 apksigner 重签（jarsigner 不够）
```

## 六、威胁形态速查：Android 侧（APK / DEX / so）

| 形态 | 识别 | 关键命令 | 处置 |
| --- | --- | --- | --- |
| 加固（360/梆梆/腾讯乐固/爱加密） | dex 里类极少、`libjiagu.so`/`libshella*.so`、`StubApp` | `unzip -l app.apk \| grep "\.so$"`；`jadx` 输出大量 `Failed to decompile` | 脱壳机（FART/Youpk/frida-dexdump），dump 运行时 dex |
| 动态加载 dex | `DexClassLoader` + 从 assets 解密 | `grep -rn "DexClassLoader\|InMemoryDexClassLoader"` | hook `DexClassLoader` 拿 dex 字节 |
| 多 dex 拆分 | `classes2.dex`+ | `unzip -l \| grep dex` | jadx/apktool 自动合并引用 |
| 原生校验签名 | `getPackageInfo(...GET_SIGNATURES)` + so 里比对 | `strings lib*.so \| grep -i sign` | hook `PackageManager.getPackageInfo` 返回原签名 |
| 反调试 | `ptrace(PTRACE_TRACEME)`、`/proc/self/status` 的 `TracerPid` | `grep -rn "TracerPid\|ptrace"` | hook `fopen`/`openat` 伪造，或 hook `ptrace` 返回 0 |
| 模拟器检测 | `ro.kernel.qemu`、`Build.FINGERPRINT`、传感器数量 | 见 `anti-detection-bypass.md` | 真机或改 props |
| 载荷藏在 assets | assets 里有 `.dex`/`.so`/加密 blob | `unzip -l \| grep assets`；`binwalk assets/*` | 按魔数判断真实类型，解密后再分析 |
| 恶意 so 直接加载 | `System.loadLibrary` 且 so 未走 JNI 标准命名 | `strings lib*.so \| grep -c "Java_"` = 0 | IDA 找 `JNI_OnLoad` 里的 `RegisterNatives` |

```bash
# 一屏看完 APK 的威胁面
unzip -l app.apk | grep -E "\.so$|\.dex$|assets/|lib/"
aapt2 dump badging app.apk | head -20                  # 权限与 SDK 版本
apkanalyzer manifest permissions app.apk
apkanalyzer dex packages app.apk | head -40            # 类分布（异常集中=加固）
```

## 七、威胁形态速查：脚本与脚本宿主（U–AV 索引）

> 这张表是 `malware-analysis` / `js-reverse` 里 "U–AV" 案例编号的对照索引，
> 只给**判别特征 + 验证命令**，不复述长文。

| 编号 | 形态 | 判别特征 | 验证命令 |
| --- | --- | --- | --- |
| U | bat/cmd 拼接 | 大量 `SET x=...` 后 `%x%%y%` 拼命令 | `grep -iE "^set |%[a-z]+%"` |
| V | UTF-16/BOM 脚本 | `xxd -l 4` 见 `ff fe`；`file` 报 "Unicode text" | `iconv -f UTF-16LE -t UTF-8 f.bat` |
| W | REM/GOTO 淹没 | 大量注释行与跳转，真实行在末尾 | 去掉 `^rem` 行后再读 |
| X | PowerShell 多层编码 | `-enc <base64>`、`FromBase64String`、`Gzip` | 逐层解，每层存 hash |
| Z | IEX 拼接/反转 | `IEX(...)`、`-join`、`[array]::Reverse` | 替换 `IEX` 为 `Write-Output` 打印 |
| AA | VBA Stomping | 源码与 P-Code 不一致（`olevba` 显源码干净但运行时跑恶意） | `olevba -a`；比对 `VBA/dir` 的 P-Code |
| AB | VBA Chr/Base64 | `Chr(65)` 串、`Base64` 解码后 `Shell` | 提取常量 → 本地解 |
| AC | 自修改宏 | 宏里改 `VBProject`/写模块再运行 | `olevba --decode`；禁用宏后静态读 |
| AD | JSVMP | 超大数组 + 解释器 switch，无正常 AST | 找 VM dispatch 循环；见 `ast-deobfuscation.md` |
| AE | CFF + 字符串数组 | 字符串全在数组，用索引取；控制流平坦化 | `deobfuscate.io` / Babel 插件解数组 |
| AF | DevTools/debugger 反调试 | `debugger;` 循环、`console` 检测、`Function.toString` 自检 | 覆盖 `Function.prototype.toString`；关 DevTools 检测 |
| AJ | DLL TLS + DllMain | TLS 回调先于 DllMain，恶意逻辑在 TLS | `objdump -p x.dll \| grep TLS`；PE-bear 看 TLS 目录 |
| AK | 导出异常 | 导出表为空或只有 `DllRegisterServer` 等假导出 | `dumpbin /exports x.dll` |
| AL | 无导出（反射加载） | 无导出表，但被 `LoadLibrary` 之外的反射加载器使用 | 找 `ReflectiveLoader` 特征 |
| AM | Delay-Load | 导入表里有 Delay Import Descriptor | `dumpbin /dependents`；PE-bear Delay 目录 |
| AO | DLL 侧加载 | 目标 exe 从自身目录加载同名 dll | 同名 dll 与合法程序同目录；`Process Monitor` 看 `NAME NOT FOUND` |
| AP | 反射式加载 | 内存中 PE 无文件落地 | `VirtualAlloc` + `NtCreateThreadEx`；扫描内存段 |

```bash
# 脚本分诊四连（先跑完再决定深挖方向）
file sample.*                 # 真实编码/类型（不信扩展名）
xxd -l 64 sample.*            # 魔数
strings -a -e l sample.*      # UTF-16LE 字符串（PowerShell 常用）
binwalk sample.*              # 附加/嵌套（base64 > gzip 很常见）
```

## 八、检测视角（防守方：怎么认出"这层被利用过"）

| 层 | 检测点 | 信号 |
| --- | --- | --- |
| ELF | `.init_array` 非常规 | 构造函数里有 `mprotect`/解密/反调试 |
| ELF | 节名与实际内容不符 | `.text` 段熵 > 7（自解密代码） |
| Mach-O | `cryptid` 从 1 变 0 | 砸壳后重签（签名失效 + 设备越狱） |
| DEX | checksum/signature 与内容不符 | 被手工 patch 过（Android 拒装/运行异常） |
| DEX | 类极度集中（大量在少数类） | 加固（运行时才解密真实 dex） |
| WASM | `call_indirect` 指向非常规 table | 混淆的虚调用（可能是 loader） |
| APK | v1 签名通过但 v2 缺失 | Janus 类漏洞前提 |
| APK | `assets/` 里有 dex/so 且加密 | 二次加载（动态释放） |
| APK | 导出组件 + deeplink 无校验 | 外部可达的越权入口 |

```bash
# 快速体检（防守方视角）
apkanalyzer manifest print app.apk | grep -E "exported|permission"
unzip -l app.apk | grep -E "assets/.*\.(dex|so|bin)"
readelf -S ./sample | grep -E "\.init_array|\.fini_array"
exiftool -Software -Comment suspect.jpg
```

## 九、验伤信号（怎么证明"拆对了层"）

| 声称 | 证据 |
| --- | --- |
| "是 ELF，动态链接" | `readelf -h` 的 `Type: DYN` + `readelf -d` 有 `NEEDED` |
| "有 canary / NX / PIE" | 具体命令输出行（不是习惯性勾选） |
| "已经砸壳" | `otool -l` 的 `cryptid 0` + 能看见真实方法实现（非 `sub_xxx` 桩） |
| "dex 反编译成功" | `out/` 下有 .java 文件，且**至少一个类的方法体非空** |
| "APK 是 v2 签名" | `apksigner verify -v` 明确列出 `Verified using v2 scheme: true` |
| "wasm 有加密逻辑" | 指出导出函数名 + 对应 code 段偏移 + 常量表引用 |

**反例（看起来成功其实是假）**：

- `file` 说 "Mach-O" 但 `otool -l` 里 `cryptid 1` → **静态分析不了**，必须先砸壳
- `jadx` 跑完但 `out/` 里全是 `// Failed to decompile` → dex 被加固（如 360 加固），
  真实代码在运行时才解密
- `apktool d` 成功但 manifest 里没有权限 → 有 **split APK**，权限在 base.apk 之外
- `strings` 拿到 URL 就报 C2 → 可能是 SDK 的统计域名，要看**谁引用它**
- `wasm-objdump -x` 有 name 段就以为函数名可信 → `wasm-opt --strip` 之后 name 段可能是伪造的

## 十、常见坑

1. **ELF 的"入口"不是 main**——`e_entry` 指向 `_start`，它调 `__libc_start_main`
   才进 main。从 `_start` 开始读会绕一大圈。
2. **静态链接样本没有 PLT**——`readelf -d` 空的话，别指望用导入函数定位，
   要靠字符串 + 系统调用（`syscall` 指令 / `int 0x80`）。
3. **Mach-O 忘了看 cryptid**——App Store 下载的 IPA 一定加密，
   不砸壳的"静态分析结论"没有任何价值。
4. **DEX 改了没重算校验**——`checksum`/`signature` 不对，Android 直接拒装
   （`INSTALL_FAILED_INVALID_APK`）。用 apktool 打包最省事。
5. **APK 只签 v1**——Android 7+ 在 `targetSdk>=30` 时拒绝 v1-only，
   必须 `apksigner` 出 v2+。
6. **WASM 把 `data` 段的字符串当连续 C 字符串**——它们没有终止符，
   长度由引用处的 `i32.const` 给出。
7. **把 AAB 当 APK 拆**——`.aab` 是 App Bundle（protobuf 格式），
   要 `bundletool build-apks` 转成 APK 集合后才有 dex/so。