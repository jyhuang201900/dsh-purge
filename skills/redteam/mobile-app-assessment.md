---
name: mobile-app-assessment
description: Use for end-to-end mobile app security assessment — device environment prep (root/jailbreak, frida-server, system CA), traffic interception with pinning bypass, API surface extraction, and credential hunting from App to backend.
whenToUse: Use when the target is a mobile app and you need the full chain from device setup to backend API surface — not just static decompilation. Especially when SSL pinning blocks interception or you need to find the API endpoints behind the App.
source: dsh-purge original（按本仓模板撰写）
---

# 移动端 App 完整测试链

`apk-reverse` 与 `mobile-reverse` 讲**逆向本体**（怎么读代码、怎么 Hook 函数）；
**本技能讲从「拿到一个 App」到「拿到它的后端接口清单与凭据」的完整流水线** ——
重点是那几件**必须先做、做不对后面全废**的环境准备。

## 为什么需要这个技能（而不是直接用逆向技能）

逆向技能交付的是「我读懂了这段代码」。
但移动端测试的**真正目标通常是它的后端**：App 是个客户端，API 才是资产。

这条链有五步，**每一步失败都会让后面全部作废**，而且失败方式都很隐蔽：

```text
① 设备环境（root + frida-server + 系统 CA）  ← 最容易失败，且失败后症状像"App 有问题"
② 抓包（SSL pinning 绕过）                    ← 失败症状是"App 打不开/没网络"
③ 接口提取（从流量 + 静态代码双向）            ← 只做静态会漏动态拼接的 URL
④ 鉴权分析（token 怎么来的、能不能伪造）        ← 决定能打多深
⑤ 后端打点（把接口清单交回 Web 侧技能）         ← 真正的产出
```

## 一、设备环境（90% 的失败在这一步）

### 1.1 选设备（决定后面能做什么）

| 选项 | 优点 | 缺点 | 什么时候用 |
| --- | --- | --- | --- |
| **真机 + Magisk**（推荐） | 能过大部分 root 检测（MagiskHide/Shamiko） | 需要解锁 bootloader（部分机型不行） | 目标 App 有 root 检测 |
| 真机（无 root）+ Frida Gadget | 不需要 root | 要重打包 APK（签名变了，部分 App 会检测） | 不能解锁的设备 |
| 模拟器（Genymotion / AVD） | 快照、方便 | **大量 App 检测模拟器** | 纯静态分析、无风控的 App |
| 越狱 iOS | 能 dump 解密后的 IPA | 越狱版本受限（iOS 16+ 难） | iOS 目标 |

**判据**：目标 App 的 Manifest 里有 `isEmulator` / `isRooted` 类检测时，
**必须用 Magisk 真机**。模拟器上一切"连不上/闪退"都是这两个检测导致的。

### 1.2 部署 frida-server（这一步错就全废）

```bash
# ① 确认设备架构（必须匹配，不匹配会 "exec format error"）
adb shell getprop ro.product.cpu.abi
# arm64-v8a / armeabi-v7a / x86_64

# ② 下载对应版本的 frida-server（版本必须与 PC 端 frida 完全一致）
pip install frida-tools
frida --version                     # 例：16.5.2
# 下载 frida-server-16.5.2-android-arm64.xz 对应架构

# ③ 推到设备并赋可执行权限
adb push frida-server-16.5.2-android-arm64 /data/local/tmp/frida-server
adb shell "chmod 755 /data/local/tmp/frida-server"

# ④ 以 root 启动（需要 adb root 或 su）
adb root
adb shell "/data/local/tmp/frida-server &"

# ⑤ 验证（关键：PC 端能看到设备进程）
frida-ps -U | head
# 判据：列出设备进程 = 通；报 "Failed to enumerate processes" = 没起来
```

**四个常见失败**（症状全都不一样，必须分开排查）：

| 症状 | 原因 | 修法 |
| --- | --- | --- |
| `exec format error` | frida-server 架构不匹配 | 按 `ro.product.cpu.abi` 重下 |
| `Failed to enumerate processes` | frida-server 没启动 / 端口没转发 | `adb forward tcp:27042 tcp:27042` 后重试 |
| `frida-ps` 能看到进程但 `-f` 附加失败 | App 有反调试 | 先绕过反调试（见 `references/anti-detection-bypass.md`） |
| 版本不匹配警告 | PC 与设备版本不同 | 两边都升到同一版本（**差一个小版本也会挂**） |

