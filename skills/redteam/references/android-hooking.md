# Android Hook：Xposed vs Frida、Java/Native 层与时机

> 被 `competition-android-hooking` 引用。选错层级是最常见的浪费：
> **Java 层能解决的不要写 native hook**，反过来 pinning 在 native 时 Java hook 一定无效。

## 一、框架选择矩阵

| 维度 | Xposed / LSPosed | Frida | 静态 patch |
| --- | --- | --- | --- |
| 需要 root | 是（LSPosed 需 Magisk） | 否（gadget） | 否 |
| 生效范围 | 全局（所有 app 的指定类） | 单进程 | 单包 |
| 时机 | app 启动前（更早） | spawn 可做到 | 永久 |
| 稳定性 | 高（进程内 dylib） | 中（inline hook 易崩） | 高 |
| 反检测 | LSPosed 可隐藏 | 需改名/patch | 无注入痕迹 |
| 开发速度 | 慢（要写模块、编译、刷入） | **快**（热加载脚本） | 中（要重打包） |
| 适合 | 长期/多 app | **探索与一次性** | 交付/演示 |

```text
选择规则：
  1. 一次性的分析 → Frida
  2. 需要"每次启动都生效"且不想每次连电脑 → Xposed 模块 / 静态 patch
  3. 目标检测 frida → gadget（改名）或静态 patch
  4. 只改一个常量/判断 → 静态 patch（apktool + smali）最省事
```

## 二、Java 层 hook：签名必须精确

### 2.1 重载是头号坑

```java
// 目标代码
public String encrypt(String data) { ... }
public String encrypt(String data, String key) { ... }
public byte[] encrypt(byte[] data) { ... }
```

```javascript
// Frida 里必须指定重载
Java.perform(function () {
  var C = Java.use("com.target.Crypto");

  // 单参数 String 版
  C.encrypt.overload('java.lang.String').implementation = function (s) {
    console.log("[encrypt(String)] " + s);
    var r = this.encrypt(s);
    console.log("  -> " + r);
    return r;
  };

  // 双参数版
  C.encrypt.overload('java.lang.String', 'java.lang.String').implementation = function (s, k) {
    console.log("[encrypt(String,String)] data=" + s + " key=" + k);
    return this.encrypt(s, k);
  };

  // byte[] 版
  C.encrypt.overload('[B').implementation = function (b) {
    console.log("[encrypt(byte[])] " + bytesToHex(b));
    return this.encrypt(b);
  };
});
```

| Java 类型 | Frida 签名写法 |
| --- | --- |
| `String` | `'java.lang.String'` |
| `int` | `'int'` |
| `long` | `'long'` |
| `boolean` | `'boolean'` |
| `byte[]` | `'[B'` |
| `String[]` | `'[Ljava.lang.String;'` |
| `Object` | `'java.lang.Object'` |
| 自定义类 | `'com.target.Foo'` |
| `List<String>` | `'java.util.List'`（泛型擦除） |

```javascript
// 不确定签名时：先打印所有重载
Java.perform(function () {
  Java.use("com.target.Crypto").encrypt.overloads.forEach(function (o) {
    console.log(o.toString());       // e.g. "encrypt(java.lang.String): java.lang.String"
  });
});
```

### 2.2 构造器与字段

```javascript
Java.perform(function () {
  var C = Java.use("com.target.Session");

  // 构造器（$init）
  C.$init.overload('java.lang.String', 'int').implementation = function (a, b) {
    console.log("[ctor] " + a + " " + b);
    return this.$init(a, b);
  };

  // 实例字段（私有也可）
  var inst = C.$new("x", 1);
  console.log(inst.token.value);

  // 静态字段
  console.log(C.sSecretKey.value);
  C.sSecretKey.value = "patched";

  // 静态方法
  console.log(C.getKey());
});
```

### 2.3 hook 时机：类加载

```javascript
// 问题：Java.use 时类还没加载 → ClassNotFoundException
// 方案 1：Java.perform 内延迟重试
function hookWhenReady(clsName, fn, tries) {
  tries = tries || 50;
  Java.perform(function () {
    try {
      fn(Java.use(clsName));
      console.log("[+] hooked " + clsName);
    } catch (e) {
      if (tries > 0) setTimeout(function () { hookWhenReady(clsName, fn, tries - 1); }, 200);
      else console.log("[-] give up " + clsName + ": " + e);
    }
  });
}

// 方案 2：监听 ClassLoader.loadClass（更早、更准）
Java.perform(function () {
  var CL = Java.use("java.lang.ClassLoader");
  CL.loadClass.overload('java.lang.String').implementation = function (name) {
    var c = this.loadClass(name);
    if (name === "com.target.Crypto") {
      console.log("[+] class loaded: " + name);
      // 在这里立即 hook
    }
    return c;
  };
});
```

