# 逆向 Agent 工作流：静态→动态→结论，与转人工的判据

> 被 `malware-analysis`、`radare2` 引用。顺序不能颠倒：**静态先建立结构，动态验证假设，
> 结论必须能回指到某条证据**。

## 一、六阶段顺序

```
[1] 接管        —— 文件类型、哈希、来源、约束（是否加壳、是否损坏）
[2] 静态测绘    —— 段/导入/导出/字符串/编译器特征
[3] 关键点定位  —— 入口、主逻辑、可疑 API、配置解密函数
[4] 动态验证    —— 跑起来看实际行为，验证静态假设
[5] 结论        —— 行为清单 + 能力判定 + 证据引用
[6] 交付        —— 报告 + IOC + 检测规则
```

**每条结论必须能回指**：`"样本会写入 Run 键" ← 静态：地址 0x401234 调用 RegSetValueEx；
动态：Sysmon 事件 13 记录 HKCU\...\Run\Updater`。

## 二、[1] 接管（5 分钟）

```bash
# 指纹
file sample.exe
sha256sum sample.exe
md5sum sample.exe

# 是否加壳（熵）
rabin2 -I sample.exe | grep -E 'arch|bits|canary|nx|pic'
# 熵 > 7.0 → 加密/压缩
python3 -c "
import math, collections
d = open('sample.exe','rb').read()
c = collections.Counter(d)
print('entropy:', -sum(v/len(d)*math.log2(v/len(d)) for v in c.values()))"

# PE 结构
rabin2 -S sample.exe | head -20    # 段
rabin2 -i sample.exe | head -20    # 导入
rabin2 -E sample.exe | head -20    # 导出
```

**加壳判定**：段名异常（`.upx`/`.aspack`/随机名）、段权限 `rwx`、导入表极少（只有
`LoadLibrary`/`GetProcAddress`）、熵高。

```bash
# UPX 直接脱
upx -d sample.exe -o sample_unpacked.exe

# 其他壳需要手工：找 OEP → dump → 修复 IAT
```

## 三、[2] 静态测绘

```bash
# 字符串（分编码）
strings -n 8 sample.exe | head -40
strings -el sample.exe | head -20        # UTF-16（Windows 常见）

# 可疑字符串
strings -n 6 sample.exe | grep -iE 'http|cmd|powershell|inject|mutex|key|pass'

# 编译器/语言特征
strings sample.exe | grep -iE 'go1\.|rustc|python|mscoree|MSVCP|libgcc'
# Go: "go1.x"；Rust: "rustc"；.NET: "mscoree.dll"；Python 打包: "PYZ"
```

```bash
# r2 快速看关键点
r2 -A -q -c 'iI; afl~sym.; izz~http; ii~Reg|Create|Inject|Crypt; q' sample.exe
```

**四个"关键点"的定位方法**：

| 关键点 | 定位方法 |
| --- | --- |
| 入口 | `ie`（entrypoint）；`afl~main` |
| 主逻辑 | xref 到关键字符串（`axt @ str.xxx`） |
| 可疑 API | `ii~CreateProcess`、`ii~RegSetValue`、`ii~InternetOpen` |
| 配置解密 | 找 `CryptDecrypt`/`CryptStringToBinary` 的调用者 |

## 四、[3] 关键点定位（最耗时）

```bash
# 1) 找用某个 API 的地方
axt @ sym.imp.CreateProcessW

# 2) 找引用某个字符串的地方（配置/C2）
izz~http
/r @ str.http_0x402000    # 谁引用了这个字符串

# 3) 找主函数（main 常被混淆）
afl~main
afl~entry
# 从 entrypoint 往下跟

# 4) 找解密函数（特征：循环 + 异或 + 引用大数组）
#    搜 xor 指令
/x 30                # xor al, [reg]
#    或看大数组的引用
px 256 @ 0x403000
```

```bash
# 静态定位配置的典型流程
# 1) 找大块不可读数据（段里的 .data）
rabin2 -S sample.exe
# 2) 找引用它的代码
/r @ 0x403000
# 3) 反汇编引用处，看解密循环
s 0x401200; pdf
```

## 五、[4] 动态验证

```bash
# Windows：Procmon 抓三条线（进程/文件/注册表）
# 过滤：Process Name is sample.exe
```

```powershell
# Sysmon（更适合自动化）
Get-WinEvent -LogName 'Microsoft-Windows-Sysmon/Operational' |
  Where-Object { $_.Id -in 1,3,11,12,13,22 } |
  Select-Object TimeCreated, Id, @{n='Msg';e={$_.Message -replace "`r`n",' | '}} |
  Select-Object -First 30 | Format-List
```

```bash
# Linux/ELF
strace -f -e trace=execve,openat,connect,write -o trace.txt ./sample
ltrace -f -o ltrace.txt ./sample     # 库调用
```

```bash
# 网络：抓包 + 看实际外联
tcpdump -i any -w dyn.pcap host not 10.0.0.1
tshark -r dyn.pcap -Y 'dns.flags.response==0' -T fields -e dns.qry.name | sort -u
```

**动态要验证的四个静态假设**：

| 静态假设 | 动态验证 |
| --- | --- |
| "这段是解密函数" | 下断点看解密后的内存 |
| "这个字符串是 C2" | 抓包看是否真的连 |
| "会写 Run 键" | 看注册表是否被改 |
| "会注入进程" | 看是否有远程线程 |

## 六、[5] 结论的结构

