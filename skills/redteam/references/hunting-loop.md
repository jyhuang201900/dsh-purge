# 狩猎循环：从假设到可验证查询

> 被 `threat-hunting` 引用。**狩猎是假设驱动，不是数据驱动**——
> 先想「如果我是攻击者会怎么做」，再去找「这件事在日志里长什么样」。

## 一、循环六步（不要跳步）

```
1. 假设   从 ATT&CK 选一个技术，写出「如果发生，会有什么后果」
2. 数据   确认哪些日志源能看见（看不见就别往下走）
3. 查询   把假设翻译成一条可执行查询
4. 结果   三种结局之一（命中 / 未命中 / 数据不足）
5. 处置   命中 → 转事件响应；未命中 → 记录为"已排除"
6. 沉淀   把查询存成可复用规则（Sigma/保存的查询）
```

## 二、假设怎么写（坏假设 vs 好假设）

**坏**：「查一下有没有异常登录」——这不是假设，是任务。

**好**：

```
技术：T1078 有效账户
假设：如果攻击者用了合法凭据登录，会出现
      「同一账号在 1 小时内从两个地理上不可能同时到达的 IP 登录」
后果：如果成立，说明凭据已泄露，且攻击者在用（不是只拿到）
数据：4624（登录）+ 4625（失败）+ 账号的常见 IP 基线
```

**判据**：假设必须能被一条查询**证伪**。不能证伪的假设（「可能有后门」）不是假设。

## 三、查询模板（Windows 安全日志）

```powershell
# 假设：同一账号短时间异地登录
Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624; StartTime=(Get-Date).AddDays(-7)} |
  Where-Object { $_.Properties[5].Value -eq 3 } |   # LogonType=3 网络登录
  ForEach-Object {
    [PSCustomObject]@{
      Time   = $_.TimeCreated
      User   = $_.Properties[5].Value
      IP     = $_.Properties[18].Value
      Workst = $_.Properties[11].Value
    }
  } |
  Group-Object User |
  Where-Object { ($_.Group.IP | Sort-Object -Unique).Count -gt 3 }
```

```kusto
// KQL 版（Defender / Sentinel）
SecurityEvent
| where EventID == 4624 and LogonType == 3
| summarize IPs = make_set(IpAddress, 20), cnt = count() by Account, bin(TimeGenerated, 1h)
| where array_length(IPs) > 3
| order by cnt desc
```

## 四、三种结局怎么处理

| 结局 | 处理 | 禁止 |
| --- | --- | --- |
| **命中** | 立刻转事件响应，固化证据（原始日志 + 时间线） | 不要"再看看"，那会拖成事故 |
| **未命中** | 明确记录「已排除 + 数据覆盖范围 + 时间窗」 | 不要说"没发现异常"就完事——要说清"在多长窗口、用哪些数据"排除了什么 |
| **数据不足** | 记录「缺哪个日志源」，要么去补，要么降低结论强度 | 不要用弱数据下强结论 |

**「未命中」的价值**：它证明了某个假设不成立，缩小了搜索空间。
但必须写明覆盖范围，否则下次还要重查。

## 五、从 ATT&CK 选技术的依据

不要一次选十个。按两条标准筛：

1. **这个环境真的可能有吗** —— 全是 Windows 就别查 Linux 提权
2. **数据源覆盖够不够** —— 没有进程创建日志（4688/Sysmon 1）就别查 LOLBin

```bash
# 快速确认数据源覆盖（先做这个，再选技术）
# Windows：检查关键日志是否开启
wevtutil gl Security | findstr "enabled"
Get-WinEvent -ListLog Security,Microsoft-Windows-Sysmon/Operational |
  Select-Object LogName, IsEnabled, RecordCount
```

## 六、五个高价值假设（可直接开猎）

| # | 技术 | 假设 | 主数据源 | 判据 |
| --- | --- | --- | --- | --- |
| 1 | T1053.005 计划任务 | 非运维账号在非维护窗口创建计划任务，且命令指向 `%TEMP%`/`AppData` | Sysmon 1（`schtasks.exe /create`）+ 4698 | 基线为每天 0-2 条（运维），出现即查 |
| 2 | T1003.001 LSASS 访问 | 非安全软件进程以 `0x1010`/`0x1410`/`0x1fffff` 打开 lsass | Sysmon 10 | 先建白名单；白名单外 1 条即高优先 |
| 3 | T1543.003 服务创建 | 服务 `ImagePath` 不在 `System32`/`Program Files`，且二进制无签名 | 7045 | 路径 + 签名双条件 |
| 4 | T1071 应用层 C2 | 同一 (src,dst,dport) 的包间隔标准差 < 5 秒，且包长几乎恒定 | netflow / Zeek conn | 至少 10 个样本才算 |
| 5 | T1552.001 凭据在命令行 | 命令行含 `password=`/`-p ` + 高熵字符串 | Sysmon 1 | 与正常运维脚本基线对比 |

