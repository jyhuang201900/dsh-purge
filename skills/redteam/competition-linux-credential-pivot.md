---
name: competition-linux-credential-pivot
description: Linux 凭据专项：追踪凭据、令牌、套接字与主机间跳板
whenToUse: Linux 主机上找凭据、会话令牌或规划主机间跳板时加载
---

> 主题：Linux 凭据与跳板（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Linux Credential Pivot

Use this skill when the decisive edge is Linux credential material and where that material is accepted.

## Quick Start

1. Separate credential storage from accepted privilege.
2. Record user, process, namespace, socket, key file, and service trust boundary before conclusions.
3. Keep artifact recovery, replay path, and resulting capability in one chain.
4. Distinguish local escalation from lateral host pivot.
5. Reproduce one minimal artifact-to-accepted-access path.

## Workflow

### 1. Map Credential And Trust Artifacts

- Record SSH keys, agent sockets, kubeconfigs, cloud tokens, service-account secrets, env vars, config files, and process memory clues.
- Note sudoers rules, capabilities, setuid binaries, systemd unit context, and namespace boundaries.
- Keep each artifact tied to owner, scope, and expected accepting service.

### 2. Prove Replay And Pivot

- Show where key, token, socket, or secret is accepted: SSH, API, Unix socket, container runtime, or control-plane endpoint.
- Record host target, protocol, principal, and resulting session or privilege.
- Distinguish authentication success from useful capability gain.

### 3. Reduce To Decisive Linux Pivot Chain

- Compress to: recovered artifact -> accepted replay path -> pivot host or privilege transition -> resulting capability.
- State whether root cause is weak key handling, token leakage, socket trust, sudo or capability abuse, or namespace crossover.
- If the chain pivots into kernel exploit boundaries, hand off to kernel container escape skill.

## Read This Reference

- Load `references/linux-credential-pivot.md` for artifact checklists, replay matrix, and evidence packaging.

## What To Preserve

- Artifact path, owner, scope, accepting service, and resulting principal
- Exact pivot order with protocol and target host or namespace
- One minimal replayable chain proving capability gain

---

## 检查清单与常见坑（上游参考并入）

### linux-credential-pivot

###### Linux Credential Pivot Checklist

###### First Pass

- SSH keys, agent sockets, kubeconfigs, cloud tokens, service-account secrets
- Env vars, config files, systemd units, sudoers, capabilities, setuid binaries
- Namespace context, container runtime sockets, control-plane endpoints

###### Chain To Reconstruct

1. Credential artifact recovered
2. Accepting service identified
3. Replay or auth path executed
4. New session, token, or privilege gained
5. Pivot or lateral effect reproduced

###### Evidence To Keep Together

- Artifact side: file or socket path, owner, scope, lifetime
- Replay side: target host, service, protocol, principal
- Effect side: privilege change, new shell, control-plane action, lateral movement

###### Common Pitfalls

- Listing secrets without proving acceptance on a target service
- Mixing local privilege escalation and lateral movement in one vague chain
- Ignoring namespace or socket ownership context

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-kerberos-delegation`、`competition-kernel-container-escape`、`competition-lsass-ticket-material`、`competition-mailbox-abuse`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

命令含 Linux 专属形态（`sudo` / `apt` / `/usr/share` 等）：本机是 Windows，**去掉 sudo**、把绝对路径换成工具目录（`$DSH_HOME/redteam/toolkit/<name>/`），`.exe` 后缀别漏。

runnability:end -->
