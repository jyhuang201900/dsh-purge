# 移动端反检测绕过：Root/越狱、模拟器、Frida、SSL Pinning

> 被 `mobile-reverse` 引用。移动端的对抗是**多层叠加**的：环境检测 → 完整性检测 →
> 通信检测。**绕过顺序很重要**：先过环境检测，再谈 pinning；顺序错了 hook 都挂不上。

## 一、检测层地图（先认清有几层）

| 层 | 检测什么 | 触发后果 | 绕过手段 |
| --- | --- | --- | --- |
| L1 环境 | root / 越狱 / 模拟器 / 调试器 | 退出/降级功能 | hook 判定函数；改 props；隐藏 su |
| L2 完整性 | APK/IPA 签名、dex 校验、so 校验 | 退出/上报 | hook 签名查询；patch 校验；重签 |
| L3 注入检测 | Frida/Xposed/Substrate 痕迹 | 退出/上报 | 改名 frida-server；hook 扫描函数 |
| L4 通信 | SSL Pinning / 双向认证 | 请求失败 | hook TrustManager / SSL_CTX |
| L5 业务 | 设备指纹、行为风控 | 服务端拒绝 | 需要真实设备/服务端配合 |

```text
正确顺序：
  1. 静态确认有哪些检测（不要边试边猜）
  2. 过 L1（否则 app 直接退出，后面都白搭）
  3. 过 L3（否则 frida 一挂就被发现）
  4. 过 L2（改包后必然触发）
  5. 过 L4（才能看明文流量）
```

## 二、Root 检测：实现与绕过（Android）

### 2.1 常见实现清单

| 检测方式 | 代码特征 | 说明 |
| --- | --- | --- |
| `su` 文件存在 | `/system/bin/su`、`/system/xbin/su`、`/sbin/su` | 最基础 |
| `which su` / `Runtime.exec` | `exec("which su")` | 会被 SELinux 影响 |
| `Build.TAGS` 含 `test-keys` | `Build.TAGS.contains("test-keys")` | 官方 ROM 是 `release-keys` |
| 危险路径 | `/system/app/Superuser.apk`、`/data/adb/magisk` | Magisk 特征 |
| `ro.debuggable` / `ro.secure` | `SystemProperties.get("ro.debuggable")` | 调试版本 |
| RootBeer 库 | `com.scottyab.rootbeer.RootBeer` | 聚合多种检测 |
| SafetyNet / Play Integrity | `SafetyNet.getClient(...)` | 服务端校验，最难 |
| `/proc/self/maps` 含 magisk | 读 maps 扫 `magisk` | 隐藏需 MagiskHide/DenyList |
| 包管理器查 `com.topjohnwu.magisk` | `getPackageInfo` | Magisk 包名可随机化 |
| mount 检查 | `/system` 是否 rw | Magisk 的 overlay |

```bash
# 静态：先列出所有检测点
grep -rn "isRooted\|/system/bin/su\|test-keys\|superuser\|magisk" ./src_out | head -20
# so 层
strings lib/arm64-v8a/lib*.so | grep -iE "su$|magisk|superuser|test-keys"
```

### 2.2 绕过（由浅入深）

```javascript
// 1) hook 常见库的判定函数
Java.perform(function () {
  try {
    var RB = Java.use("com.scottyab.rootbeer.RootBeer");
    RB.isRooted.implementation = function () { return false; };
    RB.isRootedWithBusyBoxCheck.implementation = function () { return false; };
  } catch (e) { console.log("RootBeer not present"); }

  // 2) 通用：hook File.exists 屏蔽 su 路径
  var File = Java.use("java.io.File");
  var origExists = File.exists;
  File.exists.implementation = function () {
    var p = this.getAbsolutePath();
    if (/\/su$|magisk|superuser|busybox/i.test(p)) {
      console.log("[File.exists] hide " + p);
      return false;
    }
    return origExists.call(this);
  };

  // 3) Build.TAGS
  var Build = Java.use("android.os.Build");
  console.log("TAGS =", Build.TAGS.value);
});
```

