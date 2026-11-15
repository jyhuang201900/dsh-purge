# 移动端环境部署全流程

被 `mobile-app-assessment` 引用。**这一篇只讲"把设备准备好"** ——
检测怎么绕过在 `anti-detection-bypass.md`，本篇讲那些**必须先完成、做错了后面全废**的部署步骤。

> 为什么单独成篇：环境部署的失败症状**全部伪装成"App 有问题"**。
> 抓不到包 → 以为 App 有问题；frida 挂不上 → 以为 App 反调试。
> 实际是证书文件名 hash 错了、frida-server 架构不对。
> 分开排查这两类，能省掉大半时间。

---

## 一、设备选择：先决定用哪种

| 方案 | 前置要求 | 能过什么检测 | 不能过什么 |
| --- | --- | --- | --- |
| 真机 + Magisk + Shamiko | 可解锁 bootloader | root 检测、部分完整性检测 | 强完整性（Play Integrity 硬件级） |
| 真机 + Frida Gadget（免 root） | 能重打包重签 | 无需 root | **签名校验**（签名变了）；部分 App 直接拒装 |
| 模拟器（AVD/Genymotion） | 无 | 无 | **几乎所有带风控的 App**（模拟器检测太容易） |
| 越狱 iOS | 可越狱版本 | 越狱检测（用插件隐藏） | 部分硬件级检测 |

**判据（怎么选）**：

```bash
# 先静态看一眼 App 有什么检测（这一步决定设备方案，不要先买设备再猜）
jadx -d out app.apk
grep -rE "isRooted|isEmulator|SafetyNet|PlayIntegrity|DeviceCheck|frida|ptrace" out/ | head -20
```

- 只命中 `isRooted` → Magisk 真机够
- 命中 `SafetyNet`/`PlayIntegrity` → 硬件级，**基本绕不过**，只能走纯静态路线
- 只命中 `frida` 类 → Magisk + 改名的 frida-server 够

---

## 二、Magisk 环境（Android 首选方案）

### 2.1 装 Magisk + Shamiko

```text
① 解锁 bootloader（各厂商不同；小米/一加有官方途径，华为/部分三星不行）
② 提取原机 boot.img
   · 从官方固件包里取，或 `adb shell "dd if=/dev/block/by-name/boot of=/sdcard/boot.img"`
③ Magisk App → 安装 → 「选择并修补一个文件」→ 选 boot.img → 得到 magisk_patched.img
④ fastboot flash boot magisk_patched.img
⑤ 重启 → Magisk App 显示「已安装」= 成功
⑥ 装 Shamiko 模块（Magisk → 模块 → 从本地安装）
   → 在 Magisk 设置里打开「遵守排除列表」，把目标 App 加进排除列表
   判据：目标 App 看到的是"未 root"状态
```

**判据（Shamiko 是否生效）**：

```bash
# 用目标 App 同款检测库自测（或装个 RootBeer 之类的检测 App）
# 判据：检测 App 报 "Not Rooted" = Shamiko 生效
# 报 "Rooted" = 排除列表没加对，或 Shamiko 没装
```

### 2.2 frida-server 部署（最容易错的一步）

```bash
# ── ① 确认架构（错这一步会 "exec format error"）──
adb shell getprop ro.product.cpu.abi
# arm64-v8a（最常见）/ armeabi-v7a / x86_64（模拟器）

# ── ② 版本必须与 PC 端完全一致 ──
pip install --upgrade frida-tools
frida --version      # 例 16.5.2 → 必须下 frida-server-16.5.2-android-arm64
# 差一个小版本也会挂（"Unable to communicate with remote frida-server"）

# ── ③ 下载并推送 ──
# 从 https://github.com/frida/frida/releases 下对应包
xz -d frida-server-16.5.2-android-arm64.xz
adb push frida-server-16.5.2-android-arm64 /data/local/tmp/fs
adb shell "su -c 'chmod 755 /data/local/tmp/fs'"

# ── ④ 启动（必须 root）──
adb shell "su -c '/data/local/tmp/fs &'"

# ── ⑤ 端口转发（有时需要）──
adb forward tcp:27042 tcp:27042

# ── ⑥ 验证 ──
frida-ps -U | head
# 判据：列出进程 = 通
```

