# 取证与证据链：让报告经得起复核

> 本文是 `digital-forensics` 的深水区，也是**所有红队交付物的共同底座**。
>
> 为什么单列：红队报告最常见的一句话是「已获取服务器权限」。复核者问三句就塌：
> 「什么时候拿到的」「证据在哪」「怎么证明是你做的而不是本来就有」。
> 取证能力不是防守方专属——它是**红队自证**的最后一环。

---

## 一、证据链三要素：时间、来源、完整性

任何要写进报告的结论，必须能回答：

| 要素 | 问法 | 缺失后果 |
| --- | --- | --- |
| **时间** | 这件事发生在什么时候（哪个时区） | 报告时间线错乱，无法与客户日志对齐 |
| **来源** | 这条数据从哪来的（哪台机、哪个文件、哪个命令） | 无法复核，等于孤证 |
| **完整性** | 之后有没有被改动过（哈希） | 客户质疑时无法自证 |

**最容易漏的是时区**。Windows 事件日志默认本地时间、Linux `last` 本地时间、
CloudTrail 是 UTC。混在一起写时间线，看起来整齐，实际全错。

```bash
# 落任何证据之前，先统一记一遍时区
date -u; date; cat /etc/timezone 2>/dev/null
# Windows
powershell -c "(Get-TimeZone).Id; (Get-Date).ToUniversalTime()"
```

**报告里写时间的规范**：`2026-11-15T02:13:24Z（UTC+8 对应 10:13:24）`——同时给两个，
复核者不用自己换算。

---

## 二、采集：先哈希再动，顺序不能反

```bash
# ① 先算原始哈希（在任何处理之前）
sha256sum /var/log/auth.log > /tmp/auth.sha256
# 或整盘/整目录
find /etc -type f -exec sha256sum {} \; > /tmp/etc-manifest.sha256

# ② 再复制（用 dd 时加 bs 与 count 便于复现）
dd if=/dev/sda1 of=/evidence/sda1.img bs=4M status=progress
sha256sum /evidence/sda1.img >> /tmp/evidence.sha256

# ③ 采集后立刻再算一次，两个哈希必须一致
sha256sum -c /tmp/evidence.sha256
```

**为什么顺序重要**：先复制后算哈希，中间如果有人（或你的工具）改了文件，
哈希记的是「改后的状态」，证据链从第一步就断了。

**验伤信号**：`sha256sum -c` 输出 `OK`。若 `FAILED`，说明采集过程动了文件 ——
**这条证据作废**，不能用「差不多」糊过去。

---

## 三、Linux 取证：五个必看位置

### 3.1 登录与提权痕迹

```bash
# 登录历史（注意 last 读的是 wtmp，可被清）
last -Fai | head -30
lastb | head -20                # 失败登录（btmp）
# SSH 认证细节（比 last 更细，含公钥指纹）
grep -Ei "accepted|failed" /var/log/auth.log | tail -50
journalctl -u ssh --since "1 hour ago" --no-pager

# 提权痕迹：sudo 与 su
grep -Ei "sudo:.*COMMAND" /var/log/auth.log | tail -20
journalctl _COMM=sudo --no-pager | tail -20
```

**假信号**：`last` 只显示 `reboot`，看起来「没人登录过」。实际可能：
`/var/log/wtmp` 被清过（`last -F` 的起始时间与系统安装时间不符就是线索），
或者攻击者用的是 SSH 密钥 + `w 0 0`（不写 wtmp）。**要看 `auth.log` 才作数。**

### 3.2 持久化

```bash
# cron（四个位置都要看，很多人只看 /etc/crontab）
ls -la /etc/cron.* /var/spool/cron/crontabs/ 2>/dev/null
cat /etc/crontab; crontab -l 2>/dev/null

# systemd（unit 文件的时间戳比内容更有用）
systemctl list-unit-files --state=enabled | head -40
find /etc/systemd/system -name "*.service" -newermt "-7 days" -ls

# 开机自启（rc.local / profile.d / init）
ls -la /etc/rc.local /etc/profile.d/ /etc/init.d/ 2>/dev/null
find /etc -newermt "-3 days" -type f 2>/dev/null | head -30   # 近期被改的配置
```

**判据**：文件修改时间（mtime）晚于系统安装时间，且不属于任何包的记录
（`dpkg -S <file>` / `rpm -qf <file>` 查不到归属）= 可疑。

```bash
# 确认文件是否属于官方包（这是最硬的判据）
dpkg -S /etc/systemd/system/foo.service 2>/dev/null || echo "非包管理安装 → 可疑"
```

### 3.3 进程与网络

```bash
# 进程树 + 父子关系（异常父进程是最强信号）
ps -ef --forest | head -60
# 隐藏进程：比对 /proc 与 ps 的差异
ls /proc | grep -E "^[0-9]+$" | sort > /tmp/proc.txt
ps -eo pid --no-headers | tr -d ' ' | sort > /tmp/ps.txt
comm -23 /tmp/proc.txt /tmp/ps.txt        # 只在 /proc 里有的 pid = 隐藏进程

# 网络连接与外联
ss -antp | head -30
lsof -i -P -n | grep ESTABLISHED | head -20
```

**验伤信号**：`comm -23` 有输出 → 存在 `ps` 看不见的进程，基本可断定 rootkit 或
LD_PRELOAD hook。**这是比任何扫描器都硬的证据。**

### 3.4 文件时间戳的陷阱

`mtime` 可以伪造（`touch -d`），所以：

```bash
# 看 ctime（inode 变更时间）—— 改文件内容一定会改 ctime，且无法用 touch 回改
stat /path/to/file
# 更硬：crtime（部分文件系统支持）
debugfs -R 'stat <inode>' /dev/sda1 2>/dev/null | grep -i crtime
```

