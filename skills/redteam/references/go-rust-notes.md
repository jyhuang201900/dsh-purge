# Go / Rust 二进制逆向：元数据恢复与语言特性

> 被 `go-rust-reverse` 引用。Go 和 Rust 的难点**不是反汇编**，而是**符号被剥后如何恢复语义**。
> 两者都保留了大量运行时元数据，恢复它比分柝机器码划算得多。

## 一、先认语言（30 秒判据）

| 判据 | Go | Rust |
| --- | --- | --- |
| `strings` 特征 | `Go build ID`、`go1.2x.x`、`runtime.gopanic`、`golang.org/` | `rustc`、`panicked at`、`src/`、`library/std/src/`、`core::` |
| 段名 | `.gopclntab`、`.go.buildinfo`、`.note.go.buildid` | `.rustc`（部分版本无）、`.eh_frame` 极大 |
| 构件文件 | `buildid` 段；`go:buildinfo` 起手魔数 `0xFF Go buildinf:` | `.comment` 有 `rustc version x.y.z` |
| 体积 | 极大（10MB+ 常见），含整个 runtime | 大但比 Go 小，泛型实例化后膨胀 |
| 依赖形态 | **静态链接**（默认 CGO_ENABLED=0 时纯静态） | 默认链 libc；`musl` target 静态 |
| 符号形态 | 未剥时 `main.main`、`pkg.Func`；剥了则全空 | 未剥时 mangled：`_ZN...E`（legacy）或 `_R...`（v0） |

```bash
file sample && rabin2 -I sample | head -20         # 架构 / 静态与否
strings -a sample | grep -m3 -E "go1\.[0-9]+"
strings -a sample | grep -m3 -E "rustc|panicked at"
readelf -S sample | grep -E "gopclntab|go.buildinfo|note.go"
go version -m sample                               # ★ 最直接：读 buildinfo，输出模块与依赖
```

`go version -m` 是 Go 样本给的**免费情报**：模块路径、依赖版本、VCS 修订、构建参数（含 `-ldflags` 是否 `-s -w`）全在里面。

```bash
$ go version -m suspicious.exe
suspicious.exe: go1.21.5
        path    github.com/evil/agent/cmd/agent
        mod     github.com/evil/agent    (devel)
        dep     github.com/gorilla/websocket      v1.5.0
        build   -trimpath
        build   CGO_ENABLED=0
```

## 二、Go：pclntab 是命门

### 2.1 pclntab 是什么

`.gopclntab`（PC line table）把 **PC 偏移 → 函数名/文件行号** 的映射保存成表。
Go **从不剥离它**（因为 panic 栈回溯需要它），所以即使 `-ldflags "-s -w"` 剥了 ELF 符号表，
函数名仍在 pclntab 里。这是 Go 逆向最大的红利。

pclntab 头部（Go 1.18+，`go12` 格式）：

| 偏移 | 字段 | 值 / 说明 |
| --- | --- | --- |
| 0x00 | magic (uint32) | `0xFFFFFFF1`（1.20+）/ `0xFFFFFFF0`（1.18–1.19）/ `0xFFFFFFFA`（1.16–1.17）/ `0xFFFFFFFB`（1.2–1.15） |
| 0x04 | pad | 0 |
| 0x06 | minLC | 指令最小长度（x86=1, arm64=4） |
| 0x07 | ptrSize | 4 或 8 |
| 0x08 | nfunc | 函数个数 |
| 0x10 | nfiles | 源文件数 |
| 0x18 | textStart | text 段起始虚拟地址 |
| 之后 | funcnametab / cutab / filetab / pctab / funcdata | 各子表偏移 |

**magic 决定后续解析布局**，所以工具第一步必须读偏移 0 的 `uint32`。头部在 1.16/1.18/1.20 各有小改（pad、minLC/ptrSize 位置），
导致老版本工具（如早期 `redress`、`GoReSym`）在 1.20+ 样本上失败——这是"工具说没有 pclntab"最常见的原因。

### 2.2 恢复函数名的三条路

