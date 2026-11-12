# dsh-purge 项目长期记忆

## 是什么
dsh 破甲插件：清洗宿主提示词 + 76 条补丁 + 红队演练台（116 技能 / 56 工具 / 5 角色 / 25 得分点）。
仓库 E:\完成项目\dsh-purge，远端 github.com/jyhuang201900/dsh-purge（master）。

## 发版流程
1. 改 lib/default-prompt-inject.md（gitignore 源）→ **必须跑** `node scripts/embed-default-prompt.mjs` 重封入 lib/asset-table.js（加密表入库，明文不入库）；zh 版同步。
2. package.json + 三份 README（Version 行 + dsh:// 链接 version=）一起 bump；release-notes.md 中英双段置顶。
3. `node --check` 改动 JS；`node scripts/verify.mjs`（16 关）；`node scripts/check-package.mjs`（问题须 0）。
4. push 必须加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`（schannel 报 CRYPT_E_REVOCATION_OFFLINE；只加 openssl 会撞 wrong version number）。
5. 宿主更新：cd ~/.dsh/profiles/desktop，改 package.json 的 tarball SHA → `npx --yes pnpm@11 update dsh-purge`。
   - 用 codeload 直链 `https://codeload.github.com/jyhuang201900/dsh-purge/tar.gz/<sha>`（git 协议常 early EOF）。现钉 9a180b7 = 1.1.90。
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

## 关键机制
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
插件能力只加不减；宿主保持密封（不改宿主文件）；注入预算 33000 字已用 96%，新内容走 `purge_skills` 发现与雷达 `skill:` 指向，不塞条令。