### 1.3 把 CA 证书装进系统区（Android 7+ 必须）

**Android 7 之后，用户证书不被 App 信任**（`network_security_config` 默认只信系统证书）。
所以要把代理的 CA 装到系统区 —— 这一步是**抓包能成功的前提**。

```bash
# ── 方法 A：Magisk 模块（推荐，可持久）──
# 1) 导出 Burp/mitmproxy 的 CA 为 PEM
#    Burp: Proxy → Options → Import/Export → Export CA certificate → DER
openssl x509 -inform DER -in cacert.der -out cacert.pem

# 2) 计算系统证书要求的文件名（= 证书的 subject_hash_old + .0）
openssl x509 -inform PEM -in cacert.pem -subject_hash_old -noout
# 输出形如 9a5ba575 → 文件名必须是 9a5ba575.0

# 3) 打包成 Magisk 模块
mkdir -p magisk_cert/system/etc/security/cacerts
cp cacert.pem magisk_cert/system/etc/security/cacerts/9a5ba575.0
cd magisk_cert && zip -r ../cert-module.zip . && cd ..
adb push cert-module.zip /sdcard/
# 在 Magisk App 里「模块 → 从本地安装」→ 重启

# 4) 验证
adb shell "ls /system/etc/security/cacerts/ | grep 9a5ba575"
# 判据：看到 9a5ba575.0 = 装好了

# ── 方法 B：直接写系统区（需要 remount，重启失效）──
adb root && adb remount
adb push cacert.pem /system/etc/security/cacerts/9a5ba575.0
adb shell "chmod 644 /system/etc/security/cacerts/9a5ba575.0"
adb reboot
```

**判据（验证证书生效）**：用系统浏览器访问 `https://mitm.it`，
能看到证书页面 = 系统信任了。看不到 = 证书没装对（文件名 hash 错了最常见）。

> **iOS**：越狱设备把 CA 放到 `/usr/local/share/freshen/` 或用 `SSL Kill Switch 3`；
> 非越狱设备**装不了系统级 CA**，只能靠 Frida Gadget 重打包。

## 二、抓包（SSL pinning 必绕，否则什么都看不到）

### 2.1 先确认有没有 pinning（不要盲上绕过脚本）

```bash
# 判据 1：静态看（有没有 pinning 的代码特征）
jadx -d out app.apk
grep -rE "CertificatePinner|TrustManager|X509TrustManager|sslVerify|pin-set|publicKeyPin" out/ | head
# 命中任一 = 有 pinning

# 判据 2：动态看（装好 CA 后试抓，看是不是报证书错误）
# 代理设好后打开 App：
#   · 能看到明文请求 = 无 pinning
#   · App 报 "网络错误 / 请检查网络" 且代理日志里没有该请求 = 有 pinning
```

**判据**：**静态有特征 + 动态报网络错误** = 确认有 pinning。
只静态有特征时（比如代码里引了但没启用），先试抓一次确认，别白绕过。

### 2.2 绕过 pinning（按成功率排序）

```bash
# ── 方法 1：Objection 一键（最简单，覆盖常见实现）──
objection -g com.target.app explore
# 进去后：
android sslpinning disable
# 判据：再打开 App 能抓到明文 = 成功；仍报网络错误 = 用了不常见实现，换方法 2

# ── 方法 2：Frida 脚本（frida-multiple-unpinning，覆盖更全）──
# 这个脚本同时 hook 了 TrustManager / OkHttp CertificatePinner / HostnameVerifier
# 等十几种实现，是目前覆盖率最高的
frida -U -f com.target.app -l frida-multiple-unpinning.js --no-pause

# ── 方法 3：改 APK（不改代码，只改网络配置）──
# 如果 pinning 是写在 network_security_config 里的（不是代码里的 TrustManager）
# 反编译后把 <pin-set> 删掉，重打包
apktool d app.apk -o out
# 编辑 out/res/xml/network_security_config.xml，删掉 <pin-set> 段
apktool b out -o patched.apk
# 重签名（必须，否则装不上）
keytool -genkey -v -keystore my.keystore -alias k -keyalg RSA -keysize 2048 -validity 10000
apksigner sign --ks my.keystore --ks-pass pass:password patched.apk
adb install -r patched.apk
# 判据：装得上且能抓明文 = 成功
# 注意：重签名会改变签名，部分 App 会校验签名（那就只能用方法 1/2）
```