## 三、Native 层 hook

### 3.1 inline hook（Interceptor）

```javascript
// 导出函数
var fn = Module.findExportByName("libtarget.so", "Java_com_target_Native_sign");
Interceptor.attach(fn, {
  onEnter(args) {
    // JNI 函数：args[0]=JNIEnv*, args[1]=jobject/jclass, args[2..]=Java 参数
    var jstr = Java.vm.getEnv().getStringUtfChars(args[2], null).readCString();
    console.log("[JNI sign] input=" + jstr);
  },
  onLeave(ret) { console.log("  ret=" + ret); }
});
```

```javascript
// 内部函数（按基址 + 偏移）
var base = Module.findBaseAddress("libtarget.so");
console.log("base=" + base);
// 偏移来自 IDA：0x1A2B4
var target = base.add(0x1a2b4);
Interceptor.attach(target, {
  onEnter(args) {
    this.p0 = args[0];
    this.n  = args[1].toInt32();
    console.log("[internal] n=" + this.n);
  },
  onLeave(ret) {
    console.log(hexdump(this.p0, { length: Math.min(this.n, 64) }));
  }
});
```

**ARM32 Thumb 位**：`base.add(off)` 若是 Thumb 函数，Frida 会自动处理（新版本），
但 `Memory` 读取代码时要 `off & ~1`。

### 3.2 PLT/GOT hook（稳定但只覆盖外部调用）

```javascript
// Android 的 GOT 在 .got.plt；用 Frida 可以直接改函数指针
var base = Module.findBaseAddress("libtarget.so");
var got = base.add(0x3f90);            // 静态分析拿到的 GOT 槽
var orig = got.readPointer();
console.log("orig target: " + orig);

var fake = new NativeCallback(function (a, b) {
  return 0;
}, 'int', ['pointer', 'pointer']);

Memory.protect(got, Process.pageSize, 'rwx');
got.writePointer(fake);
```

| 方式 | 覆盖 | 稳定性 | 检测面 |
| --- | --- | --- | --- |
| inline（Interceptor） | 任意函数 | 中（短函数易崩） | 高（改代码段） |
| PLT/GOT | 跨模块调用 | 高 | 低（只改数据段） |
| `Interceptor.replace` | 整个实现 | 高（但要重写逻辑） | 中 |
| 静态 patch（改 so） | 任意 | 最高 | 无（但要重签） |

### 3.3 so 加载时机（决定成败）

```javascript
// 方法 A：android_dlopen_ext（Android 特有，最可靠）
var ext = Module.findExportByName(null, "android_dlopen_ext");
Interceptor.attach(ext, {
  onEnter(args) { this.path = args[0].readCString(); },
  onLeave(ret) {
    if (this.path && this.path.indexOf("libtarget.so") >= 0) {
      console.log("[dlopen] " + this.path + " loaded");
      hookLib();
    }
  }
});

// 方法 B：dlopen（通用）
var dlopen = Module.findExportByName(null, "dlopen");
if (dlopen) {
  Interceptor.attach(dlopen, {
    onEnter(args) { this.path = args[0].readCString(); },
    onLeave(ret) {
      if (this.path && this.path.indexOf("libtarget.so") >= 0) hookLib();
    }
  });
}

// 方法 C：轮询（探索时最省事）
var t = setInterval(function () {
  if (Module.findBaseAddress("libtarget.so")) { clearInterval(t); hookLib(); }
}, 50);
```

**注意 `System.loadLibrary` 与 `dlopen` 的关系**：
`System.loadLibrary("target")` 最终会调 `android_dlopen_ext("libtarget.so", ...)`，
所以 hook `android_dlopen_ext` 能拿到**绝对路径**，比 hook `loadLibrary` 更准。

## 四、常见 Hook 目标清单（按场景）