**判据**：如果 `mtime` 显示「半年前」，但 `ctime` 是「昨天」——文件近期被改过，
且有人试图掩盖。**这是最能说明问题的组合。**

### 3.5 日志被清怎么办

```bash
# ① 看日志文件本身是否有空洞（被截断）
wc -l /var/log/auth.log; ls -la /var/log/auth.log
# 大小与内容严重不符（如 0 字节但服务在跑）= 被清

# ② 从别处恢复：journald 二进制日志常被漏
journalctl --since "2026-11-14" --no-pager | head -50

# ③ bash_history（默认只写内存，退出才落盘）
ls -la ~/.bash_history; grep -c . ~/.bash_history
# 分散的历史文件（多用户/多 shell）
find / -name ".bash_history" -o -name ".zsh_history" 2>/dev/null | head

# ④ 内核环形缓冲（部分发行版保留上次启动的）
dmesg -T | tail -50
```

**常见假成功**：`bash_history` 是空的就写「攻击者清除了历史」。
实际可能只是没正常退出 shell（`history` 只在退出时写入）。**看 `HISTFILE` 与 shell 配置**。

---

## 四、Windows 取证：四个必查点

```powershell
# ① 登录（4624 成功 / 4625 失败 / 4672 提权）
Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624,4625,4672; StartTime=(Get-Date).AddDays(-1)} |
  Select-Object TimeCreated, Id, @{n='User';e={$_.Properties[5].Value}} | Format-Table

# ② 进程创建（4688，需开审核策略；含命令行才有价值）
Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4688} |
  Where-Object { $_.Message -match "powershell|cmd|wmic|rundll32" } | Select-Object -First 20

# ③ 服务与计划任务（持久化的两大去处）
Get-Service | Where-Object { $_.Status -eq 'Running' } | Select Name, DisplayName
Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' } | Select TaskName, TaskPath

# ④ 执行痕迹（比日志更难清）
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Recent" | Select Name, LastWriteTime
Get-ChildItem "C:\Windows\Prefetch" | Sort LastWriteTime -Desc | Select -First 20
```

**Prefetch 的价值**：它记录**程序被执行过**（即使日志被清）。
文件名形如 `POWERSHELL.EXE-XXXX.prefetch`，`LastWriteTime` 就是执行时间。

**必踩的坑**：Windows 默认**不开 4688 命令行审计**。没有命令行时，
`4688` 只能告诉你「运行了 powershell.exe」，不知道跑了什么 —— 报告里不能写具体命令，
要写「执行了 PowerShell（命令行内容未审计）」。

---

## 五、把证据变成可信报告

### 5.1 时间线（最基本也最常做错）

```bash
# 统一转 UTC 再排序，别用本地时间混排
find /evidence -type f -printf "%TY-%Tm-%TdT%TH:%TM:%TSZ %p\n" | sort
```

**报告里的时间线必须标注时区**，且**跨系统对齐**：

| 事件 | 系统 | 原始时间 | 统一 UTC | 证据 |
| --- | --- | --- | --- | --- |
| SSH 成功登录 | Linux | 11-15 10:13 | 02:13Z | auth.log:2241 |
| 创建特权 Pod | K8s | 11-15 10:15 | 02:15Z | audit:1288 |
| 读取 Secret | K8s | 11-15 10:16 | 02:16Z | audit:1291 |

### 5.2 一条结论怎么写

**不合格**：「已获取服务器权限，并读取了数据库密码。」

**合格**：
```
结论 3：获取 web01（10.0.3.21）上的数据库凭据
- 时间：2026-11-15T02:13:00Z ~ 02:18:00Z（UTC+8 本地 10:13 ~ 10:18）
- 手法：T1003.001 LSASS 内存转储（procdump -ma lsass.exe）
- 证据：/evidence/web01/lsass.dmp（sha256 3f2a...9c1e，采集后复算一致）
        app.conf 全文（sha256 7d4b...02aa）
- 复现：从 lsass.dmp 提取 NTLM hash 的过程见 refs/cloud-container-escape.md §五
- 检测覆盖：Sysmon EventID 10（ProcessAccess, TargetImage=lsass.exe）可覆盖；
            该环境未开 Sysmon，仅有 4688 记录了 procdump 执行
```

差别在于：**时间有绝对值、证据有哈希、复现有路径、检测有观察**。

### 5.3 千万别做的事

| 反模式 | 为什么不行 |
| --- | --- |
| 用 `cat /etc/shadow` 的截图当证据 | 截图不可哈希，无法证明未修改 |
| 写「见附件」但附件没哈希 | 附件可被替换，等于没证据 |
| 时间只写本地时间不写时区 | 跨系统对齐时全错 |
| 把「文件存在」当「漏洞成立」 | 存在 ≠ 可利用，必须附利用回显 |
| 报告写「无检测覆盖」 | 是猜。要写「查了 X，未见 Y 规则」 |

---

## 六、自检清单（出报告前逐条过）

```text
□ 每条结论都有：绝对时间(UTC+本地) + 来源(哪台/哪个文件) + 哈希
□ 时间线统一时区，跨系统已对齐
□ 采集顺序：先哈希后复制，且采集后复算一致
□ 判据用的是 ctime / Prefetch / 包归属，不是只看 mtime
□ 「隐藏进程」用 /proc 与 ps 的差异验证过
□ 日志被清时，找到了 journald/history/dmesg 任一替代源
□ 检测覆盖写的是观察到的日志与规则名，不是"无"
□ 没有把「文件存在」「命令成功」直接等同于「成果成立」
```