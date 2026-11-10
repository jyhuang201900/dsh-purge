---
name: competition-ad-certificate-abuse
description: AD CS 证书滥用专项：枚举证书模板、EKU、注册路径，走 ESC 系列把「能注册」变成「域权限」
whenToUse: 目标是域环境且有 AD CS 证书服务，要判断能否靠证书模板/注册权拿域权限时加载
---

> 主题：AD 证书服务滥用（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition AD Certificate Abuse

Use this skill when the decisive identity edge is certificate-based and the hard part is proving how a template or CA policy turns into accepted privilege.

## Quick Start

1. Identify the CA, template, enrolling principal, and accepting service before diving into every certificate detail.
2. Separate template enrollability from cert-based authentication or privilege acceptance.
3. Record EKUs, subject or SAN controls, issuance requirements, enrollment rights, and mapping behavior in compact blocks.
4. Tie the issued cert to one accepted path: PKINIT, Schannel, LDAPS, WinRM, or another mapped service.
5. Reproduce the smallest certificate issuance-to-acceptance chain that yields the decisive privilege.

## Workflow

### 1. Map CA And Template Trust

- Record CA configuration, template name, enrollment permissions, manager approval, authorized signatures, EKUs, subject requirements, and SAN behavior.
- Note whether the path depends on alternate subject names, `UPN`, DNS names, enrollment agent behavior, or template supersedence.
- Keep principal, template, and issuance policy tied together.

### 2. Prove Cert-To-Privilege Acceptance

- Show how the issued certificate is mapped or accepted: PKINIT, smartcard logon, Schannel auth, service mapping, or explicit certificate mapping.
- Record serial, subject, SAN, EKU, validity, and the exact service or domain edge that accepts it.
- Distinguish certificate issuance from the separate step where privilege is actually granted.

### 3. Reduce To The Decisive Abuse Chain

- Compress the path to the smallest sequence: enrollment right or misconfig -> issued cert -> accepted mapping -> resulting privilege.
- State clearly whether the weakness lives in template config, CA policy, mapping logic, relay path, or enrollment rights.
- If the task is really about delegation or ticket transformation after PKINIT, switch back to the tighter Kerberos skill.

## Read This Reference

- Load `references/ad-certificate-abuse.md` for the AD CS checklist, template checklist, and evidence packaging.

## What To Preserve

- CA names, template names, rights, EKUs, issuance flags, SAN controls, and mapping details
- Issued certificate fields, serials, subjects, SANs, and the accepting service or logon path
- The smallest reproducible enrollment-to-privilege chain

---

## 检查清单与常见坑（上游参考并入）

### ad-certificate-abuse

# AD Certificate Abuse Checklist

## Core Surfaces

- Enterprise CA configuration, issuance policy, enrollment permissions, manager approval, authorized signatures
- Template flags, EKUs, subject or SAN controls, enrollment agent settings, superseded templates
- PKINIT, smartcard logon, Schannel, certificate mapping, relay paths, accepting services

## Abuse Chain To Reconstruct

1. Principal with enrollment or relay path identified
2. Template or CA weakness established
3. Certificate issued with exploitable identity material
4. Service or logon path accepts the cert
5. Resulting privilege or account effect confirmed

## Evidence To Keep Together

- Template side: name, rights, EKUs, flags, SAN controls, issuance requirements
- Cert side: subject, SAN, serial, validity, issuer, thumbprint
- Acceptance side: PKINIT or service mapping, target account, resulting privilege

## Common Pitfalls

- Stopping at template misconfiguration without proving cert issuance
- Proving issuance without proving where the cert is actually accepted
- Mixing certificate abuse with Kerberos delegation when the decisive edge is the template or mapping itself

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-agent-cloud`、`competition-cloud-metadata-path`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