```javascript
// 4) 原生层：hook access/stat/openat（so 里的检测常直调 syscall）
["access", "stat", "lstat", "openat", "__openat_2"].forEach(function (name) {
  var addr = Module.findExportByName(null, name);
  if (!addr) return;
  Interceptor.attach(addr, {
    onEnter(args) {
      try {
        var path = args[1].readCString();   // openat 的 path 在 arg1，access/stat 也在 arg1
        if (path && /su$|magisk|superuser/i.test(path)) {
          this.hide = true;
          console.log("[native] " + name + "(" + path + ") -> fake");
        }
      } catch (e) {}
    },
    onLeave(ret) {
      if (this.hide) ret.replace(ptr(-1));   // 返回"不存在"
    }
  });
});
```

| 检测强度 | 绕过手段 | 备注 |
| --- | --- | --- |
| 文件存在 | hook `File.exists` / `access` | 覆盖绝大多数 |
| 执行 `su` 命令 | hook `Runtime.exec` / `ProcessBuilder` 返回假输出 | 要看它解析什么 |
| 属性（`ro.debuggable`） | hook `SystemProperties.get` / `__system_property_get` | 原生侧也要 hook |
| SafetyNet/Play Integrity | **基本无法本地绕过** | 需真机 + 通过的服务端 |
| 服务端风控 | 需真实设备指纹 | 无解，只能换思路 |

**Magisk 层的隐藏**（比 hook 更彻底）：

```bash
# Magisk DenyList（原 MagiskHide）
# Magisk app → Settings → Configure DenyList → 勾选目标 app
# 作用：对目标进程隐藏 root、模块、Zygisk

# 或用 Shamiko 模块（更强的隐藏，配合 DenyList）
# 注意：Zygisk 开启后 frida-server 会被更容易发现

# 验证隐藏是否生效
adb shell su -c "ls /data/adb/modules"       # 在目标 app 视角应该看不到
```

## 三、模拟器检测：实现与绕过

| 检测 | 实现 | 绕过 |
| --- | --- | --- |
| `ro.kernel.qemu` | `SystemProperties.get("ro.kernel.qemu")` | 改 props（需 root + resetprop） |
| `ro.hardware` | `goldfish`/`ranchu` | resetprop |
| `Build.MODEL` / `FINGERPRINT` | 含 `sdk`/`generic`/`Emulator` | hook 返回值 |
| 传感器数量 | `SensorManager.getSensorList` 为空 | 真机 / hook 返回假列表 |
| 电池状态 | `BatteryManager` 固定值 | hook |
| 电话状态 | `TelephonyManager.getDeviceId` 为 `000000000000000` | hook 返回随机 IMEI |
| 网络运营商 | `android`/`Android` | hook |
| CPU 特征 | `ro.product.cpu.abi` 单一 | 真机 |
| 文件 | `/dev/socket/qemud`、`/dev/qemu_pipe` | hook `File.exists` |
| 硬件加速 | GPU renderer 是 `SwiftShader`/`goldfish` | 真机 |

```bash
# 改 props（Magisk resetprop，需 root）
adb shell su -c "resetprop ro.kernel.qemu 0"
adb shell su -c "resetprop ro.hardware qcom"
adb shell su -c "resetprop ro.product.model 'Pixel 7'"
adb shell su -c "resetprop ro.build.fingerprint 'google/panther/panther:14/UQ1A.240205.004/11206848:user/release-keys'"
# 重启后可能被重置 → 用 Magisk 模块固化
```

```javascript
// hook Build 字段（Java 层最直接）
Java.perform(function () {
  var Build = Java.use("android.os.Build");
  Build.MODEL.value = "Pixel 7";
  Build.MANUFACTURER.value = "Google";
  Build.BRAND.value = "google";
  Build.FINGERPRINT.value = "google/panther/panther:14/UQ1A.240205.004/11206848:user/release-keys";
  Build.HARDWARE.value = "panther";
});
```

