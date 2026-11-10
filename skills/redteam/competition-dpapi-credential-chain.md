---
name: competition-dpapi-credential-chain
description: DPAPI 专项：追踪主密钥、数据块、存储位置，还原可重放的明文凭据
whenToUse: Windows 上拿到 DPAPI 加密的数据块（凭据/浏览器密码），要还原明文时加载
---

> 主题：DPAPI 凭据链（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Dpapi Credential Chain

Use this skill when the decisive Windows secret is DPAPI-protected and the hard part is proving which context unwraps it and where the plaintext is accepted.

## Quick Start

1. Separate protected blob, masterkey, decrypting context, and final accepting service.
2. Record SID, user or machine context, masterkey path, vault or browser store, and target replay point before broad conclusions.
3. Keep DPAPI source artifact, unwrap step, plaintext secret, and acceptance edge in one chain.
4. Distinguish local user DPAPI, machine DPAPI, domain backup key use, and application-specific wrapping.
5. Reproduce the smallest DPAPI-to-accepted-access path that proves the decisive edge.

## Workflow

### 1. Map Protected Secret And DPAPI Context

- Record blob source, masterkey location, SID, protector scope, profile path, credential store, and any application wrapper such as browser encryption or vault metadata.
- Note whether the decisive value lives in Credential Manager, Vault, browser cookies, browser passwords, Wi-Fi profiles, RDP files, or custom app storage.
- Keep protected artifact, masterkey candidate, and account or machine context tied together.

### 2. Prove Unwrap And Acceptance

- Show how the secret is decrypted: user logon material, machine context, domain backup key, or another recovered protector.
- Record plaintext type, target host or service, replay method, and resulting session, token, or data access.
- Distinguish successful blob decryption from actual accepted access.

### 3. Reduce To The Decisive DPAPI Chain

- Compress the result to the smallest sequence: protected artifact -> masterkey or unwrap context -> plaintext secret -> accepted replay or access -> resulting capability.
- State clearly whether the decisive edge lives in masterkey recovery, DPAPI scope confusion, application wrapper handling, or the service that accepts the recovered secret.
- If the task broadens into generic LSASS ticket material or full Windows pivoting, hand back to the tighter host or pivot skill.

## Read This Reference

- Load `references/dpapi-credential-chain.md` for the blob checklist, masterkey checklist, and evidence packaging.

## What To Preserve

- Blob paths, masterkey paths, SIDs, protector scope, store names, and application wrapper details
- The exact accepting service or dataset unlocked by the recovered plaintext
- One minimal protected-artifact-to-accepted-access sequence that proves the edge

---

## 检查清单与常见坑（上游参考并入）

### dpapi-credential-chain

# DPAPI Credential Chain Checklist

## First Pass

- Blob source, masterkey path, SID, protector scope, profile path, store name, wrapper metadata
- Secret locations: Credential Manager, Vault, browser Login Data, cookies, Wi-Fi profiles, app storage
- Acceptance targets: browser session replay, SMB, RDP, WinRM, app login, data decryption

## Chain To Reconstruct

1. Protected artifact is identified
2. Matching masterkey or unwrap context is found
3. Plaintext secret is recovered
4. Accepting service or dataset is confirmed
5. Resulting capability or access is reproduced

## Evidence To Keep Together

- Source side: blob path, store, SID, profile, machine or user scope
- Unwrap side: masterkey source, backup key use, wrapper details, plaintext type
- Acceptance side: target service, target host, unlocked data, resulting session or privilege

## Common Pitfalls

- Treating DPAPI decryption as the end instead of proving an accepting service or dataset
- Mixing user and machine scope without recording which protector actually matches
- Ignoring application-specific wrapping around browser or vault secrets

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-cloud-metadata-path`、`competition-container-runtime`、`competition-identity-windows`、`competition-k8s-control-plane`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

