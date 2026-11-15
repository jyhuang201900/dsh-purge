# dsh-purge 项目长期记忆

## 是什么
dsh 破甲插件：清洗宿主提示词 + 76 条补丁 + 红队演练台（119 技能 / 118 参考 / 56 工具 / 8 角色 / 25 得分点 / 43 闸门）。
仓库 E:\完成项目\dsh-purge，远端 github.com/jyhuang201900/dsh-purge（master）。

## 宿主启动失败排查（1.1.117 定型，最容易误判）
- **先看进程树有没有 `dsh-desktop-host` 子进程**：没有 = 启动链后半段失败，不是插件加载问题。主进程活着但只有 gpu/utility/renderer 三四个壳进程就是这种。
- 崩溃报告：`%APPDATA%/@deepseek-ai/dsh-desktop/logs/crash-*.log`，看 `phase:`。窗口标题「DeepSeek Harness 无法使用」= `messages.startupFailed`，说明弹了致命框。
- **`desktop welcome: Web authentication failed` 的真实含义极可能不是认证问题**：`connectDesktopWelcome` 只判 `!response.ok`，401（没认证）和 431（请求头太大）归成同一句话。
- 判断 host 本身健不健康：手工 spawn 子进程（`ELECTRON_RUN_AS_NODE=1` + `--expose-internals` + 六个参数，照 main.js 的 `DesktopHostProcess.start()`），拿 URL 直连看状态码。303 + set-cookie = host 健康，问题在 Electron 主进程网络栈。
- **1.1.117 实例：71 条陈旧 `dsh-auth-*` cookie 撑爆请求头**。cookie 名 = `dsh-auth-` + sha256(authority)，authority 含**随机端口** → 每次启动新增一条，旧的永不清理。71 条 → Cookie 头 16,178B、总头 16,875B → 越过 Node `http.maxHeaderSize`=16384 → 431。修法：只留最新一条，删其余（每条都是一次性的）。
- cookie 库被宿主独占（EBUSY），要停进程才能读；`creation_utc` 是 17 位微秒，`CAST(... AS INTEGER)` 会抛 `RangeError`，取成 TEXT 比字典序。
- **绝不要点「禁用第三方插件」**：它调 `disableAllPlugins()` → `sanitizeProfile()`，把 `cordis.patch.yml` rename 成 `.bak-<ts>` 后写回空 `[]`，并把 `package.json` 的 `dsh.profile.bundles` 从 12 砍回 2（`WEB_PROFILE.bundles`）。而且 rename 出来的备份可能在同一流程里被清掉。它不修启动，只清空配置。
- asar 手工解析（无 @electron/asar 时）：前 8 字节 + headerSize + JSON 索引，`baseOffset = 8 + headerSize`，`offset` 是相对 baseOffset 的**字符串**。

## 发版流程
- **大改造前先建三层安全点**（1.1.94 定型）：`git tag -a vX-pre-xxx` + `git branch backup/xxx` + 物理 `cp -r skills/` 到仓库外。三者都要推远端。tag 管 commit 回滚、分支管完整树、物理备份管 gitignore 的东西（skills/ 与 .cache/ 不入库）。
1. 改 lib/default-prompt-inject.md（gitignore 源）→ **必须跑** `node scripts/embed-default-prompt.mjs` 重封入 lib/asset-table.js（加密表入库，明文不入库）；zh 版同步。
2. package.json + 三份 README（**Version 行 `<strong>Version X</strong>`** + dsh:// 链接 version=）一起 bump；release-notes.md 中英双段置顶，**标题层级用 `# 1.1.x`**（历史一致），别用 `##`。
3. `node --check` 改动 JS；`node scripts/verify.mjs`（34 关）；`node scripts/check-package.mjs`（问题须 0）。
4. push 必须加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`（schannel 报 CRYPT_E_REVOCATION_OFFLINE；只加 openssl 会撞 wrong version number）。
5. 宿主更新：cd ~/.dsh/profiles/desktop，改 package.json 的 tarball SHA → `npx --yes pnpm@11 update dsh-purge`。
   - 用 codeload 直链 `https://codeload.github.com/jyhuang201900/dsh-purge/tar.gz/<sha>`（git 协议常 early EOF）。现钉 d06a0b8 = 1.1.125。
   - **pnpm 必须 v11**（store 是 v11，pnpm 9 报 UNEXPECTED_STORE）；`virtual-store-dir-max-length=60` 只能写临时 `.npmrc`，装完删。宿主自带 runtime 目录已空，别用。
   - **不要手工 cp 覆盖 node_modules/dsh-purge**——pnpm 会按 lockfile 覆盖回去。临时验证可以 cp，但要记得这只是临时手段，正式版必须走 pnpm。