**三类假成功**：

1. **抓到了流量但全是加密的** —— 绕过脚本加载了但没生效（常见于有多个 TrustManager 实例）。
   判据：`frida-trace -U -i "checkServerTrusted"` 看有没有被调用。
2. **App 能正常用但代理里没记录** —— 用的是 QUIC/HTTP3（不走代理）。判据：Wireshark 看有没有 UDP 443。
3. **抓到了但请求体是加密的** —— 应用层加密（不是 TLS）。这是另一层，见第四节。

### 2.3 抓不到 QUIC 怎么办

```bash
# HTTP/3 (QUIC) 不走 HTTP 代理。两条路：
# ── A. 禁用 QUIC（改 App 配置，需要重打包）──
# 在 network_security_config 里加：cleartextTrafficPermitted 不管用，
# 要 hook OkHttp 的 enableQuic / 或改 App 的 network library 配置

# ── B. 用透明代理（iptables 重定向所有 443，不分 TCP/UDP）──
adb shell "su -c 'iptables -t nat -A OUTPUT -p udp --dport 443 -j DNAT --to-destination <proxy_ip>:443'"
# 判据：Wireshark 能看到 QUIC 被转发
```

## 三、接口提取（静态 + 动态双向，只做一边会漏）

### 3.1 静态：从代码里找 URL

```bash
# ── 找硬编码的 base URL ──
jadx -d out app.apk
grep -rhoE "https?://[a-zA-Z0-9._-]+(/[a-zA-Z0-9._/{}-]*)?" out/sources/ | sort -u | head -30

# ── 找拼接式的接口（这是静态容易漏的）──
# 判据：找 "/api/" 前缀 + 字符串拼接
grep -rn '"/api/' out/sources/ | head -20
# 拼接形态：baseUrl + "/v1/users/" + userId → 要人工拼出完整路径

# ── 找 Apollo/GraphQL 的 schema 或查询 ──
grep -rn "query \|mutation \|__schema" out/ | head -10

# ── 找 .so 里的 URL（Flutter/RN/unity 常把 URL 放 native 层）──
strings lib/arm64-v8a/*.so | grep -E "^https?://" | sort -u | head -20
```

### 3.2 动态：从流量里补全（静态漏的那些）

```bash
# ── mitmproxy 脚本化记录（比 Burp 更适合批量）──
mitmdump -w flows.mitm --set save_stream_file=flows.mitm
# 或者用脚本实时打接口清单
mitmdump -s extract_api.py

# extract_api.py 的核心逻辑：
#   对每个 request，记录 method + host + path + 关键 query keys + body 的 json keys
```

```python
# extract_api.py（最小可用）
from mitmproxy import http
import json, collections

api = collections.OrderedDict()

def request(flow: http.HTTPFlow):
    u = flow.request
    key = f"{u.method} {u.host}{u.url.split('?')[0]}"
    if key not in api:
        api[key] = {"query": list(u.query.keys()), "body": None, "auth": None}
    if u.content and u.headers.get("content-type", "").startswith("application/json"):
        try:
            api[key]["body"] = list(json.loads(u.content).keys())
        except Exception:
            pass
    auth = u.headers.get("authorization")
    if auth:
        api[key]["auth"] = auth.split(" ")[0]   # 只记 scheme，不记 token

def done():
    print(json.dumps(api, ensure_ascii=False, indent=2))
```

**判据**：**静态 + 动态的并集才是完整接口清单**。
- 静态能拿到「没被触发过的接口」（比如某个功能没点开）
- 动态能拿到「拼接出来的完整路径」（静态只有片段）

### 3.3 从接口清单到后端打点

