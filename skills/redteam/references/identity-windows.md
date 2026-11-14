# Windows 身份机制：LSASS、NTLM vs Kerberos、token 提权、runas 与 make_token

> 被 `competition-identity-windows` 与 `ctf-sandbox-orchestrator` 引用。
> 这份文件解决一类系统性误解：**「我拿到了密码/哈希，为什么登不上、为什么没权限」**。
> 答案通常在四层里：凭据类型 → 认证协议 → token 内容 → 会话类型（本地/网络/代理）。

## 一、身份的四层模型（排查顺序）

```
第 1 层 凭据    密码 / NT 哈希 / 证书 / 票 / 生物
第 2 层 认证协议 NTLM / Kerberos / PKINIT / Negotiate
第 3 层 token    SID + 组 + 特权 + 完整性级别 + 会话 ID
第 4 层 会话     Interactive / Network / Batch / Service / NetworkCleartext
```

**判据**：登录失败先定位在哪一层。
- 「密码对但登不上」→ 第 2 层（协议被禁）或第 4 层（会话类型不允许）；
- 「登上了但没权限」→ 第 3 层（token 里没有那个组/特权）；
- 「哈希对但 PtH 失败」→ 第 2 层（目标禁 NTLM）或第 4 层（目标要求 Interactive）。

## 二、LSASS 里到底存什么（按 provider 分）

| Provider | 存什么 | 何时有 | 能用来做什么 |
| --- | --- | --- | --- |
| `msv1_0` | NT 哈希（`NTResponse`/`NTOWF`） | **交互登录 / 服务登录 / 批处理登录** | PtH、Overpass、DCSync 前置 |
| `kerberos` | TGT、服务票、长期密钥（AES/RC4）、有时明文 | 任何 Kerberos 登录 | PtT、银票、伪造票据 |
| `wdigest` | 明文密码 | 仅当 `UseLogonCredential=1`（Win8.1+ 默认 0） | 一切 |
| `tspkg` | RDP 凭据的明文 | RDP 登录后 | 一切（含密码复用） |
| `ssp` / `livessp` / `cloudap` | 应用/云身份凭据 | 使用对应 SSP 时 | 对应服务 |
| `dpapi` | 用户 masterkey 缓存 | 用户加载了 DPAPI | 解该用户所有 DPAPI blob |
| `lsa`（LSA Secrets） | 服务账号密码、机器账号密码、自动登录密码 | 系统启动/服务运行 | 服务横向、机器账号伪造 |

**关键规则（很多误判源于不知道这条）**：

> **网络登录（Logon Type 3）不会在 LSASS 留下 NT 哈希。**
> 因为网络登录的认证是在**目标机的 LSASS** 完成的，用的是「会话密钥 + 挑战/响应」，
> 目标机不需要保存调用方的 NT 哈希。
>
> 所以在**文件服务器**上 dump LSASS，通常只能拿到**访问者的 TGT**，拿不到他的 NT 哈希。
> 想要哈希，必须去**他交互登录过的机器**（他自己的工作站、他 RDP 过的跳板机）。

## 三、NTLM vs Kerberos：差异与判据

### 协议流程（简化到能判断的程度）

| 环节 | NTLM | Kerberos |
| --- | --- | --- |
| 第 1 步 | 客户端 → 服务器：`NEGOTIATE`（含能力） | 客户端 → **KDC**：`AS-REQ`（用长期密钥加密时间戳） |
| 第 2 步 | 服务器 → 客户端：`CHALLENGE`（8 字节随机数） | KDC → 客户端：`AS-REP`（含 TGT，用 krbtgt 密钥加密） |
| 第 3 步 | 客户端 → 服务器：`AUTHENTICATE`（`NTResponse = f(hash, challenge)`） | 客户端 → **服务**：`TGS-REQ`（用 TGT 请服务票） |
| 第 4 步 | 服务器本地验证（或转发到 DC 做 `Netlogon` 验证） | 客户端 → 服务：`AP-REQ`（含服务票） |
| 信任模型 | **服务器必须能验证**（本地 SAM / 域 DC / 信任关系） | **服务器只需信任 KDC**（不需要联系 DC） |
| 关键后果 | 可**中继**（`AUTHENTICATE` 可被转发到另一台服务器） | **不可中继**（票绑定目标 SPN 与会话） |