## 验证宿主是否真在跑（别只看文件）
- 状态端点：端口**不固定**，扫本地监听端口找 `curl http://127.0.0.1:<port>/dsh-purge/status` 回 200 的那个（1.1.92 时是 42226）。回 `plugin_version` / `asar_still_sealed` / `patches_na`。
- MCP：`POST /dsh-purge/mcp` `tools/call` 能拿到真实工具结果——**验证「活宿主里新功能能用」的唯一硬证据**，比读 node_modules 文件可靠。
- 日志 `%TEMP%/dsh-purge-desktop.log`：`[boot]`/`[guard.wrap]` 时间戳证明重启；重启后未发消息不会有 `assemble.rewrite`，别误判成没生效。

## 技能库维护
- 加/改技能后**必须** `node scripts/build-skills.mjs`（标题规范化 → 可执行性 → 第二发 → 链路）。第二发/可执行性/链路三块是生成物，手写会被 verify 判红。
- 雷达 `FINGERPRINT_RULES` 的 **code 不唯一**（国产 OA 与通用 Web 都是 `web-app`），所以**任何 `find(r => r.code === code)` 反查都是错的**——永远拿到排在前面的那条。技能名要存在实际命中的样本上。`check-package` 第 16 项守这条。
- 技能数由 check-package 对账，改数必须同步 package.json + 3 份 README。
- **`purge_skills q=`**：技能检索（1.1.91）。索引 `lib/generated/skills-search.json` 由 build-skill-graph 生成，改技能后自动跟上。排序规则见 test-oa 教训：名字压过正文提及、英文词边界、两字母缩写不做子串、层级折进分值、同义词只在查询侧展开。
- **ATT&CK 编号检索（1.1.117）**：索引有独立 `attack` 字段（精确编号数组），**不许进 keys**。两个理由：出现次数多的编号（T1190 在 28 个技能里）会被「≥15% 泛词过滤」整条剔除，最常见的反而搜不到；keys 走模糊打分，T1059 与 T1059.001 互相包含会互相污染。检索侧 `attackQuery` 通道只做等值 + 父技术带出子技术。排序靠两条：**深度加成 +14**（列出子技术 = 真专精）、**参考表扣分 −26**（编号数 >12 是映射表不是手册，`attack-traceability` 不扣分时是每个查询第一名）。第 34 关 + 第 24 关三条判据守。
- **索引抽取有六个通道（1.1.118 定型）**，少任何一个都有一批词掉线：① `id+summary+whenToUse+技能标题` ② `references 的标题`（必须先剥代码块，否则 `# IDA: ... Cross References` 被当 H1）③ `正文表格单元格`（工具名常不在反引号内；要挡 STRUCTURAL_HEAD）④ `反引号内容按分隔符拆开逐个判`（整段被判会漏掉 `PrintSpoofer / GodPotato / ...`）⑤ `ATT&CK 编号 → attack 字段` ⑥ `纯小写 3 字母缩写`（jku/jwk/kid/alg，四条旧判据全漏）。平均关键词 29→51。第 24 关用 7 个探针 + 平均下限 40 守。
- **同义词展开必须区分原词与展开词**：展开词命中 ×0.72，否则「靠 Kerberos 沾边」的技能会压过「写着找域控路径」的技能。**key 含查询词时 key 越短越可信**（extra=0→68 / ≤3→58 / 更长→30），一律 30 会让「直接命名」和「长句偶然提及」同分。
- **中文查询命中英文 id 要单独判**：查「提权」时 `privesc-persistence`（id 含 privesc）与 `lateral-movement` 同分同 rank，只靠字母序就输。解法是把同义词组里的英文词（≥4 字符，排除 ad/dc）也判名字词级命中 +8。
- **`extractProper` 会把 ATT&CK 编号当产品名收下**（`T1562` 首字母大写+含数字符合其判据），实测混进 `edr-bypass-re` 的 keys。编号必须显式从 proper 剔除。
- **`loadSearchIndex` 的候选顺序里 `$DSH_HOME/dsh-purge/skills-search.json` 优先于仓内 `lib/generated/`**。闸门要验仓内产物时必须把 `DSH_HOME` 指到空目录，否则读宿主旧索引 → 本地绿、装上就错。
- **任何「只在相等时生效」的 tie-break 都要怀疑永远不触发**（1.1.91 实测：rank 做 tie-break 一次也没生效）。
- **断言必须卡首位，不能只断言「结果里有」**：1.1.91 本地全绿、装到宿主就错，因为断言是 `has(技能名)` 而它一直在列表里只是排第三。排序类断言一律卡首条。
- **多条降权规则会互相抵消**：加新加成前先想它和已有 rank 是不是同一件事（1.1.92 名字加成 +10 vs 专项 rank −6 就冲突过一次）。
- **加新技能必须同时改两处**，否则是孤儿：`STAGE_RULES`（挂角色）+ `TRUNK`（注入链路关系）。audit 会报「零入边 + 未被角色挂载」。
- **判断缺口要用 12 维度覆盖矩阵**（给每维度一组识别词扫全库算命中率），不要只看「哪个域少」。1.1.94 实测：看似要补的逆向域其实 8851 字第二厚，真空白是检测配对 3% / ATT&CK 3% / 误报验证 4%。
- **渐进披露判据**：单段 >1500 字且是查阅型（payload 库/案例库）才外移到 `references/`；核心工作流不动。验证用「H3 标题丢失 0」，不是比字数。
- **文档约束必须做成闸门才生效**：「攻击必配检测」光写在技能里无效，第 18 关 `check-detection-pairing` 才让它真拦（1.1.94）。
- `http-smuggling.md` 含真实 `\x00` 空字节（TE 绕过），grep/git 当二进制——是真技术内容，别当损坏修掉。
- **图谱：`graphify:refresh` 会让社区语义名全丢**（聚类 id 变、被 hub 文件名覆盖），用 id/相似度迁移是死路（备份 graph.json 已被覆盖）。**直接重跑 `npm run graphify:label`** 重新 LLM 命名，这是唯一可靠路径。
- **图谱刷新后必跑 `node scripts/check-graph.mjs`**（第 19 关）：结构/兜底名/三产物同步/社区覆盖四类。反向探针要**整社区改名**才测得出——只改单节点不报红（社区名由多数节点决定）。
- 图谱产物：2888 节点 / 7477 边 / 118 社区 / 34 超边（1.1.95）。

