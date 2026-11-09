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

## 5. 结论（本轮据此动手的事）

1. 继续走聚合优先：能力增长优先加 op/参数，而不是加第 N 个工具。
2. 补 `check-package` 包自证闸门，对标市场的 manifest 准入（purge 是 GitHub tarball 分发，manifest 校验只能自己做）。
3. `dsh.compatibility` 这类市场字段暂不硬加：purge 目前不在两个目录站里，先确认消费方是谁再加，不照抄。
