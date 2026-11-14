---
name: apk-reverse
description: 在 CLI 环境下做 Android APK 逆向时使用。适用于 APK 解包、Java 反编译、smali 修改、重打包、Frida 动态 Hook，以及按需切换到 so/native 分析。优先使用本机已安装的 jadx、apktool、frida、adb、ida-reverse、radare2。
whenToUse: 在 CLI 环境下做 Android APK 逆向时使用
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

## 适用范围

当任务属于以下场景时优先使用本 skill：

- 分析 APK 的 Java 业务逻辑
- 定位登录、签名、风控、证书校验、root 检测
- 查看与修改 `AndroidManifest.xml`
- 查看与修改 smali
- 重打包 APK
- 用 Frida 做 Java/native 动态 Hook
- APK 内含 `.so` 时切到 native 分析

## 当前机器已验证可用的 CLI 工具

- `jadx` `1.5.5`
- `apktool` `3.0.2`
- `frida-ps` `17.9.6`
- `adb`
- `java`

## 优先使用脚本的场景

以下流程高频且参数容易出错，优先用 skill 自带脚本：

- 一次性完成 `jadx + apktool` 落盘并产出摘要：`scripts/decode.ps1`
- Frida 设备检查、进程列举、spawn/attach 注入：`scripts/frida-run.ps1`
- 重建、对齐、签名、安装 APK：`scripts/rebuild-sign-install.ps1`
- 快速抽取 Manifest 关键组件与权限：`scripts/manifest-summary.ps1`

以下一行命令保持直接调用，不单独封装：

- `adb devices`
- `adb logcat`
- `frida-ps -U`
- `jadx --version`
- `apktool --version`

## 自带脚本

### `scripts/decode.ps1`

用途：

- 统一跑 `jadx` 和 `apktool`
- 默认在原 APK 同目录创建任务输出目录
- 输出 `package`、`java_files`、`smali_dirs`、`so_files` 等摘要
- 兼容 `jadx` 部分反编译错误但仍然有可用产物的情况

示例：

```powershell
pwsh -File "<skill-root>\apk-reverse\scripts\decode.ps1" -ApkPath "D:\DOWNLOAD\app.apk" -Clean
pwsh -File "<skill-root>\apk-reverse\scripts\decode.ps1" -ApkPath "D:\DOWNLOAD\app.apk" -Name demo -SkipJadx
```

### `scripts/frida-run.ps1`

用途：

- 统一 Frida 的设备、进程、spawn/attach 入口
- 避免手写参数时混淆 `-f`、`-n`、`-U`

示例：

```powershell
pwsh -File "<skill-root>\apk-reverse\scripts\frida-run.ps1" -ListDevices
pwsh -File "<skill-root>\apk-reverse\scripts\frida-run.ps1" -Usb -ListProcesses
pwsh -File "<skill-root>\apk-reverse\scripts\frida-run.ps1" -Usb -Spawn -Package com.example.app -ScriptPath "D:\hooks\test.js"
```

### `scripts/rebuild-sign-install.ps1`

用途：

- `apktool b` 重建 APK
- `zipalign` 对齐
- `apksigner` 签名与验签
- 可选直接 `adb install`

示例：

```powershell
pwsh -File "<skill-root>\apk-reverse\scripts\rebuild-sign-install.ps1" -ProjectDir "C:\work\apktool_out" -Clean
pwsh -File "<skill-root>\apk-reverse\scripts\rebuild-sign-install.ps1" -ProjectDir "C:\work\apktool_out" -Install -Reinstall -DeviceSerial "127.0.0.1:7555"
```

说明：

- 默认生成并复用调试 keystore
- 默认输出到 `ProjectDir` 同目录，便于和原始包、解包目录放在一起

### `scripts/manifest-summary.ps1`

用途：

- 抽取包名
- 列权限
- 列 activity/service/receiver/provider
- 标出主启动 activity

示例：

