---
name: competition-graphql-rpc-drift
description: GraphQL 与 RPC 专项：追踪契约、漂移与隐藏操作
whenToUse: 靶子用 GraphQL 或 gRPC/RPC，要找隐藏操作、字段越权或契约漂移时加载
---

> 主题：GraphQL / RPC 契约漂移（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Graphql Rpc Drift

Use this skill when the hard part is matching declared contracts with live handlers to find hidden, stale, or privileged operations.

## Quick Start

1. Collect the declared contract surface first: schema, manifest, generated client, persisted query map, or OpenAPI spec.
2. Record actual request shapes, operation names, variables, method, path, and auth context before mutating anything.
3. Compare declared contract, generated client behavior, and live handler behavior side by side.
4. Preserve one accepted operation and one drifted or hidden operation with the smallest delta.
5. Reproduce the smallest contract-to-handler mismatch that proves the decisive branch.

## Workflow

### 1. Map The Declared Contract Surface

- Record GraphQL schema, introspection output, persisted query ids, RPC manifests, generated clients, or OpenAPI documents that define the intended surface.
- Note versioned endpoints, client-only guards, hidden enums, optional fields, and operation naming conventions.
- Keep document source and generation path tied to the observed requests.

### 2. Prove Live Handler Behavior

- Capture the real request and response pairs, including operation name, variables, headers, cookies, and status.
- Compare client-side validation, schema expectations, and live handler normalization or fallback behavior.
- Record hidden operations, stale fields, undocumented methods, or handler-only branches that still execute.

### 3. Reduce To The Decisive Drift Path

- Compress the result to the smallest sequence: declared contract -> actual request -> handler branch -> resulting capability.
- State clearly whether the decisive drift lives in generated client assumptions, persisted query mapping, schema version skew, RPC manifest mismatch, or handler-side hidden logic.
- If the task shifts into generic JWT, OAuth, or queue behavior after acceptance, hand off to the tighter specialized skill.

## Read This Reference

- Load `references/graphql-rpc-drift.md` for the contract checklist, live-handler checklist, and evidence packaging.

## What To Preserve

- Schemas, manifests, generated clients, persisted query ids, operation names, and version markers
- One accepted and one drifted request pair that proves the mismatch
- One minimal contract-to-handler sequence that reaches the decisive effect

---

## 检查清单与常见坑（上游参考并入）

### graphql-rpc-drift

###### Graphql And Rpc Drift Checklist

###### First Pass

- GraphQL schema, introspection output, persisted query ids, RPC manifest, generated client, OpenAPI doc
- Operation names, fields, variables, method, path, version headers, auth context
- Live handlers, fallback routes, hidden operations, stale fields, client-only guards

###### Chain To Reconstruct

1. Declared contract is identified
2. Real request shape is captured
3. Handler normalization or hidden branch is observed
4. Contract drift or hidden operation is confirmed
5. Resulting capability or artifact is reproduced

###### Evidence To Keep Together

- Contract side: schema, manifest, generated client, version marker, persisted query id
- Request side: operation name, variables, method, path, headers, cookies
- Effect side: hidden data, accepted action, privilege, or backend state change

###### Common Pitfalls

- Treating generated clients as proof of the only supported operations
- Looking at GraphQL schema or OpenAPI docs without capturing real requests
- Describing hidden operations without proving the exact handler branch they hit

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-file-parser-chain`、`competition-forensic-timeline`、`competition-jwt-claim-confusion`、`competition-malware-config`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
