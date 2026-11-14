# Frida 与 Objection 深度用法

> 被 `mobile-reverse` 引用。Frida 的难点不在"写 hook 脚本"，
> 而在**注入稳定性**：spawn 时机、多线程、JNI 注册、崩溃定位。

## 一、部署：三种模式与选择

| 模式 | 前提 | 稳定性 | 检测面 |
| --- | --- | --- | --- |
| **frida-server**（root/越狱） | root / jailbreak | 高 | 进程/端口/线程可被扫到 |
| **frida-gadget**（免 root） | 能重打包重签 | 中 | so 名可改，难以按名检测 |
| **frida-gadget + 注入 loader** | 同上 | 中 | 需处理加载时机 |
| attach（已运行进程） | server 在跑 | 中（可能已过关键初始化） | 同上 |
| spawn（启动即挂） | server 在跑 | **高（推荐）** | 同上 |

### 1.1 Android frida-server

```bash
# 1) 确认设备架构
adb shell getprop ro.product.cpu.abi       # arm64-v8a / armeabi-v7a / x86_64
adb shell uname -m

# 2) 下载对应 server（版本必须与本地 frida 完全一致）
pip show frida | grep Version              # 本地版本
# 从 GitHub releases 下 frida-server-<ver>-android-arm64.xz
unxz frida-server-16.2.1-android-arm64.xz

# 3) 推送并启动
adb push frida-server-16.2.1-android-arm64 /data/local/tmp/frida-server
adb shell "su -c 'chmod 755 /data/local/tmp/frida-server'"
adb shell "su -c '/data/local/tmp/frida-server -l 0.0.0.0:27042 &'"

# 4) 验证
frida-ps -U                # 列进程
frida-ps -H 192.168.1.20:27042    # 远程设备
```

**版本不匹配的典型报错**：

| 报错 | 原因 |
| --- | --- |
| `Failed to load frida-agent: unable to connect to remote frida-server` | 版本不一致或 server 没起 |
| `unable to find a usable frida-agent` | 架构不对（把 arm64 推到 armeabi 设备） |
| `frida-server is not running` | SELinux 拦截 / 权限不足 |

### 1.2 frida-gadget（免 root，适合重打包）

```bash
# 1) 取 gadget（与本地 frida 同版本）
#    frida-gadget-16.2.1-android-arm64.so.xz

# 2) 放进 APK 的 lib 目录
mkdir -p lib/arm64-v8a
cp frida-gadget-16.2.1-android-arm64.so lib/arm64-v8a/libgadget.so
# 3) 配置（可选，指定脚本与交互方式）
cat > lib/arm64-v8a/libgadget.config.so <<'EOF'
{
  "interaction": {
    "type": "script",
    "path": "/data/local/tmp/hook.js",
    "on_change": "reload"
  }
}
EOF

# 4) 让 app 加载它：在 smali 的入口加 System.loadLibrary("gadget")
#    或改 Application 的 <clinit>
# 5) 重打包重签
apktool b app_decoded -o app-gadget.apk
apksigner sign --ks my.keystore app-gadget.apk
adb install -r app-gadget.apk
```

**Gadget 的加载时机陷阱**：

```text
□ System.loadLibrary 必须在 "被检测之前" 执行
  → 放在 Application.attachBaseContext 最前
□ 有些 app 有 <clinit> 里的早期检测（早于 Application）
  → 放在 ContentProvider.onCreate（最先执行的组件）
□ 若放在 MainActivity.onCreate，早期检测已跑完 → 太晚
```

### 1.3 Objection patchapk（全自动）

```bash
pip install objection
objection patchapk --source app.apk \
  --architecture arm64-v8a \
  --skip-resources \
  --ignore-crc-error
# 产物：app.objection.apk（已含 gadget + 重签）
adb install -r app.objection.apk
objection -g com.target.app explore
```

## 二、脚本注入模式：spawn vs attach

| 对比 | spawn (`-f`) | attach |
| --- | --- | --- |
| 时机 | 进程创建即挂，早于一切代码 | 进程已运行 |
| 覆盖 | 能看到初始化、早期检测、类加载 | 错过早期逻辑 |
| 稳定性 | 需要正确 resume | 简单 |
| 适用 | 有早期检测、有 `System.loadLibrary` 时机要求 | 交互式探索 |

