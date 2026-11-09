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
- **双语文案拆开（构建期内联，运行时加载方式不变）**：`client.js` 里两份硬编码字典（各 329 条）抽出为 `locale/zh.json` + `locale/en.json`，新增 `scripts/build-locale.mjs` 把它们内联回 `client.js` 的标记区间（`npm run build:locale`）；`exports` 加 `./locale/*.json`、`files` 与 `COPY_NAMES` 同步加 `locale`，所以 `npm run check:manifest` 照样盯着分叉。等值性不是「看起来对」：内联块与 JSON 源做了逐条、逐值、**含顺序**的深比对（329×2 全等），并特意确认写回后 **CRLF 原样保持**——这里踩过一次坑：`client.js` 是 CRLF，python 读会自动归一成 LF 所以抽取正常，而 node 读保留 `\r\n`，导致 `build-locale` 第一次匹配不到旧字面量。拆分还顺手规范了两处历史脏格式（`nav` 是裸 key、`rewind.*.hint` 两条缩进 5 个 tab），双语闸门计数因此从 328 变成真实的 329。空串 `ph.content` 两边都有，是有意占位，不是缺文案。
- **`op=update`：一个 op 收三个写方法，闸门第一次真拦住了我**。写面审计得 **29 个写方法 / drill 覆盖 9（31%）**，但 `updateVuln`、`updateWebshell`、`updateTunnel` 共用同一形状 `update*(id, rowId, patch)` —— 于是**一个 op 收纳三个方法**，符合我上轮定的比例规则（新 op 必须收纳 ≥3 方法或一整条流程），`drill_ops_max` 因此 16 → 18 并把规则写进注释。
  实测把 store 的两个坑都堵在工具层：① `updateVuln` 对枚举做**静默过滤**（`VULN_STATUSES`/`SEVERITIES` 之外的值返回 `updated:true` 却什么都没改），所以我在调用前先校枚举并在 `updated:true` 之后**强制回读**（`回读 severity=critical status=exploited evidence=回显 408`）；② `updateWebshell/Tunnel` 空 patch 会 `throw 'nothing to update'`，我把它翻成「列名可能不在表里」而不是异常。九种输入实测：缺 entity / 不支持的 entity / 缺 row（直接列现有 `#1`）/ 错枚举（提前拦下并说明"store 会静默不改"）/ 正常改（回读三字段）/ 不存在的 id（`updated:false` 并指回 `op=list`）/ tunnel 单列设置 / 错列名，全部给出下一步而不是失败。
- **两处顺手修的逻辑链缺口**：`op=list` 原来不印行 id（模型拿不到 id 就没法 update，是我自己造的拒绝链），现在每行以 `#<id>` 开头；且可改的三个实体额外带状态后缀，于是**改完用同一条 list 就能复核**（实测 `high/candidate` → `critical/exploited`）。另外 `op=update` 落地时闸门当场报 `purge_drill 1606 > 单工具预算 1600` —— 我**选择削描述（row 与 op 串各瘦几字）而不是抬预算**，削完 1569 回归合规；闸门拦人时先改代码、后考虑改门槛，这条我会一直记着。
- **写面审计 + 长尾抽样：接 `op=open` / `op=switch`，把最大的一条拒绝链自己拆掉**。写侧实测 **29 个写方法**，drill 原本只覆盖 9（31%）；但真正的收获是发现 `openEngagement(name, scope)` 与 `setActiveEngagement(id)` 在普通 node 进程里直接可用 —— 也就是说"本机 0 靶标时 drill 只能劝你去界面/切红队预设"这条死路是**我们自己造的**。于是加两个 op（复用 `name`/`target`/`engagement` 三个已有参数，零新增），十步行为序列实测：`summary`(空) → `open`(缺 name 给例句) → `assets`(空态引导已改成 `purge_drill op=open ...`) → `open name=example.com` → `open name=内网段` → `switch`(缺参列现有靶) → `switch engagement=内网段` 带 `校验 active=... ✓` → `switch` 到不存在的靶给清单而不是抛错 → `summary` 显示 2 个靶 → `chain_add` 直接记进新靶。
  一个非预期的真实行为值得记：**`openEngagement("example.com")` 把 id 规范化成 `example-com`**（点→横线），所以输出里显示的是真 id 而不是用户输入，避免"我以为叫 example.com"的错位。写面覆盖因此升到 **11/29**。
  社区侧补上长尾盲区：抽 `page=40/80/120/160/202` 得 163 条（**star 全为 0**，确为长尾），补丁/优先级治理族仅 2 条、restart∩patch 交集仍为 0 → **「无人做提示词优先级治理」在 2163/10063（21%）抽样下成立**。最接近的哲学邻居是 `dsh-dialog-fence`（通用规则 + 按对话追加规则、固定顺序注入上下文快照）。
  反堆叠预算本轮开始咬人：`可发现性 op 16/16` 正好撞上 `drill_ops_max: 16` —— **再加一种 op 就会红**，届时必须先把新面折进 `kind`/`entity`。