```bash
# 路线 A：GoReSym（Mandiant）—— 最稳，支持 1.2 ~ 最新
GoReSym -t -d -p sample.exe > sample.gore.json
# -t 输出函数表；-d 输出 buildinfo/模块；-p 打印人类可读

# 路线 B：redress（goretk）—— 能重建可被 IDA 直接吃的符号文件
redress -symbols -save-json sample.exe
# 生成 IDA 脚本/符号，导入后 FUN_xxx 变 main.beaconLoop

# 路线 C：IDA 的 golang_loader_assist / Ghidra 的 GolangAnalyzer
# 直接把 pclntab 解析成函数名 + 类型，不用外部工具
```

| 工具 | 优点 | 缺点 |
| --- | --- | --- |
| GoReSym | 覆盖版本广、输出 JSON 便于脚本化 | 只抽元数据，不做反编译 |
| redress | 能生成 IDA 符号 + 类型信息，恢复 interface | 版本支持滞后于最新 Go |
| IDA 插件 | 一体化，能看到类型 | 插件更新慢，1.20+ 常需手改 magic 判断 |
| `go tool nm` | 有符号表时最快 | 剥过的样本完全无效 |

**验证恢复成功**：函数名应呈现 `main.` / `github.com/<vendor>/...` / `runtime.` 前缀；
若全是 `FUN_` 且 `TOTAL 0`，说明 magic 没对上版本。

### 2.3 Go 运行时结构（读伪代码必须知道的）

| 结构 | 用途 | 逆向价值 |
| --- | --- | --- |
| `g`（goroutine） | 每协程的寄存器现场、栈边界、`m` 指针 | 看到 `g+0x14` 类偏移说明在访问 TLS 当前协程（`FS/GS:[0x...]`） |
| `m`（machine） | OS 线程绑定 | 与 `g0` 切换是调度入口 |
| `p`（processor） | 逻辑处理器、本地 runq | 调度逻辑分析入口 |
| `itab` | interface 的 (类型, 方法表) 二元组 | 虚调用是 `itab->fun[0]`，**不是** `vtable` |
| `_type` | 类型元数据（size/kind/name） | 反序列化器、反射调用都靠它 |
| `hmap` / `bmap` | map 实现 | `map[string]string` 在内存里是 `hmap` + 桶数组 |
| `slicerun` | slice = `{ptr, len, cap}` 三元组 | 伪代码里 `*(a+8)` 是 len、`*(a+0x10)` 是 cap |
| `string` | `{ptr, len}` 二元组 | **不是 C 字符串**，没有 `\0`，长度在第二个字段 |

**调度特征**：`runtime.newproc` / `runtime.morestack` / `runtime.gopanic` 出现即确认 Go；
`CALL runtime.morestack_noctxt` 是每个函数前导，被识别成"函数没结尾"就是这个。
伪代码里大量 `if (*(long *)(foo + 0x10) == 0) ...` + `runtime.panic...` 是 **nil 检查 + 越界检查**，
不要当业务逻辑分析——Go 编译器为每次 slice 访问插边界检查（`runtime.panicIndex`）。

### 2.4 Go 字符串与结构体布局

```
string:  { char *str; int64 len; }         // 16 字节
slice:   { void *array; int64 len; int cap; } // 24 字节
iface:   { itab *tab; void *data; }        // 16 字节
eface:   { _type *_type; void *data; }     // 16 字节
```

- 字符串常量在 rodata，**成对出现** (ptr,len) 的 movabs/mov 常被误认成指针 + 立即数
- 结构体字段按对齐排布，Go 的 `struct{ A bool; B int64 }` 会 padding 到 offset 8
- `map` 遍历顺序随机是运行时行为，不是混淆

## 三、Rust：mangled 符号与 unwind

### 3.1 demangle

| 时代 | 前缀形式 | demangle 命令 |
| --- | --- | --- |
| legacy（≤1.58 默认，仍常见） | `_ZN4core3fmt...17h0123456789abcdefE` | `rustfilt` / `c++filt`（部分） |
| v0（1.59+ 可选，未来默认） | `_RNvNtCs...` | `rustfilt`（需支持 v0） |
| MSVC target | 无 `_ZN`，符号带 `?` | `undname` |

```bash
# 批量把 nm 输出还原
nm -D --defined-only sample | rustfilt > symbols.txt
# 或
objdump -t sample | rustfilt | grep -i "crypto\|http"

# 反向：确认是否 Rust mangled
strings -a sample | grep -cE "_ZN[0-9]+|_R[Nv]"
```

`rustfilt` 是 `rust-demangler` crate 提供的独立二进制，`cargo install rustfilt`。