```bash
# spawn（推荐）
frida -U -f com.target.app -l hook.js --no-pause
#   --no-pause：立即恢复主线程（否则停在启动处，需 frida 里 %resume）
#   若不加 --no-pause：frida 控制台输入 %resume

# attach
frida -U -n "Target App" -l hook.js
frida -U -p 12345 -l hook.js           # 按 pid

# 只跑脚本不交互（CI 场景）
frida -U -f com.target.app -l hook.js --no-pause -q
```

**spawn 的常见失败**：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| app 卡在启动画面 | 没 `%resume` 或没 `--no-pause` | 加 `--no-pause` |
| 脚本报 `Java is not defined` | 太早（class loader 还没建好） | 用 `Java.perform` + `setTimeout` |
| 一挂就崩 | hook 了系统关键函数（如 `ClassLoader.loadClass` 太早） | 用 `Java.perform` 内部延迟 |
| 检测到后自杀 | 早期 anti-frida | 换 gadget / 改名 |

## 三、Java 层 hook：正确写法

### 3.1 重载方法必须指定签名

```javascript
Java.perform(function () {
  var Cipher = Java.use("javax.crypto.Cipher");

  // 错：有多个重载会抛 "has more than one overload"
  // Cipher.init.implementation = function(...) {}

  // 对：用 .overload() 精确匹配
  Cipher.init.overload('int', 'java.security.Key').implementation = function (mode, key) {
    console.log("[Cipher.init] mode=" + mode + " key=" + bytesToHex(key.getEncoded()));
    return this.init(mode, key);
  };

  // 无参数方法
  var Build = Java.use("android.os.Build");
  console.log("MODEL =", Build.MODEL.value);
});
```

```javascript
// 辅助：把 byte[] 转 hex
function bytesToHex(bytes) {
  var arr = Java.array('byte', bytes);
  var out = "";
  for (var i = 0; i < arr.length; i++) {
    out += ("0" + (arr[i] & 0xff).toString(16)).slice(-2);
  }
  return out;
}

// 打印所有重载（不知道签名时先看）
Java.perform(function () {
  var C = Java.use("com.target.Crypto");
  C.encrypt.overloads.forEach(function (o) {
    console.log(o.toString());     // 会打印参数类型
  });
});
```

### 3.2 构造对象与调用私有方法

```javascript
Java.perform(function () {
  var Cls = Java.use("com.target.Secret");
  // 调静态方法
  console.log(Cls.getKey());

  // 构造实例（指定构造器重载）
  var inst = Cls.$new("arg1");
  // 调实例方法
  console.log(inst.decrypt("ciphertext"));

  // 访问字段（公开/私有都可）
  console.log(inst.key.value);

  // 改字段
  inst.key.value = "newkey";
});
```

### 3.3 枚举已加载类（找不到类时）

```javascript
Java.perform(function () {
  Java.enumerateLoadedClasses({
    onMatch: function (name) {
      if (name.indexOf("target") >= 0) console.log(name);
    },
    onComplete: function () { console.log("done"); }
  });
});

// 动态加载的 dex（DexClassLoader）里的类也能被枚举到
```

## 四、Native 层 hook

### 4.1 导出函数与内部地址

```javascript
// 导出函数（按名字）
var open = Module.findExportByName("libc.so", "open");
Interceptor.attach(open, {
  onEnter(args) {
    this.path = args[0].readCString();
    console.log("[open] " + this.path);
  },
  onLeave(ret) { console.log("  -> " + ret); }
});

// 内部函数（按模块基址 + 偏移，偏移来自 IDA/Ghidra）
var base = Module.findBaseAddress("libtarget.so");
var fn = base.add(0x1a2b4);              // 静态分析得到的偏移
Interceptor.attach(fn, {
  onEnter(args) {
    console.log("arg0=" + args[0].toInt32());
    console.log("arg1(str)=" + args[1].readCString());
    this.buf = args[2];
  },
  onLeave(ret) {
    console.log("ret=" + ret.toInt32());
    console.log(hexdump(this.buf, { length: 32 }));
  }
});
```

**注意 thumb 位（ARM32）**：内部函数地址若是 Thumb 指令，实际地址 = `base + off + 1`（LSB 置 1），
否则 `Interceptor.attach` 会报错或崩溃。

