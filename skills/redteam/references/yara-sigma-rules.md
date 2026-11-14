# YARA 与 Sigma 规则编写：语法、性能、自测

> 被 `malware-analysis`、`threat-hunting` 引用。
> 两条硬要求：**规则必须能在真实数据上跑得动**（性能），**必须自测不误报**。

## 一、YARA：字符串与修饰符

### 1.1 基本结构

```yara
rule Malware_FamilyName_Variant
{
    meta:
        description = "检测 X 家族 Y 变种"
        author = "analyst"
        date = "2026-05-01"
        reference = "https://example.com/report"
        hash = "d41d8cd98f00b204e9800998ecf8427e"
        tlp = "WHITE"
        severity = 70

    strings:
        $s1 = "unique_c2_path_/api/v3/beacon" ascii wide
        $s2 = { 4D 5A 90 00 03 00 00 00 }           // hex
        $s3 = /User-Agent:\s*Mozilla\/5\.0[^\r\n]{0,40}EvilKit/ nocase
        $mz = { 4D 5A }

    condition:
        uint16(0) == 0x5A4D and
        filesize < 5MB and
        (2 of ($s*)) and
        $mz at 0
}
```

### 1.2 字符串修饰符全表

| 修饰符 | 作用 | 注意 |
| --- | --- | --- |
| `ascii` | 匹配 ASCII | 默认 |
| `wide` | 匹配 UTF-16LE（每字符后补 `00`） | 与 `ascii` 可并用 |
| `nocase` | 忽略大小写 | 只对文本串有效，对 hex 无效 |
| `fullword` | 前后必须是"非字母数字" | `fullword` 对 `cmd` 会漏掉 `cmd.exe`？不会，`.` 是非字母数字 |
| `xor` | 匹配单字节 XOR 后的结果 | `xor(0x01-0xff)` 会**极大增加扫描开销** |
| `xor(0x00-0xff)` | 暴力 256 种 | **性能杀手**，只在必要处用 |
| `base64` | 匹配 base64 编码后的形态（3 种偏移） | 字符串需 ≥ 3 字节 |
| `base64wide` | base64 + wide | 同上 |
| `private` | 匹配但不输出 | 用于辅助条件 |
| `regex`（用 `/.../`） | 正则 | 昂贵，尽量加锚点/长度限制 |
| `at <offset>` | 固定在偏移处 | 条件里用 `$a at 0` |

```yara
// 常见组合
$u1 = "powershell -enc" ascii wide nocase
$u2 = "FromBase64String" ascii wide
$h1 = { 48 8B 05 ?? ?? ?? ?? 48 85 C0 74 }     // mov rax,[rip+x]; test rax,rax; jz
$r1 = /https?:\/\/[a-z0-9.-]{4,40}\/(gate|panel|api)\b/ nocase
```

### 1.3 条件写法

```yara
condition:
    // 基础
    uint16(0) == 0x5A4D                       // PE
    and filesize < 10MB
    and filesize > 4KB

    // 计数
    and #s1 > 2                               // $s1 出现 > 2 次
    and 3 of ($s*)                            // 至少 3 个字符串命中
    and all of them                           // 全部命中
    and any of ($s1, $s2, $s3)

    // 位置
    and $h1 at 0x400
    and $mz in (0..1024)

    // 数值从文件读
    and uint32(0x3c) < filesize               // e_lfanew 合理
    and uint32(uint32(0x3c) + 0x18) == 0x20b  // PE32+ 可选头 magic

    // 模块相关（扫描进程内存）
    and for any section in pe.sections : (
        section.name == ".text" and section.raw_data_size > 0x1000
    )

    // 复杂逻辑
    and (
        2 of ($net*) or
        (1 of ($net*) and 2 of ($persist*))
    )
```