**注意**：`_ZN...17h<hash>E` 尾部 hash 是**代码哈希**，改变编译参数就变，
所以不能靠 hash 跨样本匹配同一函数——要靠 demangle 后的 **crate::module::func** 部分匹配。

### 3.2 rustc 构建指纹

```bash
strings -a sample | grep -m5 "rustc version"         # .comment 段
readelf -p .comment sample                            # 精确读
strings -a sample | grep -m5 -E "library/(std|core|alloc)/src"
# panic 地点泄露源码路径：src/main.rs:42:9
```

`panicked at <file>:<line>` 是**免费源码路径**，直接告诉你 crate 名与模块划分。
把样本里所有 panic 字符串抽出来聚类，等于拿到一份"哪里做了 unwrap / expect / index"的清单——
这些点正是最容易触发崩溃的地方（fuzz 起点）。

### 3.3 panic 与 unwinding

| 机制 | 特征 | 逆向影响 |
| --- | --- | --- |
| `panic=unwind`（默认） | 依赖 `.eh_frame` / `_Unwind_RaiseException` | 函数末尾有 landing pad，伪代码出现大量异常边缘 |
| `panic=abort` | 无 landing pad，只调 `core::panicking::panic_fmt` 后 `abort` | 代码更干净，反编译质量更好 |
| `rust_begin_unwind` | panic 入口符号，未剥时可见 | 定位 panic 路径的锚点 |
| `core::result::unwrap_failed` | `unwrap()` 失败路径 | 字符串交叉引用能直接定位"解析失败"分支 |

`__rust_alloc` / `__rust_dealloc` / `__rust_realloc` 是 Rust 全局分配器 shim；
看到它们说明走标准分配路径，可据此定位堆操作（`Vec` 扩容 = realloc + memcpy）。

### 3.4 Rust 结构体与字符串

- `String` = `Vec<u8>` = `{ ptr, cap, len }`（**顺序是 ptr/cap/len**，和 Go slice 不同！）
- `&str` = `{ ptr, len }`，UTF-8，**长度为字节数**
- `Option<T>` 对 `u64` 会做 niche optimization；`Option<Box<T>>` 是单个指针（0 = None）
- `Result<T,E>` 布局 = tag + payload，tag 在外层
- 泛型单态化导致同一逻辑有 N 份实例（`Vec<u8>` / `Vec<String>` 各一份），
  **不要以为是重复实现**，是编译器展开；分析一份即可，其余按类型改名 `func_u8` / `func_str`

## 四、静态方法论（两种语言通用但不完全通用）

### Go

```text
□ 1. go version -m 拿模块/依赖/构建参数        → 已知 C2 框架直接查开源
□ 2. pclntab 恢复函数名（GoReSym/redress）      → FUN_ 全变实名
□ 3. 从 main.main 顺调用链                     → main.main 在符号恢复后一定可见
□ 4. 网络路径：net/http.(*Client).Do / net.Dial → 抓 C2 地址与请求构造
□ 5. 加密路径：crypto/aes.NewCipher / crypto/tls → 标准库位置固定，好定位
□ 6. 配置：main 里大量 string 常量 + json.Unmarshal → 配置结构体
```

**Go 特有的坑**：`net/http` 请求构造里 URL 常被拆成多段字符串拼接，
字符串常量表里搜完整域名搜不到，要搜 path 片段（`/api/v1/beacon`）。

### Rust

```text
□ 1. strings 找 rustc 版本 / panic 路径 / crate 名（离线 crate 会写 vendor/ 路径）
□ 2. nm + rustfilt 恢复符号（有符号表时）
□ 3. 无符号时：panic 字符串 xref → 定位解析函数 → 顺调用链
□ 4. 异步：tokio::runtime / futures 状态机（poll 函数巨大，用 xref 而非顺序读）
□ 5. 加密：ring / rustls / aes-gcm 常量表（S 盒、GHASH 表）签名匹配
□ 6. FFI：extern "C" 边界处符号名不被 mangle，是最干净的锚点
```

**Rust 特有的坑**：tokio 的 `async fn` 被编译成 `Future::poll` 状态机，
一个函数里塞了所有 await 点，伪代码是一个巨大 switch on discriminant。
正确做法是**找状态机表**（`match` 跳转表），逐个状态读，别线性读整个 poll。

