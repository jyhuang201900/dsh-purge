---
name: competition-forensic-timeline
description: 取证时间线专项：把主机、邮件、内存与网络证据按时间对齐
whenToUse: 需要按时间线把多源证据串起来解释「什么时候发生了什么」时加载
---

> 主题：取证时间线（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Forensic Timeline

Use this skill when the hard part is not finding one artifact, but turning many artifacts into one replayable chronology.

## Quick Start

1. Pick the smallest reliable anchor: first execution, first logon, first network session, first file write, or first mailbox action.
2. Normalize timestamps, time zones, hostnames, users, process IDs, message IDs, and file paths before correlating.
3. Build one minimal chain from foothold to persistence, execution, access, or exfiltration.
4. Separate confirmed event order from inferred gaps.
5. Reproduce the decisive timeline segment that yields the artifact or privilege conclusion.

## Workflow

### 1. Establish Timeline Anchors

- Collect only the active surfaces: EVTX, Sysmon, registry, Amcache, prefetch, browser artifacts, mail traces, PCAPs, memory, or filesystem metadata.
- Record clock source, timezone, and any drift or truncation that could reorder events.
- Link shared identifiers across sources: PID, logon ID, GUID, message ID, hostname, username, IP, or hash.

### 2. Correlate The Execution Graph

- Track process tree, service or task creation, network sessions, file writes, registry changes, mailbox rules, or token use as one path.
- Distinguish causal edges from coincidence by matching identifiers and adjacency, not just nearby timestamps.
- Keep raw artifact and parsed summary side by side so every step can be traced back.

### 3. Compress To The Decisive Story

- Reduce the timeline to the smallest sequence that proves initial access, persistence, lateral movement, collection, or artifact recovery.
- Call out missing validation steps separately instead of mixing them into confirmed chronology.
- If the task becomes mainly about malware config extraction or a Windows pivot edge, switch to the tighter specialized skill.

## Read This Reference

- Load `references/forensic-timeline.md` for anchor selection, cross-source correlation, and evidence packaging.
- If the hard part is packet reassembly, protocol framing, or transferred-object extraction from a capture, prefer `$competition-pcap-protocol`.

## What To Preserve

- Source file paths, event IDs, logon IDs, message IDs, PIDs, hashes, and timestamps with timezone noted
- One compact timeline table or ordered list for the decisive segment
- Raw artifacts, parsed output, and inferred edges kept separate

---

## 检查清单与常见坑（上游参考并入）

### forensic-timeline

###### Forensic Timeline Checklist

###### Anchor Selection

- Earliest trustworthy markers: process creation, service install, scheduled task, mailbox rule write, browser download, network connect, or credential replay
- Note the time source for each artifact: event log local time, UTC network time, filesystem timestamp, mailbox server time, or packet capture timestamp
- Record drift, missing zones, daylight-saving ambiguity, or truncation before merging sources

###### Cross-Source Correlation

Match on shared identifiers whenever possible:

1. Process ID, parent process ID, or command line
2. Logon ID, SID, ticket cache, mailbox item ID, or message trace ID
3. Hostname, IP, MAC, session ID, GUID, or hash
4. File path, registry path, service name, task name, or attachment name

###### Timeline Compression

- Keep one long-form raw chronology for yourself and one short decisive chronology for the final answer
- Separate observed events from inferred transitions
- If an edge is inferred, state the missing validation step explicitly

###### Common Pitfalls

- Sorting by timestamp alone when clock drift or delayed logging exists
- Mixing mailbox, browser, host, and network artifacts without shared identifiers
- Reporting a long event dump instead of the smallest sequence that proves the challenge path

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-custom-protocol-replay`、`competition-file-parser-chain`、`competition-graphql-rpc-drift`、`competition-jwt-claim-confusion`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 隐匿 | T1070 | 清除主机痕迹 |
| 收集 | T1005 | 本地系统数据 |
| 收集 | T1560 | 归档收集数据 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
