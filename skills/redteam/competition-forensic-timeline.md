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

# Forensic Timeline Checklist

## Anchor Selection

- Earliest trustworthy markers: process creation, service install, scheduled task, mailbox rule write, browser download, network connect, or credential replay
- Note the time source for each artifact: event log local time, UTC network time, filesystem timestamp, mailbox server time, or packet capture timestamp
- Record drift, missing zones, daylight-saving ambiguity, or truncation before merging sources

## Cross-Source Correlation

Match on shared identifiers whenever possible:

1. Process ID, parent process ID, or command line
2. Logon ID, SID, ticket cache, mailbox item ID, or message trace ID
3. Hostname, IP, MAC, session ID, GUID, or hash
4. File path, registry path, service name, task name, or attachment name

## Timeline Compression

- Keep one long-form raw chronology for yourself and one short decisive chronology for the final answer
- Separate observed events from inferred transitions
- If an edge is inferred, state the missing validation step explicitly

## Common Pitfalls

- Sorting by timestamp alone when clock drift or delayed logging exists
- Mixing mailbox, browser, host, and network artifacts without shared identifiers
- Reporting a long event dump instead of the smallest sequence that proves the challenge path
