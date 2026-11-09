# dsh 生态情报笔记（社区探索所得）

来源：`https://dshmp.com/en/categories/mcp` 与 `https://dsh-plugin.net/category/mcp`（2026-11-09 抓取，HTTP 200）。
只记 purge 用得上的结论，不复制清单。

## 1. 设计原则被生态验证（不是我自己想出来的）

- `dsh-mcp-lazy`：**"one stable proxy tool instead of N tool schemas"**，服务器首次使用时才连、空闲时退出、元数据落盘。
  这正是 `purge_drill` 的路线：26 个能力面收进 1 个工具，实测 +92 字符换 6 个写面（≈15 字符/面）。
- `dsh-mcp-lens`：**"Load exact schemas on demand"**——按需取 schema，与 `purge_status` 的 `files/patches` 两个门同族（13023 → 538 字符）。
- `mneme`：**"10 model tools, MCP server, CLI"**——三消费方结构与 purge 的 `ctx.tools` + `--mcp` + `--tools` 同构，说明契约表单一来源不是洁癖而是通行做法。

## 2. 规模与先例

- 目录站两个：**dshmp.com**（有 `/api/plugins` JSON API，按 **bundle manifest** 认证，标注 dsh.bundle v1）与 **dsh-plugin.net**（按证据强度收录：README 写了 dsh 安装命令 / 仓库里有 bundle manifest / 包元数据声明 dsh 依赖）。
- 规模参照：Blue-Whale-Harness 自述 **1958 仓库 / 1819 真插件**；dsh-plugin.net 的 MCP 类目 208 个；dshmp 的 mcp 类目 489 个。
- **已有先例把 DSH 本身做成 MCP server**：`dsh-harness-mcp-server`（把 harness 能力暴露成 MCP）、`dsh-chatgpt-bridge`（让 ChatGPT Web 控制 DSH 会话）。所以 purge 的 `--mcp` 属于既有类目，差异点在暴露的是**自己的补丁面与演练台状态面**。

## 3. 命名约定（已在宿主源码本地证实）

`@deepseek-ai/dsh-mcp-client/lib/index.js` L97：`const joined = \`mcp__${serverName}__${rawName}\``，
并按 DeepSeek 函数名规则做归一。故 purge 被连接后，模型看到的是 `mcp__dsh-purge__purge_drill` 这类名字。

## 4. 社区痛点（与 purge 的约束同源）

- MCP 配置**要手写 YAML**（每服务器一行 `cordis.yml` / `cordis.patch.yml`，transport/command/env 全手写），因此冒出大量"管理面板"插件（`dsh-mcp-panel`、`dsh-skill-mcp-panel`、`dsh-mcp-studio`、`dsh-mcp-manager*`、`dsh-toolbox-ui`、`dsh-armory`、`Jnpz`）。
- **改配置要重启**：`Jnpz` 主打"热加载免重启"，`dsh-mcp-manage` 主打"运行时编辑启停不必重启宿主"。
  purge 同样受这条约束（补丁只写盘，运行时生效要重启），所以 `purge_apply/revert/align` 的文案都明确写"需重启 dsh 完全生效"。
- 备份/迁移是刚需类目：`dsh-config-manager`、`dsh-backup`（覆盖 settings/plugins/MCP/skills/会话，含升级前快照与进程外救援）。purge 的 `.bak` + `revert` 已在做同类事，但没有跨机迁移面。

## 5. 目录站 JSON API 实测（2026-11-09 第二轮，用来定口径而不是照抄）

- `GET https://dshmp.com/api/plugins` 顶层是 `{total,page,perPage,pages,plugins}`，**`total=10063`、每页 50、共 202 页**（`perPage` 参数被忽略，别指望一把取全量）。
- 条目字段只有：`slug, npmName, name, description, version, license, homepage, totalStars, totalForks, hasWebUi, publishedAt, updatedAt, tags`。
  **`compatibility` 出现率 0/50** —— 所以同机 `dsh-codex-harness` 那个 `dsh.compatibility` 数组不是市场准入门，purge **不照抄**（抄了就是没有消费方的元数据）。
