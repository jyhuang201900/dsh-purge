# iOS 逆向：砸壳、Mach-O、ObjC runtime、Swift、Keychain

> 被 `mobile-reverse` 引用。iOS 的前置门槛比 Android 高：
> **没有越狱设备，动态分析基本不动**。所以第一步永远是判断设备与包的状态。

## 一、环境与前期判定

| 项 | 检查命令 | 结论 |
| --- | --- | --- |
| 设备越狱 | `ls /Applications/Cydia.app` / `which ssh` | 无越狱 → 只能静态 |
| SSH 可用 | `ssh root@<ip> -p 22`（默认密码 `alpine`） | 用于推 frida/dump |
| IPA 来源 | App Store 下载的**一定加密** | 必须砸壳 |
| 包是 IPA 还是 .app | `unzip -l app.ipa` 看 `Payload/` | 开发版 .app 可能未加密 |

```bash
# 1) 解 IPA
unzip -o app.ipa -d app_unpacked
ls app_unpacked/Payload/
APP=app_unpacked/Payload/Target.app

# 2) 看架构与加密
lipo -info "$APP/Target"
otool -l "$APP/Target" | grep -A4 LC_ENCRYPTION_INFO
# cryptid 1 = 加密（App Store 常态）；0 = 已明文
```

## 二、砸壳（decrypt）

### 2.1 方法对比

| 工具 | 前提 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **frida-ios-dump** | 越狱 + frida | 自动、支持多架构、输出 IPA | 需要 frida 版本匹配 |
| **Clutch** | 越狱 | 纯 CLI、快 | 老工具，对新 iOS 支持差 |
| **dumpdecrypted** | 越狱 | 经典、稳 | 需手工放 dylib，新版 iOS 常失败 |
| **bagbak** | 越狱 + node | 现代替代，支持 arm64e | 依赖 node |
| **objection ios dump** | 越狱 + frida | 一条命令 | 同上 |

### 2.2 frida-ios-dump 完整流程

```bash
# 1) 设备侧：装 frida（Cydia/Sileo 源或 deb）
#    ssh 进设备确认
ssh root@192.168.1.50 "frida-ps -U | head"

# 2) 本地：装 frida-ios-dump
git clone https://github.com/AloneMonkey/frida-ios-dump
cd frida-ios-dump && pip3 install -r requirements.txt

# 3) 端口转发（USB 或 wifi）
iproxy 2222 22          # USB 转发（libimobiledevice）
# 或用设备 IP 直连

# 4) dump（-H 指定设备，-p 端口，-o 输出目录）
python3 dump.py -H 127.0.0.1 -p 2222 -u root -P alpine com.target.app -o ./dump
# 产物：./dump/Payload/Target.app（已解密）

# 5) 验证砸壳成功
otool -l ./dump/Payload/Target.app/Target | grep -A4 LC_ENCRYPTION_INFO   # cryptid 0
```

```bash
# bagbak（arm64e 设备更稳）
npm install -g bagbak
bagbak com.target.app -o ./dump
```

### 2.3 砸壳失败的判断

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `cryptid` 仍是 1 | dump 的是磁盘文件，不是内存镜像 | 工具要从内存 dump；换工具 |
| dump 后启动崩溃 | 代码签名破坏 | `codesign -f -s -` 重签，或 `ldid -S` |
| 只 dump 出部分 | 多架构未全处理 | 用 `--all`/逐架构 |
| 应用有反 dump | 检测 frida | 换非 frida 工具（Clutch） |

```bash
# 重签（越狱机上可 ad-hoc 签名）
codesign -f -s - ./dump/Payload/Target.app
# 或
ldid -S ./dump/Payload/Target.app/Target
```

## 三、Mach-O 分析

```bash
APP=./dump/Payload/Target.app
BIN="$APP/Target"

otool -hV "$BIN"                 # header + flags（PIE / DYLDLINK 等）
otool -l "$BIN" | grep -E "LC_|segname" | head -60
otool -L "$BIN"                  # 依赖 dylib
otool -ov "$BIN" | head -80      # ObjC 类/方法/属性（★ 最重要）
nm -m "$BIN" | head -40          # 符号与归属
strings -a "$BIN" | grep -iE "http|token|key|secret" | head -30
```

