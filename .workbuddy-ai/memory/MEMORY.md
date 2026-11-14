# dsh-purge 项目长期记忆

## 是什么
dsh 破甲插件：清洗宿主提示词 + 76 条补丁 + 红队演练台（119 技能 / 113 参考 / 56 工具 / 5 角色 / 25 得分点 / 21 闸门）。
仓库 E:\完成项目\dsh-purge，远端 github.com/jyhuang201900/dsh-purge（master）。

## 发版流程
- **大改造前先建三层安全点**（1.1.94 定型）：`git tag -a vX-pre-xxx` + `git branch backup/xxx` + 物理 `cp -r skills/` 到仓库外。三者都要推远端。tag 管 commit 回滚、分支管完整树、物理备份管 gitignore 的东西（skills/ 与 .cache/ 不入库）。
1. 改 lib/default-prompt-inject.md（gitignore 源）→ **必须跑** `node scripts/embed-default-prompt.mjs` 重封入 lib/asset-table.js（加密表入库，明文不入库）；zh 版同步。
2. package.json + 三份 README（Version 行 + dsh:// 链接 version=）一起 bump；release-notes.md 中英双段置顶。
3. `node --check` 改动 JS；`node scripts/verify.mjs`（21 关）；`node scripts/check-package.mjs`（问题须 0）。
4. push 必须加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`（schannel 报 CRYPT_E_REVOCATION_OFFLINE；只加 openssl 会撞 wrong version number）。
5. 宿主更新：cd ~/.dsh/profiles/desktop，改 package.json 的 tarball SHA → `npx --yes pnpm@11 update dsh-purge`。
   - 用 codeload 直链 `https://codeload.github.com/jyhuang201900/dsh-purge/tar.gz/<sha>`（git 协议常 early EOF）。现钉 9a180b7 = 1.1.90（1.1.95 需重钉）。
   - **pnpm 必须 v11**（store 是 v11，pnpm 9 报 UNEXPECTED_STORE）；`virtual-store-dir-max-length=60` 只能写临时 `.npmrc`，装完删。宿主自带 runtime 目录已空，别用。
   - **不要手工 cp 覆盖 node_modules/dsh-purge**——pnpm 会按 lockfile 覆盖回去。

## 验证宿主是否真在跑（别只看文件）
- 状态端点：端口**不固定**，扫本地监听端口找 `curl http://127.0.0.1:<port>/dsh-purge/status` 回 200 的那个（1.1.92 时是 42226）。回 `plugin_version` / `asar_still_sealed` / `patches_na`。
- MCP：`POST /dsh-purge/mcp` `tools/call` 能拿到真实工具结果——**验证「活宿主里新功能能用」的唯一硬证据**，比读 node_modules 文件可靠。
- 日志 `%TEMP%/dsh-purge-desktop.log`：`[boot]`/`[guard.wrap]` 时间戳证明重启；重启后未发消息不会有 `assemble.rewrite`，别误判成没生效。

## 技能库维护
- 加/改技能后**必须** `node scripts/build-skills.mjs`（标题规范化 → 可执行性 → 第二发 → 链路）。第二发/可执行性/链路三块是生成物，手写会被 verify 判红。
- 雷达 `FINGERPRINT_RULES` 的 **code 不唯一**（国产 OA 与通用 Web 都是 `web-app`），所以**任何 `find(r => r.code === code)` 反查都是错的**——永远拿到排在前面的那条。技能名要存在实际命中的样本上。`check-package` 第 16 项守这条。
- 技能数由 check-package 对账，改数必须同步 package.json + 3 份 README。
- **`purge_skills q=`**：技能检索（1.1.91）。索引 `lib/generated/skills-search.json` 由 build-skill-graph 生成，改技能后自动跟上。排序规则见 test-oa 教训：名字压过正文提及、英文词边界、两字母缩写不做子串、层级折进分值、同义词只在查询侧展开。
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
- 审计工具：`node scripts/check-tool-reachability.mjs`（第 20 关）、`node scripts/check-references.mjs`（第 21 关）、`node scripts/check-graph.mjs`（第 19 关）、`node scripts/check-detection-pairing.mjs`（第 18 关）。

## references 与渐进披露（1.1.97 定型）
- **「承诺了却给不出」是最坏的失败模式**：技能写「Load references/xxx.md」而文件不存在，模型分不清「我不知道」和「文件丢了」，会凭猜编内容。1.1.97 实测 149/153 引用指向空气。第 21 关守这条。
- **根因模式：从上游包改写技能时，搬了正文没搬附件**。压缩版正文保留指引句，文件留在原包。改任何来源的技能都要检查 references 是否跟着搬。
- **competition-* 这类专项技能不该在正文塞命令**：保持方法论 + 判据，命令/验伤/检测/坑全放 references 按需加载。补上引用的文件比补正文更对。
- **references 走 `<refs>/<rel>` 扁平布局**（同域复用方便），需要独立目录时用 `<refs>/<skill-id>/<rel>`。闸门两种都认。
- **写 references 的四要素**：真实命令（完整参数）、验伤信号（含「看起来成功其实是假」的反例）、检测视角（具体日志与事件 ID）、常见坑。缺验伤篇等于没写——那是最容易自欺的地方。
- 体量：113 篇 / 93.7 万字 / 平均 8295 字（1.1.97）。
- **check-package 的中英文数字映射表只写到 30**：加关超过 30 必须同步扩，否则闸门数自证会假红（改文档也没用）。

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