**改名（绕 frida 检测）**：很多 App 会扫 `/data/local/tmp/` 下有没有 `frida-server`。
把文件名改成 `fs`（如上），或改得更像系统进程：

```bash
adb shell "su -c 'cp /data/local/tmp/fs /data/local/tmp/.syscache'"
# 启动后立刻删掉原文件
adb shell "su -c 'rm /data/local/tmp/fs'"
```

### 2.3 系统 CA 证书（Android 7+ 必须，否则抓不到 HTTPS）

**为什么必须装系统区**：Android 7 起，App 默认只信任系统 CA，
用户装的证书（`/data/misc/user/0/cacerts-added/`）不被 App 信任。

```bash
# ── ① 导出代理的 CA ──
# Burp: Proxy → Options → Import/Export → Export CA certificate → DER
# mitmproxy: ~/.mitmproxy/mitmproxy-ca-cert.cer
openssl x509 -inform DER -in cacert.der -out cacert.pem

# ── ② 算文件名（必须是 <subject_hash_old>.0，算错就无效）──
openssl x509 -inform PEM -in cacert.pem -subject_hash_old -noout
# 例输出 9a5ba575 → 文件名 9a5ba575.0

# ── ③ 做成 Magisk 模块（推荐：重启后仍在）──
mkdir -p certmod/system/etc/security/cacerts
cp cacert.pem certmod/system/etc/security/cacerts/$(openssl x509 -inform PEM -in cacert.pem -subject_hash_old -noout).0
cd certmod && zip -r ../certmod.zip . && cd ..
adb push certmod.zip /sdcard/
# Magisk App → 模块 → 从本地安装 → 重启

# ── ④ 验证 ──
adb shell "ls /system/etc/security/cacerts/ | grep 9a5ba575"
# 判据：看到文件 = 装好

# ── ⑤ 端到端验证（最可靠）──
# 设备浏览器访问 https://mitm.it
# 判据：能打开且显示证书安装说明 = 系统信任了代理 CA
```

**判据（这一步最容易假成功）**：`ls` 看到文件 ≠ App 信任它。
**必须用 App 自己的请求验证**（打开 App 看是不是还报网络错误）。

---

## 三、免 root 方案：Frida Gadget

当设备不能 root（或不想改系统）：

```bash
# ── ① 用 objection 自动打补丁 ──
objection patchapk --source app.apk
# 它做的事：解包 → 注入 frida-gadget.so → 改 smali 加载 gadget → 重签名

# ── ② 或手工（可控，能选 gadget 配置）──
apktool d app.apk -o out
# 下载对应架构的 frida-gadget.so，放到 out/lib/arm64-v8a/
# 在 out/lib/arm64-v8a/ 下的某个 .so 里加加载代码，或在 MainActivity 的 onCreate 里加：
#   const-string v0, "frida-gadget"
#   invoke-static {v0}, Ljava/lang/System;->loadLibrary(Ljava/lang/String;)V
# 更需要的是 gadget 的配置文件（控制监听端口/脚本）
# out/lib/arm64-v8a/libgadget.config.so → 内容是 JSON：
#   {"interaction": {"type": "listen", "address": "127.0.0.1", "port": 27042}}

apktool b out -o patched.apk

# ── ③ 重签名（必须）──
keytool -genkey -v -keystore my.keystore -alias k -keyalg RSA -keysize 2048 -validity 10000 -storepass password -keypass password -dname "CN=test"
apksigner sign --ks my.keystore --ks-pass pass:password patched.apk
adb install -r patched.apk

# ── ④ 连接 ──
frida -U -n Gadget    # 或者按端口连
```

**判据**：免 root 方案能绕过 root 检测，但**签名变了**。
所以这条只适用于「不做签名校验」的 App。做签名校验的一重打包就被发现。

