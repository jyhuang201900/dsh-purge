---
name: competition-identity-windows
description: Windows 身份专项：追踪票据、令牌、邮箱规则与横向路径
whenToUse: 域内要理清票据/令牌/邮箱规则，规划横向路径时加载
---

> 主题：Windows 身份与横向（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Identity Windows

Use this skill when the challenge revolves around identity flow, replayable credentials, Windows host artifacts, enterprise mail, or lateral movement.

## Quick Start

1. Map the identity or pivot chain before diving into every host artifact.
2. Separate credential possession from accepted privilege.
3. Correlate identity evidence, host evidence, and mail evidence on one timeline.
4. Keep tickets, SIDs, event IDs, mailbox rules, and pivot hosts in compact evidence blocks.
5. Reproduce the privilege edge or mail effect from the smallest viable chain.

## Workflow

### 1. Identity And AD

- Trace principal origin, sync path, token or ticket minting, claims transformation, group resolution, and accepting service.
- When Kerberos matters, record ticket type, SPN, delegation mode, PAC or group data, encryption type, and cache location.

### 2. Windows Host And Pivoting

- Correlate SAM, SECURITY, SYSTEM, NTDS, DPAPI, LSA secrets, ETW, Sysmon, PowerShell, services, tasks, WMI, WinRM, SMB, and RDP as one pivot graph.
- Express movement as a concrete chain: foothold -> recovered artifact -> replay path -> pivot host -> resulting capability.

### 3. Enterprise Messaging

- Keep phishing lures, consent logs, mailbox rules, and identity-provider events tied together so the mail path and privilege path stay connected.

## Read This Reference

- Load `references/identity-windows.md` for the ticket, host, and enterprise-messaging checklist.
- If the task is primarily a host-to-host pivot, Kerberos replay, or Windows privilege chain, prefer `$competition-windows-pivot`.
- If the task is specifically about constrained delegation, unconstrained delegation, RBCD, S4U, or ticket-acceptance proof, prefer `$competition-kerberos-delegation`.
- If the task is specifically about AD CS, certificate templates, EKUs, enrollment rights, PKINIT, or cert-based privilege, prefer `$competition-ad-certificate-abuse`.
- If the task is specifically about OAuth or OIDC claims, callback flow, scopes, consent, or accepted login identity, prefer `$competition-oauth-oidc-chain`.
- If the task is specifically about DPAPI masterkeys, vault blobs, browser or vault secrets, backup-key use, or protected-secret-to-access chains, prefer `$competition-dpapi-credential-chain`.
- If the task is specifically about LSASS memory, ticket caches, LUID-linked material, DPAPI context, or replayable host credential artifacts, prefer `$competition-lsass-ticket-material`.
- If the task is specifically about mailbox rules, forwarding, OAuth consent, delegate access, or transport-level mail abuse, prefer `$competition-mailbox-abuse`.
- If the task is specifically about forced authentication, relay targets, or proving which service accepts relayed auth, prefer `$competition-relay-coercion-chain`.

## What To Preserve

- SIDs, SPNs, ticket fields, event IDs, mailbox rules, and replay points
- Exact host-to-host pivot order and the service that accepts the credential or ticket
- Raw artifacts, parsed summaries, and derived timelines as separate outputs

---

## 检查清单与常见坑（上游参考并入）

### identity-windows

###### Identity, Windows, And Enterprise Messaging Checklist

###### Identity

- Map principal origin, token or ticket minting, claims or group transformation, and final accepting service
- Distinguish credential material from effective privilege
- Inspect ACLs, GPO links, SIDHistory, delegation, certificate templates, service accounts, and replication rights when AD edges matter

###### Windows Host

- Check SAM, SECURITY, SYSTEM, NTDS, DPAPI, LSA secrets, browser stores, PowerShell history, ETW, Sysmon, prefetch, jump lists, Amcache, SRUM, shimcache
- Correlate services, tasks, WMI, WinRM, SMB, RDP, admin shares, and remote registry as one pivot graph

###### Enterprise Messaging

- Correlate phishing lures, attachment chains, consent logs, login traces, message-trace logs, and mailbox-rule changes

###### Evidence To Keep

- One compact block for SIDs, SPNs, ticket fields, event IDs, logon IDs, or mailbox rules
- One compact block for host pivots, replayed artifacts, and resulting privilege changes

###### Common Pitfalls

- Treating possession of a hash or ticket as proof of resulting privilege
- Saying "domain compromise" without a reproducible edge-by-edge chain
- Separating host evidence from identity evidence until the story stops making sense

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-container-runtime`、`competition-dpapi-credential-chain`、`competition-k8s-control-plane`、`competition-kerberos-delegation`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