### 4.2 inline hook vs PLT hook

| 方式 | 实现 | 优点 | 缺点 |
| --- | --- | --- | --- |
| `Interceptor.attach`（inline） | 改写函数头部指令 | 任意函数、参数全可见 | 短函数/热路径易崩；有检测面 |
| `Interceptor.replace` | 整函数替换 | 完全控制返回 | 需重新实现全部逻辑 |
| PLT/GOT hook | 改 GOT 槽 | 简单、稳定 | 只覆盖外部调用 |
| `Module.getExportByName` + `replace` | 导出函数专用 | 最稳 | 只对导出 |

```javascript
// replace 的正确姿势（必须保持签名一致）
var strcmp = Module.findExportByName(null, "strcmp");
Interceptor.replace(strcmp, new NativeCallback(function (a, b) {
  var sa = a.readCString(), sb = b.readCString();
  console.log("[strcmp] " + sa + " vs " + sb);
  return 0;                             // 永远相等
}, 'int', ['pointer', 'pointer']));
```

```javascript
// PLT/GOT hook（改内存里的函数指针）
// 需要知道 GOT 槽地址（静态分析拿）与目标模块基址
var base = Module.findBaseAddress("libtarget.so");
var got_slot = base.add(0x3f90);         // .got.plt 中的某项
var orig = got_slot.readPointer();       // 原始目标
var hook = new NativeCallback(function (a, b) {
  return 0;
}, 'int', ['pointer', 'pointer']);
Memory.protect(got_slot, Process.pageSize, 'rwx');
got_slot.writePointer(hook);
```

### 4.3 so 加载时机（最常见的失败）

```javascript
// 问题：脚本跑的时候 so 还没加载 → Module.findBaseAddress 返回 null
// 解决 1：监听 dlopen
var dlopen = Module.findExportByName(null, "dlopen");
Interceptor.attach(dlopen, {
  onEnter(args) { this.path = args[0].readCString(); },
  onLeave(ret) {
    if (this.path && this.path.indexOf("libtarget.so") >= 0) {
      console.log("[dlopen] loaded " + this.path);
      hookTarget();           // 此时再 hook
    }
  }
});

// 解决 2：android_dlopen_ext（Android 常用）
var ext = Module.findExportByName(null, "android_dlopen_ext");
if (ext) {
  Interceptor.attach(ext, {
    onEnter(args) { this.path = args[0].readCString(); },
    onLeave(ret) {
      if (this.path && this.path.indexOf("libtarget.so") >= 0) hookTarget();
    }
  });
}

// 解决 3：轮询（简单粗暴，适合探索）
var timer = setInterval(function () {
  if (Module.findBaseAddress("libtarget.so")) {
    clearInterval(timer);
    hookTarget();
  }
}, 100);
```

```javascript
// 解决 4：hook JNI_OnLoad（so 的初始化入口）
//   JNI_OnLoad 在 so 里，需先拿到地址
//   若无法提前拿，用 android_dlopen_ext 的 onLeave + 立即 attach
```

## 五、内存读写与搜索

```javascript
// 读内存
var p = Module.findBaseAddress("libtarget.so").add(0x2000);
console.log(hexdump(p, { length: 64, ansi: true }));

// 写内存（需改保护属性）
Memory.protect(p, 16, 'rwx');
p.writeByteArray([0x90, 0x90]);

// 分配 + 写入
var buf = Memory.alloc(0x100);
buf.writeUtf8String("hello");
buf.add(0x20).writeU32(0xdeadbeef);

// 在模块范围内搜字节（如找 key）
var ranges = Process.enumerateRanges('r--');
var pattern = "41 42 43 00";
ranges.forEach(function (r) {
  try {
    var m = Memory.scanSync(r.base, r.size, pattern);
    if (m.length) console.log(JSON.stringify(m));
  } catch (e) {}
});

// 非对齐扫描（自定义）
Memory.scan(ptr("0x7000000000"), 0x100000, "48 8b ?? 05", {
  onMatch(address, size) { console.log("hit " + address); },
  onComplete() { console.log("scan done"); }
});
```

