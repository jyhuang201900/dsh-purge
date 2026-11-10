---
name: competition-ios-runtime
description: iOS 专项：Hook IPA 签名、钥匙串访问、证书固定与请求
whenToUse: iOS App 要绕签名/钥匙串/pinning，或抓其加密请求时加载
---

> 主题：iOS 运行时（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition iOS Runtime

Use this skill when the decisive path runs through live iOS trust boundaries rather than static strings or plist values alone.

## Quick Start

1. Preserve the original IPA, extracted bundle, and any decrypted or re-signed copy as separate artifacts.
2. Start with `Info.plist`, entitlements, URL schemes, frameworks, Keychain usage, and local app storage before broad runtime hooks.
3. Choose the narrowest runtime boundary that proves behavior: signer, trust evaluator, Keychain accessor, Objective-C or Swift method, or network request builder.
4. Correlate static bundle evidence and live hook output before claiming the trust path is understood.
5. Reproduce the accepted request, token, or gated branch from the smallest hook set.

## Workflow

### 1. Static iOS Triage

- Map bundle structure, `Info.plist`, entitlements, URL schemes, universal links, embedded frameworks, and app group paths.
- Record likely trust boundaries: request signers, device binding, certificate checks, jailbreak checks, Keychain access, or local cache loading.
- Note whether sensitive logic sits in Objective-C, Swift, embedded frameworks, or a bundled web surface.

### 2. Hook The Runtime Boundary

- Prefer hooking request builders, crypto helpers, trust evaluators, Keychain reads, or Objective-C selectors instead of broad UI handlers.
- Record plaintext inputs, headers, nonces, signed strings, and outputs at the boundary that changes server acceptance.
- Patch or bypass pinning or environment checks only enough to expose the real request path.

### 3. Replay The Accepted Path

- Rebuild the smallest stateful sequence: local token, device identifier, request body, signature, headers, and trust checks.
- Keep hook logs, bundle paths, plist keys, and local storage artifacts tied to the same session or account state.
- If the task becomes mostly about transform recovery instead of iOS runtime, switch back to the broader crypto or mobile skill.

## Read This Reference

- Load `references/ios-runtime.md` for hook targets, storage checklist, and evidence packaging.

## What To Preserve

- Bundle paths, entitlements, plist keys, selectors, class names, hook points, and header names
- Keychain items, local DB or plist paths, URL schemes, and app-group storage locations
- The smallest replayable request or branch that proves the iOS trust boundary

---

## 检查清单与常见坑（上游参考并入）

### ios-runtime

# iOS Runtime Checklist

## Static Targets To Map First

- `Info.plist`, entitlements, URL schemes, universal links, embedded frameworks, provisioning clues
- Keychain access groups, app groups, local plist files, SQLite DBs, cache directories
- Certificate checks, jailbreak checks, request builders, crypto helpers, device-binding logic

## Preferred Hook Boundaries

1. Request builder input and final signed headers
2. Crypto helper plaintext and ciphertext
3. Trust evaluator or pinning decision point
4. Keychain read or write boundary
5. Objective-C selector or Swift method that gates the accepted branch

## Evidence To Keep Together

- Static location: class, selector, framework, plist key, entitlement, or bundle path
- Dynamic proof: hook log, returned value, header, request body, or accepted response
- State dependency: Keychain item, plist value, DB row, nonce, device flag, or local token

## Common Pitfalls

- Hooking only UI handlers and missing the real signer or trust evaluator
- Capturing a signed request without the plaintext or local state that generated it
- Mixing original IPA, decrypted bundle, and patched runtime output without labeling them separately

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用
- **互补**（同类场景一起用）：`competition-crypto-mobile`、`competition-firmware-layout`、`competition-reverse-pwn`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