---

## 四、iOS

```bash
# ── 越狱设备（推荐 palera1n / Dopamine，视 iOS 版本）──
# ① 装 frida（Cydia/Sileo 源：https://build.frida.re）
# ② 验证
frida-ps -U | head

# ── 装 CA 到系统信任 ──
# 越狱：scp 证书到 /usr/local/share/freshen/（或用 Filza 放）
# 非越狱：设置 → 通用 → VPN与设备管理 → 安装描述文件 → 再到「关于本机 → 证书信任设置」手动信任
#   ⚠ 非越狱的用户级 CA 只对"信任系统 CA"的 App 有效；做了 pinning 的 App 无效

# ── 解密 App Store 的 IPA（否则二进制是加密的）──
# 越狱设备上：
frida-ios-dump -u <bundle-id>          # 或
Clutch -i                              # 列出已安装 App，再 -d <编号>

# ── 非越狱：用 ipatool 下 IPA（但仍是加密的，需解密才能静态分析）──
ipatool download -b <bundle-id> -o app.ipa
```

**判据**：**iOS 的难点不在工具，在"可越狱的 iOS 版本"**。
新版本（iOS 17.4+）多数无法越狱，此时只能做静态（class-dump / otool），动态基本做不了。

---

## 五、故障排查对照表（症状 → 真因）

这一类问题最耗时间，因为症状都在"App 侧"。按这张表对照：

| 症状 | 真因 | 修法 |
| --- | --- | --- |
| `exec format error` | frida-server 架构不匹配 | 按 `ro.product.cpu.abi` 重下 |
| `Failed to enumerate processes` | frida-server 没起 / 端口没转发 | 重起 + `adb forward tcp:27042` |
| `Unable to communicate with remote frida-server` | **PC 与设备 frida 版本不一致** | 两边升到同一版本 |
| `frida-ps` 通但附加 App 失败 | App 有反调试 / frida 检测 | 见 `anti-detection-bypass.md` |
| App 能开但没网络 | **CA 没装到系统区** / 有 pinning | 查证书 hash + 绕过 pinning |
| 抓到了包但内容全密文 | 应用层加密（不是 TLS） | Hook encrypt 函数（见技能第四节） |
| 抓不到任何请求 | 走 QUIC/HTTP3（不走 HTTP 代理） | 禁 QUIC 或透明代理 |
| 装了 patched apk 打不开 | 签名校验 / 重签损坏了 v2 签名 | 换免 root 的 Frida Gadget 或放弃重打包 |
| App 一启动就闪退 | 环境检测（root/模拟器/frida） | 见 `anti-detection-bypass.md` |
| `objection` 连不上 | 用了 `-g` 但 App 已经在跑 | 先 `kill` 再 `-f` 冷启 |

---

## 六、常见坑

1. **证书文件名算错**（忘了 `.0` 后缀，或用 `-subject_hash` 而非 `-subject_hash_old`）——
   这是「装了但无效」最常见的原因。**Android 用的是 `_old` 版本**。
2. **frida-server 版本与 PC 端不一致** —— 报错信息是 "Unable to communicate"，很像网络问题。
3. **只装用户证书** —— Android 7+ 的 App 不认。必须系统区。
4. **忘记 Shamiko 排除列表** —— Magisk 装了但目标 App 仍检测到 root。
5. **在模拟器上测有风控的 App** —— 一切都是"App 有问题"的假象。
6. **重打包后忘了 `zipalign`** —— 部分设备装不上（`apksigner` 之后要 `zipalign -p 4`，
   顺序很重要：**先 zipalign 再 apksigner**）。
7. **用 adb 装 debug 版覆盖生产版** —— 签名冲突会装不上，必须先卸载（会丢数据，注意）。
8. **iOS 非越狱装 CA 后忘了「证书信任设置」** —— 设置里装完描述文件还要进
   「关于本机 → 证书信任设置」手动打开开关。