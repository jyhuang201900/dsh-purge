---
name: competition-custom-protocol-replay
description: 自定义协议专项：重放私有分帧、消息顺序与被接受的状态
whenToUse: 目标是自研协议/私有二进制协议，要重放出被服务端接受的状态时加载
---

> 主题：自定义协议重放（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Custom Protocol Replay

Use this skill when the hard part is not merely naming the protocol, but reproducing the exact message order and state needed for acceptance.

## Quick Start

1. Identify client and server roles, session boundaries, and reset conditions before decoding field semantics.
2. Recover framing, lengths, delimiters, sequence numbers, checksums, nonces, and state transitions before broad replay attempts.
3. Keep one canonical transcript of a successful exchange.
4. Change one field or one message at a time while replaying.
5. Reproduce the smallest accepted conversation that proves the decisive branch.

## Workflow

### 1. Map The Session State Machine

- Identify handshake, negotiation, authentication, keepalive, command, and teardown phases.
- Record which fields are static, which are derived, and which depend on prior messages.
- Keep message order, direction, and timing tied to the same session identity.

### 2. Recover Framing And Integrity

- Reconstruct lengths, delimiters, type bytes, checksums, MACs, counters, compression, or encryption boundaries.
- Distinguish transport framing from application-level framing.
- Note exactly where server acceptance changes when one field or step is mutated.

### 3. Build The Minimal Replay Harness

- Reduce the path to the smallest transcript that reaches the accepted state, parser branch, command effect, or artifact.
- Preserve both the original captured sequence and the replayed minimal sequence.
- If the problem is mainly generic PCAP or stream decoding with no stateful replay requirement, switch back to the broader PCAP skill.

## Read This Reference

- Load `references/custom-protocol-replay.md` for the state-machine checklist, transcript checklist, and evidence packaging.

## What To Preserve

- Canonical transcript, message types, field boundaries, checksums, counters, and session identifiers
- Original capture slices and the replay harness inputs that produce acceptance
- The exact mutation that flips the protocol from rejected to accepted, or vice versa

---

## 检查清单与常见坑（上游参考并入）

### custom-protocol-replay

###### Custom Protocol Replay Checklist

###### Transcript First

- Establish roles, stream IDs, ports, session resets, handshake boundaries, and successful transcript examples
- Separate transport segmentation from application messages
- Record retransmits or duplicate messages so they do not pollute the protocol model

###### Recovery Order

1. Framing and message boundaries
2. Direction and sequence state
3. Integrity fields: checksum, MAC, counter, nonce, or signature
4. Compression, encoding, or crypto boundary
5. Accepted vs rejected transcript deltas

###### Evidence To Keep Together

- Message identity: type, offset, length, direction, sequence, or delimiter
- Acceptance state: prior message dependency, negotiated value, checksum, or nonce source
- Replay proof: minimal transcript, harness input, and server response or side effect

###### Common Pitfalls

- Trying broad replay before framing and state dependencies are understood
- Mixing messages from separate sessions into one replay model
- Claiming protocol recovery without producing an accepted replay or meaningful state transition

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-browser-persistence`、`competition-bundle-sourcemap-recovery`、`competition-file-parser-chain`、`competition-forensic-timeline`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 凭据访问 | T1040 | Network Sniffing（网络嗅探） |
| 命令与控制 | T1071 | 应用层协议 |
| 命令与控制 | T1572 | 协议隧道 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