## 审计与同步（1.1.96 定型，最容易反复踩）
- **改条令后必须两条跑 diff**：字数差 + 逐条 bullet 比对。只看字数不知道缺哪条。1.1.96 实测生效稿缺 18/28 条而字数只差 6729——1.1.94 所有验证层条令在用户稿里零生效。
- **工具描述 ≠ 使用时机**：模型知道工具干嘛，不等于知道何时调它。第 20 关 `check-tool-reachability` 守这条（曾 31/56 工具零技能提及）。
- **判据用 `includes` 就是漏洞**：`redteam_chain` 被 `redteam_chain_add` 子串蒙过，闸门报全覆盖。判「是否提到」必须词边界 `\b(?!_)`。
- **验证层要接进链路生成器才有人用**：手工写技能引用率只有 2/116。改 `build-skill-graph.mjs` 的 `renderSection` 自动指路 → 94%。改生成器，别手工改 114 个文件。
- **宿主同步要两处**：技能 `~/.dsh/redteam/skills/` + 插件包 `~/.dsh/profiles/desktop/node_modules/dsh-purge/lib/generated/`（索引在此）。技能同步后 MCP 立即反映（读盘）；**代码如 model-tools.js 要重启宿主**。
- **`timeout N git push | tail` 输出空 + exit 0 是假象**：进程被静默杀掉。核实必须用 `git rev-list --count origin/master..HEAD`。真错误要 `GIT_TERMINAL_PROMPT=0 -c credential.helper=` 才看得见。
  - 审计工具：`node scripts/check-tool-reachability.mjs`（第 20 关）、`node scripts/check-store-refs.mjs`（第 23 关）、`node scripts/check-path-boundary.mjs`（第 22 关）、`node scripts/check-references.mjs`（第 21 关）、`node scripts/check-graph.mjs`（第 19 关）、`node scripts/check-detection-pairing.mjs`（第 18 关）。