## 四、Frida 检测：实现与绕过

### 4.1 检测手段

| 手段 | 实现 | 特征 |
| --- | --- | --- |
| 端口扫描 | 连 `127.0.0.1:27042`（默认） | 可改 `--listen` 端口 |
| 进程名 | 扫 `frida-server` / `frida` / `gum-js-loop` | 改名 + 改库名 |
| 线程名 | `/proc/self/task/*/comm` 含 `gum-js-loop`/`gmain`/`gdbus` | 可通过 patch 改 |
| 内存扫描 | 扫 maps 里 `frida-agent`/`linjector`/`gum` | 改名 so |
| 特征字符串 | 扫内存里的 `frida:rpc`/`REJECTED`/`frida-agent` | patch 字符串 |
| Xposed 类 | `de.robv.android.xposed.XposedBridge` | 用 LSPosed 隐藏 |
| ptrace 状态 | `TracerPid` | frida 默认不用 ptrace（非注入模式） |
| 系统调用监控 | 检测 `mprotect`/`mmap` 异常 | 高级手段 |

```bash
# 检查是否有 frida 痕迹（分析者视角，也是检测者的手法）
adb shell "cat /proc/net/tcp | grep -i 6969"    # 0x69A2 = 27042
adb shell "ps -A | grep -i frida"
adb shell "cat /proc/<pid>/maps | grep -i frida"
adb shell "ls /proc/<pid>/task/*/comm | xargs -I{} cat {}"  # 线程名
```

### 4.2 绕过（改名 + 端口 + 隐藏）

```bash
# 1) 拉 frida-server 到设备，改名（破坏进程名/文件检测）
adb push frida-server-16.2.1-android-arm64 /data/local/tmp/fs
adb shell "chmod 755 /data/local/tmp/fs"
adb shell "su -c '/data/local/tmp/fs -l 0.0.0.0:8888 &'"
# 客户端
frida -H 192.168.1.20:8888 -l hook.js -f com.target.app
```

```bash
# 2) 改 frida-agent 的库名/线程名（更强）
#    需要重新编译 frida 或 patch gum
#    社区做法：用 frida-gadget 以"正常 so"的名字注入（见下）
# 3) gadget 注入：把 frida-gadget.so 改名为 libsound.so 之类的常见名
#    然后在 smali 的 <clinit> 或 Application.onCreate 里 System.loadLibrary("sound")
```

```javascript
// 4) 内存扫描对抗：hook 常见扫描点
Java.perform(function () {
  // 很多检测用 Runtime.exec("cat /proc/self/maps")
  var Runtime = Java.use("java.lang.Runtime");
  var origExec = Runtime.exec.overload("java.lang.String");
  origExec.implementation = function (cmd) {
    if (cmd.indexOf("maps") >= 0 || cmd.indexOf("frida") >= 0 || cmd.indexOf("task") >= 0) {
      console.log("[exec] block: " + cmd);
      // 返回一个空输出的进程（构造假的）
      return origExec.call(this, "echo");
    }
    return origExec.call(this, cmd);
  };
});
```

```javascript
// 5) 原生侧 hook 字符串扫描（memmem/strstr）
var memmem = Module.findExportByName(null, "memmem");
if (memmem) {
  Interceptor.attach(memmem, {
    onEnter(args) { this.needle = args[2].readCString(); },
    onLeave(ret) {
      if (this.needle && /frida|gum|linjector/i.test(this.needle)) ret.replace(ptr(0));
    }
  });
}
```

