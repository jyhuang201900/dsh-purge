---
name: competition-supply-chain
description: 供应链专项：追踪依赖漂移、CI 产出与交付产物来源
whenToUse: 要追「这个产物是谁在哪一步构建的」或依赖被投毒时加载
---

> 主题：供应链与产物溯源（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Supply Chain

Use this skill when the challenge is really about provenance, dependency drift, build output, release flow, or what runtime artifact actually got shipped.

## Quick Start

1. Split the problem into source, dependency resolution, build, packaging, publish, and runtime consumption.
2. Decide where the first divergence occurs between intended artifact and runtime artifact.
3. Keep provenance as a compact chain, not a scattered set of observations.
4. Reproduce the smallest possible build or package path that still shows the issue.
5. Separate checked-in intent from what the pipeline actually emitted.

## Workflow

### 1. Trace Provenance End-To-End

- Map source checkout, lockfiles, dependency fetch, pre/post-install steps, build scripts, packaging, publish target, and runtime consumer.
- Compare declared version, resolved version, and shipped artifact.
- Note registry, cache, mirror, or CI environment differences.

### 2. Reconcile Build-Time And Runtime

- Compare manifests with image layers, mounted secrets, generated files, and runtime hooks.
- Identify whether the decisive mutation happens in dependency install, build step, publish step, or runtime bootstrap.

### 3. Report The Break Point

- State the earliest point where provenance diverges.
- Keep evidence in one short chain from source to runtime consumer.

## Read This Reference

- Load `references/supply-chain.md` for the provenance checklist, evidence packaging, and common pipeline failure modes.

## What To Preserve

- Declared dependency, resolved dependency, and runtime artifact versions
- CI step names, registry pulls, artifact hashes, and image or package layers
- The runtime consumer that actually accepts or executes the artifact

---

## 检查清单与常见坑（上游参考并入）

### supply-chain

###### Supply Chain And CI Checklist

###### Provenance Chain

Track this order explicitly:

1. Source checkout
2. Dependency declaration
3. Lockfile or resolver result
4. Build step
5. Packaging or signing step
6. Publish target
7. Runtime consumer

###### High-Value Evidence

- Version drift between source, lockfile, and fetched artifact
- Registry or mirror pulls that differ from expected origin
- Build scripts with preinstall, prepare, postinstall, or codegen steps
- Signed or packaged artifact hash compared to runtime-loaded artifact

###### Common Pitfalls

- Stopping at lockfile drift without proving runtime consumption
- Treating checked-in manifests as equivalent to live pipeline behavior
- Losing the earliest divergence point inside a wall of CI logs

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-runtime-routing`、`competition-stego-media`、`competition-template-render-path`、`competition-web-runtime`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