| LC 命令 | 分析价值 |
| --- | --- |
| `LC_SEGMENT_64 __TEXT` | 基址（通常 `0x100000000`），所有地址换算基准 |
| `LC_SEGMENT_64 __DATA_CONST` | ObjC 元数据（类/方法列表） |
| `LC_ENCRYPTION_INFO_64` | 加密标志 |
| `LC_LOAD_DYLIB` | 用了什么框架（`Security.framework` → Keychain） |
| `LC_CODE_SIGNATURE` | 改过必须重签 |
| `LC_RPATH` | 库搜索路径（劫持面） |
| `LC_MAIN` | 入口 |

```bash
# 找关键字符串与它的引用（定位方法）
strings -a -t x "$BIN" | grep -i "pin\|certificate\|jailbreak"
# 拿到偏移 → 转成虚拟地址 → 在 IDA/Hopper 里看 xref
# 换算：vaddr = file_off - __TEXT.fileoff + __TEXT.vmaddr
otool -l "$BIN" | grep -A4 "segname __TEXT" | grep -E "vmaddr|fileoff"
```

### 3.1 嵌入式框架

```bash
ls "$APP/Frameworks/"
# 每个 .framework 里有独立二进制，需单独分析
# Swift 运行时库可能被嵌入（Frameworks/libswiftCore.dylib）
```

## 四、Objective-C runtime

### 4.1 静态：class-dump / otool

```bash
# class-dump（老工具，对新格式可能失败）
class-dump -H "$BIN" -o ./headers
# 产物：每个类一个 .h（方法签名齐全）

# 现代替代：otool -ov（直接输出 ObjC 段）
otool -ov "$BIN" | sed -n '/name.*TargetCrypto/,/^$/p'

# 或用 Hopper / IDA 的 ObjC 分析
```

```bash
# 找方法实现（selector → IMP 地址）
# otool -oV 输出 method_list，含 name 与 address
otool -oV "$BIN" | grep -A3 "name.*verifyLicense"
```

### 4.2 ObjC 结构速查

```
class_t:
  +0x00 isa
  +0x08 superclass
  +0x10 cache
  +0x18 vtable
  +0x20 data (class_ro_t*)

class_ro_t:
  +0x00 flags
  +0x08 instanceStart
  +0x10 instanceSize
  +0x18 ivarLayout
  +0x20 name            ← 类名
  +0x28 baseMethods     ← method_list_t*
  +0x30 baseProtocols
  +0x38 ivars
  +0x40 weakIvarLayout
  +0x48 baseProperties

method_t (相对偏移或绝对指针，取决于版本):
  +0x00 name (sel)
  +0x08 types
  +0x10 imp
```

```bash
# 用 jtool2 更结构化
jtool2 --objc "$BIN" | head -60
jtool2 -d __DATA.__objc_classlist "$BIN" | head
```

## 五、Swift 符号

```bash
# Swift mangled 符号（以 $s / _$s 开头）
nm "$BIN" | grep -c '\$s'
nm "$BIN" | grep '\$s' | head -20

# demangle
nm "$BIN" | swift-demangle | grep -i "crypto\|auth"
swift demangle --compact < syms.txt
```

```
Swift mangling 形态：
  $s10MyAppName9CryptoMgrC7encrypt... 
   ^^  ^^^^^^^^^  ^^^^^^^^^
   |   模块名      类型名

还原技巧：
  □ 模块名 = 产品名（或 framework 名）
  □ 类型段以 C(Class)/V(Struct)/O(Enum)/P(Protocol) 结尾
  □ 方法名后跟 F(函数)/f(方法) 与参数类型标记
```

| 项 | Swift 特征 | 逆向影响 |
| --- | --- | --- |
| 字符串 | 无 `\0` 结尾，是 `{ptr, len}` 对 | `strings` 仍能看到内容（连续字节），但长度在元数据 |
| `String` 存储 | 小字符串内联（≤15 字节），大字符串堆上 | 短密钥可能内联在寄存器里，静态搜不到 |
| 协议/泛型 | witness table 间接调用 | 控制流图有大量 `witness` 调用 |
| `@objc` | 保留 ObjC 名字 | 可用 ObjC 方式 hook |
| 纯 Swift 类 | 无 ObjC 元数据 | `class-dump` 看不到，需靠符号/反编译 |

## 六、Keychain 与 entitlements

