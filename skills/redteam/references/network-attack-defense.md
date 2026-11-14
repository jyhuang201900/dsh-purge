# 域内攻击的防守视角：日志留痕、噪声等级、信号串联

> 被 `windows-ad` 引用。这份文件只回答三个问题：
> **① 这个手法在哪个日志里留痕？② 留的字段长什么样？③ 蓝队怎么把几条弱信号串成一条结论？**
>
> 用途不是教怎么打，而是打之前先知道「这一步一定会被我看见」还是「这一步几乎无痕」——
> 决定节奏，也决定报告里「对手能否发现」那一栏怎么写。

## 一、先建坐标系：日志源与可信度

| 日志源 | 在哪 | 覆盖什么 | 可信度 | 对手能不能改 |
| --- | --- | --- | --- | --- |
| **安全日志**（Security） | DC / 成员机 | 登录、认证、对象访问、进程 | 高 | 需管理员，改会留 1102 |
| **Sysmon** | 成员机（需部署） | 进程、网络、镜像加载、注册表 | 高 | 需管理员卸载驱动 |
| **PowerShell 4104** | 成员机（脚本块日志） | 脚本**内容**（不是只看命令行） | 高 | 可关，关本身是信号 |
| **DC 目录服务日志** | DC | 5136/5137/5138/5139 对象变更 | 最高（本地难删） | 几乎不能 |
| **CA 日志** | 证书服务器 | 证书签发/拒绝 | 高 | 不能 |
| **4624/4625** | 所有主机 | 登录成败 | 中（字段可被伪造） | 可伪造字段 |
| **网络流量**（NetFlow/PCAP） | 交换机/探针 | 谁连谁、什么协议 | 中高 | 加密后只能看元数据 |
| **EDR** | 端点 agent | 进程行为链 | 高（若未被绕过） | 可被 BYOVD/卸载 |

**关键前提**：默认域环境里 **4662（目录服务访问）和 5136（对象修改）通常没开审计**。
所以「ACL 滥用与 DCSync 噪声小」不是因为手法隐蔽，而是因为**大多数域没开这两个审计项**。
这一点必须写进报告，否则会把「没人看」误说成「看不见」。

## 二、逐手法留痕表（事件 ID + 关键字段）

### 1. 枚举阶段

| 动作 | 事件 | 字段 | 典型值 |
| --- | --- | --- | --- |
| 匿名/低权 LDAP 查询 | DC 1644 | `Query`、`Search Filter`、`Client IP` | 一次查询上千对象的 `(objectClass=*)` |
| 大量账户枚举 | DC 4662 | `Object Server`=DS、`Access Mask`=0x100 | 读 `domainDNS` 对象 |
| SMB 共享探测 | 主机 5140 / 5145 | `Share Name`、`Relative Target Name` | 短时间遍历多台主机的多共享 |
| SMB 签名探测 | 无日志 | — | **这一条几乎无痕**，只能靠流量侧看 |

### 2. 凭据获取阶段

| 动作 | 事件 | 字段 | 信号 |
| --- | --- | --- | --- |
| Kerberoast | DC **4769** | `Service Name`、`Ticket Encryption Type`、`Service ID` | `0x17`(RC4) + 同一 `TargetUserName` 连发 |
| AS-REP | DC **4768** | `Pre-Authentication Type`=0、`Ticket Encryption Type` | 同一源 IP 扫大量用户名 |
| LSASS 读取 | 主机 **4656/4663** + Sysmon **10** | `Object Name`=`lsass.exe`、`GrantedAccess` | `0x1010` / `0x1410` / `0x1fffff` |
| LSASS 读取（无 Sysmon） | 主机 4688 | `New Process Name`=`procdump.exe`/`rundll32.exe` + `CommandLine` 含 `comsvcs.dll, MiniDump` | 命令行就是铁证 |
| SAM/SECURITY 复制 | 主机 4656 | `Object Name` 含 `\config\SAM`、`\config\SECURITY` | 正常软件不会读这两个 |
| 域缓存 dump | 主机 4663 + DC 4768 | 主机侧读 SECURITY + 随后 DC 上出现该机对新目标 4768 | 时序配对 |
| 影子复制（vssadmin） | 主机 4688 | `CommandLine` 含 `vssadmin create shadow` | 常见于 NTDS.dit 复制 |