| 场景 | Java 层目标 | Native 层目标 |
| --- | --- | --- |
| 签名校验 | `PackageManager.getPackageInfo`（GET_SIGNATURES） | `EVP_DigestVerify*`、自定义 hash |
| Pinning | `X509TrustManager.checkServerTrusted`、`CertificatePinner.check` | `SSL_CTX_set_verify`、`SSL_get_verify_result` |
| Root 检测 | `File.exists`、`RootBeer.isRooted` | `access`、`stat`、`openat` |
| 加密 | `Cipher.doFinal`、`Mac.doFinal` | `AES_encrypt`、`EVP_EncryptUpdate` |
| 请求签名 | 自定义 `SignUtil.sign` | `HMAC`、`EVP_DigestSign` |
| 设备指纹 | `TelephonyManager.getDeviceId`、`Settings.Secure.getString` | `__system_property_get` |
| 反调试 | `Debug.isDebuggerConnected` | `ptrace` |
| 数据存储 | `SharedPreferencesImpl.getString` | — |
| 反 hook | `Class.forName("de.robv...XposedBridge")` | 扫 `/proc/self/maps` |

```javascript
// 通用"看所有 Java 层网络出口"
Java.perform(function () {
  try {
    var OkHttpClient = Java.use("okhttp3.OkHttpClient$Builder");
    // 更实用：hook RealCall
    var RealCall = Java.use("okhttp3.internal.connection.RealCall");
    RealCall.execute.implementation = function () {
      var r = this.request();
      console.log("[http] " + r.method() + " " + r.url().toString());
      var resp = this.execute();
      console.log("[http] <- " + resp.code());
      return resp;
    };
  } catch (e) { console.log("okhttp not used: " + e); }

  try {
    var HttpURLConnection = Java.use("java.net.HttpURLConnection");
    HttpURLConnection.getInputStream.implementation = function () {
      console.log("[http] url=" + this.getURL().toString());
      return this.getInputStream();
    };
  } catch (e) {}
});
```

## 五、绕过 hook 检测

| 检测 | 实现 | 反制 |
| --- | --- | --- |
| Xposed 类存在 | `Class.forName("de.robv.android.xposed.XposedBridge")` | LSPosed 隐藏；hook `Class.forName` 抛 CNFE |
| 方法被改 | 反射读 `Method` 的 `artMethod` 入口，比对预期 | 难；换 native hook |
| `/proc/self/maps` 含 frida | 扫 maps | 改 frida-agent 名；hook `open`/`read` |
| 线程名 | `/proc/self/task/*/comm` 含 `gum`/`gmain` | patch frida |
| 端口 | 27042 | 换端口 |
| JNI 调用异常 | 检查 `Method` 的 `accessFlags` | 静态 patch 更隐蔽 |
| 内存完整性 | 校验代码段 hash | 静态 patch 或 hook 校验函数 |

```javascript
// 反制"Class.forName 检测"（示例）
Java.perform(function () {
  var Class = Java.use("java.lang.Class");
  Class.forName.overload('java.lang.String').implementation = function (name) {
    if (/xposed|substrate|frida/i.test(name)) {
      console.log("[hide] Class.forName(" + name + ") -> CNFE");
      throw Java.use("java.lang.ClassNotFoundException").$new(name);
    }
    return this.forName(name);
  };
});
```

## 六、常见崩溃原因（按频率）

| 崩溃 | 原因 | 修法 |
| --- | --- | --- |
| `SIGSEGV` 在 hook 点 | 短函数 inline hook 覆盖了相邻函数 | 用 `replace` 或 hook 调用方 |
| `SIGILL` | ARM32 Thumb 位错 | 地址 +1 或 -1 试 |
| `java.lang.ClassNotFoundException` | 类未加载 | 延迟重试 / 监听 loadClass |
| `has more than one overload` | 未指定重载 | `.overload(...)` |
| `expected a pointer` | 参数类型判断错 | `args[i].toInt32()` |
| 返回值被当指针解引用 | `null` 返回 | 先判空再 `readCString` |
| hook 后 app 走假逻辑 | 检测到 hook 后降级 | 先过检测再 hook |
| `Fatal signal 11` 无堆栈 | inline hook 破坏了栈 | 换 PLT hook |

```javascript
// 崩溃最小化：一次只 hook 一个函数，逐步加
// 用 try/catch 包住每个 hook，避免一个失败影响全部
function safeHook(desc, fn) {
  try { fn(); console.log("[+] " + desc); }
  catch (e) { console.log("[-] " + desc + ": " + e); }
}
```

## 七、Xposed 模块最小骨架