- **读面覆盖率审计 + 把「反堆叠」写成闸门**。实测 store 的 92 个方法可分成 **读 29 / 写 28 / 其他 35**（路径、db 句柄、目录等），`purge_drill` 已覆盖读面 **20/29（69%）**。剩下 9 个逐个判过价值：`activeEngagementId` 是内部件、`searchTemplates` 实测 `dir:null`（模板目录未配置，接进来就是空面）、`probeSessions` 缺 id 会走到 `db(undefined)` 抛 TypeError（与 `listPrompts` 同族），价值都不高；真正有用的是 `reportTargets`。
  于是本轮**没有再加 op**，而是把 `reportTargets` 折进现有 `op=report` 的 `kind`（`kind=targets`），**零新增参数**、只涨 109 字符，输出还极短（实测 `目标汇总…117 字符 / 2 行`，一行就是 `10.0.0.7（ip @ 未归属）漏 1｜high1｜控 1`）。
  为了让这个纪律不靠自觉，`check-tools` 新增 `drill_ops_max: 16`（当前 14）：**以后想加 op 得先过预算，能折进 kind/entity 的不许再摊成 op**。渲染字段同样是量出来的——`reportTargets().targets[]` 真字段是 `{key,label,kind,segment,stats:{vulns,bySeverity,accesses,credentials,files,chainSteps}}`，我第一版按 `x.target/x.vulns` 渲染直接输出空项目符号；表头也剔掉了 `totals.targets` 以免「targets=1 … targets=1」重复。
