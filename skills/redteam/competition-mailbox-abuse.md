---
name: competition-mailbox-abuse
description: 邮箱滥用专项：追踪邮箱规则、OAuth 同意与邮件流滥用
whenToUse: 打邮箱/Exchange/O365，要用规则、OAuth 同意或邮件流做持久化与窃取时加载
---

> 主题：邮箱规则滥用（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Mailbox Abuse

Use this skill when the decisive path runs through mailbox behavior, consent flow, or message-routing effects rather than generic AD evidence alone.

## Quick Start

1. Decide whether the active path is phishing-to-consent, token-to-mailbox, rule-based persistence, or transport-level mail rerouting.
2. Keep mailbox evidence, identity evidence, and message-trace evidence tied to the same user, mailbox, token, or message ID.
3. Separate possession of a token or delegate edge from the actual mailbox effect it enables.
4. Record forwarding targets, rule predicates, consent scopes, shared mailbox edges, and resulting mail flow in compact blocks.
5. Reproduce the smallest mail effect that proves persistence, exfiltration, or privilege.

## Workflow

### 1. Map The Mail Trust Path

- Identify the principal, mailbox, token or session, consent grant, delegate edge, shared mailbox relationship, or app registration involved.
- Record consent scopes, mailbox permissions, rule ownership, transport actions, and message-trace identifiers.
- Distinguish client-visible symptoms from server-side mailbox or transport state.

### 2. Prove The Mailbox Effect

- Correlate consent logs, sign-ins, message traces, inbox rules, transport rules, forwarding settings, and mailbox audit events.
- Show which rule or token produces which concrete effect: silent forwarding, marking read, deletion, delegate access, or message rerouting.
- Keep message IDs, sender or recipient pairs, and timestamps aligned across logs.

### 3. Reduce To The Decisive Abuse Chain

- Compress the path to the smallest sequence: lure or grant -> token or delegate edge -> mailbox or transport mutation -> resulting mail effect.
- State clearly whether persistence lives in consent, mailbox rules, transport config, or shared mailbox permissions.
- If the task broadens into host pivots or Kerberos acceptance, switch back to the broader identity skill.

## Read This Reference

- Load `references/mailbox-abuse.md` for the consent checklist, rule checklist, and evidence packaging.

## What To Preserve

- Consent scopes, token claims, mailbox permissions, rule definitions, forwarding targets, and message IDs
- Message-trace lines, audit events, and mailbox effects tied to the same mail path
- The smallest replayable sequence that proves persistence, exfiltration, or delegate access

---

## 检查清单与常见坑（上游参考并入）

### mailbox-abuse

# Mailbox Abuse Checklist

## Core Surfaces

- Consent grants, app registrations, delegated or application scopes, sign-in events
- Inbox rules, forwarding settings, delegate access, shared mailbox permissions, transport rules
- Message traces, mailbox audit events, sender or recipient pairs, message IDs, folder actions

## Abuse Chain To Reconstruct

1. Lure, consent, or credential acquisition
2. Token or delegate edge obtained
3. Mailbox or transport mutation applied
4. Message flow altered, hidden, or exfiltrated

## Evidence To Keep Together

- Identity side: user, app, scope, token claim, delegate edge
- Mail side: rule predicate, forward target, folder action, message ID, transport action
- Result side: delivered, forwarded, deleted, rerouted, or silently hidden effect

## Common Pitfalls

- Reporting a token without showing the mailbox effect it actually enables
- Mixing inbox rules and transport rules without proving which one caused the observed message flow
- Ignoring shared mailbox or delegate permissions when the mailbox owner itself never logged in
