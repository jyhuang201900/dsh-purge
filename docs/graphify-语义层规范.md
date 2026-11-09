# dsh-purge 图谱语义层规范（graphify 标准化）

> 适用对象：`graphify-out/` 里的**语义层**（人/模型抽出来的文档概念），不是 AST 代码层。
> 目的：让图谱是可重跑的项目资产，而不是一次性草稿。改任何语义文件后，一条命令回到成品。

## 1. 目录布局（项目性）

```
graphify-out/
├─ semantic/            语义层源文件（唯一手写字段，进版本库）
│  ├─ 01-recon-skills.json        信息收集类技能（13 个）
│  ├─ 02-intranet-skills.json     内网与利用类技能（10 个）
│  ├─ 03-exploit-skills.json      落地与载荷类技能（9 个）
│  ├─ 04-prompt-inject.json       注入正文三变体 + 历史快照
│  ├─ 05-readme-release.json      README 双语三件 + release-notes
│  ├─ 06-docs-memory.json         两份方案文档 + .workbuddy-ai 记忆
│  ├─ 07-media.json               8 张图（截图 + banner）
│  ├─ 08-concept-bridges.json     只补跨概念边，不建节点
│  ├─ 09-isolated-bridges.json    同上：清零度数 ≤1 的孤立概念
│  ├─ 10-update-framework.json    更新框架（渠道/台账/marker/自愈）
│  ├─ 11-restart-family.json      重启家族（web/desktop/uninstall + env 兜底分叉）
│  ├─ 12-host-alignment.json      宿主版本对齐（0.2.2-rc.1 漂移 / 分桶可观测 / 生态约定对照）
│  ├─ 13-dev-gates.json           工程闸门（七关 verify / 双语一致性 / 清单一致性 / align 建议行）
│  └─ │  ├─ 14-locale-split.json           双语文案拆开（源→内联链与 CRLF 陷阱）
│  ├─ 15-tool-surface.json         工具面契约表 / MCP server / 技能可用性体检
│  └─ 16-ecosystem-intel.json        包自证闸门 + 社区生态情报（聚合优先的外部验证）
├─ ast-baseline.json    AST 基线（脚本冻结，勿手改）
├─ graph.json           交付图（生成物）
├─ graph.html           交互视图（生成物）
├─ GRAPH_REPORT.md      报告（生成物）
└─ <YYYY-MM-DD>/        cluster-only 每次自动备份上一版
```

规则：**手写的只有 `semantic/`**，其余全是生成物。要改图就改 `semantic/`，然后重跑。

发布边界：`graphify-out/` 进 git（`semantic/` + `GRAPH_REPORT.md`），但**不随 npm 包发布**——`package.json` 的 `files` 白名单里没有它，宿主运行时也不需要图谱。所以宿主副本里看不到 `graphify-out/` 属正常，不是丢文件。

## 2. 再生流程（可复制）

```sh
# 1) 代码层重抽（改了 .js / 新增文件才需要；--no-cluster 产出抽取态）
graphify extract . --code-only --no-cluster

# 2) 语义层合并 + 守门 + 聚类出图（日常只跑这条）
npm run graphify                       # 等价于下面一行
node scripts/graphify-sync.mjs --cluster
```

幂等性：`graphify-sync.mjs` 永远从 `ast-baseline.json` 重建，重跑不会累加语义边。基线不存在时，它从当前 `graph.json` 剔除 `_origin=semantic` 的部分自动冻结一份。
基线走样（AST 结构大改、社区要重来）时删掉 `ast-baseline.json` 让它重新冻结即可。

已知差值（如实记，别误判成脚本丢边）：`GRAPH_REPORT.md` 的 Summary 统计 networkx 去重后的边数，比 `graph.json` 的 `links` 少 56 条 —— 本仓库当前固定差值来自 `ref_*` 外部引用与平行边的合并，与语义层无关（校验口径以 `links` 计数 + `validationErrors` 为空为准）。

## 3. 节点规范

字段：`id` · `label` · `file_type` · `source_file` · `source_location` · `rationale`（可选）。

`file_type` **只能是** `code` / `document` / `paper` / `image` / `rationale` / `concept` 六个值之一，别的值一律拒收（脚本会报"非法 file_type"）。

**rationale 不建独立节点。** 设计理由（WHY、权衡、口径）写成所属节点的 `rationale` 属性。历史遗留的 rationale 节点由脚本折叠：`parent.rationale += " 另注：<label>"`，其身上的其它边**转移给父节点**，不丢语义。

**concept 才建节点** —— 且仅限"本身是具名实体或概念"的东西（如 `五种资产关系边`、`火力阶梯五级`）。描述性短语建节点 = 孤立噪声。

