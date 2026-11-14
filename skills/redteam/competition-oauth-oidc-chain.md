---
name: competition-oauth-oidc-chain
description: OAuth 与 OIDC 专项：追踪重定向、令牌、scope 与被接受的登录流程
whenToUse: 靶子用 OAuth/OIDC 登录，要试重定向劫持、scope 越权或令牌复用链时加载
---

> 主题：OAuth / OIDC 链（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition OAuth OIDC Chain

Use this skill when the hard part is proving how an OAuth or OIDC flow is shaped, exchanged, and ultimately accepted.

## Quick Start

1. Map the auth chain in order: entry route, redirect, authorize request, callback, token exchange, refresh, and final accepting service.
2. Record scopes, state, nonce, PKCE material, redirect URIs, and claim-bearing tokens before mutating anything.
3. Separate token possession from actual identity acceptance.
4. Keep browser-visible redirects and backend-visible token exchange in one compact chain.
5. Reproduce the smallest redirect-to-acceptance flow that proves the decisive identity edge.

## Workflow

### 1. Map The Redirect And Token Path

- Record issuer, client ID, redirect URI, authorize parameters, callback parameters, token endpoint, and refresh path.
- Note which values are user-controlled, derived, cached, or validated: `state`, `nonce`, PKCE verifier, audience, scope, or prompt.
- Keep browser redirects, server-side exchanges, and resulting session state tied together.

### 2. Prove Token-To-Identity Acceptance

- Show how code, ID token, access token, or refresh token turns into app session, claims mapping, tenant selection, or accepted privilege.
- Record token claims, expiration, audience, subject, scopes, and the exact accepting app or backend edge.
- Distinguish UI login success from backend authorization success.

### 3. Reduce To The Decisive OAuth Chain

- Compress the result to the smallest sequence: entry request -> redirect -> callback -> token or claim acceptance -> resulting capability.
- Keep one canonical good flow and one minimal mutated flow if a parameter change matters.
- If the task broadens into generic web routing or storage behavior outside the auth chain, switch back to the broader web-runtime skill.

## Read This Reference

- Load `references/oauth-oidc-chain.md` for the redirect checklist, token checklist, and evidence packaging.
- If the hard part is JWT header parsing, claim normalization, key lookup, or token validation confusion after issuance, prefer `$competition-jwt-claim-confusion`.

## What To Preserve

- Redirect URIs, parameters, codes, token claims, scopes, and the accepting service or callback
- The exact point where claims or tokens become accepted app identity
- One minimal replayable redirect-to-acceptance sequence

---

## 检查清单与常见坑（上游参考并入）

### oauth-oidc-chain

###### OAuth OIDC Chain Checklist

###### First Pass

- Entry route, issuer, client ID, redirect URI, callback route, token endpoint, refresh path
- Authorize parameters: `response_type`, `scope`, `state`, `nonce`, PKCE challenge, audience, prompt
- Browser redirects, backend token exchanges, stored session state, final app acceptance

###### Chain To Reconstruct

1. Entry request or login trigger
2. Authorize redirect built
3. Callback parameters received
4. Code or token exchange performed
5. Claims or token accepted by app or backend

###### Evidence To Keep Together

- Redirect side: route, parameters, callback values, issuer
- Token side: type, claims, scopes, audience, expiration, subject
- Acceptance side: session created, claims mapped, tenant selected, route unlocked, or privilege granted

###### Common Pitfalls

- Stopping at the callback without proving token exchange or claim acceptance
- Treating possession of a token as authorization without showing where it is accepted
- Mixing browser-only redirect evidence and backend-only auth evidence without linking them

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-jwt-claim-confusion`、`competition-malware-config`、`competition-pcap-protocol`、`competition-prompt-injection`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