```java
// build.gradle: compileOnly 'de.robv.android.xposed:api:82'
public class Hook implements IXposedHookLoadPackage {
    @Override
    public void handleLoadPackage(LoadPackageParam lpparam) {
        if (!lpparam.packageName.equals("com.target.app")) return;

        XposedHelpers.findAndHookMethod(
            "com.target.Crypto", lpparam.classLoader,
            "encrypt", String.class,
            new XC_MethodHook() {
                @Override
                protected void beforeHookedMethod(MethodHookParam param) {
                    XposedBridge.log("[hook] encrypt(" + param.args[0] + ")");
                }
                @Override
                protected void afterHookedMethod(MethodHookParam param) {
                    XposedBridge.log("[hook] -> " + param.getResult());
                    // param.setResult("patched");     // 改返回值
                }
            });
    }
}
```

| Xposed API | 用途 |
| --- | --- |
| `findAndHookMethod` | 按类名+方法名+参数类型 hook |
| `findAndHookConstructor` | 构造器 |
| `XposedHelpers.getObjectField` | 读字段 |
| `XposedHelpers.setObjectField` | 写字段 |
| `XposedHelpers.callMethod` | 动态调用 |
| `XposedBridge.hookAllMethods` | 所有同名重载 |
| `param.setResult(...)` | 改返回值 |
| `param.args[i] = ...` | 改参数 |
| `XC_MethodReplacement` | 完全替换实现 |

## 八、静态 patch（最隐蔽）

```bash
# 1) 反编译
apktool d app.apk -o dec

# 2) 定位 smali（按字符串/类名）
grep -rn "isRooted\|checkSign" dec/smali*/ | head

# 3) 改 smali（例：方法直接返回 true）
#    原：.method public isPremium()Z ... .end method
#    改：.method public isPremium()Z
#        .registers 1
#        const/4 v0, 0x1
#        return v0
#    .end method

# 4) 重打包 + 重签（v2 必须）
apktool b dec -o patched.apk
apksigner sign --ks my.keystore --ks-pass pass:test patched.apk
adb install -r patched.apk
```

| 目标 | smali 改法 |
| --- | --- |
| 返回 true | `const/4 v0, 0x1` + `return v0` |
| 返回 false | `const/4 v0, 0x0` + `return v0` |
| 返回字符串 | `const-string v0, "x"` + `return-object v0` |
| 跳过判断 | 把 `if-eqz` 改成 `goto` |
| 删方法调用 | 用 `#` 注释或删 `invoke-*`（注意栈平衡） |

## 九、检测视角（防守方）

| 动作 | 信号 |
| --- | --- |
| Xposed | `XposedBridge` 类；`/system/framework/XposedBridge.jar`；`app_process` 参数含 `de.robv` |
| Frida | 端口/进程/线程名/maps |
| gadget 重打包 | APK 签名变化；多出 so；`System.loadLibrary` 调用陌生名 |
| 静态 patch | 签名 hash 变化（服务端可校验）；dex checksum |
| hook 系统 API | 频繁调用异常（如 `getPackageInfo` 被高频调用） |
| 抓包 | 证书链异常；JA3 指纹 |

## 十、验伤信号

| 声称 | 证据 |
| --- | --- |
| "hook 生效" | 目标方法的**真实参数**被打印（不是脚本启动日志） |
| "过了签名校验" | app 走完原本被拦的流程（服务端返回业务数据） |
| "拿到密钥" | 密钥字节 + 算法 + 使用点（三者齐） |
| "native hook 成功" | `onEnter` 打印了参数、`onLeave` 打印了返回，且 app 未崩 |

**反例（看起来成功其实是假）**：

- 脚本打印 "[+] hooked X" 但无调用日志 → 方法从未执行（路径不对/类不对）
- hook 了 `encrypt(String)` 但 app 用 `encrypt(byte[])` → 打印为空，误判"没有加密"
- `setResult(true)` 后 app 崩溃 → 返回类型不匹配（`Z` vs `I`）
- native hook 成功但 pinning 仍失败 → 校验在 Java 层（`CertificatePinner`），没 hook 对

## 十一、常见坑

1. **不指定重载**——最普遍。先 `.overloads.forEach(print)` 再写 hook。
2. **hook 太晚**——`MainActivity.onCreate` 才 hook，早期检测已跑完。
   要在 Application/ContentProvider 阶段。
3. **so 未加载就 hook**——`findExportByName` 返回 null，脚本静默失败。
4. **改返回值类型错**——`boolean` 返回 `1` 用 `'int'` 会留垃圾高位；
   `void` 方法 `setResult` 会崩。
5. **一次 hook 太多**——崩了不知道是哪个。`safeHook` 逐个加。
6. **Xposed 与 Frida 混用**——两者 hook 同一方法会互相覆盖，行为不可预测。
7. **静态 patch 忘重签 v2**——Android 7+ 直接拒装。