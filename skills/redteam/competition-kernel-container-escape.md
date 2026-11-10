---
name: competition-kernel-container-escape
description: 内核/容器逃逸专项：把内核与容器边界画清楚，证明逃逸原语成立
whenToUse: 要从容器逃到宿主机、或用内核漏洞证明边界穿越时加载
---

> 主题：内核与容器逃逸（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Kernel Container Escape

Use this skill when the decisive step is proving a boundary crossing between containerized context and host or higher-privilege kernel context.

## Quick Start

1. Map runtime isolation first: namespaces, cgroups, seccomp, capabilities, LSM, and mount boundaries.
2. Separate exploit prerequisite, primitive, and boundary-crossing proof.
3. Record kernel version, config hints, runtime options, and reachable syscall surface.
4. Keep instrumented observations separate from pristine challenge path.
5. Reproduce one minimal primitive-to-boundary-crossing chain.

## Workflow

### 1. Map Isolation And Kernel Surface

- Record namespace map, cgroup mode, capabilities, seccomp profile, AppArmor or SELinux state, mounted filesystems, and runtime sockets.
- Note kernel version, distro build hints, module exposure, and container runtime behavior.
- Keep host and container observations linked to exact node and context.

### 2. Prove Exploit Primitive And Crossover

- Show controllable input, trigger condition, affected object, and observable kernel or runtime state change.
- Capture before and after identity, namespace, mount, or process visibility to prove boundary crossing.
- Distinguish crash-only behavior from stable capability gain.

### 3. Reduce To Decisive Escape Chain

- Compress to: prerequisite state -> primitive trigger -> boundary crossing evidence -> resulting host-level capability.
- State whether root cause is kernel vulnerability, runtime misconfiguration, capability overgrant, or namespace leak.
- If path relies mostly on credential replay after initial foothold, hand off to Linux credential pivot skill.

## Read This Reference

- Load `references/kernel-container-escape.md` for isolation checklist, primitive checklist, and parity guidance.

## What To Preserve

- Kernel and runtime context, capability set, seccomp or LSM state, and namespace map
- Primitive trigger data, boundary crossing evidence, and resulting capability
- One minimal reproducible chain from container context to host-relevant effect

---

## 检查清单与常见坑（上游参考并入）

### kernel-container-escape

# Kernel Container Escape Checklist

## First Pass

- Kernel version, runtime type, namespace map, cgroup mode, capability set
- Seccomp profile, AppArmor or SELinux mode, mounts, privileged sockets
- Potential primitives: syscall path, fs boundary, runtime API, namespace leak

## Chain To Reconstruct

1. Isolation baseline recorded
2. Exploit or misconfig primitive triggered
3. Boundary crossover evidence captured
4. Host-relevant capability appears
5. Chain reproduces from reset baseline

## Evidence To Keep Together

- Context side: kernel and runtime config, namespace and capability state
- Primitive side: controllable input, trigger, affected object, observables
- Effect side: identity change, host visibility, privileged action, persistence edge

## Common Pitfalls

- Treating container root as host compromise without crossover proof
- Mixing several primitives before proving one decisive chain
- Claiming escape from crash artifacts without stable capability evidence

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-k8s-control-plane`、`competition-kerberos-delegation`、`competition-linux-credential-pivot`、`competition-lsass-ticket-material`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

