# 路由矩阵：题型 → 技能 的映射与误判纠正

> 被 `ctf-sandbox-orchestrator` 引用。误判题型的代价是**整轮方向错**。所以第一步永远是
> **用最少的动作确认题型**，再进入对应技能。

## 一、主矩阵

| 题型 | 判定依据（最先看的三个） | 主技能 | 辅助 |
| --- | --- | --- | --- |
| **Web** | HTTP 服务 / 域名 / 浏览器 | `web-api` → 各类 Web 专项 | `template-render-path`、`file-parser-chain` |
| **Pwn** | ELF/PE 二进制 + 远程 nc 端口 | `reverse-pwn` / `pwn-chain` | `stack-pwn`、`heap-pwn`、`kernel-pwn` |
| **Reverse** | 二进制 + 要求"找 flag/密码" | `reverse-engineering` | `radare2`、`ghidra-reverse`、`ida-reverse` |
| **Crypto** | 数论/编码/大量数字/密钥文件 | `reverse-engineering`（crypto 分支） | — |
| **Misc** | 杂项文件/编码/流量 | `competition-*` 各专项 | `zip-archive`、`pcap-protocol`、`stego-media` |
| **取证** | 磁盘镜像/内存 dump/日志 | `digital-forensics` | `forensic-timeline`、`forensics-triage` |
| **移动** | APK/IPA | `apk-reverse` / `mobile-reverse` | `android-hooking`、`ios-runtime` |
| **硬件/固件** | 固件文件/引脚图/协议 | `firmware-pentest` | `debug-interface-triage`、`firmware-layout` |

## 二、判定的第一步：三个动作

```bash
# 动作 1：这是什么？（文件/网络）
file * 2>/dev/null
ls -la

# 动作 2：有没有网络服务？
# 题目给的地址通常是 host:port
nc -zv target.ctf 1337
curl -sI http://target.ctf:8080/

# 动作 3：文件里有什么明显特征？
strings -n 6 * | head -30
xxd * | head -5
binwalk *
```

| 结果 | 题型 |
| --- | --- |
| 有 HTTP 服务 | Web |
| `ELF 64-bit LSB executable` + 有远程端口 | Pwn |
| `ELF` + 要求输入密码/找 flag | Reverse |
| `.py` 里有大整数/`pow`/`inverse` | Crypto |
| 图片/音频/压缩包/流量 | Misc |
| `DOS/MBR boot sector` / `.E01` / `.raw` | 取证 |
| `Zip archive` 里是 `classes.dex` | 移动 |

## 三、子题型细矩阵（Web）

| 现象 | 子题型 | 技能 |
| --- | --- | --- |
| 登录框 + 注册 | 认证/越权 | `api-security`、`jwt-claim-confusion` |
| 有 `/graphql` | GraphQL | `graphql-rpc-drift` |
| 上传表单 | 文件解析 | `file-parser-chain` |
| 模板渲染明显（`{{`/`${`） | SSTI | `template-render-path` |
| 只有 SPA + JS bundle | 前端逆向 | `js-reverse` |
| 有 `/actuator` | 运行时配置 | `routing-runtime` |
| 代理/网关特征（CL/TE） | 走私 | `request-normalization-smuggling` |
| WebSocket 端点 | WS | `websocket-runtime` |
| 有机器人/管理后台访问 | SSRF/XSS | `competition-ssrf-metadata-pivot` |
| 有队列/异步任务 | 队列注入 | `queue-worker-drift` |

## 四、子题型细矩阵（Pwn / Reverse）

| 现象 | 子题型 | 技能 |
| --- | --- | --- |
| 有 `gets`/`strcpy` | 栈溢出 | `stack-pwn` |
| 有 `malloc`/`free` + 菜单 | 堆 | `heap-pwn` |
| 有 `/dev/` 或内核模块 | 内核 | `kernel-pwn` |
| 有 `seccomp` | 沙箱逃逸 | `pwn-chain` |
| Go/Rust 二进制 | Go/Rust 逆向 | `go-rust-reverse` |
| .NET/Java | 托管代码 | `dotnet-reverse` |
| 有 VM/花指令 | 混淆 | `obfuscators`、`ollvm-deobfuscation` |
| 有 WASM | WASM 逆向 | `reverse-native` |

## 五、子题型细矩阵（Misc）

| 现象 | 子题型 | 技能 |
| --- | --- | --- |
| zip/7z/rar 多层 | 归档 | `zip-archive` |
| pcap | 流量分析 | `pcap-protocol` |
| 图片异常（大/有尾附） | 隐写 | `stego-media` |
| 音频有杂音 | 音频隐写 | `stego-media` |
| 大量数字/编码串 | 编码/古典密码 | `competition-*` |
| 磁盘镜像 | 取证 | `forensic-timeline` |
| 内存 dump | 内存取证 | `forensics-triage` |

## 六、误判纠正（四个高频错误）

### 6.1 把 Reverse 当 Misc

```bash
# 症状：拿到 ELF 但一直在跑 strings/binwalk
file challenge
# "ELF 64-bit LSB executable, x86-64, dynamically linked" → 这是 Reverse/Pwn，不是 Misc
```