```markdown
## 样本结论

**基本**
- SHA256: `abc123...`
- 类型: PE32+ (x64), .NET / Go / 原生
- 加壳: 无 / UPX / 自定义（已脱）
- 编译时间: 2024-01-15（PE 头，可能被篡改）

**能力清单**（每条带证据）
| 能力 | 静态证据 | 动态证据 |
| --- | --- | --- |
| 持久化 | 0x401234 调用 RegSetValueEx（`axt @ sym.imp.RegSetValueEx`） | Sysmon 13: HKCU\...\Run\Updater |
| C2 通信 | 0x402000 的字符串 `https://c2.evil.com/api` | pcap: TLS SNI=c2.evil.com，每 60s 一次 |
| 数据收集 | 0x401500 调用 GetUserName + GetComputerName | API hook 记录到实际调用 |
| 文件加密 | 0x401800 循环 + CryptEncrypt | 观察到 .docx 被改名为 .docx.locked |

**未确认**（明确列出）
- 是否下载二次载荷：动态期间未见 HTTP GET 到 payload URL（可能需特定条件）

**IOC**
- 域名: c2.evil.com
- IP: 203.0.113.5
- 文件路径: %APPDATA%\Updater\svc.exe
- 注册表: HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Updater
- Mutex: Global\MySample_1a2b3c

**检测规则**
- Sigma: 见 `rules/persist_run.yml`
- YARA: 见 `rules/sample.yar`
```

## 七、转人工的五个判据

| 判据 | 说明 |
| --- | --- |
| **多层加壳/VM** | 脱壳后还有 VM（如 VMProtect），静态分析成本极高 |
| **反调试极其顽固** | 多轮绕过失败，动态无法稳定 |
| **逻辑在服务端** | 样本只是薄客户端，关键逻辑在 C2（需协议分析） |
| **需要真实环境** | 样本检测特定业务系统/域环境，沙箱里不触发 |
| **时间盒用尽** | 90 分钟没有实质进展 |

```markdown
## 转人工交接

**已完成**：静态测绘（段/导入/字符串）、动态运行（进程/网络/文件）
**卡点**：VMProtect 3.x 保护，OEP 定位失败（3 次尝试均被反调试踢出）
**已知事实**：
- 外联 c2.evil.com（TLS，SNI 可见）
- 写入 %APPDATA%\svc.exe 并设 Run 键
- 有 mutex `Global\xxxx`
**建议**：转动态协议分析（hook send/recv 拿明文）+ 人工脱壳
```

## 八、验伤：逆向结论的可信度

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 能力判定 | 静态地址 + 动态行为**双证** | 只有字符串里出现 "http" |
| 算法还原 | 本地复刻结果与原样本一致 | 只是看懂了大概 |
| C2 确认 | 实际网络流量（含数据交换） | 只有 DNS 查询 |
| 持久化确认 | 注册表/文件真的被创建 | 只是调用了 API 返回失败 |
| 脱壳成功 | 脱壳后能正常分析（导入表修复） | dump 出来跑不起来 |

## 九、检测视角

| 阶段 | 信号 |
| --- | --- |
| 样本落地 | 文件创建在异常位置（AppData/Temp） |
| 执行 | 父进程异常（Office/浏览器 → cmd） |
| 持久化 | Run 键/计划任务/服务 |
| 网络 | 首次外联、心跳、大流量 |
| 反分析 | 检测 VM/调试器的 API 调用 |

## 十、样本接手的三个时间盒

| 阶段 | 上限 | 超时动作 |
| --- | --- | --- |
| 静态测绘（类型/段/导入/字符串） | 20 分钟 | 记录基本指纹，直接进动态 |
| 关键点定位（找主逻辑/配置） | 40 分钟 | 转动态（让行为告诉你哪里重要） |
| 脱壳（如需） | 30 分钟 | 转人工，记录卡点 |
| 总计（单个样本） | 90 分钟 | 出阶段性结论 + 未确认清单 |

```markdown
## 时间盒记录（示例）
- 0-15min   静态测绘：PE32+, .NET, 无壳, 导入表完整
- 15-45min  关键点：找到 C2 字符串 0x402000 的 xref → 0x401A20
- 45-70min  动态：Procmon 抓到 Run 键写入；pcap 抓到 TLS 到 c2.evil.com
- 70-90min  结论整理 + YARA 规则
```

## 十一、检测视角（分析行为的环境信号）

| 分析动作 | 环境可见性 |
| --- | --- |
| 静态（r2/Ghidra/strings） | 无（本地只读） |
| 动态（沙箱/VM） | 样本自身的反分析检测会触发（见 §4） |
| 网络抓包 | 无（被动） |
| 调试运行 | `ptrace`/`DebugActiveProcess`；样本可能检测到 |
| 内存 dump | 需要高权限；可能触发 EDR |

**注意**：分析自己的样本时，环境隔离是第一位的。样本可能检测到分析环境并**延迟触发**
（等 30 分钟），所以运行时长要给够。

## 十二、常见坑

1. **顺序颠倒**——先动态再静态，看到一堆行为但不知道为什么。静态先建立结构。
2. **不记录地址**——结论说"会加密文件"但说不出是哪段代码。必须带地址。
3. **加壳样本直接动态**——壳会反调试 + 混淆行为。先脱壳。
4. **只看字符串**——字符串可能是诱饵/未使用。要 xref 确认真的被调用。
5. **动态只跑一次**——样本可能有分支（检测到沙箱走 A，真实环境走 B）。多次 + 加固环境。
6. **不记录"未确认"**——只写已知的，读者会以为已经完整。
7. **IOC 不验证**——把"字符串里出现的域名"当 IOC，实际可能是库的默认值。要动态确认。
8. **时间盒不设**——在脱壳上耗一天。设 90 分钟，超时转人工并记录卡点。