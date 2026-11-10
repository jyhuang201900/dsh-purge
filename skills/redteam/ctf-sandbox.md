---
name: ctf-sandbox
description: Thin PRIMARY for CTF / AWD / 靶场 multi-type orchestration. Hands off to the sidecar CTF-Sandbox-Orchestrator. Use when the user says CTF, AWD, 靶场, or 比赛题 and no more specific pwn/APK/IDA route already 
whenToUse: Thin PRIMARY for CTF / AWD / 靶场 multi-type orchestration. Hands off to the sidecar CTF-San
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---
# ctf-sandbox

# CTF sandbox entry (sidecar, not a second router)

## 为什么单独一层

`CTF-Sandbox-Orchestrator/` 是 **GPL 旁路包**，授权默认是沙箱内部。核心路由包仍是 MIT + `scope.md` 门禁。本 skill 只做关键词入口，不把竞赛树并进核心。

## 任务完成自检（声称完成前 MUST 通过）

- [ ] 我是否先走了 case-init / scope，而不是把“用户说了 CTF”当成已授权外网？
- [ ] 我是否打开了 sidecar orchestrator，而不是把 40 个子技能当 PRIMARY？
- [ ] 若任务其实是 pwn/APK/IDA，我是否让更具体的 PRIMARY 接手？

## 本机工具实况（自动探测，非猜测）

| 工具 | 状态 |
| --- | --- |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：流程/编排｜**角色**：`flow`
- **下游**（产出交给谁）：`ctf-sandbox-orchestrator`
- **互补**（同类场景一起用）：`cn-proxy-pool`、`ctf-sandbox-orchestrator`、`kimi-webbridge`、`pentest-tools`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->
