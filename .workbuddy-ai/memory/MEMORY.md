# dsh-purge 项目长期记忆

## 项目是什么
DeepSeek Harness (dsh) 破甲插件：清洗宿主提示词 + 84→83→76 条补丁（未安装的可选包补丁已整体摘除）+ 红队演练台（32 技能 / 56 工具 / 5 角色 / 25 得分点）。
仓库 E:\完成项目\dsh-purge，远端 github.com/jyhuang201900/dsh-purge（master）。

## 发版固定流程（必须按序）
1. 改 lib/default-prompt-inject.md（gitignore 的源）→ **必须跑** `node scripts/embed-default-prompt.mjs` 重封入 lib/asset-table.js（加密表入库，明文不入库）；
2. 改 lib/default-prompt-inject.zh.md 保持中英同步；
3. package.json + 三份 README（Version 行 + dsh:// 链接 version=）一起 bump；release-notes.md 中英双段置顶；
4. `node --check` 全部改动 JS + store.js 导入测试 + preset YAML 解析验证；
5. git commit + **push 必须加 `-c http.sslBackend=openssl -c http.version=HTTP/1.1`**（schannel 报 CRYPT_E_REVOCATION_OFFLINE；2026-11-09 实测纯 openssl 还会撞 `TLS connect error: wrong version number`，加 HTTP/1.1 才过——同一族 GitHub 网络毛病，与「git 拉包 early EOF」齐名）；
6. 宿主更新：cd ~/.dsh/profiles/desktop，改 package.json 里 dsh-purge 的 tarball SHA → `node <runtime pnpm.cjs> update dsh-purge`。
   - 本机 git 协议拉 GitHub 常 early EOF → specifier 用 `https://codeload.github.com/jyhuang201900/dsh-purge/tar.gz/<sha>` 直链（现钉 94ffe60 = 1.1.80）；
   - pnpm/node 用宿主自带：C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\{node\bin\node.exe, pnpm\bin\pnpm.cjs}；
   - **不要手工 cp 覆盖 node_modules/dsh-purge**——pnpm 任何解析都会按 lockfile 覆盖回去（1.1.74 时被梁神安装覆盖过一次）。

## 关键机制备忘
- 官方 0.2.1-rc.2 起提示词变量只注册 provider/model，**任何流入 interpolate 的段文本含 {{cwd}} 会组装期 throw**；工作目录由官方 working-directory 服务提供。
- JS 模板字符串里的 `${...}` 必须转义（store-core.js 曾因 `${IFS}` 炸掉 redteam-store/ui 导入）。
- 补丁状态核对 CLI：`DSH_SURFACE=desktop DSH_BASE="E:\Program Files\harness\resources\app\dsh\node_modules\@deepseek-ai" node bin/dsh-purge.js --status`（bash 里自动探测不到桌面端）。
- 可选补丁（optional/softSettle）目标文件不存在 → na/missing_file/skipped 属正常，failed=0 即健康。
- **会改宿主文件的命令别截管道**（1.1.84 实测踩过）：`node bin/dsh-purge.js --apply | Select-Object -First 12` 会让 node 在写文件途中被 EPIPE 打断、连 exit 码都不回，状态一度从 73/76 掉到 6/76。先完整收输出（`| Out-String`）再筛。
- **`--apply`/`purge_apply patches=` 选打是「先恢复再重打」**：子集会先从 `.bak` 恢复原文、只打选中几条，**未选中的补丁等于被回滚**（实测状态从 74/76 → 6/76）。选打完必须再跑一次全量 apply 才回到满清洗；`purge_apply` 的参数说明已按此写。幂等已验：连跑两次完整 apply 计数不变、marker 每文件 1 个。
- **宿主升级后判失配的两类假象**（1.1.84 实测）：①锚点**不许依赖 `//#region` 打包注释**——每次重打包都会换路径（0.2.2 已从 home-paths 变成 mime@4.1.1），只锚真语句；②`markersAny: true` 的补丁 **applied 只代表至少打了一处**，验收要数残留原文（#62 就这样藏了半个没打的门）。还有一条通用判据：**file key 落空不会报 missing_file**——`filterTargetFiles` 不登记落空键、状态机 skipped 优先，于是「宿主把文件搬家了」只表现为一条常年 skipped。
- 技能审计脚本：.cache/audit-skills.mjs（技能×工具引用一致性）。
- 得分点权威定义在 lib/redteam/score-rules.js（25 项：boundary 1000-30000 / central-system 500 / netdev 100·200 / iiot / iot-platform…）——写技能前先对这张表。

## 进攻条令演进（1.1.73→1.1.80）
cwd 修复 → IFS 修复 → 删死补丁 #40 → 火力阶梯+命中追击+3 技能 → 节奏/指向/首发/消耗四规则 → 思维五格弹仓+方向锁定+一轮三拍 → 汇报态势板四行制 → 武器库补全（secdev-boundary、iot-iiot-netdev）+最强进攻手优先级（分值×命中率÷成本）。
用户方向：欲望强、指向准、链路短、消耗省、汇报简洁、一点就中。
