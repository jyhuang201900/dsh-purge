---
name: competition-ssrf-metadata-pivot
description: SSRF 专项：追踪 SSRF 路径、元数据跳板与被接受的凭据边
whenToUse: 有 SSRF 要跳到元数据/内网服务并拿凭据时加载
---

> 主题：SSRF 与凭据跳板（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition SSRF Metadata Pivot

Use this skill when the decisive path runs through server-side request capability, internal service reachability, or metadata-derived credentials.

## Quick Start

1. Separate the SSRF source, forwarding layer, reachable target, and accepted downstream credential edge.
2. Record request method, URL construction, header behavior, redirects, DNS or host overrides, and response shaping before mutation.
3. Map internal host, metadata endpoint, token extraction, and accepting service as one chain.
4. Distinguish read-only reachability from credential-bearing access.
5. Reproduce the smallest SSRF-to-accepted-access path.

## Workflow

### 1. Map SSRF Reachability

- Record source primitive: URL parameter, webhook, image fetcher, importer, proxy endpoint, or backend callback.
- Note normalization steps: scheme filtering, host allowlists, redirects, DNS resolution, path rewrite, and header injection.
- Keep target host, protocol, and response behavior tied to the exact SSRF source.

### 2. Trace Metadata And Credential Pivot

- Show whether metadata endpoints, internal control APIs, or workload identity services are reachable.
- Record token fields, role scope, service account, expiration, and where the token is accepted.
- Distinguish credential extraction success from accepted privilege at a downstream service.

### 3. Reduce To Decisive SSRF Chain

- Compress to: SSRF source -> internal or metadata target -> credential or sensitive response -> accepted replay or API access.
- State whether the decisive edge is parser bypass, allowlist bypass, redirect abuse, header confusion, or metadata trust.
- If the task becomes mostly cloud identity policy analysis, hand off to the tighter cloud metadata skill.

## Read This Reference

- Load `references/ssrf-metadata-pivot.md` for SSRF checklists, metadata pivots, and evidence packaging.

## What To Preserve

- SSRF source point, URL construction rules, reachable hosts, and response deltas
- Extracted token or credential fields, scope, and accepting service
- One minimal SSRF-to-accepted-access replay path

---

## 检查清单与常见坑（上游参考并入）

### ssrf-metadata-pivot

###### SSRF Metadata Pivot Checklist

###### First Pass

- SSRF source parameter, URL builder, method, headers, redirect handling
- Host allowlist or denylist logic, DNS behavior, scheme checks, proxy layers
- Reachable internal services, metadata endpoints, token responses

###### Chain To Reconstruct

1. Server-side fetch primitive is confirmed
2. Internal or metadata endpoint is reachable
3. Credential or sensitive response is extracted
4. Downstream service accepts the recovered material
5. Resulting capability is reproduced

###### Evidence To Keep Together

- Source side: endpoint, parameter, URL construction, normalization rules
- Pivot side: target host, metadata path, token fields, scope, expiry
- Acceptance side: target API or service, replay method, resulting privilege

###### Common Pitfalls

- Treating metadata reachability as equivalent to privilege without acceptance proof
- Ignoring redirects, host normalization, or proxy-injected headers
- Skipping the final accepted-access step and reporting only response leakage

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-mailbox-abuse`、`competition-relay-coercion-chain`、`competition-windows-pivot`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