| 检测强度 | 说明 | 现实处理 |
| --- | --- | --- |
| 扫端口 | 低 | 换端口即可 |
| 扫进程名 | 低 | 改名 |
| 扫线程名 | 中 | patch frida 或换 gadget |
| 扫内存字符串 | 中高 | 需要 patch agent |
| 综合（商业壳如 梆梆/爱加密） | 高 | 通常需要定制 frida（如 hluda、strong-frida） |

## 五、SSL Pinning：五种实现与对应绕过

### 5.1 实现识别

| 实现 | 代码位置 | 特征 |
| --- | --- | --- |
| `TrustManager` 自定义 | Java：`X509TrustManager` 重写 `checkServerTrusted` | 反编译能看到 pin 逻辑 |
| `OkHttp` CertificatePinner | `new CertificatePinner.Builder().add("api.x.com","sha256/AAA...")` | 字符串里有 `sha256/` |
| `HostnameVerifier` | 自定义 `verify()` 返回 true/false | 常见于 WebView |
| Network Security Config | `res/xml/network_security_config.xml` 里 `<pin-set>` | 静态资源里直接看到 |
| Native（BoringSSL/Conscrypt） | so 里 `SSL_CTX_set_cert_verify_callback` / `SSL_CTX_set_verify` | 需 hook native |
| 双向认证（mTLS） | 客户端证书 + 服务端校验 | 需要拿到客户端证书与私钥 |

```bash
# 静态确认用的是哪种（顺序执行）
grep -rn "CertificatePinner\|TrustManager\|HostnameVerifier" ./src_out | head -20
unzip -p app.apk res/xml/network_security_config.xml 2>/dev/null | head -40
aapt2 dump xmltree app.apk --file res/xml/network_security_config.xml | grep -i pin
strings lib/arm64-v8a/lib*.so | grep -iE "SSL_CTX_set_verify|cert_verify|X509_VERIFY"
```

### 5.2 绕过

```javascript
// 方案 1：Objection（最快，多方案叠加）
// objection -g com.target.app explore
// android sslpinning disable
```

```javascript
// 方案 2：Frida 通用脚本（覆盖 Java 层主流实现）
Java.perform(function () {
  // (a) TrustManager
  var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
  var TrustManager = Java.registerClass({
    name: "com.fake.TrustAll",
    implements: [X509TrustManager],
    methods: {
      checkClientTrusted: function () {},
      checkServerTrusted: function () {},
      getAcceptedIssuers: function () { return []; }
    }
  });
  var SSLContext = Java.use("javax.net.ssl.SSLContext");
  SSLContext.init.overload(
    "[Ljavax.net.ssl.KeyManager;", "[Ljavax.net.ssl.TrustManager;", "java.security.SecureRandom"
  ).implementation = function (km, tm, sr) {
    console.log("[SSL] SSLContext.init patched");
    return this.init(km, [TrustManager.$new()], sr);
  };

  // (b) OkHttp CertificatePinner
  try {
    var CP = Java.use("okhttp3.CertificatePinner");
    CP.check.overload("java.lang.String", "java.util.List").implementation = function () {
      console.log("[SSL] CertificatePinner.check bypassed");
    };
  } catch (e) {}

  // (c) HostnameVerifier
  try {
    var HNV = Java.use("javax.net.ssl.HostnameVerifier");
    var HV = Java.registerClass({
      name: "com.fake.HV",
      implements: [HNV],
      methods: { verify: function () { return true; } }
    });
    var OkHostnameVerifier = Java.use("okhttp3.internal.tls.OkHostnameVerifier");
    OkHostnameVerifier.verify.overload("java.lang.String", "javax.net.ssl.SSLSession")
      .implementation = function () { return true; };
  } catch (e) {}

  // (d) WebView（部分 app 只用 WebView 校验）
  try {
    var WebViewClient = Java.use("android.webkit.WebViewClient");
    WebViewClient.onReceivedSslError.implementation = function (view, handler, error) {
      console.log("[SSL] WebView SslError ignored");
      handler.proceed();
    };
  } catch (e) {}
});
```

