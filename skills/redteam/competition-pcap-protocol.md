---
name: competition-pcap-protocol
description: PCAP 专项：重建会话、解码协议并把报文对上行为
whenToUse: 拿到流量包要重建会话、解协议或把报文与行为对应时加载
---

> 主题：PCAP 会话重建（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition PCAP Protocol

Use this skill when the decisive evidence sits inside packet order, protocol framing, or stream reconstruction rather than a single IOC or host log.

## Quick Start

1. Establish the capture boundaries first: hosts, time span, interfaces, missing packets, retransmits, and stream count.
2. Group traffic into sessions before decoding payload semantics.
3. Record protocol framing, sequence, timing, and transferred artifacts together instead of as isolated packets.
4. Correlate packet evidence with host, malware, or app behavior only after the session is reconstructed.
5. Reproduce the smallest decoded stream or transferred artifact that proves the challenge path.

## Workflow

### 1. Build The Session Map

- Identify endpoints, protocols, ports, TLS handshakes, DNS lookups, websocket upgrades, and long-lived streams.
- Note missing capture coverage, asymmetric routing, packet loss, or reassembly issues before drawing conclusions.
- Separate control channels, bulk transfers, keepalives, and noise.

### 2. Decode The Protocol Boundary

- Reassemble TCP streams or UDP conversations before interpreting fields.
- Recover framing, message order, custom headers, binary fields, compression, encryption boundaries, and object transfers.
- Keep payload direction, timing, and session state aligned with each decoded message.

### 3. Tie Packets To Behavior

- Show which packet sequence maps to which host event, malware branch, login flow, upload, exfiltration step, or command channel.
- Distinguish protocol recognition from artifact recovery: naming HTTP, DNS, or a custom C2 is not enough without decoded content or proven downstream effect.
- If the task becomes mostly a host timeline problem after decode, switch to the tighter forensic timeline skill.

## Read This Reference

- Load `references/pcap-protocol.md` for the session checklist, decode checklist, and evidence packaging.
- If the hard part is a WebSocket or SSE handshake, subscription flow, realtime frames, or frame-driven state, prefer `$competition-websocket-runtime`.
- If the hard part is a custom handshake, framing, checksum, sequence dependency, or deterministic replay harness, prefer `$competition-custom-protocol-replay`.

## What To Preserve

- Stream IDs, endpoint pairs, packet ranges, timestamps, protocol framing, and object boundaries
- Decoded requests, responses, commands, transferred files, and the session that carried them
- The exact packet sequence or reconstructed stream that proves the challenge behavior

---

## 检查清单与常见坑（上游参考并入）

### pcap-protocol

###### PCAP Protocol Checklist

###### First Pass

- Capture time span, interfaces, endpoint pairs, port distribution, TLS use, DNS lookups, websocket upgrades
- Missing data, retransmits, out-of-order packets, NAT ambiguity, asymmetric routing
- Candidate high-value streams: auth, upload, download, command, beacon, exfiltration

###### Decode Order

1. Reassemble stream or conversation
2. Recover framing and direction
3. Identify compression, encoding, crypto, or transfer boundaries
4. Extract decoded messages or transferred objects
5. Tie the decoded stream to host or sample behavior

###### Evidence To Keep Together

- Session identity: endpoints, ports, protocol, stream ID, timestamps
- Decode facts: framing markers, lengths, message order, headers, keys, or object names
- Behavioral link: command executed, file transferred, beacon path, auth effect, or parser branch

###### Common Pitfalls

- Reasoning from single packets when stream reassembly is required
- Naming a protocol without decoding the content that matters to the challenge
- Mixing unrelated streams because they share a host or port but not the same session state

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-malware-config`、`competition-oauth-oidc-chain`、`competition-prompt-injection`、`competition-queue-worker-drift`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