**这解释了几乎所有相关结论**：
- NTLM 能中继，Kerberos 不能 → 中继链（`relay-coercion-chain.md`）全部依赖 NTLM。
- Kerberos 需要 KDC 可达 → 打 Kerberos 必须先能连 DC 的 88 端口。
- Kerberos 需要**时钟同步**（默认 5 分钟） → NTLM 不需要。

### 怎么判断当前用了哪个

```powershell
# 1) 看当前会话的票（有票说明至少部分走 Kerberos）
klist

# 2) 看目标服务的 SPN 是否注册（没注册就只能 NTLM）
setspn -L dc01

# 3) 看协商结果（安全日志 4624 的 Authentication Package）
Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624} -MaxEvents 20 |
  Select-Object TimeCreated, @{n='User';e={$_.Properties[5].Value}},
    @{n='Pkg';e={$_.Properties[10].Value}}, @{n='Type';e={$_.Properties[8].Value}},
    @{n='Proc';e={$_.Properties[17].Value}}
```

`Authentication Package` 是 `Kerberos` / `NTLM` / `Negotiate`。
`Negotiate` 表示「先试 Kerberos，失败回落 NTLM」——**这一条是排查 PtH 失败的关键**：
如果 SPN 存在但票拿不到，客户端会静默回落 NTLM，看起来"认证成功"，实际用的是哈希。

### 环境层面的开关（决定能不能用某种方式）

| 策略 | 位置 | 影响 |
| --- | --- | --- |
| `RestrictNTLM: Outgoing NTLM traffic to remote servers` | 组策略 → 网络安全 → 限制 NTLM | 禁出站 NTLM → PtH 全废 |
| `Network security: LAN Manager authentication level` | 同上 | `Send NTLMv2 only` 时 NTLMv1 不可用 |
| `Network security: Restrict NTLM: Add remote server exceptions` | 同上 | 例外列表可绕过 |
| `msDS-SupportedEncryptionTypes` | 账号属性 | 决定该账号能否用 RC4 |
| `SupportedEncryptionTypes`（域信任） | `trustAttributes` | 跨域时限制 etype |

```bash
# 快速探测目标是否接受 NTLM（不需要凭据）
nxc smb 10.0.0.30 -u '' -p '' 
# 若能建连并列出 domain，说明 SMB 层 NTLM 可用

# 探测是否只有 Kerberos
nxc smb 10.0.0.30 -u 'user' -p 'pass' -k   # -k 强制 Kerberos，失败说明 SPN/时间有问题
```

## 四、登录类型（Logon Type）：决定「你能做什么」

| Type | 名称 | 凭据落在目标机 LSASS？ | 典型来源 | 能否 PtH |
| --- | --- | --- | --- | --- |
| 2 | Interactive | 是（本机） | 控制台登录 | — |
| 3 | Network | **否** | SMB / 共享访问 | 认证可行，但**目标机不留哈希** |
| 4 | Batch | 是 | 计划任务 | — |
| 5 | Service | 是 | 服务启动 | — |
| 7 | Unlock | 是 | 解锁屏 | — |
| 8 | NetworkCleartext | 是（明文） | IIS 基本认证 | — |
| 9 | NewCredentials | 是（仅本进程） | `runas /netonly`、`NewCredentials` | **能 PtH，但不产生本机交互会话** |
| 10 | RemoteInteractive | 是 | RDP | — |
| 11 | CachedInteractive | 是（缓存哈希） | 断网登录 | — |

**Type 9 是最特殊也最有用的一条**：`runas /netonly` 与 `NewCredentials` 创建的是
「本进程有新凭据，但本机不验证、不外泄」的会话——**出站认证用新凭据，本地仍是原身份**。
这就是为什么 `runas /netonly` 能在**非域机器**上做域内操作。