| 关键字 | 用途 |
| --- | --- |
| `them` | 所有字符串 |
| `$s*` | 通配所有以 `s` 开头的 |
| `at` | 精确偏移 |
| `in (a..b)` | 范围内 |
| `#a` | 出现次数 |
| `@a` | 第一次出现的偏移 |
| `!a` | 第一次出现的长度 |
| `for any of` / `for all of` | 迭代 |
| `defined` | 变量是否定义（模块用） |

### 1.4 性能陷阱（最影响实战）

| 写法 | 问题 | 改法 |
| --- | --- | --- |
| `$a = "MZ"`（2 字节） | 命中率极高，几乎每个文件都有 | 至少 4 字节或加 `fullword`/上下文 |
| `xor(0x00-0xff)` | 每个偏移 256 次比对 | 只在少数必要字符串上用，或缩小范围 `xor(0x01-0x20)` |
| 无锚点正则 `/[a-z]+/` | 回溯爆炸 | 加长度上限 `{1,40}`，加字面前缀 |
| `for all i in (0..filesize)` | 逐字节 | 不要这么做；用 `uint32()` 定点读 |
| 大量 `wide` 串 | 每个串要扫两遍 | 只在真需要时用 |
| `filesize` 不限制 | 扫描大文件/镜像 | 加 `filesize < N` |
| `pe.*` 模块在非 PE 上 | 解析失败但仍尝试 | 先用 `uint16(0) == 0x5A4D` 门闩 |

```yara
// 反面教材：这样写会拖垮扫描
// $a = "exe"
// $b = /.*/
// condition: xor(0x00-0xff)

// 正面：
rule Good_Perf
{
    strings:
        $anchor = "unique_marker_string_8chars_min" ascii
        $hint   = { 48 8B 05 ?? ?? ?? ?? 48 85 C0 }
    condition:
        uint16(0) == 0x5A4D and
        filesize < 20MB and
        $anchor and $hint
}
```

```bash
# 性能实测：用 -s（显示匹配）+ 计时
time yara -r -w rule.yar /samples/big_dir/ 2>/dev/null | head
# 关键指标：每秒扫描字节数 / 单文件耗时
# 用 -w 关闭警告，减少输出开销
```

## 二、YARA：模块

| 模块 | 用途 | 需显式 import |
| --- | --- | --- |
| `pe` | PE 头/节/导入/导出/资源/签名 | `import "pe"` |
| `elf` | ELF 头/节/符号 | `import "elf"` |
| `math` | 熵、均值、序列 | `import "math"` |
| `hash` | md5/sha1/sha256（2 字节以上串） | `import "hash"` |
| `dotnet` | .NET 元数据（类/方法/GUID） | `import "dotnet"` |
| `magic` | libmagic 类型 | `import "magic"` |
| `time` | 时间戳比较 | `import "time"` |
| `console` | 调试输出（`console.log`） | `import "console"` |

```yara
import "pe"
import "math"
import "dotnet"

rule PE_Suspicious_Sections
{
    condition:
        uint16(0) == 0x5A4D and
        pe.number_of_sections >= 1 and
        for any section in pe.sections : (
            section.name == ".text" and
            section.characteristics & pe.SECTION_MEM_EXECUTE != 0 and
            section.characteristics & pe.SECTION_MEM_WRITE != 0      // RWX 节
        )
}

rule High_Entropy_Overlay
{
    condition:
        uint16(0) == 0x5A4D and
        math.entropy(0, filesize) > 7.2 and
        pe.number_of_sections > 0
}

rule DotNet_Obfuscated
{
    condition:
        dotnet.is_dotnet and
        // 存在 #US（用户字符串）与 #~（元数据）流
        for any s in dotnet.streams : ( s.name == "#US" ) and
        for any s in dotnet.streams : ( s.name == "#~" ) and
        // 混淆器常伴随大量 GUID 或资源
        (dotnet.number_of_guids > 30 or dotnet.number_of_resources > 10)
}
```

> 注意：`dotnet` 模块的字段随 YARA 版本变化（常见为 `is_dotnet` / `number_of_streams` /
> `streams[i].name` / `number_of_guids` / `number_of_resources` / `assembly.name`）。
> 写规则前先 `yara --version` 并用 `yara -d` 或最小样本试跑，不要凭记忆写字段名。

