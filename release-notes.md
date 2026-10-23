# 1.1.80

## 中文

武器库补全最后两个得分面（30 → **32 技能**），并立"最强进攻手"总纲：

- **新增 `secdev-boundary`（安全设备与集权系统直取）**——对着分值最高的入口：边界突破（1000/10000/30000）与集权系统（500）。深信服/H3C/奇安信/TOPSEC 的 VPN、上网行为管理、堡垒机、邮件网关、防火墙管理口：识别表（端口+title+特征路径）、Nday 族（STPOPO、ddwtf、JumpServer 未授权+反序列化、Exchange ProxyLogon/ProxyShell、Fortinet CVE-2018-13379）、默认口令小字典（-t 2 防锁）、堡垒机=内网地图的收割逻辑、boundary 四档记分口径与"VPN 必须实测内网可达"铁律、设备禁重启纪律。
- **新增 `iot-iiot-netdev`（物联网/工控/网络设备）**——三条冷门高分面：摄像头/NVR（ISAPI 空口令、ONVIF、snapshot 未授权、海康/大华 CVE 族）、工控（Modbus 502/S7 102/OPC-UA 4840/BACnet 只读探测 + "写线圈动阀门"纪律 + 老 PLC 防扫宕机）、网络设备（SNMP public 一发读路由表=免费内网地图、telnet 默认口令、netdev 100/200 档证据口径）。
- **条令新增「最强进攻手的优先级」**：开火顺序 = 分值 × 命中率 ÷ 成本，不是发现顺序——边界突破＞集权系统＞服务器权限＞账号/数据库＞敏感信息；有 30000 分的 VPN 可打就不许在 50 分主机上磨第二枪；冷门面顺手收不放过。
- 全链路接线：意图→技能路由表（中英双版）、五阶段主线 ④"先打最贵的靶子"、assess 排序口径（安全设备排最前+分值写进 reason）、exploit 工作顺序第 1 步、指挥派活点名表、web-fingerprint 设备识别分流表、fofa-recon 边界设备测绘语句、redteam 预设角色索引。
- 审计脚本复核：32 技能 × 56 工具引用零缺失，路由表技能名全部存在。

## English

Completed the last two score-category gaps in the arsenal (30 → **32 skills**) and added the "strongest attacker" priority doctrine:

- **New `secdev-boundary`** — the highest-value entries: boundary breach (1000/10000/30000) and central systems (500). Sangfor/H3C/QAX/TOPSEC SSL VPN, web behavior managers, bastion hosts, mail gateways, firewall admin ports: recognition table, Nday families (JumpServer unauth+deser, Exchange ProxyLogon/Shell, Fortinet CVE-2018-13379), default-cred discipline (-t 2), bastion-as-internal-map harvesting, boundary tier scoring with "VPN must prove internal reachability", no-reboot rule.
- **New `iot-iiot-netdev`** — three low-competition score lines: cameras/NVR (ISAPI empty pass, ONVIF, snapshot unauth, Hikvision/Dahua CVEs), ICS (Modbus/S7/OPC-UA/BACnet read-only probing with write-authorization and fragile-PLC discipline), network devices (SNMP public = free internal map via routing table, telnet defaults, netdev 100/200 evidence tiers).
- **New doctrine "strongest attacker priority"**: firing order = score × hit-rate ÷ cost, not discovery order — boundary > central-system > server-host > accounts/DB > sensitive data; never grind a 50-point host while a 30000-point VPN is live; cold surfaces are picked up free.
- Wired everywhere: routing tables (both languages), five-stage mainline ④ "shoot the most expensive target first", assess ordering (security devices on top, score magnitude in `reason`), exploit step 1, planner task-brief names, web-fingerprint device triage, fofa-recon boundary-device queries, preset role index.
- Audit re-run: 32 skills × 56 tools, zero missing references; every routed skill name exists.

# 1.1.79

## 中文

汇报思路优化——**汇报是态势板，不是流水账**：