ID 格式：小写、只允许 `[a-z0-9_]`，`{stem}_{entity}`，stem 取仓库相对路径去扩展名、逐段规范化。中文文件名例外——用拉丁语义名（`docs_adapt_0_2_1_rc_2_diff`），因为按规则逐字符替换会把中文全变成下划线，读不出东西。禁止给 ID 追加 `_c1`、`_chunk2` 之类后缀：ID 必须只由 label 决定。

`source_file` 写**仓库相对路径**（`skills/redteam/fofa-recon.md`）。写绝对路径也行，脚本会相对化；不相对化会在增量重抽时配不上 cache。

## 4. 边规范

```
relation ∈ calls | implements | references | cites | conceptually_related_to
           | shares_data_with | semantically_similar_to | rationale_for
confidence ∈ EXTRACTED | INFERRED | AMBIGUOUS
```

- `EXTRACTED`：原文里明写（点名、引用、"见技能 xxx"）→ `confidence_score` **恒为 1.0**。
- `INFERRED`：合理推断 → 只准从 `0.95 / 0.85 / 0.75 / 0.65 / 0.55` 五档里取一个，**禁止 0.5**（离散档位比连续区间好执行）。
- `AMBIGUOUS`：拿不准 → `0.1–0.3`，宁标模糊不许省略。
- `semantically_similar_to` 只在相似性**非显然且跨面**时用（跨阶段、跨文档）；两个都 obvious 的东西不算。
- 文档到代码的边连 AST 真节点 id（`lib_identity_stripharnesspersona`），不许造一个不存在的符号名——脚本按悬空边报错。

## 5. 超边规范

3 或更多成员，每个语义文件最多 3 条；只在"成组关系"超出两两边能表达的信息时才写（如 `内网突破标准通道：加密马 → suo5 → 内网测绘`）。脚本会折叠成员并丢弃塌到 2 个以下的超边。

## 6. coverage 规范

每个语义文件的 `coverage` 映射"源文件路径 → 实读行数"。短读会标成 partial 并在下次 `--update` 重试；**缺条目等于假装读完了**。图片按 1 行计（无视觉解读时见第 8 节）。

## 7. 守门（脚本会拦的硬问题）
| 报错 | 含义 | 处理 |
| --- | --- | --- |
| `悬空边 A -[r]-> B` | B 不存在（或刚被折叠掉） | 改指父节点或删边 |
| `非法 file_type` | 写了白名单外的值 | 换成六个合法值之一 |
| `缺 confidence_score` | 边没给分数 | 补，EXTRACTED 给 1.0 |
| `INFERRED 边不在离散档位` | 用了 0.5 或 0.4 | 按第 4 节选档 |
| `超边引用了不存在的节点` | 成员名错 | 对齐节点 id |
| 某条补丁常年 `skipped` | 宿主把文件搬了家（如 0.2.2 拆出 `dsh-tool-executor-ptc`），而状态机按 skipped 优先、`filterTargetFiles` 对落空键不登记 | 别怀疑锚点，先查 file key 指向的包还在不在 |

退出码：`0` 干净；`1` 有硬问题待修（脚本不会静默放行）。

- **文档节点必须自己声明**（2026-11-09 实测）：`graphify extract --code-only` 只把代码收进 AST，`*.md` / `*.svg` 都不进。
  所以图里看到的 `release_notes`、`readme`、`docs_banner` 全是语义层自己写的文档节点；新增一份 md 想在图里被引用，
  **必须先在语义层补它的 node**，否则守门就报悬空。同理 `file_type` 只有白名单六个值（`code/document/paper/image/rationale/rfc`），
  想写 `context` 之类的新类型是不行的——本轮就被拦了一次。
- **改结构别用手插逗号**（2026-11-09 实测教训）：本文件是「一个元素一行」的紧凑风格，往数组里插一条时尾逗号会双向出错（新末元素多逗号、原末元素缺逗号）。本轮手改连错两次，正确做法是**摘掉新行 → `json.loads` 确认剩余合法 → 作为数据 `append` → 用发射器整体重写**，而不是在文本里赌逗号。这也是第 5 节「改一处跑一次」的由来：`npm run verify` 的 JSON 关当场把这两次拦下了。

## 8. 本机降级口径（如实记，不编）

- **无语义后端**（`~/.graphify/providers.json` 不存在、七个常见 API key 全无）→ 走 L3，由宿主模型内联抽取；`input_tokens = output_tokens = 0` 是**来源如实**，不是免费午餐。
- **无独立子代理可派**（本机 harness 未暴露 `subagent` 工具）→ 语义抽取发生在主上下文内，非独立上下文，注意这一点带来的串联风险。
- **当前模型无图像输入**（`huihui-flash-next-basalt` 不声明 image）→ 截图语义取自 README 图注 + PNG IHDR 实测像素尺寸，内容判读标 `AMBIGUOUS`，不许假装看过画面。
- 社区名由 `cluster-only` 按枢纽节点自动命名（无后端时不做 LLM 命名）。要人工命名：改 `semantic/` 里枢纽文档的 `label`，重跑即生效。