```yara
// 常用 PE 字段
pe.imphash() == "..."                    // 导入表 hash（家族识别）
pe.number_of_signatures == 0             // 未签名
pe.timestamp > 1600000000                // 编译时间
pe.entry_point == 0x1234
pe.sections[i].name == ".aspack"
pe.imports("kernel32.dll", "VirtualAlloc")
pe.exports("MyExport")
pe.is_dll()
pe.is_pe()
```

## 三、YARA：自测（不误报的硬流程）

| 步骤 | 做法 | 通过标准 |
| --- | --- | --- |
| 1. 正样本命中 | 对 3+ 个同家族样本跑 | 全部命中 |
| 2. 负样本不命中 | 对系统目录/常见软件跑（10k+ 文件） | **0 命中** |
| 3. 近邻不命中 | 同类型但不同家族（其他 RAT/勒索） | 0 命中 |
| 4. 性能 | 单文件 < 50ms，全目录可接受 | 无超时 |
| 5. 变体鲁棒 | 改字符串、加壳后仍命中 | 命中率 ≥ 80% |

```bash
# 1) 正样本
yara -r my_rule.yar /samples/family_x/ -w

# 2) 负样本（最关键）：扫大量干净文件
yara -r my_rule.yar /usr/bin/ /usr/lib/ -w -s 2>/dev/null | head
# Windows：用 C:\Windows\System32 与 Program Files

# 3) 只看命中文件名（快速判断误报面）
yara -r my_rule.yar /clean_corpus/ -w | cut -d' ' -f2 | sort -u | head -20

# 4) 性能
time yara -r my_rule.yar /clean_corpus/ -w > /dev/null

# 5) 变体：改一个字节后测（字符串匹配应仍命中）
```

```yara
// 用 private 串做"必要条件"，避免误报放大
rule Better_Structure
{
    strings:
        $mz = { 4D 5A }
        $a1 = "config_key_A" private
        $a2 = "config_key_B" private
        $sig1 = "unique_string_one"
        $sig2 = "unique_string_two"
    condition:
        $mz at 0 and
        $a1 and $a2 and             // 两个 private 作门闩
        (1 of ($sig*))              // 再命中一个特征
}
```

## 四、Sigma：结构与字段映射

### 4.1 基本结构

```yaml
title: Suspicious PowerShell Encoded Command
id: 6f8b1f2e-3c4d-4a5b-9e7f-0123456789ab
status: experimental
description: 检测使用 -enc 的 PowerShell，且命令行包含长 base64
references:
    - https://attack.mitre.org/techniques/T1059/001/
author: analyst
date: 2026/05/01
tags:
    - attack.execution
    - attack.t1059.001
logsource:
    category: process_creation
    product: windows
detection:
    selection_img:
        Image|endswith:
            - '\powershell.exe'
            - '\pwsh.exe'
    selection_flag:
        CommandLine|contains:
            - ' -enc '
            - ' -EncodedCommand '
            - ' -e JAB'
    filter_benign:
        ParentImage|endswith:
            - '\sccm.exe'
            - '\Microsoft.ConfigurationManagement.exe'
    condition: selection_img and selection_flag and not filter_benign
falsepositives:
    - 部署工具使用编码命令（已用 filter 覆盖）
level: medium
```

### 4.2 修饰符（Sigma 的"匹配语义"）

| 修饰符 | 语义 | 例 |
| --- | --- | --- |
| `contains` | 子串 | `CommandLine\|contains: '-enc'` |
| `startswith` / `endswith` | 前后缀 | `Image\|endswith: '\cmd.exe'` |
| `re` | 正则 | `CommandLine\|re: '.*-e[A-Za-z0-9+/=]{20,}'` |
| `all` | 列表全匹配 | `CommandLine\|all\|contains: [...]` |
| `base64offset` | base64 编解码偏移匹配 | 用于编码命令 |
| `windash` | 同时匹配 `-` 与 `/` 参数前缀 | `CommandLine\|windash\|contains: ' -enc '` |
| `cidr` | 网段 | `DestinationIp\|cidr: 10.0.0.0/8` |
| `gt` / `lt` | 数值比较 | `EventID: 4624` + 字段比较 |
| `fieldref` | 字段引用比较 | `TargetUser == SubjectUser` |
| `expand` | 展开 `%ComSpec%` | `Image\|expand: '%ComSpec%'` |

