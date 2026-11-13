---
name: detection-pairing
description: 攻击手法必配检测：每个打法同时给出防守方在日志里的可见信号（Sigma/YARA/KQL/SPL 四种方言），用于评估"这一发有多响"、写报告的影响面、以及被拦后判断是被规则拦还是被配置拦
whenToUse: 交付前要给每个发现配检测规则时；要评估某一发的隐蔽性、决定用哪条手法时；发现被拦后要判断"是 WAF 拦的还是 EDR 拦的"时；蓝队复盘要给检测建议时
---

# 攻击-检测配对（知道对手怎么看见你）

**为什么攻击方要懂检测：**

1. **选手法**：同样能达成目标的两条路，一条会触发 EDR 告警、一条只留一条日志——选后者
2. **判断被拦原因**：被拦后不知道是谁拦的，就没法绕
3. **报告价值**：客户要的不是"你打进来了"，是"你怎么被发现的、怎么防"

**核心判据：一个攻击手法如果说不清"防守方看见什么"，就等于不了解它。**

## 一、四种检测方言（按消费方选，不要混）

| 方言 | 消费方 | 适用场景 |
|---|---|---|
| **Sigma** | 通用（可转 Splunk/Elastic/Sentinel） | 报告首选——客户可能用任何 SIEM |
| **KQL** | Microsoft Sentinel / Defender | 客户是微软栈时 |
| **SPL** | Splunk | 客户是 Splunk 时 |
| **YARA** | 文件 / 内存扫描 | 涉及落地文件、内存马、样本时 |

**默认给 Sigma**（最通用），客户栈明确时再补对应方言。

## 二、按攻击阶段查表：这一发在防守方长什么样

### 阶段 1-2：侦察（噪声最大，也最容易被发现）

| 手法 | 检测点 | Sigma 逻辑 |
|---|---|---|
| 全端口扫描 | 防火墙 / NetFlow | 单源 IP 短时间触达 >100 个不同端口 |
| 目录爆破 | Web 访问日志 | 单 IP 单位时间 404 率 >80%，且请求路径无 Referer |
| 子域枚举 | DNS 日志 | 同一源大量 NXDOMAIN 查询，或查询大量不存在的子域 |
| 指纹识别 | WAF / IDS | UA 为工具特征串（`nuclei`、`nikto`、`sqlmap`） |

### 阶段 3：漏洞发现

| 手法 | 检测点 | 关键信号 |
|---|---|---|
| 注入探测 | WAF / 应用日志 | 参数里出现 SQL 关键字 + 注释符组合；URL 编码异常 |
| 路径穿越 | Web 日志 | 路径里含 `../` 或编码形式（`%2e%2e%2f`） |
| 反序列化 | 应用日志 / RASP | 请求体 base64 段解码后含 Java 序列化魔数 `AC ED` |
| SSRF | 出站流量 | 应用服务器主动连内网地址或 `169.254.169.254` |

### 阶段 4：利用（这一阶段噪声最小、后果最重）

| 手法 | 检测点 | 关键信号 |
|---|---|---|
| 命令注入 | 进程树 / EDR | Web 进程（`w3wp`/`php-fpm`/`java`）**创建子进程**（`cmd`/`sh`/`powershell`） |
| 文件上传落地 | EDR / 文件完整性 | Web 目录出现可执行文件；Web 进程写文件到非临时目录 |
| WebShell 访问 | Web 日志 + 进程树 | 同一 URL 反复访问、参数高度随机；Web 进程派生子进程 |
| 内存马 | 内存扫描（YARA） | JVM/.NET 进程内存里出现 `Runtime.exec` / `Assembly.Load` 特征 |
| 提权 | 本地审计 | `sudo` 提权到 root 且命令来自 Web 进程；Windows 服务创建 |

**最强信号（几乎必被抓）**：**Web 进程派生子进程**。这是命令注入、WebShell、反序列化 RCE 的共同特征，所有 EDR 都盯这个。

### 阶段 5：内网渗透

| 手法 | 检测点 | 关键信号 |
|---|---|---|
| 横向移动 | 4624 Type 3 / 网络登录 | 同一账号短时间登录多台主机；`Logon Process = NtLmSsp` |
| 凭据 dump | 4656 / Sysmon 10 | 进程打开 `lsass.exe`，`GrantedAccess` 含 `0x1010` |
| Kerberoast | DC 4769 | 短时间大量 RC4 服务票据请求 |
| DCSync | DC 4662 | 非 DC 机器请求 `DS-Replication-Get-Changes-All` |
| 隧道 | 出站流量 | 长连接、固定心跳间隔、非标准端口上的 TLS 或 SOCKS 握手 |

## 三、写法：一个手法配一条规则（模板）

