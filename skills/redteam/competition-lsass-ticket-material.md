---
name: competition-lsass-ticket-material
description: LSASS 专项：追踪 LSASS 秘密、票据、缓存与可重放材料
whenToUse: Windows 上要 dump LSASS、提票据/缓存或还原可重放凭据时加载
---

> 主题：LSASS 票据与凭据（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition LSASS Ticket Material

Use this skill when the decisive host artifact lives in LSASS, ticket caches, or adjacent credential material and the hard part is proving what is replayable.

## Quick Start

1. Separate raw credential material from actually usable replay edges.
2. Record logon session, LUID, ticket cache, package, account, and target service before broad conclusions.
3. Keep host artifact, extracted secret, replay attempt, and resulting acceptance in one chain.
4. Distinguish password, hash, ticket, DPAPI secret, SSP residue, and token by where each can actually be used.
5. Reproduce the smallest host-artifact-to-accepted-privilege path that proves the decisive edge.

## Workflow

### 1. Map LSASS And Adjacent Credential State

- Record logon sessions, LUIDs, ticket caches, package names, SSPs, DPAPI context, and any service-account material tied to the active path.
- Note whether the decisive value is a TGT, service ticket, delegated ticket, DPAPI secret, plaintext, hash, or package-specific secret.
- Keep host source, account context, and cache location tied together.

### 2. Prove Replay Or Acceptance

- Show where the extracted material is accepted: SMB, WinRM, service ticket use, DPAPI unwrap, Schannel, or another host or service edge.
- Record SPN, target host, logon session, ticket flags, encryption type, and resulting privilege or token change.
- Distinguish material that is present from material that is actually replayable in this path.

### 3. Reduce To The Decisive Credential Chain

- Compress the result to the smallest sequence: host artifact -> extracted material -> accepted replay or unwrap -> resulting capability.
- State clearly whether the decisive edge lives in LSASS memory, ticket cache reuse, DPAPI context, or accepting service behavior.
- If the task broadens into full host-to-host pivoting, hand back to the tighter Windows pivot skill.

## Read This Reference

- Load `references/lsass-ticket-material.md` for the session checklist, replay checklist, and evidence packaging.
- If the task is specifically about DPAPI masterkeys, protected blobs, browser or vault stores, or proving which recovered DPAPI secret is accepted, prefer `$competition-dpapi-credential-chain`.

## What To Preserve

- LUIDs, session IDs, ticket types, SPNs, encryption types, package names, and cache or memory source
- The exact accepting host or service and the resulting privilege or logon effect
- One minimal host-artifact-to-replay sequence that proves the edge

---

## 检查清单与常见坑（上游参考并入）

### lsass-ticket-material

# LSASS Ticket Material Checklist

## First Pass

- Logon sessions, LUIDs, package names, ticket caches, SSP artifacts, DPAPI context, account names
- Material types: plaintext, NTLM hash, TGT, service ticket, delegated ticket, DPAPI secret, gMSA material
- Acceptance candidates: SMB, WinRM, service ticket use, Schannel, DPAPI unwrap, service logon

## Chain To Reconstruct

1. Host or memory artifact located
2. Credential or ticket material extracted
3. Replay or unwrap path identified
4. Service or host accepts it
5. Resulting logon, token, or privilege confirmed

## Evidence To Keep Together

- Host side: process, dump or cache source, LUID, package, account
- Material side: type, ticket flags, SPN, encryption, DPAPI context, cache location
- Acceptance side: target service, target host, resulting session or privilege change

## Common Pitfalls

- Treating every extracted secret as replayable without proving an accepting service
- Mixing several logon sessions and ticket caches into one vague story
- Describing ticket presence without tying it to a concrete privilege or pivot edge

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-kernel-container-escape`、`competition-linux-credential-pivot`、`competition-mailbox-abuse`、`competition-relay-coercion-chain`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