- 目录按 **`npmName`** 索引，而 **dsh-purge 不在目录里**：真正的门槛是"发不发 npm"，不是字段齐不齐（README 早就写了 npm 上没有这个包）。
- 首页 tag 分布：`deepseek-harness:36、cordis:6、deepseek:6、mcp:5、memory:4、agent:4、cli:3、ocr:3`；
  UI 类只有 `ui:2 / web-ui:1 / dsh-tui:1 / generative-ui:1` —— **没有统一的 UI tag 约定**，所以我先前设想的"补 `dsh-plugin-web-ui`"证据不足，放弃。
- 反过来一个发现：**首页 50 条里安全/红队类 tag 一个都没有**，而 purge 带了 5 个安全类 tag（其中 `网络安全`、`红队评测` 还是中文）——我们的 tag 词表基本是自言自语。
  据此只补两个"目录站在用、且 purge 现在真的具备"的：`mcp`（本轮刚做的 stdio server）与 `cordis`（它本来就是 Cordis bundle），并写进 `check-package` 第 9 项防被顺手删掉。

## 6. 同地盘地图（600 条去重样本，2026-11-09）

采样方式：`GET /api/plugins?page=1..12`（`page` 有效、每页 50、去重得 600 条；`?tag=prompt` 与不带参数 `total` 相同 → **该参数被忽略，别拿它当过滤**）。TLS 在这台机会抖，故每页带 3 次重试。

- 粗筛「提示词 / 注入 / 补丁 / 规则 / 人设」命中 66 条，但**绝大多数是记忆类插件在描述里提到 prompt**；再按强条件（`AGENTS.md` / system prompt / 优先级 / 人设）筛出 19 条，逐个看下来**没有一个和 purge 抢同一件事**：
  - `dsh-sag`、`dsh`（PLUR memory）、`dsh-auto-memory`、`dsh-mneme` → 记忆面，不是提示词优先级；
  - `dsh-prompt-market`(106) → 提示词**导入/市场**，不是注入顺序治理；
  - `dsh-agent-studio`(41) → 图形化拼装提示词/工具/技能，「按预设绑定即接管、卸载即恢复」与 purge 的 apply/revert 最像，但它管预设不做文件级补丁；
  - `dsh-persona-dafeiyu`(52) → 人设注入 + 全局/工作区/会话三档生效。**这条反而是自我确认**：purge 早就有三档（`readCwdSelections` / `ancestorChainForCwd` / `workspace_policy`），而且 `purge_rules` 已经把 workspace 策略与 cwd 候选报给模型了；
  - `deepseek-harness-zh_pro` → UI 润色 + 提示词注入的综合包；
  - 结构上最近的邻居其实是 **`dsh-base`**（*"The shared dsh core as a profile bundle: every profile's first patch layer"*）——它占 bundle 层，purge 占文件补丁层，不冲突。
- **tag 词表的真相**：`injection:0 / patch:0 / rules:0 / policy:1 / prompt:4 / persona:4`，而 `mcp:49 / memory:27 / skill:16 / cli:11`。
  也就是说 purge 地盘的词汇在生态里几乎没有 tag —— 我们做的事确实少见，但也意味着用 `injection`/`patch` 当 tag 换不到发现率。
- 据此只补一个「生态在用 + purge 真具备」的 tag：**`skill`**（16 家在用，purge 实带 32 个 drill 技能），并纳入 `check-package` 第 9 项。
  **`persona` 明确不加**：purge 只注入一个默认人设（小码酱），不是人设管理器，加了会以误导换 discoverability。
- 复核：purge 仍不在目录里（未发 npm，目录按 `npmName` 索引）。若将来要上，缺的是**发布动作**，不是字段。

## 7. 2000 条样本的三条结论（2026-11-09，40 页并发抓取）

抓法：`page=1..40` 并发 6、每页 4 次重试，得到 **2000 条（去重后仍 2000）**，标称 total 10063，覆盖率约两成。

