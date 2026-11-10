---
name: competition-bundle-sourcemap-recovery
description: 前端产物还原专项：恢复 sourcemap、chunk 加载器与隐藏的运行时结构
whenToUse: 拿到打包后的前端（webpack/vite）要找源码结构、隐藏接口或加密逻辑时加载
---

> 主题：前端打包与 sourcemap 还原（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Bundle Sourcemap Recovery

Use this skill when runtime truth lives in built assets, source maps, chunk tables, or obfuscated loader flow rather than in checked-in source alone.

## Quick Start

1. Start from the served artifact set: entry HTML, build manifest, bootstrap bundle, chunk map, and source maps.
2. Record chunk ids, route chunks, loader functions, endpoint strings, and config keys before broad manual deobfuscation.
3. Reconstruct the smallest runtime graph that explains which asset executes now.
4. Keep served artifact truth separate from repository source unless parity is proven.
5. Reproduce the smallest asset-to-runtime boundary that proves the decisive behavior.

## Workflow

### 1. Map The Served Artifact Set

- Record entry HTML, script tags, preload hints, manifest files, asset map, chunk registry, and source map URLs.
- Note framework-specific artifacts such as route manifests, client reference manifests, or lazy-loader tables when present.
- Keep emitted filenames, hash suffixes, and route ownership tied together.

### 2. Reconstruct Runtime Structure

- Follow bootstrap code, chunk loaders, module registry, string decoders, and lazy import boundaries.
- Use source maps, manifest files, and stable symbol clusters to recover route names, API calls, feature flags, and hidden panels.
- Distinguish build-time intent from the bundle that is actively served now.

### 3. Reduce To The Decisive Bundle Path

- Compress the result to the smallest sequence: served asset -> loader path -> module or symbol -> runtime effect.
- State clearly whether the decisive weakness lives in manifest drift, chunk loading, hidden route code, string decoding, or stale source assumptions.
- If the task shifts from built assets to SSR or template enforcement, hand back to the tighter template-render skill.

## Read This Reference

- Load `references/bundle-sourcemap-recovery.md` for the artifact checklist, deobfuscation checklist, and evidence packaging.

## What To Preserve

- Served filenames, chunk ids, manifest entries, source map paths, recovered symbols, and endpoint strings
- The exact executing bundle or module that proves the runtime branch
- One minimal asset-to-runtime sequence that reaches the decisive effect

---

## 检查清单与常见坑（上游参考并入）

### bundle-sourcemap-recovery

# Bundle And Sourcemap Recovery Checklist

## First Pass

- Entry HTML, script tags, preload links, manifests, chunk registries, source map URLs
- Bootstrap bundle, lazy chunks, route chunks, loader helpers, string decoders
- Framework clues: route manifest, client reference manifest, build id, asset map

## Chain To Reconstruct

1. Served asset selected
2. Bootstrap or loader resolves chunk or module
3. Module registry or source map reveals structure
4. Hidden route, API call, or branch is recovered
5. Runtime effect is reproduced from the emitted asset set

## Evidence To Keep Together

- Asset side: filenames, hashes, chunk ids, manifest entries, source map path
- Recovery side: recovered symbol, route, endpoint, loader helper, or decoded string
- Effect side: rendered panel, hidden route, accepted request, or client behavior

## Common Pitfalls

- Trusting repository source over the currently served artifact set
- Opening huge minified bundles before checking manifests and source maps
- Recovering names without proving which bundle path actually executes at runtime

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-browser-persistence`、`competition-custom-protocol-replay`、`competition-file-parser-chain`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

