---
name: competition-websocket-runtime
description: WebSocket 专项：追踪握手、帧、订阅与状态
whenToUse: 靶子用 WebSocket，要分析握手鉴权、帧格式或订阅越权时加载
---

> 主题：WebSocket 运行时（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition WebSocket Runtime

Use this skill when the decisive behavior is carried by realtime handshake and frame flow rather than one-shot HTTP alone.

## Quick Start

1. Map the handshake first: origin, path, headers, cookies, query, auth token, and upgrade response.
2. Separate connection setup, subscription messages, keepalives, server pushes, and reconnect logic.
3. Record message schema, topic or channel identity, and state side effects in one chain.
4. Tie frames to rendered, stored, or backend-visible effects.
5. Reproduce the smallest handshake-plus-frame sequence that reaches the decisive state change.

## Workflow

### 1. Map The Realtime Handshake

- Record the initial HTTP or SSE request, upgrade headers, cookies, tokens, query params, origin checks, and negotiated protocol.
- Note whether auth material is carried by headers, cookies, query strings, or initial application frames.
- Keep route, subscription endpoint, and session identity tied together.

### 2. Decode Message Flow

- Separate subscribe, unsubscribe, ack, heartbeat, server push, reconnect, and terminal frames.
- Recover message types, channel IDs, schema fields, and sequencing that matter to behavior.
- Distinguish transport keepalive from application-level business messages.

### 3. Reduce To The Decisive Realtime Path

- Compress the result to the smallest sequence: handshake -> auth or subscribe frame -> pushed or accepted frame -> resulting state change.
- Keep canonical frame order and any replayed minimal order side by side.
- If the hard part is generic protocol reassembly without runtime UI or app-state linkage, switch back to the tighter protocol skill.

## Read This Reference

- Load `references/websocket-runtime.md` for the handshake checklist, frame checklist, and evidence packaging.

## What To Preserve

- Handshake headers, cookies, query params, auth material, negotiated subprotocol, and channel IDs
- Frame schemas, subscription messages, server pushes, reconnect flow, and resulting state changes
- The smallest replayable realtime sequence that proves the decisive branch

---

## 检查清单与常见坑（上游参考并入）

### websocket-runtime

# WebSocket Runtime Checklist

## Handshake First

- Path, query, cookies, auth headers, `Origin`, upgrade headers, negotiated protocol, upgrade response
- SSE setup path, auth carrier, retry directives, event names, last-event IDs when applicable
- Connection lifecycle: open, subscribe, heartbeat, reconnect, close

## Message Flow To Reconstruct

1. Handshake or stream setup
2. Auth or subscribe message
3. Ack or server acceptance
4. Push or command frames
5. Persisted, rendered, or backend-visible side effect

## Evidence To Keep Together

- Setup side: request shape, tokens, cookies, channel or room identity
- Frame side: type, topic, payload schema, order, reconnect behavior
- Effect side: UI update, storage mutation, route unlock, server action, or worker effect

## Common Pitfalls

- Treating keepalive traffic as business logic
- Listing frames without showing which one changes state
- Ignoring reconnect or resubscribe behavior that is necessary to reproduce the issue

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-template-render-path`、`competition-web-runtime`、`competition-zip-archive`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