1. **purge 独占「补丁 + 重启」这个组合。** 提到 restart 的 26 条、提到 patch 的 36 条，**同时提到两者的 = 0 条**。最接近的是 `dsh-setting-restart`（只管重启交互）与 `dsh-base`（官方第一层 patch layer，不谈重启）。所以"改文件级补丁 + 需重启生效"这套治理目前是我们独自承担的 UX，不是同路一片。
2. **有 UI 不是差异点，tag 也不整齐。** `hasWebUi` 占 **72.5%（1450/2000）**，可 `web-ui` tag 只有 69 家在用 —— 说明指望 tag 换发现率本身就不可靠，tag 只当辅助。
3. **tag 词形分裂，我上一轮的选择被更大样本纠正。** 全量 Top：`deepseek-harness:1606、deepseek:432、cordis:382、agent:138、mcp:124、harness:109、memory:91、skills:64、web-ui:69、codex:63、security:20、pentest:3、red-team:1`，而 **`injection:0`、`patch:0` 在两千条规模上依然为 0**。
   - `skills`(64) 与 `skill`(41) **两个词形都有人用且都不占绝对多数** → 与 purge 已经并存的 `dsh-plugin`/`dsh-plugins` 同理，两个都留，不是堆叠而是"生态本身分裂"。
   - `security:20` 是安全类里唯一有点量的英文 tag，purge 原本**没有** → 本轮补上（purge 的定位就是安全评测与进攻条令，事实成立）。
   - 据此把 `check-package` 第 9 项的 `WANT_TAGS` 扩到 7 个（`deepseek-harness / dsh-plugin / mcp / cordis / skill / skills / security`），全部满足"生态在用 + purge 真具备"。

## 7b. 长尾抽样（补头部样本的盲区）

按 star 排序只看过前 2000 条，所以补抽 `page=40/80/120/160/202`（163 条，**star 全为 0**，确为长尾）：
补丁/优先级治理族仅 **2 条**，且都不做文件级补丁；提到 restart 的 3 条里与 patch 的交集仍为 0。
→ **「无人做提示词优先级治理」在约 2163/10063（21%）的抽样下依然成立。**
值得盯的哲学邻居是 `dsh-dialog-fence`：「对所有对话生效的通用规则 + 按对话追加专属规则，以固定顺序注入运行时上下文快照」——它管上下文注入顺序，purge 管 system prompt 与包文件补丁，层不同但思路同源。

## 7c. 工具面成本 / 注入体积这两个维度上的最近邻（2026-11-09 定向探索）

第 19 轮后我一直在做内部工程化，这轮专门回社区，只看两个我刚建成门禁的维度：

- **`dsh-ops`（T-Auto）= 同问题的最近邻**。README 口径：「以提高 token 效率为目的，提供新增的 ops 系列工具并**隐藏部分官方工具**，低改动面、低侵入性」；「启用 DSH 预留的 **`tools_addition` 动态工具加载**，并提供渐进式披露的工具……大大减少常见特定场景的 token 消耗」。它的解法是**减官方工具 + 动态加载**，purge 走的是**聚合入口**（56 个 `redteam_*` 收成 1 个 `purge_drill`）——哲学一致（都是渐进式披露），手法不同，等于外部验证了聚合不是取巧。
- **`dsh-context`（bowenliang123）= 只注册 1 个工具**（13KB README、27 处 token/cost/context 表述，主战场是 context dashboard）。社区做上下文成本可视化用的是**面板 + 极少工具**，与我 `purge_drill` 的取舍互证。
- **一条实测否证**：`tools_addition` 在本机 0.2.2-rc.1 宿主产物里 **0 命中**（`@deepseek-ai/*` 全量 JS/mjs/cjs/d.ts/json/yml + 804KB 桌面壳 `main.js` 都扫过）。它不是宿主备好的开关，**别当现成能力借**。
- **purge 自己的成本账（本轮第一次算）**：76 条补丁 / 188 支替换净 **+13,128 字**，其中**提示词层只 +904 字**，其余 +12,224 字是代码文本、不进上下文 → 真 token 成本 = 默认注入 29,777 + 904 ≈ **3.07 万字**。该口径已进 `--align`：
  `注入正文：默认 29777 字｜生效 24163 字｜提示词层净 +904 字（代码层 +12224 字不进上下文）｜状态 custom：sync 不会自动覆盖`