```powershell
pwsh -File "<skill-root>\apk-reverse\scripts\manifest-summary.ps1" -ManifestPath "C:\work\apktool_out\AndroidManifest.xml"
```

如果要分析 `.so`、`lib/arm64-v8a/*.so`、`lib/armeabi-v7a/*.so`，再结合：

- `ida-reverse`
- `radare2`

## 工具分工

### `jadx`

用于：

- Java 反编译阅读
- 包名、类名、方法名搜索
- 先从高层逻辑理解 APK

常用命令：

```bash
jadx -d jadx_out app.apk
jadx --single-class com.example.LoginActivity -d jadx_out app.apk
jadx --deobf -d jadx_out app.apk
```

### `JEB Pro`（可选商业工具）

用于：

- Android DEX / APK / ARM 的交叉验证与深度反编译
- 在 JADX 输出不完整或混淆较重时补充静态分析
- 对同一目标的类、方法与调用关系进行第二工具链校验

边界：

- JEB Pro 是商业软件，必须由用户自行取得并安装有效许可证；本包不会下载、破解或规避许可。
- 仅在 工具索引（本机无，以技能内「本机工具实况」为准） 已确认本机 JEB 可用时调用；否则继续使用 `jadx`、`apktool`、Ghidra、IDA 或 radare2。
- 第三方 JEB MCP bridge 不是本包依赖。安装前必须按 `../ops/skill-supply-chain.md` 审阅源码、权限、网络行为和版本，再由用户明确确认注册。

### `apktool`

用于：

- 解包 APK
- 查看和修改 `AndroidManifest.xml`
- 查看和修改 smali
- 重建 APK

常用命令：

```bash
apktool d app.apk -o apktool_out
apktool b apktool_out -o rebuilt.apk
```

### `frida`

用于：

- 动态观察 Java 方法调用
- Hook native 导出函数
- 绕过 root 检测、证书校验、调试检测

常用命令：

```bash
frida-ps -U
frida -U -f com.example.app -l hook.js
frida-trace -U -f com.example.app -j '*!*certificate*'
```

### `adb`

用于：

- 设备连接
- 安装 APK
- 查看日志
- 拉取文件

常用命令：

```bash
adb devices
adb install -r app.apk
adb shell pm list packages
adb logcat
adb pull /data/local/tmp/file .
```

## 推荐工作流

### 1. Triage

先确定 APK 大致构成，不急着改包或 Hook。

建议动作：

1. 用 `jadx -d jadx_out app.apk` 导出 Java 代码
2. 用 `apktool d app.apk -o apktool_out` 导出 smali 和资源
3. 先看：
   - `AndroidManifest.xml`
   - 主 `package`
   - `application`、`activity`、`service`、`receiver`
   - `lib/` 目录里是否有 `.so`
4. Issue #65 威胁形态速查（授权样本/设备；详见 `../reverse-engineering/references/nonpe-format-cookbook.md` §7–8）：
   - 透明/隐藏图标（AU）：`aapt dump badging` + manifest theme/label/icon → `E-android-hidden-icon-manifest`
   - Magisk/脚本格机特征与远程 curl|sh（AR/AS）→ 特征与 URL 入证，**不执行**破坏命令
   - 持久化路径（AT）：`service.d` / `priv-app` 等 → `E-android-persistence`

### 2. Java 逻辑观察

优先从 `jadx_out` 读：

- `MainActivity`
- `Application`
- 登录、网络、加密、风控相关类
- 第三方 SDK 初始化类

常见关键词：

- `login`
- `sign`
- `encrypt`
- `cipher`
- `token`
- `root`
- `certificate`
- `trust`
- `okhttp`
- `retrofit`
- `webview`

如果 Java 代码可读，先在这里定位业务逻辑。

### 3. Smali 与资源层确认

当 `jadx` 结果不完整、混淆重、或需要实际 patch 时，切到 `apktool_out`：

- 看 `smali*/`
- 看 `res/values/strings.xml`
- 看 `AndroidManifest.xml`