### 3. 横向与票据阶段

| 动作 | 事件 | 字段 | 信号 |
| --- | --- | --- | --- |
| PtH（NTLM） | 目标 **4624 Type 3** | `Logon Process`=`NtLmSsp`、`Authentication Package`=`NTLM` | 同一账号从多主机来、无 4768/4769 配对 |
| Overpass-the-Hash | DC **4768** | `Ticket Options` 含 `0x40810010`、`Pre-Auth Type`=2 | 有 TGT 请求但**无对应 4648/交互登录** |
| PtT | 目标 **4624 Type 3** | `Authentication Package`=`Kerberos`、`Logon GUID` 异常 | 票据的 `Logon GUID` 与本机不符 |
| S4U2Self | DC **4769** | `Transited Services` 非空、`Service Name`=自身 | 服务账号给自己请「别人的」票 |
| S4U2Proxy | DC **4769** | `Transited Services` = 中间服务、目标 SPN 敏感 | 低权服务账号请求 `cifs/DC01` |
| RBCD 写入 | DC **5136** | `Attribute LDAP Display Name`=`msDS-AllowedToActOnBehalfOfOtherIdentity` | 一条就够定性 |
| 机器账号新建 | DC **4741** | `Target User Name` 以 `$` 结尾、`Subject` 非域管 | `MachineAccountQuota` 被消费 |
| WinRM 横移 | 目标 4624 Type 3/10 + **4688** | 父进程 `wsmprovhost.exe` | 子进程父是 wsmprovhost = 远程执行 |
| PsExec 横移 | 目标 **7045**（服务安装）+ 4624 Type 3 | `Service Name` 随机串、`ImagePath` 指向 `ADMIN$` | 7045 是服务类横移的核心证据 |
| WMI 横移 | 目标 4688 + Sysmon 19/20 | 父进程 `WmiPrvSE.exe`、`wmiprvse.exe` 起 cmd | WMI 进程创建链 |
| 计划任务 | 目标 **4698** + 106 | `Task Name`、`Task Content` 含 `\` UNC 路径 | 任务 XML 里能看到命令 |

### 4. 域级动作

| 动作 | 事件 | 字段 | 信号 |
| --- | --- | --- | --- |
| DCSync | DC **4662** | `Properties` 含 `1131f6ad-9c07-11d1-f79f-00c04fc2dcd2`（Get-Changes-All） | `Subject` 不是 DC 机器账号 |
| DCSync（备用判据） | DC 4662 | `AccessMask` 含 `0x100` + `Object Type`=`domainDNS` | 单个账号高频复制请求 |
| 黄金票 | DC **4769** 缺失 + 目标 4624 有 | `Ticket Encryption Type`=0x17 但 KDC 无记录 | **票是真的但 KDC 没发过** |
| 白银票 | 目标 4624（Kerberos）但 DC 无 4769 | 同上 | 只对单一服务有效 |
| krbtgt 重置 | DC 4724/4738 | `Target Account`=krbtgt | 域管应急动作 |
| 域策略改 | DC 5136 | `gPLink`、`nTSecurityDescriptor` | GPO 链接被改到新 OU |
| ADCS 签发 | CA 日志（`CertSrv`） | `Requester`、`Subject`、`SAN`、`Template` | 申请者与 SAN 不一致 |
| ADCS 模板改 | DC **4899**（证书服务） / 5136 | `Template` 的 `msPKI-Certificate-Name-Flag` 变更 | 模板被改成允许 SAN |

## 三、噪声等级：哪些几乎必被抓，哪些是低噪声

把「可见性」与「影响」画成四象限，决定出手顺序：

| 手法 | 噪声 | 为什么 | 建议 |
| --- | --- | --- | --- |
| **AS-REP 批量** | 极高 | DC 4768 成片，一个 IP 几十个用户名 | 只在授权窗口打，且限量 |
| **Kerberoast 批量** | 高 | 4769 成片 + RC4 标志明显 | 每 30 秒一个账号，混业务时段 |
| **强制认证** | 高 | 目标主机 5156 明晃晃外连，且触发者常是 DC 机器账号 | 一次只打一台，避免扫全网 |
| **LSASS dump** | 高（有 EDR 时） | 句柄 `0x1010` 到 lsass 是 EDR 必拦点 | 用系统自带 `comsvcs` 或 `procdump -ma` 已属高危 |
| **PsExec/服务创建** | 中高 | 7045 + `ADMIN$` 写入 + 随机服务名 | 用已有服务或 WMI 替代 |
| **ACL 写入（RBCD/WriteDacl）** | 低（**前提是开了 5136 审计**） | 一条 5136，无进程无网络 | **最隐蔽且最致命** |
| **DCSync** | 低 | 只有 4662，且多数域没开 | 一响即终局，多数 SOC 有专门规则 |
| **黄金票** | 极低（但后果最大） | KDC 侧无记录，只在目标 4624 异常 | 检测难，靠 `Logon GUID`/`Ticket Lifetime` 异常 |
| **ADCS ESC1** | 低 | 只留 CA 一条签发记录 | 靠「申请者≠SAN」这一条规则 |

**实用推论**：
1. 想低调 → 走 **ACL / ADCS**（一条记录，无进程）。
2. 想快 → 走 Kerberoast（噪声大但产出稳定）。
3. **任何情况下不要批量强制认证**——那是全网告警最快的一条。

## 四、蓝队串联：单条信号不够，要成链

单条 4624 Type 3 毫无意义（每天几万条）。有意义的是**时序上相邻的几条弱信号**。四个可落地的关联规则：

### 规则 A：Kerberoast 到登录的闭环

```
DC 4769（RC4 + 非 krbtgt + 同账号 ≥5 次 / 5 分钟）
  → 5~60 分钟后：某主机 4624 Type 3 且 TargetUserName = 该服务账号
  → 且该主机此前从未出现过该账号登录