### 6.1 entitlements

```bash
codesign -d --entitlements :- "$APP" 2>/dev/null | plutil -convert xml1 -o - -
# 关键项：
#   keychain-access-groups    ← Keychain 共享组
#   application-identifier    ← TeamID.BundleID
#   com.apple.security.app-sandbox
#   get-task-allow            ← 是否允许调试（开发版 true）
#   com.apple.developer.associated-domains  ← Universal Links
```

| entitlement | 影响 |
| --- | --- |
| `keychain-access-groups` | 决定 Keychain 条目的访问控制（跨 app 共享） |
| `application-identifier` | Keychain 条目的 `kSecAttrAccessGroup` |
| `get-task-allow = true` | 可直接 attach 调试（开发版） |
| `associated-domains` | Universal Link 劫持面 |
| `com.apple.private.*` | 私有 API 权限（越权点） |

### 6.2 运行时读 Keychain

```javascript
// frida：枚举指定 access group 的 Keychain 条目
if (ObjC.available) {
  var SecItemCopyMatching = Module.findExportByName("Security", "SecItemCopyMatching");
  // 更简单：直接构造 query 并调 ObjC 的 SecItemCopyMatching
  var query = ObjC.classes.NSMutableDictionary.alloc().init();
  query.setObject_forKey_("class", "kSecClass");        // 简化写法
  // 实际工程通常用一段 ObjC 桥接：
}
```

```javascript
// 更实用：直接调用 Security framework（用 ObjC bridge）
var Security = Module.load("/System/Library/Frameworks/Security.framework/Security");
var SecItemCopyMatching = new NativeFunction(
  Security.findExportByName("SecItemCopyMatching"),
  'int', ['pointer', 'pointer']
);
// 构造 CFDictionary 比较复杂 → 常用现成脚本
```

```bash
# 设备上直接看 Keychain（越狱）
ssh root@device
# keychain_dumper（需 entitlements）或
sqlite3 /var/mobile/Library/Keychains/keychain-2.db
# 表 genp（通用密码）/ inet（网络密码）/ cert（证书）
sqlite3 /var/mobile/Library/Keychains/keychain-2.db \
  "select svce, acct from genp;" 2>/dev/null | head
```

> **重要**：Keychain 条目受 access group 限制，直接 sqlite 读往往拿不到 `data` 字段
> （加密），需要 `keychain_dumper` 配合正确的 entitlements 注入。

## 七、越狱环境检测与绕过（iOS 侧）

| 检测 | 实现 | 绕过 |
| --- | --- | --- |
| 文件存在 | `NSFileManager fileExistsAtPath:` 查 `/Applications/Cydia.app` | hook 该方法返回 false |
| `fork()` | 越狱可 fork | replace `fork` 返回 -1 |
| `system()` | 可执行命令 | replace 返回 0 |
| `canOpenURL("cydia://")` | URL scheme | hook 返回 false |
| 沙箱可写 | 写 `/private/jailbreak.txt` | hook `writeToFile` |
| `stat("/bin/bash")` | 存在 | hook `stat`/`lstat` |
| `_dyld_image_count` 查可疑 dylib | 扫 Substrate | hook `dladdr`/过滤 |
| `ptrace(PT_DENY_ATTACH)` | 反调试（**不是越狱检测**） | hook `ptrace` 返回 0 |
| `sysctl` 查 `P_TRACED` | 调试器检测 | hook `sysctl` 清 flag |

```javascript
// 通用 iOS 越狱检测绕过
if (ObjC.available) {
  // 1) NSFileManager
  var NSFileManager = ObjC.classes.NSFileManager;
  var existsSel = "- fileExistsAtPath:";
  if (NSFileManager[existsSel]) {
    Interceptor.attach(NSFileManager[existsSel].implementation, {
      onEnter(args) {
        var p = new ObjC.Object(args[2]).toString();
        this.hide = /Cydia|bash|ssh|apt|Substrate|jailbreak|frida/i.test(p);
        if (this.hide) console.log("[JB] hide " + p);
      },
      onLeave(ret) { if (this.hide) ret.replace(ptr(0)); }
    });
  }

  // 2) fork / system
  ["fork", "system"].forEach(function (n) {
    var f = Module.findExportByName(null, n);
    if (f) Interceptor.replace(f, new NativeCallback(() => (n === "fork" ? -1 : 0), 'int', ['pointer']));
  });

  // 3) ptrace（PT_DENY_ATTACH = 31）
  var ptrace = Module.findExportByName(null, "ptrace");
  if (ptrace) Interceptor.replace(ptrace, new NativeCallback(() => 0, 'int', ['int','int','pointer','int']));

  // 4) canOpenURL
  var UIApplication = ObjC.classes.UIApplication;
  Interceptor.attach(UIApplication["- canOpenURL:"].implementation, {
    onEnter(args) {
      var u = new ObjC.Object(args[2]).toString();
      this.hide = /cydia|sileo|undecimus/i.test(u);
    },
    onLeave(ret) { if (this.hide) ret.replace(ptr(0)); }
  });
}
```