```powershell
# 假设 1 的可执行查询
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Sysmon/Operational'; Id=1;
  StartTime=(Get-Date).AddDays(-30)} |
  Where-Object { $_.Message -match 'schtasks\.exe.*?/create' } |
  ForEach-Object {
    $x = [xml]$_.ToXml()
    [pscustomobject]@{
      Time   = $_.TimeCreated
      User   = ($x.Event.EventData.Data | Where-Object Name -eq 'User').'#text'
      Cmd    = ($x.Event.EventData.Data | Where-Object Name -eq 'CommandLine').'#text'
      Parent = ($x.Event.EventData.Data | Where-Object Name -eq 'ParentImage').'#text'
    }
  } |
  Where-Object { $_.User -notin @('svc_backup','ops_admin') } |
  Sort-Object Time -Descending
```

```kusto
// 假设 2 的 KQL 版（先建基线，再找偏离）
DeviceEvents
| where ActionType == "OpenProcessApiCall"
| where FileName =~ "lsass.exe"
| where AdditionalFields has_any ("0x1010","0x1410","0x1438","0x143a")
| summarize FirstSeen=min(Timestamp), Cnt=count() by InitiatingProcessFileName, DeviceName
| order by FirstSeen desc
```

```bash
# 假设 4 的心跳检测（用 Zeek 的 conn.log）
python3 - <<'PY'
import csv, statistics
from collections import defaultdict
flows = defaultdict(list)
with open('conn.log') as f:
    for r in csv.DictReader((l for l in f if not l.startswith('#')), delimiter='\t',
                            fieldnames=['ts','uid','id_orig_h','id_resp_h','id_resp_p',
                                        'proto','service','duration','orig_bytes','resp_bytes']):
        try:
            flows[(r['id_orig_h'], r['id_resp_h'], r['id_resp_p'])].append(
                (float(r['ts']), int(r['orig_bytes'] or 0)))
        except ValueError:
            continue

for k, v in flows.items():
    if len(v) < 10:
        continue
    ts = sorted(t for t, _ in v)
    gaps = [b - a for a, b in zip(ts, ts[1:])]
    sizes = [s for _, s in v]
    if statistics.pstdev(gaps) < 5 and statistics.pstdev(sizes) < 20:
        print(f'{k} n={len(v)} gap={statistics.mean(gaps):.1f}s±{statistics.pstdev(gaps):.1f}'
              f' size={statistics.mean(sizes):.0f}±{statistics.pstdev(sizes):.0f}')
PY
```

## 七、查询必须先自证有效（否则"0 条"毫无意义）

**"查询返回 0 条"有三种可能**：真的没有、查询写错、数据没进库。必须逐个排除。

```bash
# ① 字段名存在性（不同 ECS 版本字段名不同）
curl -s 'http://localhost:9200/winlogbeat-*/_mapping' \
  | jq -r '.. | .properties? // empty | keys[]' | sort -u | grep -E 'process|command'

# ② 索引名与时间范围（UTC vs 本地）
curl -s 'http://localhost:9200/_cat/indices/winlogbeat-*?v&h=index,docs.count'

# ③ 健全性检查：查一个"一定存在"的事件
#    例：最近 24h 的 4624。若返回 0 → 数据问题，不是"没人登录"
```

```bash
# ④ 用 atomic-red-team 造一条已知恶意行为，验证规则能命中
git clone https://github.com/redcanaryco/atomic-red-team.git
cat atomic-red-team/atomics/T1053.005/T1053.005.md | grep -A5 'schtasks'
# 在测试机执行其中一条，然后跑查询 → 必须命中
# 命中 = 规则有效；不命中 = 规则写错（不是"环境干净"）
```

**这一步不能省**：没有自证的查询，其"未命中"结论是不可信的。

## 八、产出物：不只是"有没有"

| 产出 | 内容 | 为什么必须 |
| --- | --- | --- |
| **查询库** | 每个假设一个文件，含基线值与验证方法 | 可重复执行，不靠记忆 |
| **基线记录** | 正常分布的均值/方差/白名单 | 没有基线就没有"异常" |
| **检测规则** | Sigma/KQL/YARA，附测试用例 | 固化为自动检测 |
| **缺口清单** | 缺哪个日志源/字段/时间窗 | 驱动采集改进（最有价值的副产品） |
| **覆盖矩阵** | ATT&CK 技术 × 是否有有效检测 | 给管理层看的可见性证明 |

```bash
# 覆盖矩阵（ATT&CK Navigator 可直接导入看热图）
cat > coverage.json <<'EOF'
{
  "name": "Detection Coverage 2024Q1",
  "versions": {"attack": "14", "navigator": "4.9.0", "layer": "4.5"},
  "domain": "enterprise-attack",
  "techniques": [
    {"techniqueID": "T1053.005", "score": 90, "comment": "Sigma 规则 + atomic 验证 + 30d 基线"},
    {"techniqueID": "T1003.001", "score": 60, "comment": "有规则，无基线，误报率高"},
    {"techniqueID": "T1071.001", "score": 25, "comment": "只有代理日志，无 JA3/无 netflow"}
  ]
}
EOF
```