```text
拿到接口清单后，交给 Web 侧技能继续：
  · 鉴权面（token 怎么来的、有没有越权）  → api-security
  · 参数注入（SQLi/命令注入/SSRF）        → injection-payloads
  · 业务逻辑（越权、竞态、批量赋值）      → race-conditions / api-security
  · GraphQL                              → graphql-testing

**这一步是关键**：移动端测试的价值在于「拿到 App 背后的 API」，
而不在于「玩 App 本身」。很多人止步于"抓到包了"，报告里没有接口清单 → 价值很低。
```

## 四、应用层加密（TLS 之外的下一层）

如果流量抓到了但请求体是密文（形如 `{"data":"base64..."}`），说明有应用层加密。

```bash
# ── 找加密函数（按特征）──
grep -rE "AES|DES|RSA|Cipher|getInstance\(|encrypt\(|doFinal" out/sources/ | head -20
# 判据：找到 encrypt/decrypt 的入口方法（通常名字含 crypt/cipher/encode）

# ── Hook 加密函数（在加密前拿到明文，最省事）──
# 比"实现解密算法"简单得多：hook 的是 encrypt，输入就是明文
frida -U -f com.target.app -l hook-crypto.js

# hook-crypto.js 核心：
#   Java.perform(() => {
#     const Cipher = Java.use('javax.crypto.Cipher');
#     Cipher.doFinal.overload('[B').implementation = function (input) {
#       const result = this.doFinal(input);
#       console.log('[明文]', Java.use('java.lang.String').$new(input));
#       return result;
#     };
#   });

# ── 或用 Objection 的现成能力（覆盖常见实现）──
objection -g com.target.app explore
android keystore list      # 看密钥在哪
```

**判据**：**Hook 加密函数比破解算法快 10 倍**。
只要拿到 encrypt 的入参（明文）就够了，不需要逆出算法。
只有当加密参数参与签名（改了请求体签名会变）时，才需要把算法也拿全。

## 五、凭据与后门（App 里藏的东西）

| 目标 | 怎么找 | 价值 |
| --- | --- | --- |
| 硬编码 API Key | `grep -rE "AIza|sk_live|AKIA|Bearer " out/` | 直接打后端 |
| 硬编码凭据 | `grep -rE "password\|pwd\|secret" out/sources/` | 可能直接登录 |
| 证书/密钥文件 | `find out -name "*.p12" -o -name "*.jks" -o -name "*.pem"` | 可用作客户端证书 |
| SharedPreferences | `adb shell "run-as com.target.app cat shared_prefs/*.xml"` | token、用户信息 |
| SQLite | `adb shell "run-as com.target.app ls databases/"` | 本地缓存的数据 |
| Keychain（iOS） | `objection -g app explore` → `ios keychain dump` | token、密码 |
| 埋点 SDK 的 key | `grep -rE "appkey\|appKey\|umeng\|sensors" out/` | 第三方 SDK 的凭据（常可复用） |

```bash
# Frida 的 App 内文件读取（不需要 run-as，绕过 backup 限制）
frida -U -f com.target.app -l read-files.js
# read-files.js：用 Java 的 FileInputStream 读 /data/data/<pkg>/ 下的任意文件
```

**判据**：**硬编码凭据要验证能不能用**。
"代码里有个 password 字符串"不等于凭据有效 —— 必须真的用它登录一次。
无效的字符串在报告里写"发现硬编码凭据"是虚标。

## 六、验伤（移动端的三类假成功）

1. **"绕过了 SSL pinning"但没抓到明文** —— 绕过脚本加载了，但 App 走了别的路径（QUIC / 自实现加密）。
   判据：代理里有该域名的记录，且内容是明文。
2. **"提取了接口"但只是静态 grep 出来的 URL** —— 没有 method、没有参数、没有鉴权方式，
   这些算不上接口清单。判据：每条接口要有 `method + path + 关键参数 + 鉴权头`。
3. **"发现硬编码凭据"但没验证** —— 见上。

## 七、检测视角（从 App 侧看有没有被发现）