- **`op=report` 接入战报与得分报告（先量体量再定截断）**：实测 `report(id).markdown` 是 385 字符 / 31 行，而 `scoreReport(id)` 是 **2685 字符 / 108 行** —— 直接吐出来就是 108 行上下文，所以按 `limit` 截（缺省 14 行）并在尾行写「…另 N 行（加 limit=31 看全量）」，把放宽方式告诉模型而不是让它猜。零新增参数：`kind` 复用（attackfile 的类别 / report 的 `score` 开关），**drill 仅涨 75 字符（1222 → 1297，预算 1600）就拿到整个战报面**；`stats` / `summary` 的数值字段一并给出，模型不读 markdown 也能判断战况。可发现性门禁自动跟到 `op 14/14`。
- 一个流程改进立刻见效：上轮四条边被守门判悬空之后，这轮我**在写语义层之前先用 graph.json 校验目标 id**，结果一次通过（`validationErrors: []`），不用再"写完—被拦—回改"。顺带量到 `redteam_asset_add` 的建行方式其实是 `listAssets(id, {ip, limit:1})`（查询即建行），而 `listAssets` 支持 filters。
- **量到并修掉一个真 bug：`report()` 在真实使用路径上会抛。** 根因是 `openEngagement(name, scope)` 把 scope **原样存进 `scope_cidrs`**（数组语义），而 `redteam_engagement_open`（`tools.js` L421）与界面 op（`store-core` L780）传的都是**字符串** → `report()` L5066 的 `(meta.scope_cidrs || []).join(', ')` 直接抛 `is not a function`，**面板战报和 redteam_report 工具一起中招**。修法按「写时归一 + 读时容错」：新增 `cidrList()`（串按逗号/分号/空白切成多个 CIDR），写入与五个读取点统一走它，历史脏 meta 也不会炸。回归五种形态全绿（串 / 数组 / 逗号多串 / 空 / 手工写脏的字符串 meta），战报授权范围行正确。
- **顺手纠正我自己写进文档的一个误判**：前几轮我说过「store 没设 PRAGMA/WAL，多进程共写会抢锁」。实测两件事——`store-core` 里确实搜不到 `PRAGMA/journal_mode`，但靶标目录里躺着 `assets.db-wal` / `assets.db-shm` → **node:sqlite 默认就是 WAL**，我把锁风险高估了。代码注释、语义层与本页都按真值改正（changelog 里的旧条目不重写，另记此条更正）。
- **再接入 `op=pocs`（POC 弹药库，此前完全没暴露）**：`searchPocs` + `pocStats` 实测可用，输出含库总量/已验证/带正文/被复用/按 kind 分布与清单，`text` 直接当检索词复用。形状又教了我一次：`byKind` 是 **`[{kind,n}]` 数组**而不是对象 map，我第一版当对象渲染直接 `Cannot convert object to primitive value`。成本侧这次是**组合的极限例证：drill 只涨 8 字符（1214 → 1222）就多一整个能力面**，因为参数全复用；可发现性门禁同步升到 `op 13/13`。
- **`--mcp-probe`：把「等重启才能验」变成一条命令 + 一个不依赖重启的端到端证明**。新增 `lib/mcp-probe.js`（`probeMcpEndpoint({baseUrl, timeoutMs})`），对 `POST /dsh-purge/mcp` 跑三步协议矩阵并分四态给结论：`live` / `not-live`（405→解释为"宿主进程未加载该路由，重启即可"）/ `unreachable` / 缺 `baseUrl`，前两者 exit 0、后两者 exit 1，**自家诊断工具也不许把异常抛给人**。关键验证不需要你重启：本地起一个用同一份 `mcpRespond` 的 stub server，探测得到 `state=live`、`tools/list 9 个`、`tools/call` 出文本。
  过程中修掉两处我自己的缺陷：① probe 只给第一步包了 try，第二三步连接挂住会抛 `AbortError` 崩掉整条命令（现在三步都有兜底）；② 默认 8s 超时太紧——实测**冷启动 `purge_align` 单次要 10055ms**（要读宿主目录/asar），直接把默认放宽到 20s，并把每步耗时打进输出行，让"慢"成为可观测信息而不是失败。另清掉一处只写不读的 `doers` 变量。真实运行中的宿主目前如实报 `待重启（路由未加载）`。
- **借目录站的「三级证据」收录法做成第 11 项自查，结论是 purge 早已全满足（`9 项核对，问题 0`）**：tier1 README 写安装命令 ✓（每份 5 处、含 `--profile web add` 与 `--profile desktop add` 两种句式）；tier2 `package.json` 有 `dsh.bundle` ✓（我们是 `{patch: "./cordis.patch.yml"}`，并校验指向的文件真存在）；tier3 包元数据声明 dsh 依赖 ✓（`peerDependencies.@deepseek-ai/cordis ^4.0.1`）。
  三条判据都取自实测而不是措辞猜测，其中两次纠正是关键：① 我原本用精确串 `dsh plugin add` 判 tier1，结果**7 个已装插件全部不成立**——生态真实写法是 `dsh plugin --profile <web|desktop> add`，判据错了会误杀所有插件；② 官方确实把 `dsh.bundle` 当准入信号——宿主 `client.js` L15679 的字段说明就是 *"Whether the version declares a `dsh.bundle`"*，而 `dsh-client-modules/index.js` L1065 还规定了可选的 `dsh.bundle.platforms` 必须是**非空字符串数组**（purge 未声明，故形状校验按"若有才校验"）。
  反向探针做了两轮才对：第一轮只抹掉一种句式，tier1 仍 3/3 —— 因为 README 里还有另一种句式满足正则，**这不是空转而是我探针没打中**；第二轮抹掉全部 5 处，闸门准确报 `✗ README 缺安装命令（tier1）`、exit=1，恢复归零。
  于是"要不要上目录站"从愿望变成清单：**三级证据全绿，缺的只有「发 npm」这一个动作**（dshmp 按 `npmName` 索引）。
