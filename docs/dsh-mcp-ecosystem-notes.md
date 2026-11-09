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

## 7. 结论（本轮据此动手的事）

1. 继续走聚合优先：能力增长优先加 op/参数，而不是加第 N 个工具。
2. 补 `check-package` 包自证闸门，对标市场的 manifest 准入（purge 是 GitHub tarball 分发，manifest 校验只能自己做）。
3. `dsh.compatibility` 这类市场字段暂不硬加：purge 目前不在两个目录站里，先确认消费方是谁再加，不照抄。
