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

###### Mailbox Abuse Checklist

###### Core Surfaces

- Consent grants, app registrations, delegated or application scopes, sign-in events
- Inbox rules, forwarding settings, delegate access, shared mailbox permissions, transport rules
- Message traces, mailbox audit events, sender or recipient pairs, message IDs, folder actions

###### Abuse Chain To Reconstruct

1. Lure, consent, or credential acquisition
2. Token or delegate edge obtained
3. Mailbox or transport mutation applied
4. Message flow altered, hidden, or exfiltrated

###### Evidence To Keep Together

- Identity side: user, app, scope, token claim, delegate edge
- Mail side: rule predicate, forward target, folder action, message ID, transport action
- Result side: delivered, forwarded, deleted, rerouted, or silently hidden effect

###### Common Pitfalls

- Reporting a token without showing the mailbox effect it actually enables
- Mixing inbox rules and transport rules without proving which one caused the observed message flow
- Ignoring shared mailbox or delegate permissions when the mailbox owner itself never logged in

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-linux-credential-pivot`、`competition-lsass-ticket-material`、`competition-relay-coercion-chain`、`competition-ssrf-metadata-pivot`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
