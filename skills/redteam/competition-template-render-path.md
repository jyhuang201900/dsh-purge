---
name: competition-template-render-path
description: 模板渲染专项：追踪 SSR 加载器、模板、水合与渲染信任缺口
whenToUse: 靶子用 SSR/模板引擎（Jinja/SSTI/Next.js 等），要找渲染信任缺口时加载
---

> 主题：模板渲染链（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Template Render Path

Use this skill when the decisive bug or artifact lives in route resolution, server render context, template data, or hydration handoff rather than in a plain JSON API alone.

## Quick Start

1. Map the render chain in order: route resolution, loader or data fetch, template or component context, response HTML, hydration payload, and client takeover.
2. Record host, route params, preview toggles, tenant or host switches, and server-only variables before mutating anything.
3. Compare template gating with loader or handler enforcement.
4. Preserve one successful render and one failing render path with the smallest delta.
5. Reproduce the smallest request-to-render branch that proves the decisive behavior.

## Workflow

### 1. Map Route To Render Context

- Record host, path, route match, loader, template, layout, hydration blob, and client boot chunk for the active view.
- Note whether the response is SSR HTML, static HTML plus hydration, edge-rendered content, or a template fragment used by another route.
- Keep server-only context and client-visible context separate.

### 2. Trace Template And Enforcement Boundaries

- Show where permissions, feature flags, preview state, tenant selection, or host-based switches are applied.
- Compare template-level gating, loader-level gating, and backend handler enforcement instead of trusting any one layer.
- Record hidden fields, inline data, hydration JSON, meta tags, or alternate partials that expose the decisive branch.

### 3. Reduce To The Decisive Render Path

- Compress the result to the smallest sequence: request -> route match -> loader or template context -> rendered output or hidden data -> resulting effect.
- State clearly whether the decisive weakness lives in route selection, template context construction, server-client hydration handoff, or mismatched enforcement between render and handler.
- If the task becomes mostly emitted bundle recovery or source map reconstruction, hand off to the tighter bundle skill.

## Read This Reference

- Load `references/template-render-path.md` for the render checklist, hydration checklist, and evidence packaging.

## What To Preserve

- Route names, loader names, templates, layouts, hydration keys, and host or preview switches
- One success or failure pair that shows where render-layer behavior diverges
- One minimal request-to-render sequence that reaches the decisive branch

---

## 检查清单与常见坑（上游参考并入）

### template-render-path

# Template Render Path Checklist

## First Pass

- Host, path, route params, route match, loader name, template or layout, response mode
- SSR HTML, inline data, hydration payload, client boot chunk, preview or feature flags
- Hidden fields, alternate partials, meta tags, host-based switches, tenant context

## Chain To Reconstruct

1. Request reaches route match
2. Loader or server data fetch runs
3. Template or layout context is built
4. HTML or hydration payload is emitted
5. Client takeover or handler follow-up turns it into the decisive effect

## Evidence To Keep Together

- Route side: host, path, matched route, params, loader or handler
- Render side: template or layout, server-only variables, hydration keys, hidden fields
- Effect side: rendered content, leaked data, privileged action, or bypassed branch

## Common Pitfalls

- Trusting visible UI gating without checking loader or handler enforcement
- Looking only at HTML and ignoring hydration JSON or inline data blobs
- Mixing route selection bugs with client-only rendering differences without proving the server boundary

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-stego-media`、`competition-supply-chain`、`competition-web-runtime`、`competition-websocket-runtime`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