## 7d. 第二趟：按 npm 产物量邻居的「工具面成本」（2026-11-09）

不读宣传语，直接下 tarball 量打包后的真产物：

| 插件 | 版本数 | 产物规模 | 注册处 | description 文本合计 |
| --- | --- | --- | --- | --- |
| `dsh-context`（0.83.0） | **161** | 1045KB / 2 JS | **0** | **65 字**（纯面板路线） |
| `dsh-ops`（0.5.2） | 19 | 1298KB / 264 JS | 8 | **7,566 字** |
| **purge** | — | 72 文件 | 10 工具 | **3,598 字**（内含把 56 个 `redteam_*` 聚成 1 个 `purge_drill`） |

三条结论：① **生态里确实没人给工具面设预算** —— dsh-ops 用 7,566 字描述换 8 个注册，purge 用 3,598 字换 10 个工具；② `dsh-context` 走的是另一个极端（**0 工具、纯 dashboard**），说明"面板 or 工具"是真实存在的两条路，purge 选的是"聚合工具 + 面板并存"；③ 版本节奏 161 vs 19，`dsh-context` 迭代密度最高，值得后续盯它怎么做上下文度量。
**顺带一条否证**：想借的 `tools_addition`（见 8b/第 7 轮）在本机宿主里 0 命中，`dsh-ops` 的注册数也只有 8 处（不是它 README 听起来那么多），**别按宣传语估成本**。

## 8. 三级证据自查（借 dsh-plugin.net 的收录判据，落成 `check-package` 第 11 项）

| 层级 | 目录站判据 | 本机实测 | purge |
| --- | --- | --- | --- |
| tier1 | README 写 dsh 安装命令 | 精确串 `dsh plugin add` 对 **7 个已装插件全部不成立**，真实写法是 `dsh plugin --profile web add` / `--profile desktop add` | ✓ 三语各 5 处 |
| tier2 | 仓库有 bundle manifest | 不是独立文件，而是 `package.json` 的 **`dsh.bundle`** 字段；官方 hub 把它当布尔标记（宿主 `client.js` L15679 字段说明）；`dsh-client-modules` L1065 规定可选 `dsh.bundle.platforms` 必须是非空字符串数组 | ✓ `{patch: "./cordis.patch.yml"}`（文件存在已校验） |
| tier3 | 包元数据声明 dsh 依赖 | 7 个已装插件都有 `peerDependencies.@deepseek-ai/*`（cordis 等） | ✓ `@deepseek-ai/cordis ^4.0.1` |

结论：**purge 三级证据全绿，唯一缺的是"发 npm"这个动作**（dshmp 按 `npmName` 索引，purge 至今不在目录里）。反向探针：抹掉 README 全部 5 处安装命令 → `✗ README 缺安装命令（tier1）`、exit 1。

## 8b. registry 版本表的坑（改掉了自己一条旧结论）

`@deepseek-ai/dsh-*` 的 `dist-tags.latest` 指向 `0.0.1-rc.1` 这类占位版本，但 `versions` 表里有 40+ 个真实宿主版本（含 `0.2.2-rc.1`、`0.2.1-rc.2`、`0.2.0-rc.2`）。所以：
- 判"宿主有没有新版本"**必须读 versions 表**，看 latest 会被骗（我第 8 轮就被骗过一次，写下「宿主版本不能靠 npm 判定」）。
- `check-anchors --old` 的自动推断正是从 versions 表里取「小于新版的最大一档」，实测推出 `0.2.2-alpha.3`。

## 9. 结论（本轮据此动手的事）

1. 继续走聚合优先：能力增长优先加 op/参数，而不是加第 N 个工具。
2. 补 `check-package` 包自证闸门，对标市场的 manifest 准入（purge 是 GitHub tarball 分发，manifest 校验只能自己做）。
3. `dsh.compatibility` 这类市场字段暂不硬加：purge 目前不在两个目录站里，先确认消费方是谁再加，不照抄。