## references 与渐进披露（1.1.97 定型）
- **「承诺了却给不出」是最坏的失败模式**：技能写「Load references/xxx.md」而文件不存在，模型分不清「我不知道」和「文件丢了」，会凭猜编内容。1.1.97 实测 149/153 引用指向空气。第 21 关守这条。
- **根因模式：从上游包改写技能时，搬了正文没搬附件**。压缩版正文保留指引句，文件留在原包。改任何来源的技能都要检查 references 是否跟着搬。
- **competition-* 这类专项技能不该在正文塞命令**：保持方法论 + 判据，命令/验伤/检测/坑全放 references 按需加载。补上引用的文件比补正文更对。
- **references 走 `<refs>/<rel>` 扁平布局**（同域复用方便），需要独立目录时用 `<refs>/<skill-id>/<rel>`。闸门两种都认。
- **写 references 的四要素**：真实命令（完整参数）、验伤信号（含「看起来成功其实是假」的反例）、检测视角（具体日志与事件 ID）、常见坑。缺验伤篇等于没写——那是最容易自欺的地方。
- 体量：113 篇 / 93.7 万字 / 平均 8295 字（1.1.97）。
- **check-package 的中英文数字映射表只写到 30**：加关超过 30 必须同步扩，否则闸门数自证会假红（改文档也没用）。

## 逻辑审阅（1.1.98 定型）
- **逻辑审阅必须实测，不能靠审代码**：1.1.98 三次「读代码推断」全错（`?? 0` 会不会挤掉 failed、619 处空 catch 是否系统性吞错、枚举是否死导出）。实测后全部修正。闸门形态也应为「真造 symlink / 真构造非法 id」，不是静态扫描。
- **对称操作要查默认值是否相反**：`applyPatchesAllHosts` 默认 `discover:false`，`revertAllHosts` 原默认 `discover !== false`（扫全盘）。点应用改一份、点回滚触及其它宿主。凡成对操作（apply/revert、open/close、push/pop）都要核对默认参数。
- **`?? 0` 兜底会让未知值与最差值同权**：`RANK[x] ?? 0` 表面上安全，实际是「先枚举者赢」。未知值应给显式最低分（-1）并浮上来。
- **判据顺序会决定检查是否真执行**：`assertPathWithin` 若先字符串后实路径、命中即 break，symlink 检查永远不跑。凡「多级判据」都要确认每一级都有机会执行。
- **注释声明「与 X 对齐」+ 代码复制值 = 最易骗过 review 的形态**：`validate-input.js` 写「与 store 的 SEVERITIES 对齐」却复制。枚举一律引用单一来源。
- **路径边界必须实测解析**（`realpathSync`），纯字符串前缀比对挡不住 symlink/junction。`assertPathWithin` 有 8 处调用点（截图/POC/攻击文件），其路径字段可被写库工具影响。
- **事实库无 FOREIGN KEY**（24 张表，SQLite 默认也不强制）→ 应用层必须自己校验引用。`#assertAssetRef` 守漏洞/凭据/访问会话三处。
- **有 TTL 语义的状态必须真清理**：只记时间戳不清理 = 崩溃即永久占位。清理数要报出来，静默清理像「东西凭空没了」。

## 关键机制
- **用户 override 整份替换出厂条令**：`~/.dsh/prompt-inject.md` 存在且 `override_status: custom` 时，改出厂 `lib/default-prompt-inject.md` **对实际行为零影响**。改提示词必须两处都改。
- **改提示词要挂两层闸**（1.1.93 定型）：关键词层（条款在不在）+ 语义层（两种场景是否给出相反动作、条件与动作是否同一行）。只挂关键词层会漏「都写了但没区分」。
- **闸门的反向探针必须真删整段**，不能只改关键词——否则测的是闸门不是内容。1.1.93 第一版语义闸门就是这么假的。
- 0.2.1-rc.2 起提示词变量只注册 provider/model，**段文本含 `{{cwd}}` 会组装期 throw**。
- JS 模板字符串里的 `${...}` 必须转义（store-core.js 曾因 `${IFS}` 炸掉导入）。
- 补丁状态核对：`DSH_SURFACE=desktop DSH_BASE="E:\Program Files\harness\resources\app\dsh\node_modules\@deepseek-ai" node bin/dsh-purge.js --status`（bash 探测不到桌面端）。
- optional/softSettle 补丁目标不存在 → na/missing_file/skipped 正常，failed=0 即健康。
- **会改宿主文件的命令别截管道**：`--apply | Select-Object -First 12` 会让 node 写文件途中 EPIPE 中断，状态 73/76 掉到 6/76。先 `| Out-String` 收完再筛。
- **`--apply`/`purge_apply patches=` 选打是「先恢复再重打」**：未选中的补丁等于被回滚（74/76 → 6/76）。选打完必须再跑一次全量 apply。
- **锚点不许依赖 `//#region` 打包注释**（每次重打包换路径），只锚真语句；`markersAny: true` 的补丁 applied 只代表至少打了一处，验收要数残留原文。
- **file key 落空不报 missing_file**——`filterTargetFiles` 不登记落空键、skipped 优先，症状只是一条常年 skipped。
- 得分点权威定义在 lib/redteam/score-rules.js（25 项）——写技能前先对表。
- 审计脚本：.cache/audit-skills.mjs（技能×工具引用一致性）。

