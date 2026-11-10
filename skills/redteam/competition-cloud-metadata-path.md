---
name: competition-cloud-metadata-path
description: 云元数据专项：追踪元数据服务、实例凭据与信任边
whenToUse: 有 SSRF 或能从实例内部出网，要打云元数据服务拿实例凭据时加载
---

> 主题：云元数据与实例凭据（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Cloud Metadata Path

Use this skill when the decisive edge is not just reaching metadata, but proving how metadata-derived identity becomes accepted privilege.

## Quick Start

1. Identify which metadata surface is active: instance metadata, workload identity, node identity, task role, or platform-specific token endpoint.
2. Record the exact reachability path: local process, pod, container, proxy, SSRF surface, or host route.
3. Separate metadata reachability from credential issuance and from downstream privilege acceptance.
4. Keep token format, role identity, scope, and accepting API in compact evidence blocks.
5. Reproduce the smallest metadata-to-accepted-privilege path that proves the challenge edge.

## Workflow

### 1. Map Metadata Reachability

- Record the metadata endpoint, required headers, hop limits, session tokens, workload selectors, or path prefixes.
- Note whether access comes from direct local calls, pod networking, SSRF, sidecar, or host-level routing.
- Keep the reaching surface and the metadata endpoint in one chain.

### 2. Prove Credential Or Identity Issuance

- Show how the metadata response becomes a token, temporary credential, signed identity doc, or platform-specific workload identity.
- Record expiration, role name, subject, audience, issuer, or cloud account mapping that matters downstream.
- Distinguish raw metadata from usable credential material.

### 3. Reduce To The Decisive Trust Path

- Compress the result to the smallest sequence: reaching surface -> metadata call -> credential issued -> accepted cloud or cluster action.
- State clearly whether the weakness lives in reachability, metadata config, role trust, downstream policy, or workload binding.
- If the challenge narrows to RBAC or cluster mutation after credential issuance, switch back to the tighter control-plane skill.

## Read This Reference

- Load `references/cloud-metadata-path.md` for the reachability checklist, token checklist, and evidence packaging.
- If the hard part is first proving a server-side fetch primitive, SSRF reachability, or internal endpoint traversal before metadata itself, prefer `$competition-ssrf-metadata-pivot`.

## What To Preserve

- Metadata endpoints, required headers, reachability path, issued tokens or creds, and accepted APIs
- Role names, audiences, issuers, account bindings, and privilege-bearing actions
- The smallest replayable metadata-to-privilege chain

---

## 检查清单与常见坑（上游参考并入）

### cloud-metadata-path

###### Cloud Metadata Path Checklist

###### First Pass

- Metadata endpoint, hop limit, required headers, session token requirements, link-local route, workload identity binding
- Reaching surface: local process, pod, container, proxy, SSRF, sidecar, or host namespace
- Downstream trust: role assumption, cloud API, cluster API, secret access, or signed identity use

###### Chain To Reconstruct

1. Reachable path to metadata established
2. Metadata response or token obtained
3. Usable identity or credential material extracted
4. Downstream API or trust edge accepts it
5. Resulting privilege or artifact confirmed

###### Evidence To Keep Together

- Reachability side: route, headers, namespace, container, SSRF primitive, or proxy path
- Identity side: role name, token claims, expiration, audience, issuer, account or project binding
- Acceptance side: API action, resource access, secret read, or spawned workload effect

###### Common Pitfalls

- Proving metadata access without proving a useful credential was actually issued
- Proving token issuance without showing which downstream API accepts it
- Mixing node identity and workload identity without showing which one actually drove the privilege edge

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-ad-certificate-abuse`、`competition-agent-cloud`、`competition-container-runtime`、`competition-dpapi-credential-chain`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