- **样本推到 2000 条后，两条结论被证实、一条被纠正**（40 页并发抓 + 每页 4 次重试；`page` 有效、去重后仍 2000，约占标称 10063 的两成）。
  证实之一：**purge 独占「补丁 + 重启」组合** —— 提到需重启的 26 条、提到补丁的 36 条，**同时提到两者的为 0**，最接近的只有 `dsh-setting-restart`（管重启交互）与官方 `dsh-base`（第一层 patch layer，不谈重启）。
  证实之二：`injection:0`、`patch:0` 在两千条规模上依然为 0，而带 Web UI 的占 **72.5%（1450/2000）**、`web-ui` tag 却只有 69 家 —— **tag 换发现率本来就不可靠**，别把它当战略。
  纠正之一：我上一轮按 600 条样本选了单数 `skill`，更大样本显示 `skills:64 / skill:41` **词形分裂、都不占绝对多数** —— 与 purge 已并存的 `dsh-plugin`/`dsh-plugins` 同理，两个都留；同时补上安全类里唯一有点量的英文 tag `security:20`（purge 原本没有）。`WANT_TAGS` 因此扩到 7 个，实测 `生态 tag 7/7 在位`。定位段已写进三语 README，且刻意避开 "N patches" 句式以免被第 7 项误判成过期声明（实测 `声明 4 处、过期 0 处`）。
