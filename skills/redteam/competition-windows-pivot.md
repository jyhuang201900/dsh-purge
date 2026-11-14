---
name: competition-windows-pivot
description: Windows 跳板专项：追踪 Kerberos 重放、Windows 横向与票据被接受
whenToUse: 要用票据在 Windows 主机间横向并证明被接受时加载
---

> 主题：Windows 票据跳板（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Windows Pivot

Use this skill when the challenge path is dominated by host-to-host movement, replayable ticket material, or Windows privilege edges.

## Quick Start

1. Compress the pivot into a concrete chain: foothold -> recovered artifact -> replay path -> pivot host -> resulting capability.
2. Separate stored credential material from usable privilege.
3. Keep host evidence, ticket evidence, and privilege effect on one timeline.
4. Record the exact accepting service or host for every replayed artifact.
5. Reproduce the smallest pivot that still proves the privilege edge.

## Workflow

### 1. Recover The Replay Material

- Inspect SAM, SECURITY, SYSTEM, NTDS, DPAPI, LSA secrets, browser stores, PowerShell history, ETW, Sysmon, and event logs in the active path.
- Distinguish password, hash, ticket, cookie, vault blob, or gMSA material by where it can actually be used.

### 2. Trace The Pivot Chain

- Map the protocol actually used: WinRM, SMB, RDP, WMI, admin shares, remote registry, or service control.
- When Kerberos matters, record SPN, delegation, PAC or group data, encryption type, and the accepting service.
- When AD edges matter, inspect ACLs, GPO links, SIDHistory, delegation, certificate templates, and replication rights.

### 3. Report The Edge

- Keep the pivot path concrete and replayable.
- State what artifact crossed which boundary and what capability appeared on the destination host.

## Read This Reference

- Load `references/windows-pivot.md` for the pivot checklist, Kerberos evidence block, and common replay mistakes.
- If the task is specifically about DPAPI masterkeys, browser or vault stores, protected blobs, or proving where a recovered DPAPI secret is accepted, prefer `$competition-dpapi-credential-chain`.
- If the task is specifically about LSASS memory, ticket caches, replayable session material, or host-resident credential extraction, prefer `$competition-lsass-ticket-material`.
- If the task is specifically about delegation edges, SPN trust, S4U flow, or which service accepts the delegated ticket, prefer `$competition-kerberos-delegation`.
- If the hard part is forced authentication, coercion primitives, relay targets, or the service that accepts relayed auth, prefer `$competition-relay-coercion-chain`.

## What To Preserve

- Host names, logon IDs, SIDs, SPNs, ticket fields, service names, and event IDs
- Exact replay point and resulting logon session, token, or group change
- Raw host artifacts and derived timeline separately

---

## 检查清单与常见坑（上游参考并入）

### windows-pivot

###### Windows Pivot And Kerberos Checklist

###### Pivot Chain

Write the chain explicitly:

- source host
- recovered artifact
- replay protocol or service
- destination host
- resulting capability

###### Kerberos Fields To Keep

- Ticket type
- SPN
- Delegation mode
- PAC or group data
- Encryption type
- Cache location
- Accepting service

###### Host Evidence To Keep

- Event IDs, logon IDs, process creation, service creation, task creation
- WinRM, SMB, RDP, WMI, admin-share, and remote-registry traces
- Group membership or token changes on the destination host

###### Common Pitfalls

- Treating possession of a ticket as proof of accepted privilege
- Saying a pivot worked without showing the destination-side effect
- Mixing several hops into one vague statement instead of a reproducible chain

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-relay-coercion-chain`、`competition-ssrf-metadata-pivot`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 横向移动 | T1021.002 | SMB/Windows 管理共享 |
| 横向移动 | T1570 | 横向工具传输 |
| 命令与控制 | T1090 | 代理 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