**判据**：想让目标机留下你的凭据（以便后续 dump）→ 用 Type 2/10；只想出站认证 → Type 9 最干净。

## 五、Token 与提权：SeImpersonate / SeAssignPrimaryToken

### 概念

Windows 的每个进程持有一个 **token**（`_TOKEN`），token 里含：
`User SID`、`Groups`、`Privileges`、`IntegrityLevel`、`SessionId`、`TokenType`（Primary / Impersonation）。

**提权的两条路**：
1. **改 token 内容**（加组、加特权）→ 需要 `SeDebug`/`SeTcb` 等，通常要 SYSTEM；
2. **换 token**（拿到别人的 token 用）→ 需要 `SeImpersonate`（客户端 token）或 `SeAssignPrimaryToken`（主 token）。

### 关键特权

| 特权 | 含义 | 谁有 |
| --- | --- | --- |
| `SeImpersonatePrivilege` | 可 `ImpersonateLoggedOnUser` / 命名管道模拟客户端 | **服务账号、IIS 应用池、SQL Server 服务账号**（默认） |
| `SeAssignPrimaryTokenPrivilege` | 可给新进程指定 token | 服务账号（默认） |
| `SeDebugPrivilege` | 可打开任意进程 | 本地管理员（默认） |
| `SeBackupPrivilege` | 可绕过 ACL 读任意文件 | 备份操作员、部分服务 |
| `SeRestorePrivilege` | 可绕过 ACL 写任意文件 | 同上 |
| `SeTakeOwnershipPrivilege` | 可夺取任意对象所有权 | 本地管理员（默认） |
| `SeTcbPrivilege` | 「作为操作系统的一部分」 | SYSTEM 才有 |

```cmd
whoami /priv
whoami /groups
whoami /all
```

### Potato 家族为什么能提权（一句话原理）

`SeImpersonate` 允许你**模拟连到你命名管道的客户端**。Potato 类工具的做法是：
诱使 **SYSTEM 账户**（如 `NT AUTHORITY\SYSTEM` 的 DCOM/Print Spooler/RPCSS 客户端）
连到你的管道 → 你 `ImpersonateNamedPipeClient` → 拿到 SYSTEM token → `CreateProcessWithTokenW`。

| 工具 | 触发机制 | 适用版本 |
| --- | --- | --- |
| **JuicyPotato** | DCOM（`BITS`/`ShellHWDetection`）CLSID | ≤ Win10 1809 / Server 2016 |
| **RoguePotato** | DCOM + 伪造 OXID 解析器 | 1903+ 的替代 |
| **PrintSpoofer** | Print Spooler 命名管道（`\\.\pipe\spoolss`） | Win10 / Server 2019（有 Spooler 时） |
| **GodPotato** | RPCSS + `SeImpersonate` 的通用实现 | 2012–2022 广覆盖 |
| **SweetPotato** | 组合多种触发器 | 通吃但依赖更多 |

```cmd
:: PrintSpoofer 典型用法（需 SeImpersonate）
PrintSpoofer.exe -i -c "cmd /c whoami"
:: 成功输出 nt authority\system

:: GodPotato（2012-2022）
GodPotato.exe -cmd "cmd /c net user hacker P@ss123 /add"
```

**验伤**：`whoami` 输出 `nt authority\system` 才算；只看到「成功启动进程」不算。
**假阳性**：`-c "whoami"` 返回原用户 → 触发器没让 SYSTEM 连过来（Spooler 关闭 / DCOM 服务禁用）。

### 打印机/Spooler 关闭时的替代

```cmd
# 检查 Spooler
sc query Spooler
# 若 STOPPED，PrintSpoofer 无效，改用 GodPotato（走 RPCSS，不依赖 Spooler）
```

## 六、`runas /netonly`、`make_token`、`sekurlsa::pth`：三者别混

这三个都是「借别人的身份做出站认证」，但**输入、作用域、产物**都不同：

