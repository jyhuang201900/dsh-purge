---
name: competition-crypto-mobile
description: 移动端加密专项：解码数据块、查隐写、Hook 移动端签名器
whenToUse: 移动端 App 里有加密数据块、隐写载体或自研签名要还原时加载
---

> 主题：移动端加密与隐写（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Crypto Mobile

Use this skill when the active challenge depends on recovering a transform chain, hidden media payload, mobile signing path, or local trust boundary.

## Quick Start

1. Decide whether the dominant path is crypto, stego, or mobile.
2. Recover transforms in order; do not jump straight to the fanciest algorithm.
3. Record exact parameters and boundaries that affect the result.
4. Hook the narrowest mobile boundary that proves the behavior.
5. Reproduce the plaintext, payload, signed request, or accepted branch.

## Workflow

### 1. Crypto And Encoding

- Reconstruct the chain step by step: container, compression, encoding, xor or substitution, crypto, integrity, final parse.
- Keep exact keys, IVs, nonces, salts, tags, offsets, and byte order.

### 2. Stego

- Inspect metadata, chunk layout, palettes, alpha planes, LSBs, thumbnails, trailers, and transcoding artifacts.
- Rank decode attempts by evidence, not by brute-force curiosity.

### 3. Mobile

- Start with manifest or plist, exported components, deeplinks, native libs, shared prefs, local DBs, and configs.
- Trace signer logic, token storage, SSL pinning, protobuf or RPC boundaries, and native bridge calls.

## Read This Reference

- Load `references/crypto-mobile.md` for the transform checklist, hook targets, and evidence packaging.
- If the task is specifically about Android dynamic tracing, signer hooks, JNI boundaries, or pinning checks, prefer `$competition-android-hooking`.
- If the task is specifically about iOS runtime tracing, Keychain access, Objective-C or Swift hooks, or pinning checks inside an IPA, prefer `$competition-ios-runtime`.
- If the task is specifically about media carriers, hidden channels, thumbnails, or appended trailers, prefer `$competition-stego-media`.

## What To Preserve

- Decisive bytes proving each decode stage
- Hook points, signed strings, headers, and local storage paths
- Component names, protobuf fields, channel-specific outputs, or trailer offsets

---

## 检查清单与常见坑（上游参考并入）

### crypto-mobile

# Crypto, Stego, And Mobile Checklist

## Crypto

- Work in order: container -> compression -> encoding -> xor/substitution -> crypto -> integrity -> parse
- Recognition is not recovery; reproduce the actual plaintext or downstream artifact
- Keep exact parameters in one compact evidence block

## Stego

- Check metadata, chunk layout, palettes, alpha, LSBs, thumbnails, appended trailers
- Prefer evidence-driven decode attempts over blind brute force

## Mobile

- Check manifest/plist, exported components, deeplinks, native libs, shared prefs, local DBs, configs
- Hook the narrowest boundary: signer, crypto helper, protobuf edge, keystore access, WebView bridge
- Correlate static evidence and dynamic evidence before concluding

## Common Pitfalls

- Reporting only algorithm names with no reproduced artifact
- Scattering transform stages across many bullets
- Hooking too late and missing the trust boundary that matters

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用
- **互补**（同类场景一起用）：`competition-android-hooking`、`competition-firmware-layout`、`competition-ios-runtime`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