```yaml
# 多值 + 修饰符组合
detection:
    selection:
        EventID: 4688
        CommandLine|contains|all:
            - 'certutil'
            - '-urlcache'
            - '-split'
    condition: selection
```

### 4.3 字段映射（跨后端的关键）

| Sigma 字段 | Windows 事件 | Sysmon | 说明 |
| --- | --- | --- | --- |
| `Image` | 4688 的 NewProcessName | EventID 1 的 Image | 进程路径 |
| `CommandLine` | 4688 的 CommandLine | 1 的 CommandLine | **需开审计** |
| `ParentImage` | 4688 的 CreatorProcessName | 1 的 ParentImage | 父进程 |
| `User` | 4624 的 TargetUserName | 1 的 User | 账号 |
| `TargetFilename` | — | 11 的 TargetFilename | 文件创建 |
| `DestinationIp` / `DestinationPort` | 5156 | 3 的 DestinationIp | 网络 |
| `TargetObject` | 4657 | 12/13/14 的 TargetObject | 注册表 |
| `Hashes` | — | 1 的 Hashes | 需配 |
| `Signature` | — | — | 部分后端 |
| `ParentCommandLine` | — | 1 的 ParentCommandLine | 父命令行 |

```yaml
# 明确 logsource（不同后端映射不同）
logsource:
    product: windows
    service: security        # 走 Security 通道（4688）
# 或
logsource:
    product: windows
    category: process_creation   # 走 Sysmon 1（如果后端把 Sysmon 1 归到这类）
```

## 五、Sigma：转换（sigmac / sigma-cli）

### 5.1 现状

| 工具 | 状态 | 用法 |
| --- | --- | --- |
| `sigmac` | **已弃用**（旧版） | 不推荐新项目 |
| `sigma-cli`（pySigma） | **现行** | `sigma convert -t <backend> rule.yml` |
| `sigma convert` 后端 | splunk / elasticsearch / opensearch / sentinel / qradar / ... | 见 `sigma list targets` |

```bash
# 安装
pip install sigma-cli
sigma plugin list                     # 已安装的 backend 插件
sigma plugin install splunk           # 装后端
sigma plugin install elasticsearch

# 转换
sigma convert -t splunk rule.yml                   # 输出 Splunk SPL
sigma convert -t splunk --without-pipeline rule.yml  # 不套 pipeline（字段名原样）
sigma convert -t elasticsearch -p ecs_windows rule.yml   # 套 ECS 字段映射
sigma convert -t sentinel rule.yml

# 批量
sigma convert -t splunk -p splunk_windows rules/ -o out.spl
```

| Pipeline | 作用 |
| --- | --- |
| `ecs_windows` | 映射到 Elastic Common Schema |
| `splunk_windows` | 映射 Splunk 的 CIM 字段名 |
| `sysmon` | Sysmon 字段归一 |
| `windows_audit` | 走 Security 事件（4688）而非 Sysmon |
| `azure_monitor` | Azure Sentinel 表/列名 |

```bash
# 查看可用 pipeline
sigma list pipelines
# 生成自定义 pipeline（字段名不一致时）
sigma plugin install pySigma-pipeline-...
```

### 5.2 转换后的验证

```spl
// Splunk 产物（示例）
index=windows sourcetype=WinEventLog:Security EventCode=4688
  (NewProcessName="*\\powershell.exe" OR NewProcessName="*\\pwsh.exe")
  (CommandLine="* -enc *" OR CommandLine="* -EncodedCommand *")
  NOT (CreatorProcessName="*\\sccm.exe")
```