**纠正**：`file` 显示可执行 → 用 `radare2`/`ghidra` 看逻辑，不是找隐写。

### 6.2 把 Web 当 Misc（或反之）

```bash
# 症状：拿到一堆文件但没看端口
# 纠正：先看题目给的连接信息（nc/curl 试一下）
curl -sI http://target:8080/ || nc -zv target 1337
```

### 6.3 把 Crypto 当 Reverse

```bash
# 症状：二进制里全是数学运算（大数乘法/模幂）
strings ch | grep -iE 'pow|mod|inverse|gmp'
# 或看导入
rabin2 -i ch | grep -iE 'gmp|bn_'
```

**纠正**：数字很大 + 有 RSA/ECC 特征 → 走 Crypto（数学分析），不要硬逆汇编。

### 6.4 把 Pwn 当 Reverse

```bash
# 症状：二进制有栈溢出但题目给了远程 nc
# 判据：题目给了 host:port 且服务是交互式 → Pwn（要拿 shell）
#      只有本地文件 + 要 flag → Reverse（要读逻辑）
```

## 七、多题型混合的处理

很多题是多层的：

```
[Misc 入口] → 解出 zip → 里面有 pcap → pcap 里有 HTTP → HTTP 有 SQLi → 拿到 flag
```

```markdown
## 分层追踪表（必填）
| 层 | 输入 | 动作 | 产出 | 下一层 |
| --- | --- | --- | --- | --- |
| 1 | challenge.zip | 解压（密码在题目描述） | secret.png | — |
| 2 | secret.png | zsteg | base64 串 | 3 |
| 3 | base64 | 解码 | pcap | 4 |
| 4 | pcap | tshark 提取 HTTP | 上传接口 + 参数 | 5 |
| 5 | HTTP | SQLi | flag | 完成 |
```

**关键**：每层都要记录"输入→动作→产出"，否则多层题容易断在中间。

## 八、验伤：题型判断是否正确

| 结论 | 证据 | 假象 |
| --- | --- | --- |
| 是 Web | HTTP 响应可解析（有 header/body） | 端口开着但是别的服务 |
| 是 Pwn | 二进制有可控输入到危险 sink | 只是有 `gets` 但不可达 |
| 是 Reverse | 能找到校验逻辑 | 只是有 flag 字符串（可能是假的） |
| 是 Crypto | 有明确的数学结构 | 只是数字大 |
| 是 Misc | 文件有隐藏层 | 只是文件损坏 |

## 九、检测视角（这是 CTF，防守视角有限）

| 判断动作 | 对环境的可见影响 |
| --- | --- |
| 端口探测 | 目标侧连接日志 |
| 大量 strings/binwalk | 无（本地操作） |
| 反复试 payload | WAF/服务日志 |

## 十、技能切换的四个时机

| 时机 | 判据 | 动作 |
| --- | --- | --- |
| 解题层变化 | 解出一个新文件/新协议 | 重跑路由矩阵，选新技能 |
| 卡住 20 分钟 | 无新进展 | 重判题型（可能一开始就判错） |
| 发现跨领域线索 | 如 Web 题里出现二进制 | 同时加载两个技能 |
| 工具不适用 | 用错工具（如对 ELF 跑 binwalk） | 换对应技能的工具集 |

```markdown
## 切换记录（示例）
- 10:00 判定为 Misc（给了 zip）→ `zip-archive`
- 10:15 解出 pcap → 切 `pcap-protocol`
- 10:40 提取到 HTTP 上传接口 → 切 `file-parser-chain`
- 11:05 上传被拦（有 MIME 校验）→ 切 `graphql-rpc-drift` 查是否有隐藏接口
- 11:20 找到隐藏的批量上传接口 → 回到 `file-parser-chain`
```

## 十一、平台侧可见性（限流与反作弊）

CTF 通常没有防守方，但**平台会有反作弊与限流**：

| 动作 | 平台侧信号 |
| --- | --- |
| 高频请求 | 速率限制（429）/ IP 封禁 |
| 目录爆破 | 大量 404 会被记录；有些平台会警告 |
| 攻击平台基础设施 | 直接违规（越界） |

```bash
# 控制速率（避免被封）
ffuf -u https://target/FUZZ -w wordlist.txt -rate 50 -t 10
```

**纪律**：只打题目给的 target，不打平台本身。

## 十二、常见坑

1. **不看题目给的连接信息**——很多题的关键在"给了 host:port"或"给了源码"。
2. **拿到文件就跑 binwalk**——ELF 不是归档，binwalk 出来的是噪音。
3. **不看文件类型**——`file` 是所有分析的起点。
4. **忽视多层结构**——单层解题，卡在中间不知道下一步。
5. **不记录分层追踪**——多层题断在中间无法回溯。
6. **误判后不回头**——在错误方向上投入大量时间。设 20 分钟检查点：如果没进展，重判题型。
7. **忽略题目描述**——描述里的每个词都可能是提示（"登录"、"上传"、"监听"）。
8. **不做最小验证**——直接上复杂工具。先用 `file`/`curl`/`nc` 三个基础动作确认。