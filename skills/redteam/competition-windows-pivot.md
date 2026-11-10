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

# Windows Pivot And Kerberos Checklist

## Pivot Chain

Write the chain explicitly:

- source host
- recovered artifact
- replay protocol or service
- destination host
- resulting capability

## Kerberos Fields To Keep

- Ticket type
- SPN
- Delegation mode
- PAC or group data
- Encryption type
- Cache location
- Accepting service

## Host Evidence To Keep

- Event IDs, logon IDs, process creation, service creation, task creation
- WinRM, SMB, RDP, WMI, admin-share, and remote-registry traces
- Group membership or token changes on the destination host

## Common Pitfalls

- Treating possession of a ticket as proof of accepted privilege
- Saying a pivot worked without showing the destination-side effect
- Mixing several hops into one vague statement instead of a reproducible chain