```text
验证三件事（转换后必做）：
  □ 字段名在当前后端存在（不是空字段）
  □ 通配符语义正确（Splunk 用 *，ES 用 wildcard 语义）
  □ 大小写/空格（Splunk 不区分大小写；ES 取决 mapping）
```

## 六、Sigma：规则质量自测

| 检查 | 做法 | 通过标准 |
| --- | --- | --- |
| 命中已知恶意 | 用 Atomic Red Team（隔离实验室）跑对应技术 | 有告警 |
| 不命中正常基线 | 用 1 周的生产基线日志回放 | 误报 < 阈值（按环境） |
| 字段存在 | 在真实索引里 `| fieldsummary` | 无空字段 |
| 性能 | 查询时间 | 不超时（加索引/时间窗） |
| ATT&CK 映射 | tag 正确 | 与技术 ID 对应 |

```text
Atomic Red Team 用法（仅授权实验室）：
  Invoke-AtomicTest T1059.001 -TestNumbers 1
  → 触发后检查 SIEM 是否告警
  Invoke-AtomicTest T1059.001 -TestNumbers 1 -Cleanup
```

## 七、检测视角（用规则反查自己的规则）

| 你的规则 | 可能被绕开的方式 | 加固 |
| --- | --- | --- |
| `CommandLine contains '-enc'` | 用 `-e`、`-ec`、大小写变体、`/enc` | 加 `windash` + 多值 |
| `Image endswith '\powershell.exe'` | 改名为 `ps.exe`；用 `pwsh`；用 `-Command` 从 stdin | 加父进程/网络条件 |
| 只匹配字符串 | 样本改字符串 | 加结构条件（PE 特征/导入） |
| YARA 只匹配 wide | 样本用 ascii | 两者都加 |
| 只匹配 `MZ` | 任何 exe 命中 | 加唯一字符串 |

## 八、验伤信号

| 声称 | 证据 |
| --- | --- |
| "规则可用" | 正样本命中列表（文件名 + 规则名）+ 负样本 0 命中 |
| "性能可接受" | 具体耗时（扫描 N 个文件 / X 秒） |
| "Sigma 转换成功" | 转换后的查询语句 + 在真实索引里跑通（有结果或 0 结果但字段有效） |
| "覆盖了 ATT&CK T####" | tag + 该技术的 Atomic 测试命中 |

**反例（看起来成功其实是假）**：

- 规则在样本上命中 → 但命中的是 `MZ` 或 `This program cannot be run in DOS mode`
  这种通用串
- 负样本"0 命中" → 因为你只扫了 10 个文件；要扫上万
- Sigma 转换成功 → 但字段名在前端不存在，查询永远返回空（`0 结果` 被误读为"没有攻击"）
- 只在 Sysmon 上验证 → 客户环境没有 Sysmon，规则等于没用（要按实际数据源写）

## 九、常见坑

1. **YARA 字符串太短**——2–3 字节串几乎必然误报。至少 6–8 字节或用 hex 结构。
2. **`xor(0x00-0xff)` 无节制**——扫描性能下降 100 倍以上。只在必要时用，且缩小范围。
3. **不设 `filesize` 上限**——扫到磁盘镜像/大压缩包时超时。
4. **正则无锚点**——`/.*token.*/` 会回溯爆炸。加字面前缀和长度上限。
5. **Sigma 的 `contains` 在 ES 上是 `wildcard`**——语义不完全等价（ES 的 wildcard 对
   `analyzed` 字段无效），要 `keyword` 字段或 `.raw`。
6. **不区分数据源**——写 4688 的规则但环境只开 Sysmon，字段名不同。
7. **只做正样本测试**——误报是规则真正的杀手，负样本必须覆盖系统目录。
8. **Sigma 规则无 `filter`**——几乎所有"可疑行为"都有合法场景（部署工具/监控代理），
   没有 filter 的规则在生产环境会被关掉。