| 动作 | 检测点 | 现实 |
| --- | --- | --- |
| root / 越狱 | App 的 SafetyNet / DeviceCheck | 部分 App 会上报服务端（**这是真会被发现的**） |
| frida-server 在场 | 检测 27042 端口 / 扫描 `/data/local/tmp` | 强风控 App 会检测 → 服务端标记该账号 |
| 重打包 | 签名校验（服务端比对签名 hash） | 装了重签名版本 = 立刻被发现 |
| 代理 | 证书链异常 / 证书 pinning | 服务端能看到 `SSL handshake failed` |
| Hook | 反调试（`ptrace` 检测）、Frida 特征扫描 | 强风控会检测 |

**实用推论**：**移动端和 Web 不一样 —— 很多检测是「上报到服务端」而不是「本地拦截」**。
所以「App 看起来正常」不等于「没被发现」。演练时要专门问：
**对方的后台风控有没有把我的设备标记出来**（这需要看对方的日志，属于蓝队协同项）。

## 八、工具链（完整体）

| 环节 | 工具 | 用途 | 本机状态 |
| --- | --- | --- | --- |
| 静态反编译 | `jadx` / `apktool` / `JEB` | Java/smali 源码 | 本机无（见可执行性块） |
| 反汇编 | `ghidra` / `radare2` / `ida` | .so / Mach-O | `radare2` ✓ |
| 动态插桩 | `frida` / `objection` | Hook、绕过 | `pip install frida-tools objection` |
| 抓包 | `mitmproxy` / Burp | 流量拦截与脚本化 | `pip install mitmproxy` |
| 自动化扫描 | MobSF | SAST+DAST 一体 | Docker 部署 |
| 重打包 | `apktool` + `apksigner` | 改配置 / 免 root | `apktool` 需 java |
| 设备管理 | `adb` | 推文件、装包、日志 | 需 Android SDK |
| iOS 解密 | `frida-ios-dump` / `Clutch` | 从越狱设备 dump | 需越狱设备 |

## 参考（深水区，按需加载）

- `references/mobile-env-setup.md` —— 设备环境全流程：Magisk/Shamiko 配置、
  frida-server 部署的所有失败模式、系统 CA 的完整步骤（含 iOS）、以及模拟器被检测后的补救。
- `references/anti-detection-bypass.md` —— root/越狱/模拟器/Frida 检测/SSL Pinning 的绕过，
  按检测层（L1 环境 → L2 完整性 → L3 注入 → L4 通信 → L5 业务）组织，每层给 hook 脚本。
- `references/frida-objection-deep.md` —— Frida 与 Objection 的深度用法（已有）。
- `references/ios-reverse-guide.md` —— iOS 专项（已有）。

## 落库要求

- `redteam_chain_add`：`stage_code=recon`（接口提取属于侦察）或 `exploit`（打到后端后），
  `tool` 写关键动作（`objection sslpinning disable` / `mitmdump -w`）。
- **接口清单要落库** —— 这是本技能的核心产出。每条记 method + path + 鉴权方式。
  后续 Web 侧技能要基于它打点。
- 硬编码凭据（验证过的）→ `redteam_credential_add`。

## 任务完成自检

- [ ] frida-server 与 PC 端版本完全一致，且 `frida-ps -U` 能看到进程？
- [ ] CA 装在**系统区**（不是用户区），且 `https://mitm.it` 能打开？
- [ ] 确认过有没有 SSL pinning（静态 + 动态双判），并成功绕过？
- [ ] 接口清单是静态 + 动态并集，且每条有 method/参数/鉴权？
- [ ] 硬编码凭据验证过能用（不是只看到字符串）？
- [ ] 应用层加密是 Hook 拿的明文（不是硬猜算法）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 收集 | T1005 | 本地系统数据（App 本地文件 / SharedPreferences） |
| 收集 | T1005 | 本地系统数据（Hook 读取界面/本地缓存） |
| 凭据访问 | T1552 | 不安全存储的凭据（硬编码密钥 / 明文配置） |
| 隐匿 | T1027 | 混淆文件或信息（加固 / 应用层加密） |
| 隐匿 | T1553 | 颠覆信任控制（重签名绕过校验） |
| 发现 | T1046 | 网络服务发现（探测后端 API 面） |