```bash
# Sigma 规则的最小骨架（可直接跑 sigmac 转各平台）
cat > rules/t1053_schtasks_temp.yml <<'EOF'
title: Scheduled Task Created From Temp Directory
id: 1a2b3c4d-0000-0000-0000-000000000001
status: experimental
logsource: {product: windows, service: sysmon, category: process_creation}
detection:
  sel:
    Image|endswith: '\schtasks.exe'
    CommandLine|contains: '/create'
  susp:
    CommandLine|contains: ['\Temp\', '\AppData\', '\Users\Public\']
  condition: sel and susp
falsepositives:
  - 合法的安装程序临时任务（需按软件白名单排除）
level: high
EOF

# 转换并验证
pip install sigma-cli
sigma convert -t splunk rules/t1053_schtasks_temp.yml
```

## 九、狩猎节奏与时间盒

```
[1] 选假设（30 分钟：查 ATT&CK + 本地资产 + 历史事件）
[2] 确认数据可用（15 分钟：字段名 + 时间窗 + 数据量）
[3] 写查询（30 分钟）
[4] 自证查询（15 分钟：用 atomic 或已知事件验证）
[5] 跑全量 + 建基线（视数据量）
[6] 判定三种结局（30 分钟）
[7] 记录 + 固化规则（20 分钟）
```

**单轮上限 2-3 小时**。超时通常意味着"数据不足"，直接记录缺口，换下一个假设。

## 十、验伤：狩猎结论的可信度

| 结论 | 合格证据 | 假象 |
| --- | --- | --- |
| 命中 | 多事件关联的完整链（父子进程 + 网络 + 文件），且能解释为恶意 | 单条可疑日志（可能是误报或正常运维） |
| 未命中 | 查询已用已知恶意样本验证 + 数据覆盖该时间窗 + 有基线 | 查询字段名写错导致恒返回 0 |
| 数据不足 | 明确指出缺哪个日志源/字段/时间窗 | 笼统说"没有发现" |
| 检测规则有效 | atomic 执行后规则命中 | 规则写了但从没验证过 |

**最关键的三个反例**：

1. **字段名错**：`process.name` vs `process_name` vs `Image`。写错就恒为 0。
2. **时区错**：日志是 UTC，你按本地时间查，窗口偏 8 小时。
3. **数据断流**：采集 agent 挂了三天，查询"过去 30 天"实际只有 27 天有数据。

## 十一、检测视角（狩猎过程本身在 SIEM 里是什么样）

狩猎是**防守动作**，但它自己也会产生"看起来像攻击"的信号，必须与 SOC 协调：

| 狩猎动作 | 在 SIEM/EDR 里的样子 | 风险 |
| --- | --- | --- |
| 批量查 lsass 访问日志 | 大量针对 lsass 的查询（只是查询，非访问） | SIEM 审计日志告警 |
| 导出大量事件 | 大批量数据导出 | DLP 告警 |
| 执行 atomic-red-team | **真的执行了 T1053/T1003 等技术** | EDR 高危告警、可能隔离主机 |
| 跑 YARA 全盘扫描 | 大量文件读取、CPU 高 | 性能告警 |
| 用 PSRemoting 批量查主机 | 4648/4624 类型 3 大量出现 | 横向移动告警（**误判**） |

```bash
# 在测试环境执行 atomic 前，先在 EDR 里加白名单（否则会被隔离）
# 或明确告知 SOC：接下来的 2 小时内 10.0.0.50 会执行 ATT&CK 技术测试
```

**关键**：狩猎的"未命中"结论，如果是因为自己触发了告警导致数据被隔离，那就是
**数据不足**而不是"未命中"。要在记录里注明。

## 十二、常见坑

1. **数据驱动代替假设** —— 把日志丢进 SIEM 看排名，被高频噪声带跑。
   没有假设就没有「异常」的定义。
2. **假设不可证伪** —— 「查查有没有横向移动」不是假设；「同一账号 5 分钟内
   从两台主机发起类型 3 登录」才是。
3. **只看命中，不看未命中** —— 未命中的记录同样有价值（缩小范围），但必须写清覆盖范围。
4. **查询没存** —— 辛苦写的查询用完就丢，下次重写。每条有效查询都应存成规则。
5. **时间窗太短** —— 攻击者可能潜伏数周。至少查 30 天，除非数据量不允许。
6. **忽略时区** —— 日志用 UTC，分析用本地时间，差 8 小时会漏掉关键关联。
7. **查询没自证** —— 「0 条」可能是字段名错/索引错/数据断流。必须先用已知事件验证。
8. **不留基线** —— 不知道正常分布就无法定义异常。阈值不能拍脑袋。
9. **狩猎结果不固化** —— 命中了却只写进报告，没有变成规则，下次还得重猎。
10. **狩猎本身触发告警** —— 大量 lsass 查询、批量导出，看起来像攻击。先与 SOC 协调。