```yaml
# Sigma 模板——照这个填，不要只写"会有告警"
title: Web Process Spawning Shell (Command Injection)
id: <uuid>
status: experimental
description: Web 服务器进程派生 shell 子进程，命令注入 / WebShell 的强信号
logsource:
  category: process_creation
  product: windows          # 或 linux
detection:
  parent:
    ParentImage|endswith:
      - '\w3wp.exe'
      - '\php-cgi.exe'
      - '\httpd.exe'
  child:
    Image|endswith:
      - '\cmd.exe'
      - '\powershell.exe'
      - '\sh'
      - '\bash'
  condition: parent and child
falsepositives:
  - 部分运维脚本由 Web 面板触发（需白名单）
level: high
```

```kql
// KQL 等价
DeviceProcessEvents
| where InitiatingProcessFileName in~ ("w3wp.exe","php-cgi.exe","httpd.exe")
| where FileName in~ ("cmd.exe","powershell.exe","sh","bash")
| project Timestamp, DeviceName, InitiatingProcessFileName, FileName, ProcessCommandLine
```

```spl
| tstats summariesonly=true count from datamodel:Endpoint.Processes
  where Processes.parent_process_name IN ("w3wp.exe","php-cgi.exe","httpd.exe")
    AND Processes.process_name IN ("cmd.exe","powershell.exe","sh","bash")
  by Processes.dest, Processes.parent_process_name, Processes.process_name
```

```yara
rule WebShell_Memory_Java_Exec
{
  meta:
    description = "JVM 内存中的 Runtime.exec 特征（内存马）"
  strings:
    $a = "java/lang/Runtime" ascii wide
    $b = "ProcessBuilder" ascii wide
    $c = "getRuntime" ascii wide
  condition:
    any 2 of them
}
```

## 四、隐蔽性评级（选手法时用）

给每个手法标一个「响度」，直接决定该不该用：

| 响度 | 特征 | 例子 | 建议 |
|---|---|---|---|
| **🔇 静默** | 只留正常业务日志，无告警规则覆盖 | 读公开接口、被动指纹、合法凭据登录 | 首选，能达成目标就别用别的 |
| **🔉 低** | 有日志但不触发告警 | 单次 SQL 探测、单次目录访问 | 可用，控制频率 |
| **🔊 中** | 触发告警但需人工研判 | 批量目录爆破、Kerberoast | 评估是否需要，优先找替代 |
| **📢 高** | 直接触发自动阻断 | 全端口扫描、`lsass` dump、Web 派生 shell | **除非必需，否则换手法** |

**纪律**：同一轮里不要连打两个 📢 ——第一个被拦，第二个也会被同一个规则拦。

## 五、被拦之后：三步定位是谁拦的

顺序不能换，成本从低到高：

```bash
# 1) 换个源 IP 再打一次
#    通了 = 是 IP 信誉/频控拦的，不是规则
#    还是不通 = 规则层拦截，继续 2)

# 2) 换个载荷编码（不改语义）再打
#    通了 = 正则/关键字规则拦的（可绕）
#    不通 = 可能是语义分析或行为检测

# 3) 换一个"合法"请求探同一端点
#    合法请求也 403 = 端点被整体封禁（不是你的载荷问题）
#    合法请求正常 = 确实是载荷被识别

# 判据汇总
#   1 通 → 改用干净 IP / 降频
#   2 通 → 换编码继续（见 waf-bypass）
#   3 不通 → 这条路封了，换端点
```

## 六、与其它技能的分工

- **上游**：任意攻击技能（提供手法）→ 本技能给"这一发有多响"
- **同层互补**：`verification-discipline`（证明真的打中了）、`oob-verification`（无回显判定）
- **下游**：写报告时把检测建议一并给客户；`threat-hunting`（防守方主动狩猎方向）

**MUST NOT**：不要给未验证的手法配检测规则——规则基于错误认知，交付出去是害客户。

## 任务完成自检

- [ ] 每个发现都配了检测规则（默认 Sigma）？
- [ ] 标了响度评级，并说明为什么选这个手法？
- [ ] 规则里有 `falsepositives`（没有就是不可用规则）？
- [ ] 涉及落地文件/内存的，配了 YARA？
- [ ] 被拦时按三步定过位，而不是直接归因为"WAF"？

## 参考

- `verification-discipline`：先证明打中了，再谈响度
- `waf-bypass`：定位为"编码被识别"之后的绕过
- `threat-hunting`：这些规则反过来就是防守方的狩猎起点



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`nikto`、`sqlmap`、`yara`
- `nikto`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `sqlmap`：`python -m pip install sqlmap`（本机有 python）
- `yara`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`attack-traceability`、`verification-discipline`

2. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：流程/编排｜**角色**：`flow`
- **上游**（先做完这些再进来）：`verification-discipline`
- **下游**（产出交给谁）：`attack-traceability`
- **互补**（同类场景一起用）：`attack-traceability`、`verification-discipline`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->