> **Mobile ATT&CK 矩阵（T14xx）不在本表**：与本仓的 ATT&CK 表（企业矩阵 v20.1）是两套独立矩阵。
> 移动端的动作在上表里用**企业矩阵的语义对应编号**。报告里要引用 Mobile 编号
> （如 Stored Application Data、Input Capture 这类只在 Mobile 矩阵里的技术）时，**另行注明「Mobile 矩阵」**，
> 不要混进本表 —— 混进来会被「按 ATT&CK 复核」判定为编造。

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 检测视角（补充：服务端视角）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| root / 越狱 | App 的 SafetyNet / Play Integrity → **上报服务端** | 服务端记录「该设备完整性校验失败」；账号被标记风险 |
| frida-server 在场 | App 扫 27042 端口 / 扫 `/data/local/tmp` → 上报 | 服务端记录「检测到注入框架」 |
| 重打包 | 服务端比对签名 hash | 签名不匹配 → 直接拒服务（不是本地拒装） |
| 抓包（中间人） | TLS 握手异常 / 证书 pinning 失败 → 上报 | 服务端看到 `SSL handshake failed` 聚集 |
| Hook / 动态调试 | 反调试（`ptrace` 检测）+ Frida 特征扫描 | 进程被标记；App 静默降级功能 |
| 接口探测 | WAF / API 网关日志 | 同一 token 访问大量非常规路径；参数异常 |
| 批量拉数据 | 业务侧风控 | 单账号短时读取量远超基线；分页连续拉取 |

**实用推论**：**移动端和 Web 最大的差别是「检测结果常常上报到服务端，而不是本地拦截」**。
所以「App 看起来正常 / 没报错」**不能**作为「没被发现」的依据 ——
很多 App 会静默上报并在后台给你降权（限流、要验证码、标记账号），而界面上毫无提示。
演练时必须专门问对方：**你们的风控日志里有没有把我的设备/账号标记出来**。
这个问题的答案，比"我抓到了几个接口"更能说明对方的安全水位。

## 第二发（主力打不出去时，按这个顺序换）

1. **绕过 pinning 失败**：转 `apk-reverse` 的 Frida 手册（自写 hook 覆盖特殊实现），
   或转重打包（删 pin-set）
2. **App 有强风控**（root/frida/重打包全检测）：转纯静态（`apk-reverse` + `mobile-reverse`），
   不动态碰它 —— 静态也能出接口清单
3. **抓不到流量**（QUIC/私有协议）：转 `protocol-reverse`（协议逆向，从 pcap 反推）
4. **拿到接口了但打不动**：转 `api-security` / `injection-payloads`（Web 侧技能）
5. **需要 App 的签名算法**：转 `mobile-reverse` 的加密提取节

**纪律**：重打包会改签名，部分 App 会立刻上报。**先静态分析判断有没有签名校验，再决定要不要重打包**。

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

（此节由 `scripts/inject-runnability.mjs` 生成，见文件末尾）

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

（此节由 `scripts/build-skill-graph.mjs` 生成，见文件末尾）



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`frida`、`objection`、`apktool`、`jadx`、`ghidra`、`pip`
- `frida`：`python -m pip install frida-tools`（本机有 python）；App 侧还需 `frida-server`（推目标机，架构要对）
- `objection`：`python -m pip install objection`（依赖 frida，见上）；它操作的是**连着的目标 App**，本机装客户端即可
- `apktool`：官方只发 `apktool_<ver>.jar`（**需 java**）；`java -jar apktool.jar d <apk>`
- `jadx`：官方发 `jadx-gui-<ver>-win.zip`（自带 JRE 的发行版可直接双击）
- `ghidra`：官方发 `ghidra_<ver>_PUBLIC_<date>.zip`（**需 JDK 17+**，解压后 `ghidraRun.bat`）。**本机已有 `radare2`**：日常反汇编/字符串交叉引用用 `radare2` 够，Ghidra 的优势是反编译成伪 C，只在需要读复杂逻辑时装
- `pip`：用 `python -m pip` 代替裸 `pip`

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`apk-reverse`、`mobile-reverse`
- **下游**（产出交给谁）：`api-security`、`injection-payloads`、`protocol-reverse`
- **互补**（同类场景一起用）：`apk-reverse`、`mobile-reverse`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名


<!-- /skill-link-graph -->
