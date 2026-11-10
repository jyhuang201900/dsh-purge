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

# OAuth OIDC Chain Checklist

## First Pass

- Entry route, issuer, client ID, redirect URI, callback route, token endpoint, refresh path
- Authorize parameters: `response_type`, `scope`, `state`, `nonce`, PKCE challenge, audience, prompt
- Browser redirects, backend token exchanges, stored session state, final app acceptance

## Chain To Reconstruct

1. Entry request or login trigger
2. Authorize redirect built
3. Callback parameters received
4. Code or token exchange performed
5. Claims or token accepted by app or backend

## Evidence To Keep Together

- Redirect side: route, parameters, callback values, issuer
- Token side: type, claims, scopes, audience, expiration, subject
- Acceptance side: session created, claims mapped, tenant selected, route unlocked, or privilege granted

## Common Pitfalls

- Stopping at the callback without proving token exchange or claim acceptance
- Treating possession of a token as authorization without showing where it is accepted
- Mixing browser-only redirect evidence and backend-only auth evidence without linking them