```javascript
// 方案 3：Native 层（BoringSSL / Conscrypt）
// 3a. 高层：hook SSL_CTX_set_verify 把 mode 改成 SSL_VERIFY_NONE
var set_verify = Module.findExportByName(null, "SSL_CTX_set_verify");
if (set_verify) {
  Interceptor.attach(set_verify, {
    onEnter(args) { args[1] = ptr(0); }              // SSL_VERIFY_NONE
  });
}
// 3b. 更强：hook SSL_get_verify_result 永远返回 0（X509_V_OK）
var gvr = Module.findExportByName(null, "SSL_get_verify_result");
if (gvr) {
  Interceptor.replace(gvr, new NativeCallback(() => 0, 'long', ['pointer']));
}
// 3c. 兜底：hook 证书链校验回调
var verify_cb = Module.findExportByName(null, "SSL_CTX_set_cert_verify_callback");
if (verify_cb) {
  Interceptor.attach(verify_cb, {
    onEnter(args) {
      // 把 callback 换成永远返回 1 的函数
      var f = new NativeCallback((x509_store_ctx) => 1, 'int', ['pointer']);
      args[1] = f;
    }
  });
}
```

| 方案 | 覆盖 | 失效场景 |
| --- | --- | --- |
| Objection `sslpinning disable` | Java 层主流 | 纯 native pinning |
| 上面的通用 Java 脚本 | Java + OkHttp + WebView | 用了自定义 native 校验 |
| `SSL_CTX_set_verify` hook | native BoringSSL | 用的是自实现校验（不调该 API） |
| `SSL_get_verify_result` hook | 多数 native | 校验在 callback 里做完，不看返回值 |
| **系统性方案**：frida hook `memcmp`/`CRYPTO_memcmp` | 覆盖"比对证书 hash"类 | 会误伤其他 memcmp 调用（要看上下文） |

```javascript
// 4) 兜底：hook 证书 hash 比较（很多 pinning 就是比对 sha256）
var CRYPTO_memcmp = Module.findExportByName(null, "CRYPTO_memcmp");
if (CRYPTO_memcmp) {
  Interceptor.attach(CRYPTO_memcmp, {
    onEnter(args) { this.n = args[2].toInt32(); },
    onLeave(ret) {
      if (this.n === 32) {           // 32 字节 = sha256
        console.log("[SSL] CRYPTO_memcmp(32) forced equal");
        ret.replace(ptr(0));
      }
    }
  });
}
```

### 5.3 证书安装（pinning 之外的必经步骤）

```bash
# Android 7+ 默认不信任用户证书 → 必须装到系统证书
# 方法 A：Magisk 模块（MoveCertificates / Cert-Fixer）
# 方法 B：手工（需 root）
openssl x509 -inform PEM -subject_hash_old -in burp.der | head -1   # 得到 hash
# 重命名为 <hash>.0
adb root; adb remount
adb push <hash>.0 /system/etc/security/cacerts/
adb shell "chmod 644 /system/etc/security/cacerts/<hash>.0"
adb reboot

# 方法 C：把证书打进 APK 的 network_security_config（需重打包）
# 方法 D：直接改 targetSdk < 24（不现实）
```

## 六、iOS 侧对照

| 检测 | 实现 | 绕过 |
| --- | --- | --- |
| 越狱文件 | `/Applications/Cydia.app`、`/bin/bash`、`/usr/sbin/sshd` | hook `NSFileManager.fileExistsAtPath` |
| `fork()` 成功 | 越狱设备可 fork | hook `fork` 返回 -1 |
| `system()` / `popen` | 存在 | hook 返回 0 |
| URL scheme `cydia://` | `canOpenURL` | hook 返回 false |
| 沙箱可写 `/private/` | `writeToFile` 成功 | hook |
| `FridaGadget` 检测 | 扫 dylib | 改 dylib 名 |
| 调试器 | `PT_DENY_ATTACH`、`sysctl` | hook `ptrace` / `sysctl` |