优先 patch：

- `android:exported`
- 调试标记
- root 检测返回值
- 登录验证逻辑
- 证书校验分支

### 4. 重建与安装

修改后：

```bash
apktool b apktool_out -o rebuilt.apk
```

或者直接用脚本闭环：

```powershell
pwsh -File "<skill-root>\apk-reverse\scripts\rebuild-sign-install.ps1" -ProjectDir "apktool_out" -Install -Reinstall -DeviceSerial "127.0.0.1:7555"
```

说明：

- 本 skill 只保证 `apktool` 重建链路
- 若后续需要正式安装到设备，通常还需要签名流程
- 如果任务进入签名/对齐，补充 `apksigner` / `zipalign`

### 5. 动态 Hook

静态分析不足时，用 Frida：

- Hook 登录函数
- Hook `OkHttp` / `Retrofit` / `WebView` 关键点
- Hook `javax.crypto`、`MessageDigest`
- Hook root 检测函数
- Hook SSL pinning 逻辑

原则：

- 先 Hook Java 层，再看是否需要 native Hook
- 先打印参数与返回值，再决定是否主动修改返回值

建议：

- 简单一次性命令直接用 `frida-*`
- 需要稳定复用的注入流程优先走 `scripts/frida-run.ps1`

### 6. Native `.so` 分流

如果 APK 中包含关键 `.so`：

- 用 `apktool` 或 `jadx` 找到 `lib/**/*.so`
- 若只是导出符号、字符串、快速 triage，可用 `radare2`
- 若要长期深入分析、反编译、改名、类型恢复，用 `ida-reverse`

遇到这些信号要尽快切 native：

- Java 层只是 JNI 包装
- 核心签名逻辑不在 Java
- `System.loadLibrary()` 后关键逻辑消失
- 证书校验/风控在 `.so` 中

## 输出要求

最终至少说明：

- 入口组件与关键类
- 关键逻辑在 Java、smali 还是 `.so`
- 已确认的敏感点：登录、签名、root、SSL、WebView、JNI
- 如果做了 patch，说明改了什么
- 如果做了 Hook，说明 Hook 了哪个类/方法/导出函数

## 禁止事项

- 不要一开始就盲目改 smali
- 不要在没看 manifest 和主入口前就写 Hook
- 不要把 Java 反编译不完整直接等同于“逻辑不可分析”
- 不要在 `.so` 明显承载核心逻辑时继续死磕 Java 层

## 快速命令备忘

```bash
# 反编译 Java
jadx -d jadx_out app.apk

# 解包 APK
apktool d app.apk -o apktool_out

# 重建 APK
apktool b apktool_out -o rebuilt.apk

# 设备与进程
adb devices
frida-ps -U

# 启动并注入
frida -U -f com.example.app -l hook.js
```

---

## 路由上下文

**上游入口**: `skills/SKILL.md`（总控）、`routing.md`
**下游出口**:
- 核心逻辑在 `.so` → `ida-reverse/` 或 `radare2/`
- 需动态 Hook/验证 → `reverse-engineering/tools-dynamic.md`（Frida 章节）
- 通用逆向方法论 → `reverse-engineering/SKILL.md`

**同级关联模块**: `reverse-engineering/`（.so 分析和 Frida 进阶用法）

---

## 任务完成自检（声称完成前 MUST 通过）