```javascript
// Java 堆上的字符串搜索（找运行时解密的字符串）
Java.perform(function () {
  Java.choose("java.lang.String", {
    onMatch: function (s) {
      var v = s.toString();
      if (v.indexOf("http") >= 0 || v.indexOf("token") >= 0) console.log(v);
    },
    onComplete: function () {}
  });
});
```

## 六、Objection 常用命令

```bash
objection -g com.target.app explore
```

| 命令 | 作用 |
| --- | --- |
| `android root disable` | 绕过常见 root 检测 |
| `android sslpinning disable` | 绕过 Java 层 pinning |
| `ios jailbreak disable` | 绕过越狱检测 |
| `ios sslpinning disable` | iOS pinning 绕过 |
| `android hooking list activities` | 列 Activity |
| `android hooking list services` | 列 Service |
| `android hooking list receivers` | 列 Receiver |
| `android hooking list classes` | 列已加载类（可 grep） |
| `android hooking search classes <kw>` | 按关键词搜类 |
| `android hooking search methods <kw>` | 按关键词搜方法 |
| `android hooking watch class <cls>` | 监视类所有方法调用 |
| `android hooking watch method <sig> --dump-args --dump-return` | 监视单方法 |
| `android keystore list` | 列 keystore 条目 |
| `android keystore clear` | 清空（慎用） |
| `ios keychain dump` | dump keychain |
| `env` | 看应用环境（路径、SDK） |
| `ls` / `cd` / `pwd` | 浏览应用沙箱（不是设备） |
| `sqlite connect <db>` | 连 sqlite |
| `memory list modules` | 列模块 |
| `memory list exports <module>` | 列导出 |
| `memory search --string <s>` | 内存搜字符串 |
| `file download <remote> <local>` | 从沙箱下载文件 |
| `android intent launch_activity <act>` | 启动 activity |

```bash
# 非交互式（脚本化）
objection -g com.target.app explore -s "android sslpinning disable"
# 或
objection -g com.target.app run "android root disable"
```

## 七、调试崩溃：Frida 脚本挂了怎么定位

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `Error: expected a pointer` | 参数不是指针（如 int 传成了 pointer） | 用 `args[i].toInt32()` |
| `TypeError: cannot read property 'readCString' of null` | 参数是 NULL | 先判空 |
| `java.lang.ClassNotFoundException` | 类还没加载 / 名字拼错 | `Java.perform` + 延迟 / `Java.enumerateLoadedClasses` |
| `Error: has more than one overload` | 未指定重载 | `.overload(...)` |
| `Process crashed: SIGSEGV` | hook 破坏了函数（短函数 inline 失败） | 换 `replace` 或 hook 调用方 |
| `Failed to find module` | so 未加载 | 用 dlopen 监听 |
| 脚本执行但没输出 | hook 点没被调用 | 确认路径真的走到（加日志在更外层） |

```javascript
// 崩溃定位：缩小 hook 范围
// 1) 先只 hook 一个函数，确认稳定
// 2) 逐个加 hook，找到引发崩溃的那个
// 3) 用 Stalker 追踪调用流（慎用，极慢）
Stalker.follow(Process.getCurrentThreadId(), {
  events: { call: true, ret: true },
  onReceive(events) { /* 解析 */ }
});
```

## 八、脚本模板（可直接改）