## 用户方向
欲望强、指向准、链路短、消耗省、汇报简洁、一点就中。
插件能力只加不减；宿主保持密封（不改宿主文件）；注入预算 50000 字已用 64%，新内容走 `purge_skills` 发现与雷达 `skill:` 指向，不塞条令。

## 图谱刷新（1.1.118 定型，顺序不能错）
1. `graphify extract . --code-only --no-cluster`
2. **`node scripts/graphify-sync.mjs --refresh-baseline`** ——这一步最容易漏。`ast-baseline.json` 是冻结的 AST 快照，不刷新则新抽取被旧基线吞掉，**增量是假的**。判据：`addedNodes` 很大但 `totalNodes` 只涨个位数 = 基线没刷新。
3. `node scripts/graphify-sync.mjs --cluster`
4. `node scripts/graphify-label.mjs` ——聚类会让 108 个社区名退回 hub 文件名，重跑 label 才能补回。
5. LLM 通常漏 2-4 个**代码模块类**社区（`mcp-server.js`/`desktop.js`/`store-core.js`/`check-search-index.mjs`），
   按成员语义手工命名：改 `graphify-out/.graphify_labels.json` 后逐节点写回 `community_name`。
6. `node scripts/check-graph.mjs`（第 19 关）。
产物 `graph.json`/`graph.html` 被 gitignore（生成物），只有 `GRAPH_REPORT.md` 与 `semantic/` 入库。
当前：3241 节点 / 8068 边 / 123 社区 / 兜底名 0。

## 覆盖矩阵审计（找缺口的方法，1.1.94 起沿用）
给 30 个维度各一组识别词，扫全库算命中率，<15% 算缺口。**不要只看「哪个域技能少」**：
1.1.118 实测真空白不是「域少」，而是**核心技能的职责远大于体量**
（`privesc-persistence` 157 行覆盖 9 个 ATT&CK 技术且零 references，而流程编排 `attack-chain` 731 行）。
判据：把「职责（ATT&CK 技术数 / 阶段覆盖）× 体量」摆在一起看倒挂。
脚本：`.cache/audit-dims.mjs`、`.cache/audit-toolgap.mjs`（工具落差；**带 g 的正则必须每文件 new RegExp**，
复用会因 lastIndex 延续把统计放大十倍 —— frida 被算成 113 个技能，实际 10 个）。

## 闸门设计的元判据（1.1.119 定型，比具体判据更重要）
- **「观测项」不是安全的中间态**：只打印不判红的指标，等于承认它不重要。检测段覆盖率 9% 挂了很久没人管，就因为它不进 `problems`。凡是文档里承诺「必须」的约束，要么进 problems，要么别写。
- **判据词表太窄 = 误判，比漏判更坏**：它逼人去改本来就对的文字。检测段判「感知源」时只认 `日志|audit|Sysmon`，把写「防火墙 / NetFlow」「K8s audit」「WIDS」的 27 个段判成「没有检测点」。判据的作用是区分「具体」与「空话」，不是限定用词。
- **判据该问「有没有点到具体名字」，不该问「属于哪一类」**：工具落差判空话，第一版要求「用 X 替代」紧邻（误判 nikto→nuclei），第二版放宽（漏过 bloodhound「可本机跑」）。最后定成「说明里必须用反引号点到工具名/命令/包名」——机器可判、不依赖措辞。
- **对离线类技能要留豁免**：逆向/固件/取证的目标侧一条日志都没有。强行要求「两类感知源」只会逼出编造。「目标侧无感」本身就是有效结论。
- **批量改写前必须区分「原本有」与「原本没有」**：我按 `s.attack[0]` 重配检测表，attack 是字母序（T1078 常排第一），结果把 cn-oa-exploit 的 Web 表换成「账户滥用」表，还覆盖了 11 个原本正确的段（credential-attack 的 6 条被压成 2 条）。改前先 `git show HEAD:` 确认。
- **别在已有多轮修补的字段上叠加**：同一段被脚本叠 3 遍，连「实用推论」都串成了别的技术的。改内容要先读现状。
- **重复行要专门判**：批量注入会让「表格 8 行」里只有 3 条有效信号。只数行数的闸门会认为合格。

