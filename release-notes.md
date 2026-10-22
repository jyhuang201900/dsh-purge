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