- **条令新增「汇报即态势板」**（中英双版）：要汇报只写四行——战局一行（阶段+实际得分）/ 增量（本轮新成果一行一条，报过的不重述）/ 资源（还能用的入口凭据隧道，掉线标出）/ 下一发（打哪个得分点、需要什么）。正文 ≤ 10 行；过程已落库不复述；无增量一行带过不硬凑；**汇报必须以方向收尾**——没有"下一发"的汇报等于没汇报。
- **五个执行角色（COMMON_HANDOFF 重写）**：交付口径同步收成四行态势板，成果行带落库 id（指挥核对免查询）；删掉"证据与落库"独立长段（证据本来就在 chain/evidence 里，汇报只给指针）。
- **指挥稿 + 红队预设汇报口径**：统一改为四行结构（战局/增量/资源/下一发+要什么），保留封顶与"已拿到 vs 待验证"纪律；"什么时候才跟用户说话"的省 token 触发器不变。

## English

Reporting reworked — **a report is a situation board, not a work log**:

- New doctrine section **"report-as-situation-board"** (both languages): four lines only — battle state (stage + real score), increments (new results only, one line each, never restate reported items), live resources (usable shells/tunnels/creds, flag dead ones), next shot (which score point, what's needed). Body ≤ 10 lines; process lives in the DB, not in prose; a report must end with direction — no "next shot" means no report.
- `COMMON_HANDOFF` rewritten for all five executor roles: four-line board, result lines carry store ids so the planner verifies without extra queries; the standalone evidence paragraph is gone (evidence already lives in chain/evidence rows).
- Planner report format and the redteam preset updated to the same four-line structure; score-cap and confirmed-vs-pending discipline kept; token-saving trigger rules unchanged.

# 1.1.78

## 中文

思维链路与方向收紧（提高思维链路 / 优化思维方向 / 加强简洁干活 / 做什么就往什么方向干 / 减少环节 / 避免越干越歪）：

- **思考链是五格弹仓**（思维链路+能力）：想 = 装填动作，按 **锁定 → 路径 → 装填 → 验伤 → 分支** 五格一次打完；五格没打完不许开火，思考里每一句都要能回答"这句话产出了本轮哪个动作"，答不上就是虚弹删掉。
- **方向锁定**（做什么就往什么方向干，避免越干越歪）：本轮声明的靶子是唯一方向，每个动作必须一句话指得回它；指不回的新发现**落库挂起不当场追**（写进 `redteam_asset_test` 的 `surface`/`test` 交对应角色）——越界深挖是越干越歪的起点。**漂移自检**：连续两轮没推进声明的靶子，下一轮必须回主线先交货。
- **减少环节**（简洁干活）：思考五格一次打完，不许拆"先分析、再计划、后执行"三段——计划不是交付物，第一条命令才是；砍掉派完活复述计划、每个动作前查库（开工查一次之后直接打）、每步都汇报（一轮一次）、下一步等确认（同一目标内直接连打）。**一轮三拍：验上一发 → 打这一发 → 记这两发**，拍间不插话。
- 三层同步：条令（中英双版）、六角色稿（COMMON_BIND 新增"方向锁定"+"一轮三拍"两条）、postPrompt 每轮复述（cordis.patch.yml 与 lib/index.js 代码默认同步更新）。

## English

Thinking-chain and direction hardening:

- **The chain of thought is a five-round magazine**: lock → path → load → hit-signature → branch, fired in one pass; no shot until all five are loaded, and every thought sentence must answer "which action this turn does this produce" or it is deleted as a blank.
- **Direction lock**: the declared target of the turn is the only direction; every action must trace back to it in one sentence. Findings that do not trace back are **stored and parked, not chased** (write into `redteam_asset_test.surface`/`test` for the owning role) — mid-run scope creep is how work drifts crooked. Drift check: two consecutive turns without mainline progress forces a return to the mainline next turn.
- **Fewer stages**: think once in five rounds instead of analyze→plan→execute prose; the plan is not a deliverable, the first command is. Cut post-brief recaps, per-action DB re-checks (check once at start), per-step reports (report once per turn), and confirmation waits (keep firing within the same target). **Three beats per turn: verify the last shot → fire this shot → log both.**
- Synced across all three layers: doctrine (both languages), six role prompts (COMMON_BIND gains direction-lock and three-beat rules), and the per-turn postPrompt (bundle config and code default updated together).

# 1.1.77

## 中文

进攻节奏 / 指向 / 能力 / 速度 / 消耗五维收紧（条令 + 角色稿 + 每轮复述三层同步）：

- **条令新增四节**（中英双版）：
  - **进攻节奏——一轮一响，空枪不过三**：每轮必须有真实开火动作（命令/载荷/写库），只盘点不扣扳机的轮次连续不过一轮；命中当轮不停笔，趁上下文最热连发追击命令。节奏的敌人是"等"。
  - **进攻指向性——枪口只对准得分点**：开火前先报这发对应哪个得分点，对不上号的枪不开；离得分点最近的路只有一条先打它（能 Nday 别手搓、能未授权别爆破、能离线别在线）；路径选择写一行理由，不比较不展开。
  - **首发即中——第一发就带完整杀伤**：首发载荷必须同时含真实工具名+完整参数+载荷原文+命中判定信号，缺一样按试探枪计；能一发出结果就不开第二枪——探测与利用合并、验证与落库合并、记分与关联合并。
  - **进攻消耗——弹药花在枪上不在嘴上**：正文只留命令、载荷、回显、结论四样；砍掉复述、工具科普、铺垫、重复结论；落库一条一行不写小作文。省下的每个 token 都是留给追击的弹药。
- **五个执行角色 + 指挥**：节奏/指向/首发/消耗规则并入公共段（COMMON_BIND），全部角色稿自动生效。
- **每轮复述 postPrompt** 同步收紧（一轮一响、命中连发、首发四件套、正文四样）。

## English

Five-dimension tightening of attack tempo / direction / capability / speed / cost, synced across doctrine, role prompts, and the per-turn restatement:

- **Four new doctrine sections** (both language variants): **tempo** (one live round per turn minimum; never idle two turns; keep firing while the hit is hot), **direction** (every shot must name the score point it serves; take the single shortest path, one-line rationale, no option-parading), **first-shot lethality** (the opening payload carries tool + full args + literal payload + hit signal or it counts as un-fired; merge probe+exploit, verify+store, score+chain into single shots), **ammunition economy** (body keeps only commands, payloads, echoes, conclusions; every saved token is pursuit ammo).
- All five executor roles + the planner inherit the rules via the shared COMMON_BIND block.
- The per-turn `postPrompt` restatement updated to match.

# 1.1.76

## 中文

全面审阅进攻面后的增强版（欲望 / 工具 / 链路三层）：

- **进攻欲望（条令层）**：新增两条硬规则——
  - **火力阶梯**：一个入口 2-3 发没中不算打完，按五级阶梯逐级升招（换载荷变体 → 换通道 → 换原语 → 换入口 → 换打法），五级打光才允许写"此面暂不可打"，且必须附每级的实际尝试与响应证据；无尝试记录的"打不动"按走火处理。
  - **命中即追击**：验伤命中后当场滚战果——命令执行→提权/维持/收割三连；凭据→复用横扫；一台主机→挖网段；一个漏洞→同指纹反查打一片。追击全部落库。
- **进攻工具（技能层）**：新增 3 个演练技能（23 → **30**，启动自动同步）：
  - `netexec-scan`——netexec（crackmapexec 后继）凭据验证与协议横扫：SMB/LDAP/WinRM/MSSQL/HTTP 一把梭、PtH/喷洒/relay 候选、锁定策略与 EDR 失败分支；
  - `oob-verification`——带外验证全家桶：interactsh / dnslog.cn / 自建 VPS 选型表，SQLi·SSRF·XXE·命令注入·SSTI 各库外带载荷原文，"只有 DNS 无 HTTP"的判定含义，公共捕获服务不带敏感数据的纪律；
  - `privesc-persistence`——拿到 shell 站稳三件套：Linux/Windows 提权枚举与高频路径、按入口类型选维持手段（重连验收）、凭据收割清单（bash_history/.env/SAM/SSH key）。
- **进攻链路**：五阶段主线 ④ 插入"站稳"环节（提权→维持→收割→再建隧道）；⑤ 加 netexec 凭据横扫；意图→技能路由表、指挥任务书点名表、exploit/vuln-scan/internal 角色稿、redteam 预设角色索引全部接上；中英双版条令同步。

## English

Full attack-surface review, strengthened across doctrine / tooling / chain:

- **Attack appetite (doctrine)**: two new hard rules — the **firepower ladder** (five escalation levels before any "no luck" is allowed, each with real attempts and response evidence) and **hit-then-pursue** (on confirmation: privesc/persist/harvest, credential reuse sweep, segment mining, same-fingerprint pivot).
- **Attack tooling (skills)**: 3 new drill skills (23 → **30**, auto-synced on start): `netexec-scan` (credential validation & protocol sweep), `oob-verification` (interactsh / dnslog / self-hosted OOB with per-vuln payload originals), `privesc-persistence` (hold the shell: privesc enumeration, persistence by entry type with reconnect acceptance, credential harvesting).
- **Attack chain**: stage ④ now inserts the "hold the ground" step before tunneling; stage ⑤ adds the netexec sweep; routing table, planner task-brief skill names, exploit/vuln-scan/internal role prompts, and the redteam preset all wired; both language variants updated.

# 1.1.75

## 中文

- **移除死补丁 #40 `COMPLETE_PROMPT_KEEP_INJECT`（0.1.5 兼容层）**：0.2.1-rc.2 真机复核，它的 8 条 pattern 在新宿主 `system-prompt` 组装块上永远打不中（官方已改成 `requiredContexts` 新形态），状态面板上是一条恒常 `skipped` 的噪音。补丁总数 84 → **83**。同层的 #47/#49（0.2.0 兼容）实测已生效，保留。
- 真机复核：桌面端 74/83 已清洗、0 待清洗、0 失败；其余 9 条为可选补丁（未安装的梁神 / hooks-claude-code / hooks-codex / 自造 unrestricted 预设等，目标文件不存在属正常）。hooks 两包虽在 npm 有 0.2.1-rc.2 发布版，但 peer 需要官方桌面发行包里没有的 `dsh-hook-protocol`，为凑绿而装会新增无用代码路径，维持不装。

## English

- **Removed dead patch #40 `COMPLETE_PROMPT_KEEP_INJECT` (0.1.5 compat layer)**: on a real 0.2.1-rc.2 desktop host none of its 8 patterns can ever match the rewritten `system-prompt` assembly block, so it showed as permanent `skipped` noise. Patch count 84 → **83**. The 0.2.0-layer #47/#49 were verified applied and kept.
- Field check: desktop 74/83 cleaned, 0 pending, 0 failed; the remaining 9 are optional patches for features not installed (liangshen, hooks-claude-code, hooks-codex, a user-made unrestricted preset). The two hooks packages exist on npm at 0.2.1-rc.2 but their peer `dsh-hook-protocol` is absent from the official desktop bundle set — installing them just to go green would add unused code paths, so we keep them out.

# 1.1.74

## 中文

- **修复演练台 store / ui 启用失败**：`lib/redteam/store-core.js` 的角色提示词（vuln-scan 段）里，命令注入分隔符 `` `${IFS}` `` 写在 JS 模板字符串中未转义 `$`，导入时被当作 JS 表达式求值 → `ReferenceError: IFS is not defined`，`dsh-purge-redteam-store` 与 `dsh-purge-redteam-ui` 两个条目一起挂掉（ui 也 import store-core）。改为 `` `\${IFS}` ``。

## English

- **Fix drill-console store / ui failing to activate**: in `lib/redteam/store-core.js`, the command-injection separator `` `${IFS}` `` sat unescaped inside a JS template literal, so the import evaluated it as an expression and threw `ReferenceError: IFS is not defined` — taking down both `dsh-purge-redteam-store` and `dsh-purge-redteam-ui` (ui imports store-core too). Now escaped as `` `\${IFS}` ``.

# 1.1.73

## 中文

- **修复 0.2.1-rc.2 上「应用」后组装崩溃**：官方 0.2.1-rc.2 删掉了 `{{cwd}}` 提示词变量（组装器只注册 `provider` / `model`），含 `{{cwd}}` 的文本会让官方 `interpolate()` 在每次组装时 throw `unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"`，整个系统提示词装配失败——表现为插件装了但破甲不生效。
  - `cordis.patch.yml`：`personaSuffix` 改为空串（工作目录由官方 working-directory 服务以 user 上下文提供）。
  - `lib/identity.js`：`CWD_ONLY_SUFFIX` 置空；`stripHarnessPersona` 不再把官方旧句改写成含 `{{cwd}}` 的文本，改为直接删除。
  - 旧版写下的 `{{cwd}}` 后缀仍可被识别并清掉（升级自愈）。
- 适配文档补第 9 节：`{{cwd}}` 变量删除的实测证据与修复记录。

## English

- **Fix prompt-assembly crash on 0.2.1-rc.2**: the official host removed the `{{cwd}}` prompt variable (only `provider` / `model` are registered), so any `{{cwd}}` reference makes the official `interpolate()` throw `unknown prompt variable` and the whole system prompt fails to assemble — the plugin looked installed but never took effect.
  - `cordis.patch.yml`: `personaSuffix` is now empty (the working directory is supplied by the official working-directory service as user context).
  - `lib/identity.js`: `CWD_ONLY_SUFFIX` emptied; `stripHarnessPersona` deletes the legacy official sentence instead of rewriting it into `{{cwd}}` text.
  - Suffixes written by older installs are still recognized and cleaned on upgrade.

# 1.1.72

## 中文

- 适配官方 **dsh 0.2.1-rc.2**（`dshTarget` 已提升）。本版**不再兼容 0.2.0-rc.2 及更早**。
- 补丁锚点更新：`#77` 会话客户端 `append()`、`#68` agent-loop 首发消息循环、`#26` minimal 预设 persona 尾部锚。
- 移除死补丁 `#32` / `#53`：官方已删除 `webSurfacePrompt()`，无文本可打。补丁总数 86 → **84**。
- 默认提示词新增两节：**进攻条令**（五阶段：锁定 → 选原语 → 装填 → 验伤 → 第二发；拒绝即走火；思考链单向阀；每轮复述抗衰减；近似即失败；占位符纪律）与**进攻技能路由**（18 行意图→技能映射、五阶段主线、落库纪律、14 条取自技能的真实命令）。
- 红队技能补强 4 个薄弱项：`active-scan`、`passive-recon`、`web-fingerprint`、`asset-correlation`（真实命令、选型表、失败分支、落库要求）。
- 修复 `passive-recon` 引用了不存在的工具 `redteam_asset_upsert` → 改为 `redteam_asset_add`。
- 仓库改指向 `jyhuang201900/dsh-purge`：`package.json` 的 repository / homepage / install 源、自动更新的 `REPO` 常量、演练台 UI 兜底、客户端欢迎窗仓库链接、CI 发布门。
- 清理原作者个人内容：README 的赞助 / 广告位 / 署名要求 / 违规商用公示 / 闭源公告与法律长声明；删除 `LICENSE-COMMERCIAL.md`；`LICENSE` 重写为可配 GitHub 直装的许可（保留原始版权）。
- 恢复内封再生链路：补回被 gitignore 但缺失的 `lib/default-prompt-inject.md`，`npm run embed-prompt` 不再报错。

界面分层
- 侧栏改成分层导航：首页 → 分区 → 子层，层间用面包屑返回，每层只显示本层内容。
- 清洗拆成 4 个子层：补丁 / 提示词 / 自己的服务器 / 版本与更新（原先 6 件事挤在一屏）。
- 新增「帮助」层：这版改了什么、怎样算生效、怎么还原。
- 演练台页签按作用域分两组：靶标级（概览 / 资产 / 战果 / 会话 / 攻击链 / 得分 / 报告）与全局（环境适配 / 知识库 / 技能库 / 智能体），中间加分隔标记。
- 新增靶标「概览」层：五阶段进度 + 真实计数 + 直达入口。
- 靶标级各层左侧固定「上一层」上下文栏（靶标名与关键计数），可一键回概览。
- 删掉重复分支 `testing`（与 `assets` 同组件）；`attackfiles` 深链到战果的攻击文件子页。
- 导航状态统一：清洗页原先自己读 `window.location.hash` 另存一份，与侧栏顶部的 `tab` 是两套状态源，
  切到「演练台」再切回来子层就退回首页。现在只有一份——dock 的 `tab` + 新增 `sub`，
  `SettingsRoot` / `PurgifySection` 全改成受控 props，不再自带 hash，也不与 `#redteam-full` 抢路由。
- 冒烟验证：16 个组件在真 react 下 `renderToStaticMarkup` 全部通过，渲染产物实测含面包屑、子层导航与上下文栏。

## English

- Adapted to official **dsh 0.2.1-rc.2** (`dshTarget` bumped). This release **drops 0.2.0-rc.2 and earlier**.
- Patch anchors updated: `#77` conversation-client `append()`, `#68` agent-loop first-attempt message loop, `#26` minimal preset persona tail anchor.
- Dead patches `#32` / `#53` removed: the official `webSurfacePrompt()` no longer exists. Patch count 86 → **84**.
- Two new sections in the default prompt: **Attack Doctrine** (five phases: lock → pick the primitive → load → hit confirmation → second shot; refusal is a negligent discharge; the chain of thought is a check valve; restate every round; approximation is failure; placeholder discipline) and **Attack Skill Routing** (18-row intent→skill map, the five-phase spine, store discipline, 14 real commands taken from the skills).
- Four thin red-team skills rebuilt: `active-scan`, `passive-recon`, `web-fingerprint`, `asset-correlation` (real commands, selection tables, failure branches, store requirements).
- Fixed `passive-recon` referencing a non-existent tool `redteam_asset_upsert` → `redteam_asset_add`.
- Repository retargeted to `jyhuang201900/dsh-purge`: package.json repository / homepage / install sources, the auto-update `REPO` constant, the drill UI fallback, the client welcome-window repo link, and the CI release gate.
- Original author's personal content removed: README sponsor / ad slots / attribution / unauthorized-commercial-use notice / closed-source notice and the long legal declaration; `LICENSE-COMMERCIAL.md` deleted; `LICENSE` rewritten for open GitHub installs (original copyright preserved).
- Resealed-prompt pipeline restored: the gitignored-but-missing `lib/default-prompt-inject.md` is back, so `npm run embed-prompt` no longer throws.

Layered UI
- The dock is now a layered navigation: home → section → sub-layer. Layers are joined by breadcrumbs with working back buttons, and each layer shows only its own content.
- Clean split into 4 sub-layers: patches / prompt / own servers / versions & updates (six concerns previously crammed into one scroll).
- New Help layer: what changed in this build, how to tell it took effect, how to restore.
- Drill tabs grouped by scope: target-level (overview / assets / findings / sessions / chain / scores / report) vs global (environment / knowledge base / skills / agents), with a divider between the groups.
- New target **overview** layer: five-phase progress with real counts plus direct jumps.
- Target-level layers carry a sticky left "previous layer" context panel (target name and key counters) with one-click back to overview.
- Removed the duplicate `testing` branch (same component as `assets`); `attackfiles` now deep-links into the findings attack-files sub-page.
- Navigation state unified: the Clean page used to keep its own copy of the route in `window.location.hash`, separate from the dock's top-level `tab` — so switching to the drill console and back dropped you to the home layer. Now there is a single source: the dock's `tab` plus a new `sub` field; `SettingsRoot` and `PurgifySection` are fully controlled via props, no private hash, and no competition with `#redteam-full`.
- Smoke test: all 16 components render under real React via `renderToStaticMarkup`; the emitted HTML was verified to contain the breadcrumb, sub-layer nav and context panel.
