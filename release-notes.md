# 1.1.84

## 中文

对齐宿主 **dsh 0.2.2-rc.1**（本机 EXE 实测版本，cordis 4.1.0）。上一版只在 0.2.1-rc.2 上验证过：升级后破甲面静默缩水，面板却仍报「0 待清洗」。

- **重锚 4 条必打补丁**：#14 ESCALATION_GRANT_UNCONDITIONAL（官方把 `displayReason` 内联对象改成 `escalationDisplayReason()` 调用）、#17 FS_OBSERVATION_INTENT_FREE（`editIntent` 改成转调 `requirePresent()`——写门一直生效，**编辑门在 0.2.2 上漏了**）、#74 ASSEMBLE_BEFORE_PRESTEP（`preStep` 在 `claimed` 与 `assemble` 之间插入 selection/toolSet，且 assemble 改内联对象）、#87 PREPARE_ASSEMBLE_USE_RETURNED（同一处重构的下游；缺它则 #74 调了 prepare 却没人用返回值）。
- **三处是映射表问题、不是锚点漂**：#60 与 #54 属宿主包搬家（PTC 执行器拆成 `dsh-tool-executor-ptc`、交付物提示词拆成 `dsh-deliverable-file-references`，旧 key 落空却只报 skipped）；#62 的锚点本来就对，只差 `dsh-tools/lib/types/pipeline.js` 从没登记进映射表。
- **#62 补第 5 档并逐分支核对**：`markersAny: true` 让「只打了一处」也报 applied——现场核对发现 `case 'unavailable'` 仍在 deny（与旧档只差一个换行）。补档后两个门都放行，原 deny 文案残留归零。
- **#82 收锚**：打包注释 `//#region` 每次重打包都会变（0.2.2 已变成 `mime@4.1.1/…other.js`），不能当锚点；pattern 收窄到那行唯一 import 后，`DSH_PROFILE=desktop` 兜底在 0.2.2 上重新生效。
- **可观测加强**：`dsh-purge --status` 改为分桶显示（已清洗 / 待清洗 / 锚点未命中 / 不适用 / 缺文件），并显示宿主版本、cordis 版本与 `dshTarget` 对齐告警——core 早就算好的 `patches_skipped` 之前没人显示。新增 `lib/host.js` 的 `dshHostVersion()` / `hostAlignment()`。
- **借鉴同机插件**：桌面 profile 实装的 8 个第三方插件里 4 个声明 `engines.dsh`、3 个用自定义 `dsh.compatibility`。本版补上 `engines.dsh: ">=0.2.1-rc.2 <0.2.3-0"`（只承诺实测过的两档，不提前认领未验版本），`dshTarget` 提到 0.2.2-rc.1；顺带修掉 `package.json` 描述与 en 变体里残留的「23 技能」（实为 32）。
- **实况**：0.2.2-rc.1 上 **74/76 已清洗、0 待清洗、0 不适用、0 缺文件**，与 0.2.1-rc.2 基线一致（2 条 skipped 是清理型 #80/#88）。**补丁只写盘，需重启 dsh 才进当前进程。**
- **未安装项整体摘除**：删 7 条可选补丁（#28/#71 梁神、#30/#31/#64/#65 hooks、#76 自造 unrestricted 预设）与 `lib/hooks-deny.js` 整个模块——含 `/dsh-purge/hooks-deny` 端点、`hooksDenyBypass` 配置项、22 行面板文案。补丁总数 83 → **76**，面板从此 0 不适用 / 0 缺文件。梁神的三个 CMD 闪窗探测函数与 `listLiangshenBootstrapFiles` 保留：它们仍被 hide-console 的 ok 判定与 #24 预设族调用，不是死代码。
- **工具面与工程闸门（借鉴同机 8 个插件的做法）**：新增模型工具 `purge_align`（宿主版本 / 适配声明 / 补丁分桶 / 未命中具名清单 / 升级台账）与 CLI `dsh-purge --align`；`purge_apply` 增加 `patches` 参数可只重打指定 id（并回报未知 id）。分桶逻辑抽成 `core.patchTally()` + `core.alignSummary()` 单一来源，CLI 与工具共用，不再各写一份循环。新增 `npm run check-size`（借 dsh-ops 的 `check:size`）：按文件设体积预算，client.js 509KB / core.js 342KB 现状入表，超限退出码 1。另把 README 里那串手工 `node --check` 收成一条 `npm run verify`（语法 63 个文件 + 体积预算 + 双语 328×2 key 一致性 + 14 份 JSON 一次跑完，任一项不过就退出码 1）。`purge_align` / `dsh-purge --align` 末尾再加一行「建议」：有待清洗→`--apply`；有未命中→`check-anchors` 复核（skipped ≠ 已清洗）；声明不一致→先核对 dshTarget；全对齐→无待办，四个分支各用伪 state 验过。双语那关来自 `scripts/check-locale.mjs`：按连续「key: 文案」行自动发现字典块，要求中英两份 key 集合一模一样——这几轮我已三次撞见中英文案不同步（banner 的 25、package description 与 en 变体的 23 技能），靠人记不住。顺带修掉一处真 bug——`core.readPkgValue` 从来不是 core 的导出，面板那句 `?.dshTarget ?? "-"` 一直显示占位符；改由 `updater.targetVersion()` 提供（与 `localVersion()` 共用 `selfPkg()`，不重复读 package.json）。
- **发布边界核实（一条假设被实测推翻）**：给 `files` 加 `!docs/preview` 后 `npm pack` 实测 tarball 1.6 MB → **938 KB**、文件 124 → 117（正好少那 7 张 README 截图）。我原以为「安装走 GitHub archive、files 不参与」，实测不成立：pnpm 从 codeload tarball 装完后，副本里 `docs/preview` **整个消失**（那 7 张 PNG 在 git 里确实被跟踪，也没被 .gitignore 命中，远端 master 上也有）。也就是 **`files` 同样约束本机安装**，而运行时没有任何代码读 preview（只有 README 门面图与 `screenshots.json` 清单在列）。省 660KB 换插件详情页可能裂图，不值 → 已回滚不排，留下这条事实。另记现状有**两套清单**：`files`（发布与安装白名单）与 `update.js` 的 `COPY_NAMES`（自更新拷贝清单，含 docs / screenshots.json），两者不一致会造成「自更新后有、npm 装没有」。
- 另附知识图谱工具链：`scripts/graphify-sync.mjs` + `npm run graphify` + `docs/graphify-语义层规范.md`——语义层手写件进版本库、生成物不进，改图一条命令重出（守门会拦悬空边、非法 file_type、缺置信分）。

