---
name: competition-firmware-layout
description: 固件专项：划分分区、还原启动链、提取内置密钥
whenToUse: 拿到固件镜像要划分区、找启动链或提取硬编码密钥时加载
---

> 主题：固件布局与密钥提取（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Firmware Layout

Use this skill when the hard part is understanding how a firmware image is structured, booted, updated, and turned into reachable device behavior.

## Quick Start

1. Preserve the original image, extracted partitions, unpacked filesystems, and patched copies as separate artifacts.
2. Map outer container, partition table, bootloader, kernel, rootfs, config, and update metadata before editing anything.
3. Track the boot or update chain in order instead of jumping straight to the most interesting file.
4. Record keys, signatures, offsets, partition boundaries, and init entrypoints in one compact evidence chain.
5. Reproduce the decisive secret, branch, or reachable service from the smallest extracted path.

## Workflow

### 1. Establish Image Layout

- Identify container type, partition headers, compression, filesystem type, and any appended or nested images.
- Record offsets, sizes, hashes, mount points, and partition names before extraction mutates anything.
- Separate bootloader, kernel, initramfs, rootfs, config blobs, and update metadata as different layers.

### 2. Trace Boot Or Update Flow

- Map how control moves from bootloader to kernel to init to services, or from update package to verifier to installer.
- Note which credentials, certificates, passwords, seeds, or config files are consumed at each stage.
- Distinguish checked-in firmware intent from the live behavior the extracted files actually support.

### 3. Reduce To The Decisive Path

- Show the smallest chain from image boundary to service exposure, auth bypass, debug interface, credential recovery, or flag artifact.
- Keep extracted filesystems, derived configs, and patch experiments separate from pristine inputs.
- If the challenge becomes mostly about native crash behavior or exploit primitives after extraction, switch back to the broader reverse skill.

## Read This Reference

- Load `references/firmware-layout.md` for the layout checklist, boot-chain checklist, and evidence packaging.

## What To Preserve

- Partition offsets, hashes, filesystem types, mount paths, boot entrypoints, and update metadata
- Extracted secrets, config paths, init scripts, service units, and credentials tied to the stage that consumes them
- Original images, extracted layers, mounted views, and patched copies as separate artifacts

---

## 检查清单与常见坑（上游参考并入）

### firmware-layout

###### Firmware Layout Checklist

###### First Pass

- Identify outer container, partition headers, compression, checksums, and appended images
- Record partition names, offsets, sizes, filesystem types, mount points, and hashes
- Separate bootloader, kernel, initramfs, rootfs, config, and update payloads

###### Boot Or Update Chain

1. Boot ROM or vendor bootstrap
2. Bootloader or secure boot stage
3. Kernel and initramfs
4. Root filesystem init path and services
5. Update verifier, installer, and post-install hooks

###### Evidence To Keep Together

- Boundary facts: offsets, sizes, signatures, hashes, partition names
- Consumed state: keys, certs, passwords, default configs, scripts, or service files
- Reachable effect: debug service, auth branch, update bypass, or recovered artifact

###### Common Pitfalls

- Editing extracted files before recording pristine offsets and hashes
- Mixing config recovered from one partition with behavior sourced from another without proving the link
- Treating an extracted secret as decisive without showing where the boot or update flow actually consumes it

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用
- **互补**（同类场景一起用）：`competition-android-hooking`、`competition-crypto-mobile`、`competition-ios-runtime`、`competition-reverse-pwn`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