| 维度 | `runas /netonly` | `make_token`（Cobalt Strike） | `sekurlsa::pth`（mimikatz） |
| --- | --- | --- | --- |
| 需要什么 | **明文密码** | **明文密码** | **NT 哈希**（或 AES key） |
| 作用在哪 | **新进程** | **当前进程**（beacon 的 token） | **新进程**（`/run` 指定的程序） |
| 登录类型 | Type 9（`NewCredentials`） | Type 9（网络专用登录） | Type 9（网络专用登录） |
| 本机能否验证 | 否 | 否 | 否 |
| 能否读本机资源 | **否** | **否** | **否** |
| 能否访问域内远程 | **是** | **是** | **是** |
| 子进程继承 | 是（该进程树） | 视 beacon 配置 | 是（`/run` 起的进程树） |
| 主要留痕 | 本机 **4648** | 本机无；目标 4624 Type3 | 本机无；目标 4624 Type3 |

> **纠正一个常见误写**：mimikatz **没有** `sekurlsa::make_token` 这条命令。
> mimikatz 的 `token::` 模块做的是 `whoami` / `elevate` / `run` / `revert`（token 窃取与降权），
> 不做「用明文密码造网络凭据」。造网络凭据的是 `sekurlsa::pth`（哈希）或 CS 的 `make_token`（明文）。

### 命令

```cmd
:: runas /netonly：密码在提示符里输入（不能直接跟在命令行）
runas /netonly /user:CORP\administrator "mmc \\dc01.corp.local\c$"

:: 注意：/netonly 下 whoami 仍显示本机身份，这正常
:: 验证是否生效：访问远程资源成功
dir \\dc01.corp.local\c$
```

```
# Cobalt Strike beacon（明文，改当前 beacon 的网络凭据）
make_token CORP\administrator Passw0rd!
# 验证
shell dir \\dc01.corp.local\c$
rev2self          # 用完还原
```

```cmd
:: mimikatz：用哈希，起一个新进程并在其中注入
mimikatz.exe "privilege::debug" "sekurlsa::pth /user:administrator /domain:corp.local /ntlm:<NTHASH> /run:cmd.exe" "exit"

:: 之后在弹出的 cmd 里做远程操作（该 cmd 及其子进程都带这份凭据）
dir \\dc01.corp.local\c$
```

**`sekurlsa::pth` 的 `/run` 参数**：必须给一个程序（`cmd.exe` / `powershell.exe` / `mmc.exe`）。
它**新起一个进程**并在其中注入凭据——所以原窗口里没有任何变化，你必须在**新弹出的窗口**里操作。

### 三个必须知道的坑

1. **`whoami` 不变**。三种方式下 `whoami` 都显示旧身份——因为本地 token 没被换成本地可验证的身份。
   判据不是 `whoami`，而是**远程访问是否成功**（`dir \\host\c$`）。
2. **访问本机资源会失败**。这类登录是「只用于出站」的：读本机 `C:\` 用的是原身份，
   但读 `\\localhost\c$` 会失败（本机不认这个网络凭据）。
3. **不产生可 dump 的哈希**。Type 9 的凭据只存在于该进程的 LSA 上下文里，
   dump LSASS 通常拿不到明文或哈希——所以它比交互登录更「干净」，也更不适合做后续凭据扩散。

### 第三个选择：`New-PSDrive` / `Invoke-Command -Credential`

```powershell
# 明文凭据 + 只对单个命令生效（Type 3 网络登录）
$c = Get-Credential
Invoke-Command -ComputerName dc01.corp.local -Credential $c -ScriptBlock { whoami }

# 映射驱动器（也在当前会话内生效）
New-PSDrive -Name X -PSProvider FileSystem -Root \\dc01.corp.local\c$ -Credential $c
```

这条路产生的是 **Type 3**，目标机有 4624 记录，但**不会**在本机 LSASS 留下哈希。

## 七、Kerberos 侧的身份操作（与 NTLM 路线对照）

```bash
# 用哈希换 TGT（Overpass-the-Hash）
impacket-getTGT corp.local/administrator -hashes :<NTHASH> -dc-ip 10.0.0.10
export KRB5CCNAME=administrator.ccache