判定：Kerberoast 成功并已使用
```

### 规则 B：DCSync 的精确签名

```
DC 4662
  AND Properties 含 1131f6ad-9c07-11d1-f79f-00c04fc2dcd2
  AND SubjectUserName 不以 $ 结尾（不是 DC 机器账号）
  AND 同一 Subject 在 10 分钟内 ≥3 次
判定：域内主机在做 DCSync（而非正常复制）
```

**注意**：正常 DC 之间复制**一定**会有这两条 GUID，所以「排除 `$` 结尾」是这条规则的全部价值。

### 规则 C：横向三选一

```
目标主机 7045（服务安装，ImagePath 含 ADMIN$ 或随机名）
  或 4688 父进程 = wsmprovhost.exe
  或 4688 父进程 = WmiPrvSE.exe 且子进程是 cmd/powershell
  AND 同一源 IP 在 10 分钟内对 ≥3 台主机重复
判定：自动化横向工具（PsExec/WinRM/WMI 批量）
```

### 规则 D：强制认证的「不该外连」

```
主机 5156（允许出站连接）
  AND 目标端口 445/135/80
  AND 发起进程是 SYSTEM（PID 4 / lsass / spoolsv）
  AND 目标 IP 不是已知 DC/文件服务器
判定：强制认证（PrinterBug/PetitPotam/DFSCoerce）
```

**为什么这条有效**：正常业务里 SYSTEM 很少主动向陌生 IP 发 445。`spoolsv.exe` 外连基本可以直接告警。

## 五、检测工程落地：从规则到可运行查询

### Splunk（SPL）——Kerberoast

```spl
index=win_security EventCode=4769
| eval rc4=if(Ticket_Encryption_Type=="0x17",1,0)
| where rc4=1 AND Service_Name!="krbtgt"
| stats count values(Service_Name) as svc by src_ip, TargetUserName
| where count>=5
```

### Sigma（转任意后端）——DCSync

```yaml
title: DCSync From Non-DC Principal
logsource: {product: windows, service: security}
detection:
  sel:
    EventID: 4662
    Properties|contains: '1131f6ad-9c07-11d1-f79f-00c04fc2dcd2'
  filter_dc:
    SubjectUserName|endswith: '$'
  condition: sel and not filter_dc