- **同地盘地图（600 条去重样本，社区探索第一次做「对手判定」而不是只看清单）**：`/api/plugins?page=1..12` 采样（`page` 有效；`?tag=` 被忽略——带参数与不带的 `total` 完全相同，别把不生效的参数读成过滤）。粗筛提示词/注入/补丁/规则/人设命中 66 条，强条件（`AGENTS.md` / system prompt / 优先级 / 人设）收窄到 19 条，逐个读完**没有一个与 purge 抢同一件事**：其余多为记忆类只是描述里提到 prompt；最接近的是 `dsh-agent-studio`（图形化拼装、"按预设绑定即接管、卸载即恢复"）与 `dsh-persona-dafeiyu`（人设 + 全局/工作区/会话三档），而三档生效这件事 **purge 早就有**（`readCwdSelections`/`ancestorChainForCwd`/`workspace_policy`，`purge_rules` 已经把策略与 cwd 候选报给模型）；结构上最近的邻居其实是官方 `dsh-base`（每个 profile 的第一层 patch layer），它占 bundle 层、purge 占文件补丁层，不冲突。
- **tag 词表的真相与一次克制**：600 条样本里 `injection:0 / patch:0 / rules:0 / policy:1 / prompt:4 / persona:4`，而 `mcp:49 / memory:27 / skill:16 / cli:11` —— purge 地盘的词汇在生态里几乎没有 tag，说明我们做的事少见，也说明用 `injection`/`patch` 换不到发现率。据此只补一个「生态在用 + purge 真具备」的 **`skill`**（16 家在用，purge 实带 32 个 drill 技能），并纳入 `check-package` 第 9 项（实测 `生态 tag 5/5 在位`）；**`persona` 主动不加**——purge 只注入一个默认人设（小码酱），不是人设管理器，加了是拿误导换曝光。另复核 purge 仍不在目录里：缺的是**发 npm 这个动作**，不是字段。
- **MCP 加上第二条通路：宿主内 HTTP 端点 `POST /dsh-purge/mcp`（streamable-http），不必再不起子进程**。前提是先证实而不是假设：宿主 `dsh-mcp-client/lib/index.js` L38 的 `createTransport` 明确支持 `stdio` 与 `streamable-http`（`new StreamableHTTPClientTransport(new URL(config.url))`），purge 侧有现成的 `readJsonBody(request, maxBytes)`。协议处理**没有复制第二份**：把原来 stdio 循环里的分支抽成 `mcpRespond(raw, ctx)`，stdio 与 HTTP 共用，循环只剩「读一行 → 调它 → 有回应才写」。九项协议矩阵单测全过（`initialize` 回显客户端 protocolVersion、`ping` 回 `result:{}`、`tools/list` 9 个、`tools/call` 出文本、未知工具 -32602、未知方法 -32601、通知返回 null 不回话、解析错误 -32700、批量只回带 id 的那条）。
- 过程中三个真实小坑，全都被当场抓住：① 我自己把 `ping` 写成了 `return fail(0,"") ?? null`，会回 error 而不是 `result:{}`；② `node --check` 通过但 handler 里引用了 **index.js 根本不存在的 `mcpRespond` / `readPkgJson`**（运行时才炸，正是 MEMORY 里那条老坑），已补 import 并换成现成的 `updater.localVersion()`；③ 我用对照组钉死了 **405 的语义**——`/dsh-purge/zzz-not-exist` 也是 `POST=405 GET=404`，所以运行中的 405 只代表「这条 POST 路由还没有」，要等重启，不能读成「路由存在但不支持 POST」。
- **`check-tools` 工具面闸门（`verify` 升到七关）：把「手量的数字」变成「永久预算」**。这几轮我反复在测工具面成本（drill 曾占 45%、status 返回值 13K），但那些数只存在于对话里 —— 现在落成五道断言：结构完整性（9 个工具，名字/描述/严格 parameters/execute/output.render 齐全）、描述+schema 预算（实测 2938，上限 3600；单工具上限 1600，当前最大 `purge_drill`=1214）、**只读默认返回值预算**（上限 1500 字符 / 20 行，当前最大 `purge_status`=538/15 行，apply/revert 会改宿主文件所以不进闸门）、摘要版有界（217 字符）、以及**可发现性**：`KNOWN` 里每个 op、读写两张 entity 表里每个键，都必须出现在参数描述里，否则等于加了个模型看不见的隐藏能力（实测 op 12/12、entity 16/16 = 读 10 + 写 6）。
- 两处按我自己立的规矩做的验证：**反向探针**（从描述里藏掉 `attackfile_add` → 闸门立刻红、退出码 1；恢复归零，证明闸门会咬人而不是常绿）；以及一次**空转自查**——第 5 项第一版写成 `entity 0/0 通过`，原因是正则要求值后跟 `{` 而 `DRILL_ENTITIES` 的值是字符串，**「0/0」正是假保证的形状**。另外第 10 项把「几关」这种最易漂的说法也纳入自证：从 `verify.mjs` 读实际关卡数并要求 README 中英两侧一致，顺手修掉四处过期口径（README 中英、规范目录树、语义层 label 与超边名）。
- 社区方法论补一条警告：目录站 `?sort=stars` 排的是**上游仓库 star**（`dsh-base` 26 万、`archify-dsh` 8.7 万，而 `dsh-mnemon` 才 695），不是插件热度 —— 用 star 找「最强能力」会误导，别拿它当质量信号。
- **用目录站的 JSON API 定量定口径，挡掉两次「照抄冲动」（`check-package` 加第 9 项）**：`https://dshmp.com/api/plugins` 实测 **`total=10063`、每页 50、202 页**（`perPage` 参数被忽略）。它的条目字段只有 `slug/npmName/name/description/version/license/homepage/totalStars/totalForks/hasWebUi/publishedAt/updatedAt/tags`，**`compatibility` 出现率 0/50** —— 于是同机 codex-harness 那种 `dsh.compatibility` 数组被判定为"没有消费方的元数据"，purge **不照抄**；目录按 `npmName` 索引而 purge 不在表内，真正的门槛是有没有发 npm（不是字段齐不齐）。tag 分布 `deepseek-harness:36 / cordis:6 / mcp:5`，UI 类只有 `ui:2 / web-ui:1`（**没有统一约定**，我原先想补的 `dsh-plugin-web-ui` 因此放弃），而首页 50 条里**安全/红队类 tag 为零**——purge 那 5 个安全 tag（含两个中文）基本是自言自语。最终只补两个同时满足「目录站在用 + purge 确实具备」的：`mcp`（本轮自己做的 stdio server）与 `cordis`（本来就是 Cordis bundle），并用第 9 项钉住：**反向探针实测抽掉就红（退出码 1），恢复归零**。
- **`check-package` 包自证闸门（对标社区市场的 manifest 准入，`verify` 升到六关）**：市场用 bundle manifest 判插件可信，purge 走 GitHub tarball 分发，只能自证。八项核对里前七项是静态口径（必需字段、`engines.dsh` 是否真覆盖 `dshTarget`、`files` 每项存在、`exports` 每个目标存在、`screenshots.json` 每张图存在、中英 README 逐字节一致），第八项才是本轮真正的价值：**扫全部「当前口径」文件里的每条数量声明，逐个与运行时真相比对** —— 数字直接 `import { ALL_PATCHES }` 取，不再用正则数数组猜。这条门治的是本仓库反复复发的老毛病（banner 曾写 25 patches、description 与 en 变体曾写 23 技能，实为 76/32）。首跑就抓到两处假保证：我的中文正则匹配不到现在改成英文的 `"32 drill skills"`，而 README 里根本没有「N patch」字样——**从没触发过的断言等于没有断言**；同时故意排除 `release-notes.md`，changelog 里的旧数字是历史事实不是谎言。实测：声明 5 处、补丁 76 / 技能 32、问题 0。
- **社区探索（两个目录站都真取到了）**：`dsh-mcp-lazy` 的「**one stable proxy tool instead of N tool schemas**」与 `dsh-mcp-lens` 的「load exact schemas on demand」，说明我把 26 个能力面收进 1 个 `purge_drill`、给 `purge_status` 加两个门，走的是生态共识而不是个人偏好；`mneme` 的「10 tools + MCP server + CLI」也与我这边三消费方同构。规模参照 **1958 仓库 / 1819 真插件**、MCP 类目 208–489 个；`dsh-harness-mcp-server`、`dsh-chatgpt-bridge` 已把 DSH 本身做成 MCP server，所以 `--mcp` 属既有类目。`mcp__<server>__<tool>` 命名在宿主源码 L97 本地证实。社区痛点与 purge 同源：MCP 配置手写 YAML、改配置要重启。结论落到 `docs/dsh-mcp-ecosystem-notes.md`，其中一条自我约束是 **`dsh.compatibility` 等市场字段先不硬加**——purge 不在目录站里，没确认消费方之前不照抄。
- **`purge_drill` 再加 `op=entity_add`（一个 op 覆盖六个写面）**：写面的麻烦在字段词汇不统一，所以先从 `store-core` 源码里把各 `add*` 的 `required` 抛错抽成表（`credential.host`、`access.host`、`webshell.url`、`shot path or data_base64`，而漏洞行用的是 `target` 不是 `ip`），再用 `DRILL_WRITE_ENTITIES` 把统一的 `target/name/kind/text` 映射到各实体真实列。因为四个参数本来就在契约表里，**六个写面只涨 92 字符 schema（≈15 字符/面）**，按「每面一个工具」堆要约 1140。实测六实体逐个写入并回读为 1 条、首条显示正确（`vuln→title=Fastjson 反序列化`、`credential→secret_type=password`、`access→method=ssh`、`webshell→url=…`、`tunnel→kind=socks5`、`http→method=GET`）；缺 entity、给错 entity、给 shot/poc 这类不支持实体都走引导而不是异常。**明确不接的两个**：`shot`（`addShot` 会真拷贝源文件，相对路径按靶标目录解析，没有文件就是假接）、`poc`（`savePoc` 签名不吃 id）。
- **`purge_drill` 的 `op=list` + `entity`：用组合代替堆叠（本轮最大能力增量）**：先统计 56 个 preset 工具的功能族分布（`asset:9 poc:6 attack:4 score:4 session:3 vuln:3 shot:3 webshell:3 tunnel:3 …`），确认「给每个查询面加一个 op 或一个工具」就是重新堆叠。做法是加一张 `DRILL_ENTITIES` 表把 `vuln|credential|access|webshell|tunnel|web|http|shot|prompt|segment` 映射到 store 现成的统一 `list*` 方法——实测 **+156 字符 schema 换 10 个查询面（约 16 字符/面）**，按「每面一个工具」堆要约 1900 字符（约 190/面）。十个 entity 逐个实测通过，写入真数据后读回也正确（`title=Fastjson 反序列化`、`secret_type=password`、`method=ssh`、`label=首页截图`）。显示列名是按真实 row keys 校正的：漏洞用 `title` 不是 `name`，凭据是 `secret_type/username/privilege`，我原先按工具层直觉写的 `kind/user/value` 一个都不存在。另记下 store 的两处行为：必填校验会直接点名（`credential.host required`、`shot path or data_base64 required`），`addShot` 会**真的拷贝源文件**（相对路径按靶标目录解析）。
- **社区（这次绕过了 403）**：`linux.do` 有真帖「deepseek harness 有哪些好用的插件推荐的」；生态存在两个插件目录站 **dshmp.com** 与 **dsh-plugin.net**（含 MCP 类目），另有 `dsh-plug-mcp` 给 MCP 做了「设置→插件→MCP」的 GUI（社区痛点是配置要手写 YAML）。命名约定确认：官方 `@deepseek-ai/dsh-mcp-client` 把外部 MCP server 的工具注册成 **`mcp__<服务名>__<工具名>`**，所以 purge 被连上后模型看到的是 `mcp__dsh-purge__purge_drill`。npm 侧 `@deepseek-ai/cordis` 最新仍是 4.1.0（11-04），`dsh-web-app`/`dsh-base` 在 npm 上只是 0.0.1-rc.1 占位，说明**宿主版本不能靠 npm 判定**，`engines.dsh` 的上界还得靠本机实测。
- **先量化再决定拆不拆（这轮把「不是简单堆叠」落到数字上）**：实测每个工具的 `description + JSON.stringify(parameters)` 字符数，`purge_drill` 一个工具占全工具面的 **45%**（1256 / 2798），其余 8 个平均约 190。本能否定「按读/写拆成两个工具」——拆完公共的 op/engagement 与描述要各写一份，估算约 1500 字符，**反而更贵**。真正的成本源是「12 条参数各自复述自己属于哪个 op」，于是把要求编码进 op 串（`chain_add(text)|score_add(point,text,value?)|attackfile_add(target,name,text,kind?,content?)`，159 字符讲清 10 种 op），参数描述缩成一句话：结果 **1256 → 966 字符（-23%）**，drill 占比 45% → **39%**，全工具面 2798 → **2508**，而 12 个参数、10 种 op 一个没减。另修两处：CLI `--drill [op]` 可带 op（我上一版误把它从 mode 白名单删掉，导致打整篇 status，自己造的回归自己认），以及把 op 合法性校验提到「无靶标」判断之前——否则 0 靶标机器上 `--drill bogus` 只会说「没有靶标」，把真实原因（op 写错）盖掉，未知 op 现在直接回全 10 种可用 op。

