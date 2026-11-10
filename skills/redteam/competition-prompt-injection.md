---
name: competition-prompt-injection
description: 智能体提示词注入专项：分析检索污染、规划器漂移与工具滥用
whenToUse: 靶子是 AI 智能体，要分析「不可信内容怎么变成工具参数」这类信任边界时加载
---

> 主题：提示词注入（智能体）（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Prompt Injection

Use this skill when the challenge is primarily about trust boundaries inside an agentic system.

## Quick Start

1. Identify the first untrusted content that becomes model-visible.
2. Map the chain from retrieval, memory, or transcript into planner or executor behavior.
3. Record the exact point where text becomes a tool argument, file path, network target, or secret request.
4. Prove one minimal exploit chain before exploring variants.
5. Keep prompt snippets and tool transitions in compact evidence blocks.

## Workflow

### 1. Map The Control Stack

- Track system, developer, user, retrieved, memory, planner, and tool-response layers separately.
- Distinguish claimed capability from runtime-exposed capability.
- Note what the model can actually call, read, or mutate.

### 2. Prove The Boundary Crossing

- Reproduce one chain from untrusted text to changed planner behavior, changed tool args, or secret exposure.
- Keep the decisive transcript compact: source chunk, rewritten planner state, final tool invocation.
- Prefer the smallest transcript that still demonstrates the bug.

### 3. Report By Boundary

- State which layer failed: retrieval, summarizer, planner, executor, tool normalization, or output post-processing.
- Separate instruction drift from actual side effect.

## Read This Reference

- Load `references/prompt-injection.md` for the checklist, evidence layout, and common prompt-boundary pitfalls.

## What To Preserve

- Original malicious chunk or prompt
- Intermediate summary or planner drift if it matters
- Final tool args, file paths, or exposed secret surface

---

## 检查清单与常见坑（上游参考并入）

### prompt-injection

# Prompt Injection And Tool Boundary Checklist

## Map These Layers Explicitly

- System and developer instructions
- User request
- Retrieved chunks or documents
- Memory or summaries
- Planner draft or chain-of-thought proxy artifacts
- Executor or tool adapter
- Final tool invocation and side effect

## Minimal Proof Chain

Use the smallest chain that proves the bug:

1. Untrusted content enters context
2. Model-visible instruction boundary changes
3. Planner or executor behavior drifts
4. Tool call or secret access changes
5. Side effect becomes observable

## Evidence To Keep

- One compact block for the malicious chunk or prompt
- One compact block for planner drift or intermediate rewrite
- One compact block for final tool args and side effect

## Common Pitfalls

- Treating a malicious string as proof without a side effect
- Mixing several injection variants before one minimal chain is proven
- Forgetting to separate retrieval contamination from executor normalization bugs

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-oauth-oidc-chain`、`competition-pcap-protocol`、`competition-queue-worker-drift`、`competition-race-condition-state-drift`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