# 用 AES key 换 TGT（更隐蔽，不需要 RC4）
impacket-getTGT corp.local/administrator -aesKey <AES256_HEX> -dc-ip 10.0.0.10

# 用票访问（注意必须用 FQDN，否则 SPN 不匹配）
impacket-smbclient -k -no-pass //dc01.corp.local/c$
```

**对照判据**：

| 想要 | NTLM 路线 | Kerberos 路线 |
| --- | --- | --- |
| 只访问 SMB | `nxc smb -H` | `getTGT` + `smbclient -k` |
| 访问 WinRM | `nxc winrm -H`（需目标允许 NTLM） | `getTGT` + `nxc winrm -k` |
| 过 NTLM 被禁的环境 | **不可行** | **唯一可行** |
| 不留 4624 里的 NTLM 包 | 不可能 | 可以（`Authentication Package=Kerberos`） |
| 需要时钟同步 | 不需要 | **需要（5 分钟）** |

## 八、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| `runas /netonly` | 本机 **4648**（显式凭据登录） | `Target Server Name` 为空或 `localhost`，`Subject`=发起者，`TargetUserName`=被借用账号 |
| `sekurlsa::pth` / make_token | 本机**无**；目标 **4624 Type 3** | 目标机 `Logon Process=NtLmSsp`、`Authentication Package=NTLM`，且源主机从未有该账号的 4648 |
| PtH 的典型组合信号 | 目标 4624 + DC **无 4768/4769** | **无票证记录的网络登录 = 一定是哈希/密码直连**（Kerberos 必有 4768） |
| Overpass-the-Hash | DC **4768** | `Pre-Authentication Type=2`（PA-ENC-TIMESTAMP）但**无对应的交互登录 4648/4624 Type2** |
| Potato 提权 | 本机 4688 + Sysmon 1 | 父进程是 `spoolsv.exe` / `dcomlaunch` / `svchost` 起的陌生进程；或命名管道 `spoolss` 被非系统进程连接（Sysmon 17/18） |
| token 窃取 | 本机 4688 + Sysmon 10 | 进程打开另一个高权进程且 `GrantedAccess` 含 `0x0400`（`PROCESS_QUERY_INFORMATION`）后紧跟 `CreateProcessWithTokenW` |
| NTLM 认证 | 目标 4624 | `Authentication Package = NTLM`，`Logon Process = NtLmSsp` |
| Kerberos 认证 | DC 4768/4769 + 目标 4624 | 三者能配对；配对不上即为伪造票或哈希直连 |

**蓝队最有效的一条规则**：**「4624 Type 3 但没有 DC 侧 4768」**
——Kerberos 登录必然先在 DC 留下 4768，没有就是 NTLM 直连（PtH/密码）。
这一条能把 PtH 从海量 4624 里捞出来。

## 九、常见坑

1. **拿网络登录的机器 dump 哈希**。Type 3 不留 NT 哈希，这是最常见的白忙。
2. **`runas /netonly` 后用 `whoami` 判断成败**。永远不变，要看远程访问。
3. **PtH 到要求 Interactive 的服务**。RDP 不接受纯 PtH（除非 `Restricted Admin` 模式），
   WinRM 视配置而定；SMB 最宽松。
4. **`/netonly` 访问本机共享**。`\\localhost\c$` 会失败，这是设计如此。
5. **SPN 用 IP 访问**。`psexec -k` 与 `smbclient -k` 必须用 FQDN，用 IP 会回落 NTLM 或直接失败。
6. **以为 `Negotiate` 就是 Kerberos**。它是「先试 Kerberos」，失败会静默回落 NTLM，
   日志里看到 `Negotiate` 要再确认实际包（`Authentication Package` 字段）。
7. **Potato 在无 Spooler 的机器上试**。`sc query Spooler` 先看一眼；停了就换 GodPotato/RPCSS 路线。
8. **忽略了 `SeImpersonate` 只在服务账号有**。普通管理员账户也有（默认），但**受限 token（UAC 提权前的 medium）没有**——
   先确认 `whoami /priv` 里真的有这一行。