## 八、动态工具链

| 工具 | 用途 | 命令 |
| --- | --- | --- |
| frida | 通用 hook | `frida -U -f com.app -l hook.js` |
| objection | 免脚本 | `objection -g com.app explore` |
| cycript | 交互式 ObjC（老） | `cycript -p Target` |
| lldb | 原生调试（设备） | `debugserver` + `lldb` |
| Frida (ObjC) | 调任意方法 | `ObjC.classes.X.method()` |
| Passionfruit / MobSF | 静态+动态套件 | GUI |

```bash
# lldb 连设备（需 debugserver）
# 设备侧
/usr/bin/debugserver *:1234 --attach=Target
# 本地
lldb
(lldb) process connect connect://192.168.1.50:1234
(lldb) image list
(lldb) b 0x100001234
```

## 九、检测视角（防守方）

| 红队动作 | 可见信号（App/服务端） |
| --- | --- |
| 越狱设备 | 文件/`fork`/URL scheme 检测；设备完整性上报 |
| 砸壳后重装 | 代码签名变化；`cryptid` 变化（服务端可通过 IPA 校验） |
| frida 注入 | `/proc` 类扫描（iOS 用 `_dyld_image_count`）；内存字符串 |
| Keychain 读取 | 无直接日志，但 `SecItemCopyMatching` 调用可被 hook（反制） |
| 证书绕过 | TLS 指纹（JA3/JA4）；证书链 |
| 调试器附加 | `P_TRACED`；`ptrace` 调用 |

## 十、验伤信号

| 声称 | 证据 |
| --- | --- |
| "已砸壳" | `otool -l` 的 `cryptid 0`，且反编译能看到**真实方法实现**（非桩） |
| "拿到类清单" | `class-dump`/`otool -ov` 输出含目标类与方法签名 |
| "拿到 Keychain 明文" | 条目 `data` 被解出为可读字符串，且与**使用它的代码**对应 |
| "绕过越狱检测" | App 进入主界面/发出真实请求（不是"没退出"） |

**反例（看起来成功其实是假）**：

- `class-dump` 输出大量类但没有目标类 → 目标类在**独立的 framework** 里，要单独 dump
- 砸壳后 `cryptid=0` 但方法体是空的 → dump 的是**磁盘文件**而非内存镜像
- Keychain 读到 `acct`/`svce` 但没有 `data` → access group 不匹配，需要 `keychain_dumper` + entitlement
- hook 生效但 app 没走真实逻辑 → 检测到越狱后走了降级分支

## 十一、常见坑

1. **拿 App Store 的 IPA 直接静态分析**——`cryptid 1`，方法体全是加密字节（看起来像乱码）。
   必须先砸壳。
2. **砸壳工具 dump 到的是磁盘文件**——`frida-ios-dump` 是从内存 dump，
   而手工 `cp` 出来的一定仍加密。
3. **重签只做 `codesign -f -s -`**——`arm64e` 二进制可能因 PAC 失败崩溃，
   需 strip arm64e 或换 arm64。
4. **`class-dump` 对新格式失败**——用 `otool -ov` 或 Hopper/IDA 替代。
5. **Swift 类 `class-dump` 看不到**——纯 Swift 类没有 ObjC 元数据，要看 `$s` 符号。
6. **短字符串搜不到**——Swift 的 `String` ≤15 字节内联，静态 `strings` 可能漏，
   要动态 hook。
7. **Keychain 用 sqlite 直读**——`data` 字段加密，且受 access group 限制，
   需要正确的 entitlement 注入。