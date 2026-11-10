---
name: competition-android-hooking
description: 安卓动态注入专项：Hook APK 签名校验、JNI 桥、证书固定与请求
whenToUse: 安卓 App 要绕签名校验、JNI 层或证书固定（pinning）时加载
---

> 主题：安卓 Hook 与签名校验（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Android Hooking

Use this skill when the decisive path runs through an Android app's live trust boundary rather than static strings alone.

## Quick Start

1. Preserve the original APK, extracted resources, and decompiled output before patching or resigning.
2. Start with manifest, exported components, deeplinks, native libs, prefs, local DBs, and bundled configs.
3. Decide the narrowest runtime boundary to hook: signer, crypto helper, JNI bridge, WebView bridge, or request builder.
4. Correlate static evidence and dynamic traces before claiming a trust edge is understood.
5. Reproduce the signed request, accepted token, or gated branch from the smallest hook set.

## Workflow

### 1. Static Triage Before Hooks

- Map package structure, exported activities, services, receivers, providers, and deeplink handlers.
- Note SSL pinning logic, root checks, feature flags, token storage, shared prefs, SQLite tables, and protobuf or RPC boundaries.
- Identify whether the sensitive logic sits in Java, Kotlin, JNI, or a bundled WebView.

### 2. Hook The Narrowest Boundary

- Prefer hooking request signers, crypto helpers, keystore access, protobuf encode or decode, or JNI marshaling instead of broad UI hooks.
- Record plaintext inputs, signed strings, headers, nonces, and outputs at the boundary that actually changes trust.
- If pinning or environment checks block progress, patch or hook only enough to expose the real request path.

### 3. Replay The Accepted Path

- Rebuild the smallest sequence that reaches the accepted server-side branch: local state, nonce, request body, signature, and headers.
- Keep hook logs, captured request shapes, and local storage paths tied to the same account or session state.
- If the challenge becomes more about transform recovery than Android runtime, switch back to the broader crypto or mobile skill.

## Read This Reference

- Load `references/android-hooking.md` for hook targets, storage checklist, and evidence packaging.

## What To Preserve

- Hook points, class names, JNI symbols, signer inputs and outputs, and header names
- Shared prefs, local DB rows, deeplinks, exported components, and token storage paths
- The smallest replayable request or branch that proves the trust boundary

---

## 检查清单与常见坑（上游参考并入）

### android-hooking

# Android Hooking Checklist

## Static Targets To Map First

- `AndroidManifest.xml`, exported components, deeplinks, intent filters, bundled configs
- Native libraries, JNI registration points, crypto helpers, request builders, protobuf models
- Shared prefs, SQLite DBs, WebView assets, root checks, SSL pinning logic

## Preferred Hook Boundaries

1. Request signer input string and output signature
2. Crypto helper plaintext and ciphertext
3. JNI boundary arguments and return values
4. Keystore access or device-binding checks
5. WebView bridge messages or JS interface calls

## Evidence To Keep Together

- Static location: class, method, symbol, or asset path
- Dynamic proof: hook log, returned value, request header, or accepted response
- State dependency: local token, DB row, pref key, nonce, or device flag

## Common Pitfalls

- Hooking too high in the UI layer and missing the real signer boundary
- Capturing a signed header without the plaintext that produced it
- Ignoring local state prerequisites such as prefs, DB rows, or keystore material

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用
- **互补**（同类场景一起用）：`competition-crypto-mobile`、`competition-firmware-layout`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