```javascript
// template.js —— 移动端通用侦察 + 关键 hook
Java.perform(function () {
  console.log("[*] frida attached, pid=" + Process.id);
  console.log("[*] arch=" + Process.arch + " pointerSize=" + Process.pointerSize);

  // ---- 1. 环境信息 ----
  try {
    var Build = Java.use("android.os.Build");
    console.log("[env] MODEL=" + Build.MODEL.value + " SDK=" + Build.VERSION.SDK_INT.value);
  } catch (e) {}

  // ---- 2. 网络出口（Java）----
  try {
    var OkHttpClient = Java.use("okhttp3.OkHttpClient");
    var RealCall = Java.use("okhttp3.internal.connection.RealCall");
    RealCall.execute.implementation = function () {
      var req = this.request();
      console.log("[http] " + req.method() + " " + req.url().toString());
      var resp = this.execute();
      console.log("[http] <- " + resp.code());
      return resp;
    };
  } catch (e) { console.log("[!] okhttp hook skipped: " + e); }

  // ---- 3. 加密 ----
  try {
    var Cipher = Java.use("javax.crypto.Cipher");
    Cipher.getInstance.overload("java.lang.String").implementation = function (algo) {
      console.log("[crypto] Cipher.getInstance(" + algo + ")");
      return this.getInstance(algo);
    };
    Cipher.doFinal.overload("[B").implementation = function (data) {
      var out = this.doFinal(data);
      console.log("[crypto] doFinal in=" + bytesToHex(data) + " out=" + bytesToHex(out));
      return out;
    };
  } catch (e) {}

  // ---- 4. 字符串构造（抓运行时解密）----
  try {
    var SB = Java.use("java.lang.StringBuilder");
    SB.toString.implementation = function () {
      var s = this.toString();
      if (s.length > 8 && /^[A-Za-z0-9+\/=]{16,}$/.test(s)) console.log("[str] " + s);
      return s;
    };
  } catch (e) {}
});

// ---- 5. Native 出口 ----
function hookNative() {
  var connect = Module.findExportByName(null, "connect");
  if (connect) {
    Interceptor.attach(connect, {
      onEnter(args) {
        var sa = args[1];
        var fam = sa.readU16();
        if (fam === 2) {
          var port = (sa.add(2).readU8() << 8) | sa.add(3).readU8();
          var ip = [0,1,2,3].map(i => sa.add(4+i).readU8()).join(".");
          console.log("[net] connect " + ip + ":" + port);
        }
      }
    });
  }
}
setTimeout(hookNative, 0);
```

## 九、检测视角（防守方）

| 红队动作 | 可见信号 |
| --- | --- |
| frida-server 运行 | 进程名/端口 27042/线程名 `gum-js-loop` |
| 注入 | `/proc/<pid>/maps` 出现 `frida-agent`/`linjector`；`/proc/<pid>/task/*/comm` 异常 |
| hook 系统调用 | inline hook 会改 libc 头部字节（完整性校验可发现） |
| Gadget | 打包内多出 `.so`；签名变化；`System.loadLibrary` 调用陌生库 |
| 内存扫描 | `memmem`/`strstr` 扫描路径异常 |
| 证书绕过 | 服务端 JA3/TLS 指纹变化；证书链异常 |

## 十、验伤信号

| 声称 | 证据 |
| --- | --- |
| "hook 生效" | 目标函数被调用时**打印出真实参数/返回值**（不是脚本启动日志） |
| "抓到明文流量" | 完整的 URL + body + 响应（不是只有方法名） |
| "拿到密钥" | 密钥字节 + 算法名 + 使用它的调用栈 |
| "app 未检测到" | 运行 10 分钟以上无退出；服务端无风控拒绝 |

**反例（看起来成功其实是假）**：

- 脚本打印 "[*] attached" 但没有任何 `[hook]` 输出 → 目标方法从未被调用（路径不对）
- `[crypto] doFinal` 打印但 hex 是空 → 数据在别的重载（`doFinal(byte[], int, int)`）
- 抓到请求但全是 `OPTIONS`/心跳 → 业务请求被 pinning 拦了
- hook 了 `Cipher.init` 显示的 key 是 `null` → 用了 `SecretKeySpec` 直接传入，要 hook 构造函数

## 十一、常见坑

1. **frida 版本与 server 不一致**——最常见的"连不上"。版本必须**完全一致**。
2. **spawn 后没 resume**——app 停在启动处，看起来像"挂死"。
3. **so 没加载就 hook**——`Module.findBaseAddress` 返回 null，
   脚本静默失败。用 `dlopen`/`android_dlopen_ext` 监听。
4. **重载方法不指定签名**——`has more than one overload`。用 `.overload()` 或先打印 `overloads`。
5. **hook 太早**（class loader 还没就绪）——`Java.perform` 里再延迟，
   或监听 `ClassLoader.loadClass`。
6. **inline hook 短函数导致崩溃**——用 `Interceptor.replace` 或 hook 调用方。
7. **ARM32 Thumb 位没设**——`base+off+1`，否则崩溃。
8. **改内存忘 `Memory.protect`**——写只读页直接 SIGSEGV。
9. **Gadget 加载时机太晚**——早期检测已跑完，等于没挂。