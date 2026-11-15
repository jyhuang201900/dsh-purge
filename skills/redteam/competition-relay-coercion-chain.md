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

###### Relay Coercion Checklist

###### Chain Segments

- Coercion source and trigger
- Captured or forwarded authentication
- Relay target and protocol
- Acceptance point and resulting effect

###### Reconstruction Order

1. What triggers the source to authenticate
2. Which identity leaves the source
3. Where that authentication is relayed
4. Which service actually accepts it
5. What privilege, enrollment, or artifact results

###### Evidence To Keep Together

- Source side: host, service, trigger, protocol, coerced principal
- Relay side: listener, transcript, target host, protocol, response
- Effect side: accepted service, resulting account effect, privilege, or issued artifact

###### Common Pitfalls

- Stopping at “forced auth happened” without proving relay acceptance
- Proving relay acceptance without showing what capability it produced
- Mixing several candidate relay targets without isolating the one that actually accepted the relayed auth



## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 强制认证 | 4624 / 5145 | 目标主动向攻击者发起认证（打印机/EFSR 等 RPC 调用） |
| 强制认证触发 | 目标侧 RPC 日志 | 打印机/EFSR/DFSCoerce 类 RPC 被调用（目标主动向外部发起认证） |
| 中继接收 | 认证服务器日志 | 同一凭据极短时间内从两台机器认证 |
| 强制认证 | 目标 RPC 日志 | 打印机/EFSR/DFSCoerce 被调用，目标主动外连认证 |
| 中继接收 | 认证服务器日志 | 同一凭据短时从两台机器认证 |
| 认证方向反转 | 目标 RPC + 认证日志 | 服务器主动向攻击者发起认证（非客户端连服务器） |
| 认证方向反转 | 目标 RPC 日志 | 服务器主动向攻击者发起认证（正常是客户端连服务器） |
| 中继链路的网络侧 | NetFlow 连接记录 | 目标主机向攻击者主机的 SMB/HTTP 连接（强制认证的回连方向） |

**实用推论**：**判据是认证方向反了**：正常是客户端连服务器，强制认证是服务器去连别人。

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 凭据访问 | T1187 | 强制认证 |
| 凭据访问 | T1557 | 中间人攻击 |
| 横向移动 | T1550.002 | Pass the Hash |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-lsass-ticket-material`、`competition-mailbox-abuse`、`competition-ssrf-metadata-pivot`、`competition-windows-pivot`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