## 五、动态辅助

```bash
# Go：Frida 挂 net/http 出口（-trimpath 后符号仍在 pclntab，可被 frida 解析）
frida -U -f com.app -l hook_go.js
```

```javascript
// Go 二进制（Linux/Windows 同理）：hook connect 拿 C2
Interceptor.attach(Module.getExportByName(null, "connect"), {
  onEnter(args) {
    const sa = args[1];
    const family = sa.readU16();
    if (family === 2) {  // AF_INET
      const port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
      const ip = [0,1,2,3].map(i => sa.add(4 + i).readU8()).join(".");
      console.log(`connect -> ${ip}:${port}`);
    }
  }
});
```

| 场景 | 手段 | 注意 |
| --- | --- | --- |
| Go 栈回溯异常 | Frida `Thread.backtrace` 对 Go 无效 | Go 用自己的栈，需 `runtime.Stack` 或 pclntab 解析 |
| Rust panic 定位 | 直接断 `rust_begin_unwind` | panic 消息在 `panic_fmt` 参数里 |
| 断点难打 | 用字符串地址下**内存断点** | Go 字符串无 `\0`，`r2` 的 `/` 搜索要按对 |

## 六、检测视角（防守方）

| 特征 | 防守方信号 | 说明 |
| --- | --- | --- |
| Go 静态二进制 | 体积 > 8MB、无 libc 依赖、`go1.x` 字符串 | 文件静态特征即可识别 |
| `-trimpath` 构建 | 无源码绝对路径，但模块路径仍在 buildinfo | `go version -m` 仍可读 |
| Rust 样本 | `.comment` 有 `rustc version`；`panicked at src/...` | 直接暴露 crate 结构 |
| Go C2 agent（Sliver/Mythic 等） | 已知模块路径 + 固定 JA3 | 结合网络侧指纹 |
| Rust 恶意样本 | 常静态链接、体积大、panic 字符串暴露模块名 | 可按字符串聚类归因 |

```bash
# 防守方一键判定（不用开 IDA）
go version -m suspect.exe 2>/dev/null || strings -a suspect.exe | grep -m1 "rustc version"
```

## 七、验伤信号

| 声称 | 证据 |
| --- | --- |
| "已恢复 Go 函数名" | 输出里有 `main.xxx` / `vendor/...` 前缀函数，且数量与 nfunc 接近 |
| "确认是 Rust 且版本 X" | `.comment` 段原文 `rustc version 1.x.y` 或 `go version -m` 输出 |
| "找到 C2 地址" | 地址与**使用它的函数地址**同时给出，且动态 connect 抓到同一 IP |
| "识别出加密算法" | 指出常量表地址 + 调用点，并说明 key/IV 来源 |

**反例（看起来成功其实是假）**：

- GoReSym 输出 `{"Functions":[]}`——magic 版本不匹配，不代表样本没有 pclntab
- `strings` 里看到 `https://...` 就报 C2——可能是依赖库的默认 endpoint 或文档 URL，
  必须证明它进入 `net/http` 请求构造
- `rustfilt` 输出一堆 `_ZN...`（没变）——符号是 v0 格式，`rustfilt` 版本太旧
- 反编译看到 `runtime.panicSliceB` 就报"存在越界漏洞"——那是编译器插入的检查，不是漏洞

## 八、常见坑

1. **`-ldflags "-s -w"` 以为剥干净了**——Go 的 pclntab 剥不掉，
   声称"无符号所以无法分析"是无效结论。先跑 GoReSym。
2. **Go 版本与工具不匹配**——1.20 改了 pclntab magic 字节数，
   老工具静默返回空。判断标准是看 magic 值，不是看工具报错。
3. **把 Go 的边界检查当业务分支**——`if (len <= idx) panicIndex` 是自动插入的，
   逆逻辑时整段跳过。
4. **Rust 泛型实例当重复代码**——同一逻辑出现 N 次属正常，
   在报告里写"代码大量重复疑似混淆"是错误结论。
5. **tokio 状态机线性阅读**——poll 函数必须按状态跳转表读，否则永远读不完。
6. **静态链接的 Go 样本在 IDA 里"函数太多"**——那是 runtime，不是恶意代码。
   先按 `main.` / `github.com/` 前缀过滤，别从 `runtime.mallocgc` 开始读。