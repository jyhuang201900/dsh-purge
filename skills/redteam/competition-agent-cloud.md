---
name: competition-agent-cloud
description: 智能体/云部署链路专项：追踪提示词到工具的流转、部署漂移与产物来源
whenToUse: 靶子是 AI 智能体的云部署，要追「一句提示怎么变成工具调用」或部署与代码不一致时加载
---

> 主题：智能体云链路（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Agent Cloud

Use this skill when the challenge path is driven by prompt-to-tool execution, retrieval and memory boundaries, deployment drift, or build and release provenance.

## Quick Start

1. Decide whether the dominant path is agentic or infrastructure-driven.
2. Map one minimal control chain: untrusted input -> visible context -> tool or deployment side effect.
3. Distinguish checked-in intent from live runtime truth.
4. Keep prompts, tool args, manifests, mounts, and provenance steps in compact evidence blocks.
5. Reproduce the exploit or misconfiguration with minimal context and minimal instrumentation.

## Workflow

### 1. Agent And Prompt Injection

- Treat prompts, tool schemas, retrieved chunks, planner notes, memory files, and handoffs as challenge artifacts.
- Prove one minimal chain from untrusted content to model-visible instruction to tool side effect.
- Distinguish claimed capability from runtime-exposed capability.

### 2. Cloud, Containers, And CI/CD

- Split build-time, deploy-time, and runtime.
- Reconcile compose or kube manifests with live mounts, env, logs, and traffic.
- Trace provenance from source to dependency resolution to build to publish to runtime consumer.

## Read This Reference

- Load `references/agent-cloud.md` for the control-stack checklist, deployment-truth checklist, and evidence packaging.
- If the task is specifically about prompt-boundary abuse or retrieved-content-to-tool drift, prefer `$competition-prompt-injection`.
- If the task is specifically about CI, dependency provenance, registry drift, or shipped artifacts, prefer `$competition-supply-chain`.
- If the task is specifically about queue payloads, async worker drift, retries, or worker-only runtime state, prefer `$competition-queue-worker-drift`.
- If the task is specifically about SSRF to internal control surfaces, metadata endpoints, or metadata-derived token pivots, prefer `$competition-ssrf-metadata-pivot`.
- If the task is specifically about proxy-upstream parse differentials, ambiguous headers, path normalization drift, or request smuggling behavior, prefer `$competition-request-normalization-smuggling`.
- If the task is specifically about metadata-service access, instance or workload identity, link-local token paths, or metadata-derived privilege, prefer `$competition-cloud-metadata-path`.
- If the task is specifically about kube API permissions, service-account trust, admission behavior, controller drift, or cluster secret exposure, prefer `$competition-k8s-control-plane`.
- If the task is specifically about live mounts, sidecars, init containers, or runtime-only secret exposure, prefer `$competition-container-runtime`.
- If the task is specifically about container-to-host boundary crossing, kernel-surface prerequisites, or escape primitive verification, prefer `$competition-kernel-container-escape`.

## What To Preserve

- Prompt snippets, retrieved chunks, planner transitions, and final tool args
- Compose or Kubernetes fragments tied to live mounts or routes
- Artifact hashes, dependency drift, CI steps, and the resulting runtime consumer

---

## 检查清单与常见坑（上游参考并入）

### agent-cloud

###### Agent, Toolchain, Cloud, And Supply-Chain Checklist

###### Agentic Path

- Map instruction layers, retrieval layers, memory layers, tool gates, auth material, and side effects
- Keep one compact evidence block for prompts, retrieved text, planner drift, tool arguments, and side effect
- Prove one minimal exploit chain before exploring variants

###### Cloud And Container Path

- Compare checked-in manifests to live mounts, env, sidecars, and logs
- Treat metadata services, registries, message buses, object stores, and IAM-like identities as sandbox control surfaces when they appear in-path
- Track build-time, deploy-time, and runtime separately

###### Supply Chain

- Keep a compact provenance chain: source -> dependency resolution -> build -> package/sign -> publish -> runtime consumer
- Focus on version drift, registry pulls, generated artifacts, and final runtime hook points

###### Common Pitfalls

- Trusting a prompt string without runtime confirmation
- Treating checked-in manifests as deployment truth
- Missing the point where retrieved content becomes executable tool input

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-ad-certificate-abuse`、`competition-cloud-metadata-path`、`competition-container-runtime`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 初始访问 | T1078 | 有效账号 |
| 凭据访问 | T1552 | 不安全存储的凭据 |
| 发现 | T1526 | 云服务发现 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
