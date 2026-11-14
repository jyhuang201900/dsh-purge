---
name: competition-reverse-pwn
description: 逆向/PWN 专项：还原二进制、分析崩溃并证明可利用路径
whenToUse: 二进制题要还原逻辑、分析崩溃、证明可控利用路径时加载
---

> 主题：逆向与 PWN（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Reverse Pwn

Use this skill for binary-heavy challenges where the decisive path runs through artifacts, decoded layers, process behavior, crash state, or exploit primitives.

## Quick Start

1. Preserve the original artifact before unpacking, patching, or instrumenting.
2. Start with passive triage: type, headers, sections, imports, strings, entropy, resources.
3. Decide whether the path is reverse-first, DFIR-first, or exploit-first.
4. Tie every claim to an observable boundary: decode edge, persistence edge, crash edge, or leak edge.
5. Reproduce the artifact or primitive from a clean baseline.

## Workflow

### 1. Reverse Or Forensic Triage

- Separate loader, payload, config, and post-decode behavior.
- Correlate files, memory, logs, registry, services, tasks, IPC, and PCAPs as one graph.
- Keep decoded or dumped artifacts separate from the pristine sample.

### 2. Native And Exploit Path

- Map mitigations, loader behavior, libc or runtime, syscall and IPC surfaces, and protocol framing.
- Record the primitive, controllable bytes, leak source, target object, and final artifact separately.
- Compare host, libc, loader, and framing differences before doubting the primitive.

## Read This Reference

- Load `references/reverse-pwn.md` for triage order, exploit evidence expectations, and common failure modes.
- If the task is specifically about staged payload boundaries, config blobs, beacon parameters, or decoded IOC fields, prefer `$competition-malware-config`.
- If the task is specifically about firmware partitions, boot chains, extracted filesystems, or update-package trust boundaries, prefer `$competition-firmware-layout`.
- If the task is specifically about upload parsing, previews, archive extraction, converters, or deserialization chains, prefer `$competition-file-parser-chain`.
- If the task is specifically about source maps, emitted bundles, chunk registries, or reconstructing hidden runtime structure from served frontend assets, prefer `$competition-bundle-sourcemap-recovery`.
- If the task is specifically about container-to-host boundary crossing, kernel exploit preconditions, namespace or cgroup crossover, or escape primitive verification, prefer `$competition-kernel-container-escape`.
- If the task is specifically about reconstructing protocols, streams, or transferred artifacts from packet captures, prefer `$competition-pcap-protocol`.
- If the task is specifically about a custom binary or text protocol where replay state, message order, or checksum logic is the real blocker, prefer `$competition-custom-protocol-replay`.
- If the task is specifically about reconstructing chronology across EVTX, PCAP, registry, mail, or disk artifacts, prefer `$competition-forensic-timeline`.

## What To Preserve

- Offsets, hashes, section names, imports, config blobs, mutexes, registry keys
- Crash offsets, registers, heap or stack shape, leak addresses, and protocol steps
- Original, decoded, dumped, and instrumented artifacts as separate files

---

## 检查清单与常见坑（上游参考并入）

### reverse-pwn

###### Reverse, DFIR, And Pwn Playbook

###### Reverse And DFIR

- Start with file type, headers, sections, imports, strings, resources, embedded archives, entropy
- Reconstruct process trees, persistence, startup paths, IPC, and network beacons as one execution graph
- Explain when each recovered value becomes plaintext and where it came from

###### Pwn And Native

- Record mitigations, loader path, libc build, protocol framing, syscall surface
- Separate exploit prerequisites from exploit proof
- Tie allocator layout, crash state, and target object to observed execution

###### Evidence To Keep

- One compact block for offsets, hashes, imports, config fields, or registry paths
- One compact block for crash state, leaks, allocator state, and protocol steps
- Minimal but sufficient logs proving the decoded layer or privilege effect

###### Common Pitfalls

- Mixing original and modified artifacts
- Treating one string hit as proof of the full behavior
- Naming a primitive without replaying it from a clean baseline

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用
- **互补**（同类场景一起用）：`competition-firmware-layout`、`competition-ios-runtime`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
