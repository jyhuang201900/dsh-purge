---
name: competition-request-normalization-smuggling
description: 请求规范化专项：追踪解析器差异、头部歧义与请求走私
whenToUse: 代理/网关/后端三层解析不一致，要试走私或头歧义时加载
---

> 主题：请求规范化走私（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Request Normalization Smuggling

Use this skill when request interpretation changes between proxy, middleware, and backend parser layers.

## Quick Start

1. Map every parsing hop: client-facing proxy, gateway, app server, and downstream service.
2. Record path normalization, header canonicalization, transfer framing, and host derivation at each hop.
3. Capture one accepted baseline request and one differential request with minimal delta.
4. Prove which hop interprets the request differently.
5. Reproduce one minimal differential path that yields decisive behavior.

## Workflow

### 1. Map Parse And Routing Boundaries

- Record `Host`, forwarded headers, path decoding, slash collapsing, dot-segment handling, and case behavior.
- Note `Content-Length`, `Transfer-Encoding`, chunk framing, and connection reuse behavior when relevant.
- Keep edge parser and backend parser decisions side by side.

### 2. Prove Differential Interpretation

- Build paired requests that differ in one canonicalization dimension only.
- Capture proxy logs, backend logs, route match, and downstream request shape.
- Show where route, auth scope, or body boundary diverges.

### 3. Reduce To Decisive Smuggling Chain

- Compress to: crafted request -> parser differential across hops -> unintended routed request or hidden endpoint reach -> resulting effect.
- State whether root cause is path normalization drift, header ambiguity, transfer framing differential, or host-derivation confusion.
- If the chain becomes primarily runtime routing without framing tricks, hand off to runtime routing skill.

## Read This Reference

- Load `references/request-normalization-smuggling.md` for parse-differential checklist and evidence packaging.

## What To Preserve

- Raw request pairs, hop-by-hop interpretation, and final routed target
- Exact normalization or framing delta that flips behavior
- One minimal replayable differential request path

---

## 检查清单与常见坑（上游参考并入）

### request-normalization-smuggling

# Request Normalization Smuggling Checklist

## First Pass

- Front proxy, gateway, backend parser, internal service chain
- Path decode rules, slash and dot handling, case normalization, host derivation
- Header canonicalization, duplicate header behavior, CL/TE handling, chunk parsing

## Chain To Reconstruct

1. Baseline request path captured
2. Differential request crafted with one delta
3. Parser or router divergence observed
4. Unintended route or request body boundary reached
5. Decisive effect reproduced

## Evidence To Keep Together

- Request side: raw baseline and differential requests
- Hop side: each parser decision and route match per hop
- Effect side: hidden endpoint access, auth bypass branch, or state mutation

## Common Pitfalls

- Changing multiple fields at once and losing root-cause attribution
- Looking only at frontend proxy logs without backend route evidence
- Reporting parser mismatch without reproducing final effect

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-queue-worker-drift`、`competition-race-condition-state-drift`、`competition-runtime-routing`、`competition-stego-media`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