```javascript
// iOS 越狱检测绕过（Frida）
if (ObjC.available) {
  var NSFileManager = ObjC.classes.NSFileManager;
  Interceptor.attach(NSFileManager["- fileExistsAtPath:"].implementation, {
    onEnter(args) {
      var path = new ObjC.Object(args[2]).toString();
      this.hide = /Cydia|bash|ssh|apt|cydia/i.test(path);
      if (this.hide) console.log("[JB] hide " + path);
    },
    onLeave(ret) { if (this.hide) ret.replace(ptr(0)); }
  });
  // fork
  var fork = Module.findExportByName(null, "fork");
  Interceptor.replace(fork, new NativeCallback(() => -1, 'int', []));
}
```

## 七、检测视角（防守方）

| 红队动作 | App/服务端可见 |
| --- | --- |
| root/越狱 | 设备完整性上报（SafetyNet/Play Integrity） |
| Magisk DenyList | 部分检测仍可通过 `/proc/mounts`/`/proc/1/root` 发现 |
| frida-server | 端口/进程/线程/内存特征；商业壳会上报 |
| 改 Build 字段 | Java 层字段改了，但 `ro.product.*` 属性没改 → 不一致可被发现 |
| SSL 绕过 | 服务端看到 TLS 指纹变化（JA3/JA4）；证书链异常 |
| 重打包 | 签名变化（服务端可校验签名 hash） |
| 抓包 | UA/请求头异常；时间/序列不合规 |

> 高级风控会做**指纹一致性校验**：`Build.MODEL` 与 `ro.product.model`、
> 传感器列表与机型、GPU 与 SoC。**只改 Java 层字段会被识破**。

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "过了 root 检测" | app 进入主界面/发出业务请求（不是"没退出"） |
| "过了 pinning" | 抓到**明文 HTTP 请求/响应**（Burp 有记录），且 app 正常返回数据 |
| "Frida 未被检测" | 长时间运行（>10 分钟）无退出/上报；服务端未出现异常风控 |
| "模拟器检测绕过" | app 在模拟器里走完业务流程 |
| "拿到了密钥" | 密钥 + 使用它的函数/请求同时给出 |

**反例（看起来成功其实是假）**：

- app 没退出就以为"绕过成功" → 实际走了降级分支（功能受限/假数据）
- Burp 里有请求但都是 `CONNECT` → TLS 握手失败，pin 没过（只看到隧道，没有明文）
- hook 生效但抓到的请求 401 → 签名/设备指纹没过，不是 pinning 问题
- frida 脚本打印"bypassed"但 app 崩溃 → hook 破坏了调用约定（返回值类型错）
- 在模拟器里绕过成功 → 真机上有额外检测（传感器/基带）

## 九、常见坑

1. **顺序错**——先绕 pinning 再管 root 检测：app 早就退出了，抓不到任何流量。
2. **只 hook Java 层**——很多检测在 native（`access("/system/bin/su")`），
   Java hook 完全无效。
3. **`File.exists` hook 写错路径参数**——`this.getAbsolutePath()` 与
   `exists()` 的参数不同；用 `this.getPath()` 更稳。
4. **返回值类型不匹配导致崩溃**——`registerClass` 的 `getAcceptedIssuers` 必须返回
   正确类型的空数组，返回 `null` 会 NPE。
5. **装证书没重启**——Android 系统证书目录改了不 reboot 不生效，
   表现为"pin 过了但证书不被信任"（两个不同问题）。
6. **只改 Java 层 Build 字段**——原生层读 `__system_property_get` 拿到的是真值，
   高级样本会交叉校验。
7. **忽略 `network_security_config`**——它会在应用层强制 pin，
   即使 hook 了 TrustManager 也可能因为 `<pin-set>` 在 native 层生效而失败。