- **`purge_drill` 第三个写 op `attackfile_add`（台账 + 磁盘双落地，实测确认）**：store 要求 `target + name + evidence + (content|path)` 四件，缺任一都抛错——工具层改成一次返回「还缺哪几件」的合并清单，并把 `content` 默认成 evidence，省掉「为写一条记录先造个文件」。实测四种输入：全缺→合并提示；缺两件→只列缺的；写成功→`台账 1 条，落盘=10.0.0.7/slowloris.py` 且磁盘上真的有这个文件；同名再写→按 `(target,name)` upsert，台账仍 1 条。至此 drill 有 7 个读 op + 3 个写 op，工具描述里那句「只读」也顺手删掉（它已经过期）。
- **`purge_drill` 再接两个写 op（`chain_add` / `score_add`），失败全部当场分诊**：不重载读语义、不给 56 个工具硬挂定义，写入后立刻回读确认（实测 `已写入｜回读 1 条，末条=recon:nmap 摸到 3 个端口`）。store 没设 PRAGMA/WAL，多进程共写同一 `assets.db` 会抢文件锁，所以失败必须分流：含 `not found` 时报「code 写错，跑 op=scores 看可用得分点（当前 25 项）」，其余才提示「可能被宿主占用，改在红队会话里写」——把锁提示套到参数错误上，模型再重试也不会成。另按 `dsh-ops` 的「联动」做法给三语 README 补了「联动 / 生态」一节，写清 8 个同机插件各管哪一层、purge 只占策略与补丁层。终验五种输入实测：缺证据→引导；`terminal-access value=1/2`→`命中 1 次 earned=10`、`命中 2 次 earned=20（档位 5 / 10 分/台）`；错 code→回列 10 个可用 code（共 25）；`chain_add`→`链条共 1 步，末步=recon:nmap 摸到 3 个端口`。
- **演练台接入为第 9 个工具 `purge_drill`（接入而非堆叠）**：56 个 `redteam_*` 工具是 preset 平面（`tools.register(` 实测正好 56 处），普通会话切不过去；不搬定义，改为一个只读聚合入口用 `node:sqlite` 直连同一份事实库（`RedteamStore(root)`，零外部依赖），op 收 7 类（summary/engagements/assets/chain/scores/attackfiles/stages）、`limit` 缺省 8 做有界输出。返回形状靠实测而非猜：`listAssets` 是 `{total,sort,items}`、`listScorePoints` 是 `{items,ruleGroups,summary}`、`listChain/listStages` 是裸数组，故统一归一。本机 `listEngagements()=0`（还没开靶），空态给「怎么开靶」的引导而不是抛错——store 层 `listPrompts(id)` 缺 id 会直接 `TypeError`。CLI 侧 `dsh-purge --drill` 不重启即可实测。另记 `assessAsset` 是评估已有资产、不是新增（传新 ip 报 `asset not found`），store 方法名与工具层 `redteam_asset_add` 不同名。
- **工具面 4 → 8，并把定义收成一张契约表（标准化 / 模块化）**：新增 `lib/model-tools.js` 作为模型工具的唯一来源，`index.js` 的注册块从 125 行样板缩到 11 行循环（-123/+10）；`lib/mcp-server.js` 让同一张表还能以 stdio JSON-RPC 对外（`node bin/dsh-purge.js --mcp`，实测 initialize / tools/list / tools/call 三条全通，通知不回）。补的四个工具都来自「面板 14 条路由、模型只有 4 个工具」这个缺口：`purge_patch`（按层/id 查明细）、`purge_update`（渠道/宿主/台账，`check=true` 才联网）、`purge_rules`（生效项与注入来源）、`purge_skills`（**技能可用性体检**：红队 32 可用 32 坏 0、用户 20 可用 20，单查还给缺哪个环境变量与怎么修）。`dsh-purge --tools` 可离线核对全表。宿主侧 `purge_status` 仍用原渲染，逐字节未变。
- **`COPY_NAMES` 缺 `skills` / `presets`——一个真 bug（新闸门第一战）**：清单闸门 `scripts/check-manifest.mjs` 一跑就暴露出 `overlayFromZip()` 只拷 `COPY_NAMES`，而它当初没有 `presets` / `skills` / `scripts` —— 也就是插件**自更新后代码是新的、32 个红队技能与红队预设却是旧的**，正是「代码新、技能旧」的半升级。修法：三项补进 `COPY_NAMES`，并把原先硬写 `lib || docs || bin` 的「整目录先 rm 再 cp」判断改成 `COPY_DIRS` 集合（否则被删掉的旧技能会残留）。已实测：`COPY_NAMES` 14 项全部被 `files` 覆盖，问题 0。`npm run verify` 升级为五关（语法 / 体积 / 双语 / 清单 / JSON），README 三语与 `npm run check:manifest` 同步登记。
- **发布边界核实（一条假设被实测推翻）**：给 `files` 加 `!docs/preview` 后 `npm pack` 实测 tarball 1.6 MB → **938 KB**、文件 124 → 117（正好少那 7 张 README 截图）。我原以为「安装走 GitHub archive、files 不参与」，实测不成立：pnpm 从 codeload tarball 装完后，副本里 `docs/preview` **整个消失**（那 7 张 PNG 在 git 里确实被跟踪，也没被 .gitignore 命中，远端 master 上也有）。也就是 **`files` 同样约束本机安装**，而运行时没有任何代码读 preview（只有 README 门面图与 `screenshots.json` 清单在列）。省 660KB 换插件详情页可能裂图，不值 → 已回滚不排，留下这条事实。另记现状有**两套清单**：`files`（发布与安装白名单）与 `update.js` 的 `COPY_NAMES`（自更新拷贝清单，含 docs / screenshots.json），两者不一致会造成「自更新后有、npm 装没有」。
- **量化「返回值成本」并把 `purge_status` 改成按需展开（本轮最大收益）**：先测得宿主注入的全量 `renderStatus` 一次吐 **13023 字符 / 138 行**（26 条目标文件绝对路径 + 68 行补丁明细），而 `--align` 只要 254 字符——工具面的钱其实花在返回值上。改法不是加一个新工具，而是把同一份渲染里的两个 section 改成显式索取：`files`（实测单独就要 7853 字符）、`patches`。默认紧凑视图 **538 字符 / 15 行（-96%）**，仍保留可行动信息（`74/76 applied, 0 pending`、未生效 `#80 #88`、shim、备份、注入状态、app.asar 是否还封着）并提示「加 patches=true 看逐条」。斜杠命令 `/purge status` 仍走全量（人要看路径），所以两个消费方共用一个函数、两种深度，没有第二套实现。代价是 schema 多 182 字符（工具面 2798 → 2690，仍低于起点），换每次调用省约 12.5K。MCP/CLI 侧的 `defaultRenderStatus` 同样认这两个开关（217 → 622 字符），不留第二套语义。顺手删掉一处「读了没人写的字段」：`state.__tally` 恒为 null。

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