## 用户 override 与出厂条令（1.1.119 二次确认）
`~/.dsh/prompt-inject.md` 存在时**整份替换**出厂 `lib/default-prompt-inject.md`。**改出厂稿对实际行为零影响**。
必须两处都改。第 36 关 `check-override-parity` 守 7 个「读入口锚点」（谁归谁 / 链路位置 / 上游下游纪律 / 落库纪律 / ver 验证层 / 检索入口 / 确认条款 / ATT&CK），只警告不失败。
判据陷阱：锚点词不能只认一种措辞 —— 「只问一次」在用户稿里是「只对第一次开口收一次费」。

## 审阅方法（两轮换判据才找准，1.1.119 + 1.1.120）
**只看覆盖率会漏掉「写了但跑不起来」。**两轮要分开做：
- **第一轮看「有没有写」**：覆盖矩阵（30 维度 × 识别词）、职责/体量倒挂、references 深度。
- **第二轮看「能不能跑」**：
  · **toolkit 路径**（第 37 关）：路径在本机不存在且同小节无侧别说明 = 缺陷。判据要按**同一小节**找声明，不能按「前后 3 行」——人必然把「工具选择说明 + 它的命令」写在一节里，隔 5 行很正常。
  · **平台错配**：`suo5` 只给 `suo5-linux-amd64` 而本机只有 `suo5.exe`，所有命令都跑不起来。这类比「文件缺了」更隐蔽（缺失至少报错）。
  · **边界输入探针**：空串/空格/超长/路径穿越/null/undefined/对象/数组全跑一遍，看有没有抛异常。
  · **零命中是否降级**：`q=T9999`（不存在的编号）曾降级成模糊匹配命中 `vps-reverse-shell`（因为正文有端口 9999）。编号是精确标识，**不许降级**。
  · **过短查询**：`q=a` 曾命中 95 个技能。一屏 95 个比没有结果更糟（模型挑第一个，而第一个是字母序巧合）。
- 闸门判据设计的三条纪律：① 别把「目标机载荷本机没有」判成缺陷（会让闸门失去区分力）；② 声明词表要覆盖同义写法（「需自行补上」vs「需自行放到该路径」vs「不下载」）；③ **判据不能把自己给的提示当成违规**（第 34 关曾因为提示文字用 · 列建议，把提示判成违规列表）。

## 语义层审计（1.1.121 定型，第三轮判据）
前两轮查形态（有没有写 / 路径对不对），这一轮查**内容对不对**。三个可机器判的锚点：
1. **官方页**：CVE 事实（受影响版本、CVSS、PR/UI、KEV）只能对 NVD 核，不能凭记忆。
2. **本机真实二进制**：工具 flag 会随版本改名（nuclei v3.11.1 把 `-json` 改成 `-jsonl`），
   而 httpx/naabu 的 `-json` 仍合法 —— 同类工具升级方向不一致。`node scripts/fetch-toolhelp.mjs` 抓 help，`check-semantic-flags` 比对。
3. **本机注册表/文件系统**：注册表路径 `Test-Path` 实测。

### 抓 help 的两个坑（fetch-toolhelp.mjs 已内置处理）
- **`-h` 不一定是 help**：fscan 的 `-h` 是「目标主机」，要按 `--help`→`-help`→`-h` 顺序试。
- **Go 的 flag 包把 usage 打在 stderr 且 exit 0**：`execFileSync` 拿不到 stderr（fscan stdout 605 / stderr 4454），必须 `spawnSync` 收两路。

### 写入类命令的硬判据
- **组策略键在干净系统上不存在**：`HKLM\SOFTWARE\Policies\...` 那几个 `Test-Path` 全 False。
  用 `Set-ItemProperty` 直接抛 `Cannot find path`。必须 `reg add` / `New-Item -Force`（自动建键）。
- **「命令成功」≠「效果达成」**：reg add 成功但域策略会覆盖回去；EDR 可能从 ETW 取数据不看注册表。
  验伤只能打特征命令再看日志有没有新记录。

### 别名劫持（第 40 关）
脚本环境里 `curl`=`Invoke-WebRequest`，`-o/-w/-s/-k` 全不兼容 → 必须 `curl.exe`。
同类：`wget`/`rm -rf`/`cat`/`ls -la`/`ps -ef`/`kill -9`/`grep -r`/`head`/`tail`。