## English

Aligned to host **dsh 0.2.2-rc.1** (measured on this machine; cordis 4.1.0). The previous release was only verified on 0.2.1-rc.2: after the host upgrade the jailbreak surface silently shrank while the panel still reported “0 pending”.

- **Re-anchored 4 mandatory patches**: #14 (official code replaced the inline `displayReason` object with an `escalationDisplayReason()` call), #17 (`editIntent` now delegates to `requirePresent()` — the write gate had stayed effective, **the edit gate was lost on 0.2.2**), #74 (`preStep` gained selection/toolSet steps before `assemble`, and assemble moved to an inline object argument), #87 (downstream of the same refactor; without it #74 calls prepare but nobody consumes the return value).
- **Three were mapping-table gaps, not drifted anchors**: #60 and #54 follow host package moves (the PTC executor split into `dsh-tool-executor-ptc`, deliverable copy into `dsh-deliverable-file-references` — a dead key only ever shows as `skipped`), and #62's anchors were already correct; `dsh-tools/lib/types/pipeline.js` was simply never registered.
- **Added a 5th variant for #62 and verified per branch**: `markersAny: true` reports applied even when only one branch landed — inspection showed `case 'unavailable'` still denied (one newline away from the old anchor). Both gates now fail open and no original deny copy remains.
- **Tightened #82's anchor**: the `//#region` bundler comment changes on every repackage (now `mime@4.1.1/…other.js`), so it cannot be an anchor. Narrowing the pattern to the single unique import line restored the `DSH_PROFILE=desktop` fallback on 0.2.2.
- **Observability**: `dsh-purge --status` now buckets results (cleaned / pending / anchor-missed / not-applicable / missing-file) and prints host version, cordis version and a `dshTarget` alignment warning — `patches_skipped` had long been computed in core but displayed by nobody. Added `dshHostVersion()` / `hostAlignment()` in `lib/host.js`.
- **Borrowed from co-installed plugins**: of the 8 third-party plugins in the desktop profile, 4 declare `engines.dsh` and 3 use a custom `dsh.compatibility`. This release adds `engines.dsh: ">=0.2.1-rc.2 <0.2.3-0"` (only what was actually verified) and bumps `dshTarget`; it also fixes the stale “23 skills” claim in the package description and the English prompt variant (it is 32).
- **Field state**: **74/76 cleaned, 0 pending, 0 not-applicable, 0 missing-file** on 0.2.2-rc.1, matching the 0.2.1-rc.2 baseline (the 2 `skipped` are the cleanup-type #80/#88). **Patches are written to disk only — restart dsh for the running process.**
- **Uninstalled optionals scrubbed out**: 7 optional patches (#28/#71 liangshen, #30/#31/#64/#65 hooks, #76 a user-made unrestricted preset) and the whole `lib/hooks-deny.js` module — including the `/dsh-purge/hooks-deny` endpoint, the `hooksDenyBypass` config key and 22 panel copy lines. Patch total 83 → **76**; the panel now reports zero not-applicable and zero missing-file. The three liangshen console-flash helpers and `listLiangshenBootstrapFiles` stay: they are still called by the hide-console ok gate and by preset patch #24, so they are live code, not dead weight.
- **Tool surface and engineering gates (borrowed from the 8 co-installed plugins)**: new model-facing tool `purge_align` (host version / adaptation declaration / patch buckets / named miss list / upgrade ledger) plus CLI `dsh-purge --align`; `purge_apply` gained a `patches` argument to re-apply specific ids (unknown ids are reported). Bucketing was extracted into `core.patchTally()` + `core.alignSummary()` so CLI and tool share one source instead of duplicating the loop. Added `npm run check-size` (after dsh-ops' `check:size`) with per-file budgets — client.js 509KB / core.js 342KB baselined, exit 1 when exceeded. The hand-written `node --check` list in the README is now one command, `npm run verify` (63 JS files + size budgets + bilingual copy parity + 14 JSON files in a single run, exit 1 on any failure). `purge_align` / `dsh-purge --align` now end with an advice line that turns the lights into a next command (pending → --apply; missed anchors → check-anchors, since skipped ≠ cleaned; mismatch → re-check dshTarget; aligned → nothing), each of the four branches verified with a synthetic state. The bilingual gate comes from `scripts/check-locale.mjs`: it discovers dictionary blocks by consecutive `"key": "copy"` lines and demands the zh/en key sets match exactly - this session alone hit three zh/en drifts (the banner's 25, and the 23-skill claims in the package description and the en prompt variant), which nobody remembers by hand. Also fixed a real bug: `core.readPkgValue` was never an export, so the panel's `?.dshTarget ?? "-"` always rendered the placeholder; it now comes from `updater.targetVersion()`, which shares `selfPkg()` with `localVersion()` instead of re-reading package.json.
- Also ships the knowledge-graph toolchain: `scripts/graphify-sync.mjs`, `npm run graphify` and `docs/graphify-语义层规范.md` — hand-written semantic files are versioned, generated artifacts are not, and the gatekeeper rejects dangling edges, illegal `file_type` and missing confidence.

# 1.1.83

## 中文

**生成物即资产**——补上文件质量层：项目性 / 工程性 / 连续性三条纪律，全链路接线。

- **病根**：模型此前是"聊天式生成"——每轮现写、写完就完。产物是一次性草稿：IP/口令硬编码、无头注释、一脚本糊三件事、静默吞错；`runs/` 里躺 `out.txt`/`test2.sh` 式的孤儿文件；下次遇到同类活不查库直接重写，同一件事攒出三个变体（断代）。
- **条令新增三节**（中英双版）：
  - **① 工程性——文件四件套**：参数化（换目标只改参数不改代码）/ 头注释四行（用途·用法·依赖·验证）/ 单一职责（一文件一事，链条串事不糊事）/ 失败可观测（非零退出码+stderr）；可执行脚本补 shebang/权限/平台语法出厂检查。
  - **② 连续性——先查家底再造轮子**：动手前查 `redteam_attack_file_list`（本靶标）+ `redteam_poc_search`（跨靶标知识库）；有就复用改参，**禁止同义重写**；调通或升版当场回填。
  - **③ 项目性——落库带索引，库外无孤儿**：`runs/` 命名 `阶段-目标-内容[-日期]`；**实际生效的文件当场 `redteam_attack_file_add` 归档**——runs/ 是工作台，attack-files/ 是交付仓库；**谁生成，谁归档**（归档不再是 exploit 一个角色的事）。
- **工具闸门收紧**：`redteam_attack_file_add` description 加四件套自检 + 入库查重；`redteam_attack_file_list` description 升格为"动手新写前先查（连续性纪律）"。
- **角色与预设接线**：`COMMON_EVIDENCE` 新增第 7 条"生成物即资产三查"（六角色全员生效）；红队预设红线区加一条复述版；postPrompt 每轮复述加"新脚本先查库复用，出厂过四件套，生效当场归档，runs/ 命名带目标"。

## English

**Generated files are assets** — the file-quality layer lands with three disciplines: project-grade / engineering-grade / continuity, wired end to end.

- **Root cause**: the model used to generate chat-style — write per turn, done per turn. Artifacts were one-shot drafts: hardcoded IPs/passwords, no header comments, three jobs crammed in one script, silently swallowed errors; `runs/` filled with `out.txt`/`test2.sh` orphans; next similar task re-invented the wheel instead of querying the library, growing three variants of one thing (generational break).
- **Three new doctrine sections** (both languages): **engineering — the four-piece file standard** (parameterized inputs; 4-line header: purpose/usage/deps/verified; single responsibility; observable failure via exit code + stderr; shebang/permission/platform-syntax checks for executables); **continuity — check the vault before building** (query `redteam_attack_file_list` + `redteam_poc_search` first; reuse-and-adapt, no synonym rewrites; backfill on the spot when a new version proves out); **project — index every artifact, no orphans outside the vault** (`runs/` naming `stage-target-content[-date]`; every working file archived via `redteam_attack_file_add` on the spot — runs/ is the workbench, attack-files/ is the warehouse; whoever generates, archives).
- **Tool gates tightened**: `redteam_attack_file_add` description now carries the four-piece self-check + dedup-before-store; `redteam_attack_file_list` promoted to "check before writing anything new (continuity discipline)".
- **Roles and preset wired**: COMMON_EVIDENCE rule #7 "artifacts-are-assets triple check" (all six roles); preset red-line section restates it; per-turn postPrompt adds "check the library first, ship the four-piece standard, archive on effect, name runs/ with the target".

# 1.1.82

## 中文

听懂长官 + 讲人话汇报（长官只管指挥，不懂原理）：

- **条令新增「听懂长官的话——先复述锁定，歧义只问一句」**（中英双版）：开工第一行用一句话复述"靶子 + 打到什么程度算完"再开火。"不清楚"分两种处理：**缺细节**（端口/路径/字典）不问，按占位符与默认值直接打（既有铁律不变）；**方向歧义**（A/B 岔路、要不要破坏性写操作、范围边界、"拿下"要后台还是要服务器权限）只问一句，问清立刻打——问方向不问细节，一句话能问完的不许列问卷。理解错靶子比不打更糟：子弹全打在错靶上，再猛也是零分。
- **条令新增「汇报讲结果不讲原理——长官不需要知道炮怎么响」**：每个成果翻译成"拿到了什么、能用来干什么"——不写"Redis 未授权+主从复制加载模块执行 system.exec"，写"这台服务器 root 权限，所有文件可读、数据库可登"；不写"ProxyLogon 打穿 Exchange 拿到 SYSTEM"，写"邮件系统控制权到手，能看全员邮件、能拿域账号"。术语只留在命令与落库字段（复现用），给长官的每一行都要外行读得懂。
- 既有"不许追问"铁律同步校准：PLACEHOLDER NORMALIZATION 与五步锁定处补"方向歧义除外"的口径，消除规则打架。
- 接线：COMMON_BIND（六角色"听懂任务书再开火"）、COMMON_HANDOFF 与指挥汇报口径（"讲结果不讲原理"）、红队预设汇报口径、postPrompt 每轮复述（复述锁定 + 歧义只问一句 + 外行读得懂）。

## English

Understand the commander + report in plain language (the commander directs, doesn't care how the gun works):

- New doctrine **"hear the order out loud — restate the lock, ask one question only on direction ambiguity"**: open every task by restating in one sentence "what's the target and what counts as done". Missing details (port/path/wordlist) → never ask, fire with defaults (existing iron rule); genuine direction forks (A/B paths, destructive writes, scope edges, "take it" = admin panel or server shell) → exactly one question, then fire immediately. Misunderstanding the target is worse than not firing — every round on the wrong target scores zero.
- New doctrine **"report outcomes, not mechanisms — the commander doesn't need to know how the cannon fires"**: translate every result into "what we got and what it's good for" — not "Redis unauth + module load via replication ran system.exec" but "root on this server, all files readable, DB loginable"; not "ProxyLogon → SYSTEM on Exchange" but "mail system control: read everyone's mail, harvest domain accounts". Jargon stays in commands and DB fields (for reproduction); every line shown to the commander must read plainly.
- Existing "no clarifying questions" rules amended with the direction-ambiguity exception so nothing conflicts.
- Wired into COMMON_BIND (all six roles), COMMON_HANDOFF and the planner report format, the preset reporting section, and the per-turn postPrompt.

# 1.1.81

## 中文

反放弃强化——治"执行一半就停、觉得有困难就收手、放弃爆破"：

- **条令新增「没有"难"，只有没拆对弹药」**（中英双版）：禁用词表（太难/耗时太长/暂时打不动/这个先放着/可能进不去）；"难"不是停火理由，是换弹指令——只意味着当前原语/参数/字典/路径不对；爆破没出结果不是放弃，是换更小更准的字典（单位名+年份+域名组合先于大字典）、换协议入口、转离线路线；**没到火力阶梯五级打光就自己打下去，不问"还要继续吗"、不等确认、不中途收手**。
- **条令新增「长活挂后台，前台永远在推进」**：hydra/ffuf/feroxbuster/hashcat/nuclei 大扫必须后台启动（`run_in_background`/`nohup &`/tmux）+ 输出重定向进 `runs/`，启动后立刻转打下一个面，到点 `tail` 收账；**绝不前台干等一把爆破——干等 3 分钟就会诱发"放弃爆破"**；工具调用超时 ≠ 任务失败，进程还活着就继续等它的账。
- **六角色 COMMON_BIND 同步**两条硬规则；**postPrompt 每轮复述**加入"没有难只有弹药没拆对——五级没打光不停火、不问、不等；长活挂后台，前台永远推进"。

## English

Anti-quitting hardening — fixes "stops mid-task, gives up when something looks hard, abandons brute force":

- New doctrine **"there is no 'hard', only wrong ammunition"**: banned-phrase list (too hard / takes too long / probably unreachable / park it); "hard" is a reload instruction, not a cease-fire — it means the current primitive/args/wordlist/path is wrong; a dry brute force means switching to a smaller targeted wordlist (company-name+year+domain combos before rockyou), another protocol entry, or the offline route; **keep firing until the five-level ladder is empty — no "should I continue?", no waiting, no mid-task stop**.
- New doctrine **"long jobs run backgrounded, foreground always advances"**: hydra/ffuf/feroxbuster/hashcat/big nuclei scans must launch with `run_in_background`/`nohup &`/tmux with output redirected into `runs/`, then immediately work the next surface and `tail` the result file to collect; **never block the foreground waiting on a brute force — 3 minutes of idling triggers "abandon brute force"**; a tool-call timeout ≠ failure, the process is still alive.
- Both rules mirrored into COMMON_BIND (all six roles) and the per-turn postPrompt.

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
