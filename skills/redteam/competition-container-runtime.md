---
name: competition-container-runtime
description: 容器运行时专项：解释运行时与清单的差异、挂载、sidecar 与路由
whenToUse: 靶子是容器/K8s 工作负载，要判断实际运行态与声明态差在哪时加载
---

> 主题：容器运行时漂移（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Container Runtime

Use this skill when the challenge is really about what the live container or pod is doing now, not what the checked-in manifest claims it should do.

## Quick Start

1. Split intent from reality: manifest, image, startup, live mount, live route, live process.
2. Map host -> proxy -> container or pod -> mounted volume -> consuming process.
3. Keep secrets, rendered config, init output, and sidecar output separate from static manifests.
4. Prove one minimal live path from mounted or injected state to reachable behavior.
5. Reproduce the effect with the smallest runtime-specific chain.

## Workflow

### 1. Map The Live Runtime

- Compare compose or kube manifests against running containers, pods, mounted volumes, env, sidecars, init containers, and entrypoints.
- Identify which process actually consumes the mounted secret, rendered config, or shared volume output.

### 2. Trace Route And Mount Boundaries

- Map virtual host, reverse proxy, service, container port, filesystem mount, and runtime-generated file paths together.
- Record whether the decisive state is image-baked, env-injected, mounted later, or written by an init/sidecar process.

### 3. Report The Runtime Deviation

- State the earliest point where live runtime diverges from checked-in intent.
- Keep one compact evidence chain from manifest or compose intent to live consumer behavior.

## Read This Reference

- Load `references/container-runtime.md` for the runtime checklist, mount-chain checklist, and common live-vs-static pitfalls.
- If the hard part is kube API permissions, service-account trust, RBAC edges, admission mutations, or controller-created workload drift, prefer `$competition-k8s-control-plane`.
- If the hard part is Host-header routing, path-prefix rewriting, or route-to-service mapping across nodes, prefer `$competition-runtime-routing`.
- If the hard part is proving container-to-host crossover, kernel attack-surface preconditions, or stable escape primitives, prefer `$competition-kernel-container-escape`.
- If the hard part is replaying Linux secrets, socket trust edges, or host-to-host pivots after container foothold, prefer `$competition-linux-credential-pivot`.

## What To Preserve

- Compose/Kubernetes fragments tied to live mounts or routes
- Container IDs, pod names, mount paths, sidecar outputs, rendered config paths, and consuming processes
- The exact route or file path that becomes reachable only at runtime

---

## 检查清单与常见坑（上游参考并入）

### container-runtime

###### Container Runtime Checklist

###### Compare Intent vs Reality

Inspect side by side:

- compose or kube manifests
- image layers and entrypoints
- init containers
- sidecars
- mounted volumes
- runtime env
- live processes and listeners

###### Trace The Mount Chain

- who writes the file
- where it is mounted
- which process reads it
- which route or behavior depends on it

###### High-Value Runtime Deviations

- rendered secrets written to shared volumes
- init output consumed by the main container
- sidecar-generated config or credentials
- runtime-only env values not visible in checked-in manifests
- reverse-proxy routing that exposes an internal path only after startup

###### Evidence To Keep

- one compact block for manifest intent
- one compact block for live mounts, processes, or rendered files
- one compact block for the route or behavior reached only because of runtime state

###### Common Pitfalls

- treating checked-in manifests as deployment truth
- stopping at “secret is mounted” without proving the consuming process
- missing sidecar or init output because only the main service was inspected

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-agent-cloud`、`competition-cloud-metadata-path`、`competition-dpapi-credential-chain`、`competition-identity-windows`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 提权 | T1611 | Escape to Host（容器逃逸到宿主） |
| 隐匿 | T1610 | Deploy Container（部署容器） |
| 发现 | T1613 | 容器与资源发现 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