### 判据设计教训（新增两条）
- **「RCE」这个词要慎用**：4 个 CVE 里 3 个被标 RCE，实际是「路径遍历+需落点」「账户接管+需骗人点」「越界读+需找外带路径」。
  虚高严重性直接变成红队的时间浪费。
- **判据太松 = 报告没人看**：端口审计第一版「服务名后 20 字符内有数字」，
  `http` 后面全是状态码和 IP 段，噪音 90%+。收紧到「显式写端口」后只剩 10 处全对。**宁可漏判，不要满屏误报**。

## 加技能/改技能的三条硬规则（1.1.122 定型）
1. **新技能必须同时注册四处**，否则是孤儿：`STAGE_RULES`（挂角色）+ `TRUNK`（链路关系）+ `DOMAIN_RULES`（域分组）+ `RECORD_RULES`（落库实体）。落库实体必须在 `LEDGER_ENTITIES` 里。
2. **新技能会污染已有检索**，必须测这三类：① 单实体中文（域控/提权/工控）；② 多词英文（active directory）；③ 编号（T1059）。三条都进第 34 关卡首条。
3. **描述里要写中文实体词**：索引的中文关键词主要来自 description/whenToUse/标题。新 OT 技能最初没写「工控」，查不到 —— 补进 description 才好。

## ATT&CK 表的三条纪律（1.1.122 教训）
- **子技术用下划线存**（`T1003_001`），`normalizeTechniqueId` 会转。所以「表里有没有子技术」必须 `Object.keys(TECHNIQUES)` 实测，别靠印象（我误判过一次，把真子技术降级成父技术还写了错误注解）。
- **只收企业矩阵**：ICS（T08xx）与 Mobile（T14xx）编号在各自矩阵里是真的，但不在本表。用企业矩阵的语义对应编号，引用 ICS/Mobile 时另行标注矩阵名，**不要混进映射表**（会被判成编造）。
- **父子不许同列**（第 41 关）：T1003 已含 LSASS/SAM/NTDS，再列子技术 = 一件事占两名额，报告「覆盖 N 个技术」虚高。**标注不足也一样有害**（第 42 关）：`code-audit` 只标 T1190 而它明写硬编码密钥/命令注入。

## 检索判据的两个反噬点（1.1.122）
- **「反含 close」只在单实体查询上成立**：`key.length ≤ needle.length+3 → 62 分`。多词查询会反噬 —— `active directory`(16字) 含 key `directory`(9字) 得 62 分，于是 `dir-bruteforce`（目录爆破）成了 AD 查询首条。**必须加 `!/\s/.test(needle)` 守卫**。
- **同义词展开的泛词会污染**：`domain`（也指域名）、`domain controller`（被拆成 `controller`）。判据：只放「在别的域几乎不出现」的专有词。
- **模板化章节标题会变成 key**：多个技能的 `## 5. 利用提权 / 横向` 让它们都命中「提权」。改标题比改打分器省事且正确。

## 子代理审阅的用法（1.1.122 实测）
**噪音极大，必须逐条验证再动手。** 24 个技能的审阅报告里 6 条主要指控只有 1 条成立
（父子重复标注成立；「有 X 编号但没讲」「把编号堆成一行」全是误判）。
用法：让它做「批量扫描找候选」，**判定权必须留在自己手里** —— 拿它的结论直接改内容会引入错误。

## 索引抽取的来源权重必须分级（1.1.124 定型，比具体通道更重要）
索引有六个通道（`id+summary+whenToUse+技能标题` / `references 标题` / `正文表格单元格` / `反引号内容` / `ATT&CK 编号` / `纯小写 3 字母缩写`），
但**它们不等于同一种证据**。合并进同一个 `keys` 池子是错的：
- `keys`（技能自己写的词）→ 最高 100。这是「这个技能是什么」。
- `refKeys`（references 标题里的词）→ **封顶 40**。这是「它引用了什么」。
40 的依据：高于反含弱档（23，症状式沾边），低于 key 直接命中的最低档（30+）。
实测三个反例：`子域`→pentest-tools（引用综合手册）、`域控`→scada-hmi-attack（类比说法）、
`钓鱼`→api-security（OAuth 的"同意钓鱼"）。
**通则：凡「合并不同来源的词」，先问「它们的证据强度一样吗」。**

### references 中文标题的两个坑
- **只取 H2 及以下**：H1 是文档名，词跨度极大、区分度极低。
- **中文标题要过 `extractCnFromHeadings`，不是 `extractProper`**：后者只认英文/数字形态，
  1.1.118 修「references 不可见」时只补了英文侧，`q=变电站` 一直搜不到。
