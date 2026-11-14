---
name: competition-jwt-claim-confusion
description: JWT 专项：追踪头部、声明、密钥选择与接受逻辑的不一致
whenToUse: 靶子用 JWT 鉴权，要试 alg 混淆、密钥选择歧义或声明越权时加载
---

> 主题：JWT 声明混淆（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition JWT Claim Confusion

Use this skill when the decisive bug is not just "there is a JWT," but how headers, claims, and key selection turn into accepted identity.

## Quick Start

1. Split the token path into parse, key lookup, signature or decryption, claim validation, and final acceptance.
2. Record header fields, claims, key source, issuer, audience, and role mapping before mutating anything.
3. Separate possession of a token from the exact service that accepts it.
4. Keep parser behavior, trust policy, and resulting app session or privilege in one chain.
5. Reproduce the smallest token-to-acceptance flow that proves the decisive confusion.

## Workflow

### 1. Map Header And Key Selection

- Record header fields such as `alg`, `kid`, `typ`, `cty`, `jku`, or embedded key material when present.
- Note where keys come from: static config, JWKS, local file, cache, or dynamic lookup.
- Keep token parser, key selection path, and validation mode tied together.

### 2. Prove Claim-To-Privilege Acceptance

- Show how subject, audience, issuer, tenant, scope, role, or custom claims become app session, route access, or backend privilege.
- Record expiration, not-before, clock skew, issuer matching, audience matching, and claim normalization behavior.
- Distinguish token parse success from actual authorization success.

### 3. Reduce To The Decisive JWT Path

- Compress the result to the smallest sequence: token supplied -> parser or key path taken -> claim accepted -> resulting capability.
- Keep one canonical accepted token path and one mutated token path if confusion or bypass depends on a delta.
- If the task broadens into a larger OAuth redirect chain, hand back to the tighter OAuth skill.

## Read This Reference

- Load `references/jwt-claim-confusion.md` for the header checklist, claim checklist, and evidence packaging.

## What To Preserve

- Raw headers, claims, key source, JWKS or local key path, and the accepting service
- The exact validation or normalization step that turns the token into accepted identity
- One minimal replayable token-to-acceptance sequence

---

## 检查清单与常见坑（上游参考并入）

### jwt-claim-confusion

###### JWT Claim Confusion Checklist

###### First Pass

- Token form: JWS, JWE, nested token, detached signature, or bearer wrapper
- Header fields: `alg`, `kid`, `typ`, `cty`, `jku`, x5u-like references, embedded keys
- Claim fields: `iss`, `aud`, `sub`, `exp`, `nbf`, `iat`, tenant, role, scope, custom privilege claims

###### Validation Chain To Reconstruct

1. Token parser invoked
2. Key source selected
3. Signature or decryption step performed
4. Claim validation and normalization applied
5. App session or privilege accepted

###### Evidence To Keep Together

- Header side: fields, key source, lookup behavior, cache or remote key material
- Claim side: issuer, audience, subject, roles, scopes, time claims, normalization rules
- Acceptance side: session cookie, route unlock, backend action, or privilege-bearing claim usage

###### Common Pitfalls

- Stopping at successful decode without proving authorization acceptance
- Focusing on one claim without showing the whole validation chain
- Ignoring key lookup or normalization behavior that matters more than the raw claim value

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-forensic-timeline`、`competition-graphql-rpc-drift`、`competition-malware-config`、`competition-oauth-oidc-chain`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