- [ ] 我是否执行了工作流中的每一步（而不是只阅读）？
- [ ] 我是否基于 工具索引（本机无，以技能内「本机工具实况」为准） 使用了真实工具路径？
- [ ] 我是否产出了可复现证据（命令/脚本/截图/报告）？
- [ ] 我是否完成并回写了 RULES 要求的 Checklist 项？
- [ ] 若命中隐藏图标/格机/持久化线索：是否按 U–AV cookbook 记录 E-android-* Evidence（授权范围内）？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `decode` | ❌ 未装（用前先装，或改用等价工具） |
| `frida-run` | ❌ 未装（用前先装，或改用等价工具） |
| `rebuild-sign-install` | ❌ 未装（用前先装，或改用等价工具） |
| `manifest-summary` | ❌ 未装（用前先装，或改用等价工具） |
| `（本机未装）` | ❌ 未装（用前先装，或改用等价工具） |
| `frida` | ❌ 未装（用前先装，或改用等价工具） |
| `jadx` | ❌ 未装（用前先装，或改用等价工具） |
| `apktool` | ❌ 未装（用前先装，或改用等价工具） |
| `adb` | ❌ 未装（用前先装，或改用等价工具） |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `radare2` | ✓ 已装（toolkit 内，非 PATH） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `strings` | ✓ 已装 |

---

## Frida 实战手册（上游深度参考）

###### Frida 实战脚本速查

