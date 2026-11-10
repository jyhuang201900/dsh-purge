---
name: competition-browser-persistence
description: 浏览器持久化专项：检查 Cookie、存储、Service Worker 与缓存状态
whenToUse: 要从浏览器侧找持久化/凭据/缓存痕迹，或判断网页能不能离线驻留时加载
---

> 主题：浏览器持久化痕迹（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Browser Persistence

Use this skill when the decisive branch lives in browser-held state rather than only in visible HTML or backend source.

## Quick Start

1. Identify the active persistence surface first: cookie jar, localStorage, sessionStorage, IndexedDB, Cache Storage, or service worker.
2. Record origin, scope, domain, path, expiry, and key names before mutating state.
3. Tie stored state to one concrete effect: request header, rendered branch, cached response, offline behavior, or hidden route access.
4. Separate boot-time state from runtime-mutated state.
5. Reproduce the smallest stateful sequence that reaches the decisive branch.

## Workflow

### 1. Map Browser State Surfaces

- Inspect cookies, storage buckets, service worker registrations, cache entries, and transient globals exposed during boot.
- Record which origin, host, route, or feature flag each state item actually applies to.
- Keep auth tokens, refresh material, CSRF state, cached responses, and feature toggles in separate evidence blocks.

### 2. Tie State To Runtime Behavior

- Show how stored state becomes request headers, role derivation, route visibility, cached API data, or offline fallback behavior.
- Compare clean-state and mutated-state runs with one variable changed at a time.
- Distinguish UI-only state from backend-accepted state.

### 3. Reduce To The Decisive Persistence Chain

- Compress the result to the smallest chain: initial page or login -> state persisted -> subsequent request or render branch -> resulting capability.
- Keep extracted storage, service worker scripts, and replay steps tied to the same origin and route.
- If the problem broadens into general web routing or worker behavior outside browser persistence, switch back to the broader web-runtime skill.

## Read This Reference

- Load `references/browser-persistence.md` for the browser-state checklist, service-worker checklist, and evidence packaging.

## What To Preserve

- Cookie attributes, storage keys, database names, cache keys, service worker scopes, and origin boundaries
- The exact request or render effect caused by each decisive state item
- Clean-state vs mutated-state reproduction steps for the smallest working path

---

## 检查清单与常见坑（上游参考并入）

### browser-persistence

# Browser Persistence Checklist

## Surfaces To Check

- Cookies: domain, path, expiry, `HttpOnly`, `Secure`, `SameSite`
- `localStorage`, `sessionStorage`, IndexedDB object stores, Cache Storage entries
- Service worker registrations, cached responses, fetch handlers, offline fallbacks
- Boot-time globals, hydration payloads, feature flags, role or tenant selectors

## Correlation Pattern

1. Storage item or cookie identified
2. Origin and scope confirmed
3. Request, render, or cache behavior linked to that item
4. Clean-state vs mutated-state run compared
5. Decisive branch reproduced

## Evidence To Keep Together

- State identity: origin, key, value shape, scope, expiry, DB or cache name
- Runtime effect: header, route, feature flag, cached response, or rendered branch
- Replay prerequisites: initial route, prior request, login state, or service worker registration

## Common Pitfalls

- Listing storage contents without showing which item changes behavior
- Mixing several origins or tenants in one storage explanation
- Treating cached UI data as backend authorization without proving a server-side effect

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-bundle-sourcemap-recovery`、`competition-custom-protocol-replay`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
