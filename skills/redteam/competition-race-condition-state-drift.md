---
name: competition-race-condition-state-drift
description: 竞态专项：在并发下复现竞态、定序缺陷与状态漂移
whenToUse: 要利用并发让 check-then-act 失效、或状态机在竞争下漂移时加载
---

> 主题：竞态与状态漂移（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Race Condition State Drift

Use this skill when the decisive behavior depends on request timing, async ordering, lock gaps, or stale state.

## Quick Start

1. Identify mutable state first: rows, cache keys, queue payloads, session fields, counters, or files.
2. Reproduce with smallest concurrent sequence and fixed timing assumptions.
3. Capture one baseline run and one racing run with only one variable changed.
4. Track read, check, write, enqueue, and commit boundaries separately.
5. Prove final state drift from a clean reset.

## Workflow

### 1. Map Mutable Boundaries

- Record transaction scope, lock behavior, retry logic, idempotency keys, cache invalidation, and queue handoff.
- Note where read-check-write is split across requests, workers, or services.
- Keep each boundary tied to exact timestamps or sequence numbers.

### 2. Reproduce Timing Window

- Build deterministic concurrent inputs with controlled delay, duplicate requests, or reordered worker execution.
- Compare accepted and rejected paths under identical payloads.
- Record which condition flips when ordering changes.

### 3. Reduce To Decisive Race Chain

- Compress to: request A and B ordering -> stale check or lock gap -> conflicting writes -> resulting capability or artifact.
- State whether root cause is missing lock, weak idempotency, stale cache read, delayed async commit, or retry side effect.
- If the path becomes queue-dominant, hand off to queue worker drift skill.

## Read This Reference

- Load `references/race-condition-state-drift.md` for race harness ideas, evidence blocks, and parity checks.

## What To Preserve

- Mutable keys, transaction boundaries, lock behavior, and idempotency markers
- Timestamped or sequenced traces for baseline and race runs
- One minimal replayable concurrent sequence proving drift

---

## 检查清单与常见坑（上游参考并入）

### race-condition-state-drift

###### Race Condition State Drift Checklist

###### First Pass

- Mutable rows, cache keys, counters, files, queue payloads
- Read-check-write boundaries, lock scope, retry behavior, idempotency handling
- Worker delays, commit timing, stale reads, invalidation timing

###### Chain To Reconstruct

1. Baseline ordering established
2. Concurrent or reordered flow injected
3. Check or lock boundary is bypassed
4. Conflicting state mutation lands
5. Decisive drift is reproduced

###### Evidence To Keep Together

- State side: key or row, initial value, final value, commit boundaries
- Timing side: request order, delays, retries, queue timing
- Effect side: duplicated action, privilege drift, balance drift, stale authorization

###### Common Pitfalls

- Running noisy stress tests without a minimal deterministic sequence
- Mixing several mutable keys without proving which key drives the effect
- Reporting timing sensitivity without final-state parity proof

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-prompt-injection`、`competition-queue-worker-drift`、`competition-request-normalization-smuggling`、`competition-runtime-routing`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1190 | 利用面向公众的应用 |
| 提权 | T1068 | 利用漏洞提权 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
