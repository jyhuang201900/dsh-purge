---
name: competition-relay-coercion-chain
description: 中继/强制认证专项：追踪强制、中继目标与被接受的认证边
whenToUse: 域内要串「强制认证 + 中继」拿权限（如 NTLM relay）时加载
---

> 主题：强制认证与中继链（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Relay Coercion Chain

Use this skill when the hard part is proving the full chain from forced authentication to a service that actually accepts the relayed identity.

## Quick Start

1. Split the chain into coercion source, captured auth, relay target, acceptance point, and resulting effect.
2. Record transport, protocol, and service identity at each hop.
3. Separate forced-auth generation from relay success and from downstream privilege.
4. Keep coercion trigger, relay transcript, and accepting service in one evidence chain.
5. Reproduce the smallest coercion-to-acceptance path that proves the decisive edge.

## Workflow

### 1. Map The Coercion Source

- Identify the service, RPC, file path, printer path, WebDAV edge, or protocol trigger that forces authentication.
- Record source host, coerced principal, transport, and any environmental preconditions.
- Keep one compact note of exactly what causes the auth to leave the source.

### 2. Trace The Relay Target

- Record where the authentication lands, how it is forwarded, and which protocol or service consumes it.
- Distinguish capture-only, replay-only, and actual relay acceptance.
- Keep service name, target host, protocol, relay transcript, and acceptance response tied together.

### 3. Reduce To The Decisive Relay Chain

- Compress the result to the smallest sequence: coercion trigger -> relayed auth -> accepted service -> resulting privilege or artifact.
- State clearly whether the decisive weakness lives in the coercion source, the relay target, signing settings, or the accepted downstream service.
- If the path ultimately becomes a certificate-enrollment issue or a pure Kerberos delegation edge, hand off to the tighter specialized skill.

## Read This Reference

- Load `references/relay-coercion-chain.md` for the coercion checklist, relay checklist, and evidence packaging.

## What To Preserve

- Coercion trigger details, source host, coerced identity, target host, accepting service, and resulting effect
- Relay transcripts, error or acceptance responses, and the exact protocol used at each hop
- The smallest replayable coercion-to-acceptance sequence

---

## 检查清单与常见坑（上游参考并入）

### relay-coercion-chain

# Relay Coercion Checklist

## Chain Segments

- Coercion source and trigger
- Captured or forwarded authentication
- Relay target and protocol
- Acceptance point and resulting effect

## Reconstruction Order

1. What triggers the source to authenticate
2. Which identity leaves the source
3. Where that authentication is relayed
4. Which service actually accepts it
5. What privilege, enrollment, or artifact results

## Evidence To Keep Together

- Source side: host, service, trigger, protocol, coerced principal
- Relay side: listener, transcript, target host, protocol, response
- Effect side: accepted service, resulting account effect, privilege, or issued artifact

## Common Pitfalls

- Stopping at “forced auth happened” without proving relay acceptance
- Proving relay acceptance without showing what capability it produced
- Mixing several candidate relay targets without isolating the one that actually accepted the relayed auth

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-lsass-ticket-material`、`competition-mailbox-abuse`、`competition-ssrf-metadata-pivot`、`competition-windows-pivot`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