> 精选自 [awesome-frida](https://github.com/dweinstein/awesome-frida)、[Frida-Mobile-Scripts](https://github.com/m0bilesecurity/Frida-Mobile-Scripts)、[frida-codeshare-scripts](https://github.com/zengfr/frida-codeshare-scripts) 等开源项目。
> 按场景分类，直接复制使用。

---

###### 通用 Hook 模板

###### Hook 任意 Java 方法

```javascript
Java.perform(function() {
    var TargetClass = Java.use("com.target.ClassName");
    
    // Hook 无参方法
    TargetClass.methodName.implementation = function() {
        console.log("[*] methodName called");
        var ret = this.methodName();
        console.log("[*] return: " + ret);
        return ret;
    };
    
    // Hook 有参方法
    TargetClass.methodName.overload('java.lang.String', 'int').implementation = function(str, num) {
        console.log("[*] methodName(" + str + ", " + num + ")");
        var ret = this.methodName(str, num);
        console.log("[*] return: " + ret);
        return ret;
    };
});
```

###### Hook 构造函数

```javascript
Java.perform(function() {
    var TargetClass = Java.use("com.target.ClassName");
    TargetClass.$init.overload('java.lang.String').implementation = function(arg) {
        console.log("[*] new ClassName(" + arg + ")");
        this.$init(arg);
    };
});
```

###### 枚举所有方法

```javascript
Java.perform(function() {
    var TargetClass = Java.use("com.target.ClassName");
    var methods = TargetClass.class.getDeclaredMethods();
    methods.forEach(function(method) {
        console.log(method.toString());
    });
});
```

---

###### 加密/签名 Hook

###### Hook AES 加解密

```javascript
Java.perform(function() {
    var Cipher = Java.use("javax.crypto.Cipher");
    
    Cipher.doFinal.overload('[B').implementation = function(input) {
        var mode = this.getOpmode ? this.getOpmode() : "?";
        console.log("[Cipher.doFinal] mode=" + mode);
        console.log("  input: " + bytesToHex(input));
        var result = this.doFinal(input);
        console.log("  output: " + bytesToHex(result));
        return result;
    };
    
    // 捕获密钥
    var SecretKeySpec = Java.use("javax.crypto.spec.SecretKeySpec");
    SecretKeySpec.$init.overload('[B', 'java.lang.String').implementation = function(key, algo) {
        console.log("[SecretKeySpec] algo=" + algo + " key=" + bytesToHex(key));
        this.$init(key, algo);
    };
    
    // 捕获 IV
    var IvParameterSpec = Java.use("javax.crypto.spec.IvParameterSpec");
    IvParameterSpec.$init.overload('[B').implementation = function(iv) {
        console.log("[IvParameterSpec] iv=" + bytesToHex(iv));
        this.$init(iv);
    };
});

function bytesToHex(bytes) {
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
        hex.push(('0' + (bytes[i] & 0xFF).toString(16)).slice(-2));
    }
    return hex.join('');
}
```

###### Hook MD5/SHA

```javascript
Java.perform(function() {
    var MessageDigest = Java.use("java.security.MessageDigest");
    
    MessageDigest.digest.overload('[B').implementation = function(input) {
        console.log("[MessageDigest.digest] algo=" + this.getAlgorithm());
        console.log("  input: " + bytesToHex(input));
        var result = this.digest(input);
        console.log("  hash: " + bytesToHex(result));
        return result;
    };
    
    MessageDigest.digest.overload().implementation = function() {
        console.log("[MessageDigest.digest] algo=" + this.getAlgorithm());
        var result = this.digest();
        console.log("  hash: " + bytesToHex(result));
        return result;
    };
});
```

###### Hook HMAC

```javascript
Java.perform(function() {
    var Mac = Java.use("javax.crypto.Mac");
    
    Mac.doFinal.overload('[B').implementation = function(input) {
        console.log("[Mac.doFinal] algo=" + this.getAlgorithm());
        console.log("  input: " + bytesToHex(input));
        var result = this.doFinal(input);
        console.log("  mac: " + bytesToHex(result));
        return result;
    };
    
    Mac.init.overload('java.security.Key').implementation = function(key) {
        var keyBytes = key.getEncoded();
        console.log("[Mac.init] key=" + bytesToHex(keyBytes));
        this.init(key);
    };
});
```

---

###### 网络请求 Hook

###### Hook OkHttp3 请求/响应

```javascript
Java.perform(function() {
    var OkHttpClient = Java.use("okhttp3.OkHttpClient");
    var Interceptor = Java.use("okhttp3.Interceptor");
    
    // Hook newCall 获取请求 URL
    var RealCall = Java.use("okhttp3.RealCall");
    RealCall.execute.implementation = function() {
        var request = this.request();
        console.log("[OkHttp] " + request.method() + " " + request.url().toString());
        var headers = request.headers();
        for (var i = 0; i < headers.size(); i++) {
            console.log("  " + headers.name(i) + ": " + headers.value(i));
        }
        var response = this.execute();
        console.log("[OkHttp] Response: " + response.code());
        return response;
    };
});
```

###### Hook URL 连接

```javascript
Java.perform(function() {
    var URL = Java.use("java.net.URL");
    URL.openConnection.overload().implementation = function() {
        console.log("[URL] " + this.toString());
        return this.openConnection();
    };
});
```

###### Hook WebView

```javascript
Java.perform(function() {
    var WebView = Java.use("android.webkit.WebView");
    WebView.loadUrl.overload('java.lang.String').implementation = function(url) {
        console.log("[WebView.loadUrl] " + url);
        this.loadUrl(url);
    };
    
    WebView.evaluateJavascript.implementation = function(script, callback) {
        console.log("[WebView.evaluateJavascript] " + script.substring(0, 200));
        this.evaluateJavascript(script, callback);
    };
});
```

---

###### 绕过类 Hook

###### 通用 SSL Pinning 绕过

```javascript
Java.perform(function() {
    // OkHttp3 CertificatePinner
    try {
        var CertificatePinner = Java.use("okhttp3.CertificatePinner");
        CertificatePinner.check.overload('java.lang.String', 'java.util.List').implementation = function() {
            console.log("[*] SSL Pinning bypassed (OkHttp3)");
        };
    } catch(e) {}
    
    // TrustManagerImpl
    try {
        var TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
        TrustManagerImpl.verifyChain.implementation = function(untrustedChain) {
            console.log("[*] SSL Pinning bypassed (TrustManagerImpl)");
            return untrustedChain;
        };
    } catch(e) {}
    
    // X509TrustManager
    try {
        var X509TrustManager = Java.use("javax.net.ssl.X509TrustManager");
        var TrustManager = Java.registerClass({
            name: "com.bypass.TrustManager",
            implements: [X509TrustManager],
            methods: {
                checkClientTrusted: function() {},
                checkServerTrusted: function() {},
                getAcceptedIssuers: function() { return []; }
            }
        });
    } catch(e) {}
    
    // Network Security Config (Android 7+)
    try {
        var NetworkSecurityConfig = Java.use("android.security.net.config.NetworkSecurityConfig");
        NetworkSecurityConfig.isCleartextTrafficPermitted.implementation = function() { return true; };
    } catch(e) {}
});
```

###### 通用 Root 检测绕过

```javascript
Java.perform(function() {
    // File.exists 绕过
    var File = Java.use("java.io.File");
    var rootPaths = ["su", "Superuser", "magisk", "busybox", "xposed", 
                     "/system/xbin/su", "/system/bin/su", "/sbin/su",
                     "/data/local/xbin/su", "/data/local/bin/su"];
    
    File.exists.implementation = function() {
        var path = this.getAbsolutePath();
        for (var i = 0; i < rootPaths.length; i++) {
            if (path.toLowerCase().indexOf(rootPaths[i].toLowerCase()) !== -1) {
                console.log("[Root] Blocked: " + path);
                return false;
            }
        }
        return this.exists();
    };
    
    // Runtime.exec 绕过
    var Runtime = Java.use("java.lang.Runtime");
    Runtime.exec.overload('java.lang.String').implementation = function(cmd) {
        if (cmd.indexOf("su") !== -1 || cmd.indexOf("which") !== -1) {
            console.log("[Root] Blocked exec: " + cmd);
            throw Java.use("java.io.IOException").$new("Permission denied");
        }
        return this.exec(cmd);
    };
    
    // Build.TAGS 绕过
    var Build = Java.use("android.os.Build");
    Build.TAGS.value = "release-keys";
});
```

###### 反调试绕过

```javascript
Java.perform(function() {
    // Debug.isDebuggerConnected
    var Debug = Java.use("android.os.Debug");
    Debug.isDebuggerConnected.implementation = function() {
        console.log("[AntiDebug] isDebuggerConnected → false");
        return false;
    };
    
    // TracerPid 检测绕过（native 层）
    var fopen = Module.findExportByName("libc.so", "fopen");
    Interceptor.attach(fopen, {
        onEnter: function(args) {
            this.path = args[0].readUtf8String();
        },
        onLeave: function(retval) {
            if (this.path && this.path.indexOf("/proc/") !== -1 && this.path.indexOf("/status") !== -1) {
                // 可以进一步 hook fgets 修改 TracerPid
            }
        }
    });
});
```

###### 模拟器检测绕过

```javascript
Java.perform(function() {
    var Build = Java.use("android.os.Build");
    Build.FINGERPRINT.value = "google/walleye/walleye:8.1.0/OPM1.171019.011/4448085:user/release-keys";
    Build.MODEL.value = "Pixel 2";
    Build.MANUFACTURER.value = "Google";
    Build.BRAND.value = "google";
    Build.DEVICE.value = "walleye";
    Build.PRODUCT.value = "walleye";
    Build.HARDWARE.value = "walleye";
    
    // TelephonyManager
    var TelephonyManager = Java.use("android.telephony.TelephonyManager");
    TelephonyManager.getDeviceId.implementation = function() { return "352099001761481"; };
    TelephonyManager.getSubscriberId.implementation = function() { return "310260000000000"; };
    TelephonyManager.getSimSerialNumber.implementation = function() { return "89014103211118510720"; };
});
```

---

###### 数据存储 Hook

###### Hook SharedPreferences

```javascript
Java.perform(function() {
    var SharedPreferencesImpl = Java.use("android.app.SharedPreferencesImpl");
    
    SharedPreferencesImpl.getString.implementation = function(key, defValue) {
        var value = this.getString(key, defValue);
        console.log("[SP.get] " + key + " = " + value);
        return value;
    };
    
    var Editor = Java.use("android.app.SharedPreferencesImpl$EditorImpl");
    Editor.putString.implementation = function(key, value) {
        console.log("[SP.put] " + key + " = " + value);
        return this.putString(key, value);
    };
});
```

###### Hook SQLite

```javascript
Java.perform(function() {
    var SQLiteDatabase = Java.use("android.database.sqlite.SQLiteDatabase");
    
    SQLiteDatabase.rawQuery.implementation = function(sql, args) {
        console.log("[SQL] " + sql);
        if (args) console.log("  args: " + JSON.stringify(args));
        return this.rawQuery(sql, args);
    };
    
    SQLiteDatabase.execSQL.overload('java.lang.String').implementation = function(sql) {
        console.log("[SQL.exec] " + sql);
        this.execSQL(sql);
    };
});
```

---

###### 脱壳 Hook

###### 通用 DEX Dump

```javascript
Java.perform(function() {
    Java.enumerateClassLoaders({
        onMatch: function(loader) {
            try {
                var pathList = Java.cast(loader, Java.use("dalvik.system.BaseDexClassLoader")).pathList.value;
                var dexElements = pathList.dexElements.value;
                for (var i = 0; i < dexElements.length; i++) {
                    var dexFile = dexElements[i].dexFile.value;
                    if (dexFile) {
                        console.log("[DEX] " + dexFile.getName());
                        // 可以进一步 dump dex 内容
                    }
                }
            } catch(e) {}
        },
        onComplete: function() {}
    });
});
```

###### Hook ClassLoader.loadClass

```javascript
Java.perform(function() {
    var ClassLoader = Java.use("java.lang.ClassLoader");
    ClassLoader.loadClass.overload('java.lang.String').implementation = function(name) {
        if (name.indexOf("com.target") !== -1) {
            console.log("[ClassLoader] " + name);
        }
        return this.loadClass(name);
    };
});
```

---

###### 实用工具函数

```javascript
// 字节数组转十六进制
function bytesToHex(bytes) {
    if (!bytes) return "null";
    var hex = [];
    for (var i = 0; i < bytes.length; i++) {
        hex.push(('0' + (bytes[i] & 0xFF).toString(16)).slice(-2));
    }
    return hex.join('');
}

// 打印调用栈
function printStack() {
    console.log(Java.use("android.util.Log").getStackTraceString(
        Java.use("java.lang.Throwable").$new()));
}

// 打印对象所有字段
function printFields(obj) {
    var fields = obj.class.getDeclaredFields();
    fields.forEach(function(field) {
        field.setAccessible(true);
        try {
            console.log("  " + field.getName() + " = " + field.get(obj));
        } catch(e) {}
    });
}

// 搜索内存中的类实例
function findInstances(className) {
    Java.choose(className, {
        onMatch: function(instance) {
            console.log("[Instance] " + instance);
            printFields(instance);
        },
        onComplete: function() {}
    });
}
```

---

###### 参考资源

| 资源 | 说明 | 链接 |
|------|------|------|
| Frida 官方文档 | API 参考 | https://frida.re/docs/ |
| Frida CodeShare | 社区脚本分享 | https://codeshare.frida.re/ |
| awesome-frida | 资源大全 | https://github.com/dweinstein/awesome-frida |
| frida-codeshare-scripts | 全网最全脚本收集 | https://github.com/zengfr/frida-codeshare-scripts |
| Objection | Frida 封装工具 | https://github.com/sensepost/objection |
| r2frida | radare2 + Frida 集成 | https://github.com/nowsecure/r2frida |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`frida`、`objection`、`apktool`、`jadx`、`ghidra`
- `frida`：`python -m pip install frida-tools`
- `objection`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `apktool`：官方只发 `apktool_<ver>.jar`（需 java）；装上后 `java -jar apktool.jar d <apk>`
- `jadx`：官方发 `jadx-gui-<ver>-win.zip`（Java 启动器，需 java）
- `ghidra`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`mobile-reverse`

2. **前提没满足就先回去**：`mobile-reverse` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-android-hooking`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`mobile-reverse`
- **下游**（产出交给谁）：`competition-android-hooking`
- **专项下游**（同主题更深的靶子面）：`competition-android-hooking`
- **互补**（同类场景一起用）：`mobile-reverse`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
