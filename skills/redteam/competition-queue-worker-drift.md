---
name: competition-queue-worker-drift
description: 队列/Worker 专项：追踪队列载荷、worker 状态、重试与异步漂移
whenToUse: 靶子有消息队列/异步 worker，要利用重试、状态漂移或载荷注入时加载
---

> 主题：队列与 Worker 漂移（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Queue Worker Drift

Use this skill when the decisive effect happens after enqueue, inside a worker, or only under async runtime state that differs from the request path.

## Quick Start

1. Map the async chain first: enqueue point, queue payload, worker consumer, retries, and final side effect.
2. Keep request-time state separate from worker-time state.
3. Record queue name, message shape, worker config, retry policy, and downstream store in one chain.
4. Compare synchronous path and async path when behavior diverges.
5. Reproduce the smallest enqueue-to-side-effect flow that proves the decisive async drift.

## Workflow

### 1. Map Enqueue And Worker Identity

- Record queue names, topics, cron schedules, delayed jobs, dead-letter queues, worker processes, and consumer groups.
- Note which config, env vars, feature flags, or credentials exist only in the worker environment.
- Keep enqueue request, stored payload, and worker identity tied together.

### 2. Trace Worker-Only State And Retries

- Show how worker runtime differs from the request path: different env, files, mounts, caches, permissions, or clocks.
- Record retry count, backoff, dedupe keys, failure handling, dead-letter flow, and idempotency behavior.
- Distinguish immediate request success from eventual worker success or failure.

### 3. Reduce To The Decisive Async Chain

- Compress the result to the smallest sequence: enqueue -> worker runtime -> retry or branch -> resulting effect.
- State clearly whether the decisive difference lives in payload shape, worker config, retry path, or downstream consumer.
- If the issue is really about the file parser invoked by the worker, switch back to the tighter file-parser skill.

## Read This Reference

- Load `references/queue-worker-drift.md` for the queue checklist, retry checklist, and evidence packaging.

## What To Preserve

- Queue names, payloads, worker identities, retry metadata, dead-letter edges, and downstream effects
- The exact worker-only config or state that changes behavior
- One minimal enqueue-to-side-effect reproduction chain

---

## 检查清单与常见坑（上游参考并入）

### queue-worker-drift

###### Queue Worker Drift Checklist

###### First Pass

- Enqueue endpoint, queue or topic name, payload schema, worker process, schedule or delay, downstream store
- Worker env, mounts, credentials, feature flags, config files, retry policy, dedupe behavior
- Final effects: file write, cache mutation, email, report, artifact generation, privilege-bearing action

###### Async Chain To Reconstruct

1. Request or cron enqueue occurs
2. Payload stored or scheduled
3. Worker picks it up under its own runtime state
4. Retry, backoff, or failure path taken if relevant
5. Side effect lands in file, DB, cache, email, or service

###### Evidence To Keep Together

- Enqueue side: route, payload, queue name, task ID
- Worker side: process, env, config, retry metadata, dedupe or lease state
- Effect side: resulting artifact, downstream mutation, timestamps, and replay prerequisites

###### Common Pitfalls

- Explaining only the request path and never proving the worker branch
- Ignoring worker-only env or mount differences
- Treating eventual side effects as synchronous behavior without isolating the async boundary

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-pcap-protocol`、`competition-prompt-injection`、`competition-race-condition-state-drift`、`competition-request-normalization-smuggling`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