- **章节名会变成噪音**（142 个：「落库要求」「注意事项」「六条常见提权路」）。
  用正面形态判据（`^(怎么|如何|第N|N条)` 或 `(要求|清单|纪律…)$` 且 ≤8 字），不要堆黑名单 ——
  但**取窄**：宁可漏几个，不误删「抓接口清单」这类真内容。

## 「还差什么」的答法（1.1.123 定型）
**不能凭印象**。做法：拿覆盖矩阵 30 组识别词逐个 grep 全库算命中数，**命中 0 的是候选**，
再逐个核实。实测 7 个 0 命中里 **4 真缺 3 是写法差异**
（AS-REP Roasting 写成 `Pre-Authentication Type = 0`，实际有内容）。
真缺的四个：Struts2 / ThinkPHP / PrintNightmare / IEC-104 —— 前三类在
`references/java-php-middleware-payloads.md`，IEC-104 在 `industrial-protocol-deep.md`。

## 图谱刷新必查「基线是否落后」
`built_at_commit` 是唯一可靠判据。1.1.122 时图谱还停在 6e4108e(1.1.118)，
**6 个技能 / 9 篇参考 / 2 个闸门脚本全没进图谱** —— 但 `check-graph` 全绿，因为它只查结构不查新鲜度。

## 覆盖矩阵自身的三个缺陷（1.1.125 定型，比数据更重要）
1. **必须连 references 一起扫**：本仓的主要组织方式是「方法论在技能、深水在参考」，
   只扫技能正文会把内容厚的维度误判成缺口（提权-Windows 报 5%，实际参考里 potato 出现 7 次）。
   归属方式：references 命中算**引用它的那个技能**命中，不把每篇参考当独立技能（否则分母冲淡）。
2. **识别词写错一个词就会毁掉整个维度**：`无线与硬件` 里写了 `rgba`（应为 rfid），
   该维度从 74% 变成 10%。加识别词时逐条核对语义。
3. **统一阈值系统性冤枉垂直域**：社工/工控/无线这类领域真实世界里就少数专家负责，
   127 个技能不可能有 19 个讲社工。阈值分两档（通用 15% / 垂直 8%），分类是**领域属性**不是数据。
4. **「命中数」有结构性局限**：一个技能写完整个领域，命中数也只是 1。
   它适合找「完全没人管」的领域，**不适合衡量深度**。衡量深度看 references 字数 + 技能行数。

## 检索排序的三种污染源（1.1.122–1.1.125 逐层发现，同一族问题）
1. **引用了什么 ≠ 是什么**（1.1.124）：references 标题里的词单独存 `refKeys`，封顶 40 分。
2. **顺带提到 ≠ 主业**（1.1.125）：用**显式词汇归属表 `TERM_OWNER`**，把词登记给专职技能，
   其他技能的 keys 排除它。**领域归属是事实，不该由算法推断。**
   （试过「命中 key 数」「同族覆盖」两种 tie-break，都因单 term 查询下恒为 1 而无效，已回滚不留死代码。）
3. **通用词展开污染**（1.1.122）：同义词只放「在别的域几乎不出现」的专有词。

## 图谱新鲜度必须独立成关（1.1.125）
`check-graph` 只查结构（节点/边/社区/兜底名），**从不问「什么时候建的」**。
1.1.123 就这样漏了 6 个提交（6 技能 + 9 参考 + 2 闸门脚本全没进图）。
第 43 关三档：一致→绿｜落后<10 且只改 md→黄｜落后≥10 或改了代码→红。
**判据：改 `lib/*.js` 或 `scripts/*.mjs` 必须重抽，只改 md 可以等下次。**

## 本机工具链实测状态（1.1.125）
- ✅ frida 17.26.3（脚本不在 PATH，用 `python -m frida_tools.ps`）
- ✅ netexec 1.98（**PyPI 无包**，要 git clone + `--no-deps`；**netifaces 编译失败 → 用 `netifaces2`**）
- ✅ impacket（随 netexec）
- ❌ **ghidra 装不上**：github API / release / codeload 全不通，源码构建需 gradle + 数十分钟。
  JDK 21 本机有（`JAVA_HOME=E:\Tools\jdk\jdk-21.0.12.1+1`）。
- ❌ **radare2 的 `pdc` 在 x64 PE 上报 `Unknown or oversized global type`** ——
  「用 radare2 替代 ghidra」不成立，伪 C 反编译确实无可替代。