level: critical
```

### 命令行（快速核查，不用 SIEM）

```powershell
# 本机最近的服务安装（PsExec/WinRM 落地痕迹）
Get-WinEvent -FilterHashtable @{LogName='System'; Id=7045} -MaxEvents 50 |
  Select-Object TimeCreated, @{n='Name';e={$_.Properties[0].Value}},
                @{n='Image';e={$_.Properties[1].Value}}

# 谁在访问 lsass（需先开对象访问审计）
Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4656} -MaxEvents 200 |
  Where-Object { $_.Message -match 'lsass' } | Select TimeCreated, Message
```

## 六、检测的死角：这些地方看不到

必须承认的盲区，报告里要写明，否则「未检出」会被误读成「没发生」：

| 盲区 | 为什么 | 补偿手段 |
| --- | --- | --- |
| **未开 5136 审计的域** | ACL/RBCD/GPO 写入完全无痕 | 建议开 `Directory Service Changes` 审计；或用 AD 变更比对（快照 diff） |
| **未部署 Sysmon 的主机** | 进程链、网络连接看不到 | 靠 4688 命令行审计（需开 `ProcessCreationIncludeCmdLine`） |
| **票据伪造（黄金/白银）** | KDC 侧无记录 | 只能靠目标侧 `Logon GUID`、`Ticket Lifetime` 异常、`4624` 与 4769 不配对 |
| **加密流量中的中继** | 只看到 SMB/LDAP 会话，看不到中继跳转 | 靠 5156 的「不该外连」+ 目标侧 4624 的源 IP 与预期不符 |
| **内存中的操作** | 不落盘、不改配置 | 只能靠 EDR 句柄/驱动回调；无 EDR 则无解 |
| **已关日志的主机** | 对手 `wevtutil cl` | 1102（日志被清）本身是最高优先级告警 |

## 七、蓝队响应：看到信号后按这个顺序做

1. **先冻结时序**，不要立刻改密码——改密码会破坏证据，也提醒对手。
2. **按「principal → edge → artifact → accepting → effect」填一遍**，缺哪一环就去补哪一环的日志。
3. **区分「尝试」与「成功」**：
   - 4769 有记录 → 只说明**申请了票**，不代表票被服务接受。
   - 4624 Type 3 出现 → 才是**服务接受了**。
   - 两者都在、且目标主机有 4688 落地 → 才是**执行了**。
4. **收敛面**：ACL 类事件要查「谁改的」，不是「改了什么」；票据类事件要查「票从哪台机来」。
5. **补审计**：一次事件之后最该做的不是封 IP，是把 5136、4688 命令行、Sysmon 10 补上——
   否则下一次还是看不见。

## 八、常见坑（防守侧）

1. **只看 4624 就下结论**。4624 的 `IpAddress` 可以被伪造（`MSV1_0` 相关字段可被工具写入），
   必须与 DC 侧 4768/4769 配对才可信。
2. **把 DC 间正常复制误报成 DCSync**。必须排除 `$` 结尾的机器账号与 DC 自身。
3. **忘记 4769 也会记录失败**。`Status` 非 `0x0` 的 4769 是「被拒」，与成功要分开统计。
4. **把 5156 当可靠**。5156 需要开「筛选平台连接」审计，多数环境默认关闭；开了才有这条规则。
5. **没开 4688 命令行**。只有进程名没有命令行，等于只能看到 `powershell.exe` 而看不到它跑了什么；
   `ProcessCreationIncludeCmdLine_Enabled` 必须显式开启。
6. **只信 SIEM 不信原始日志**。关联规则会漏；关键事件要回原始 `.evtx` 看完整字段
   （`wevtutil qe Security /q:"*[System[(EventID=4769)]]" /f:text /c:20）。