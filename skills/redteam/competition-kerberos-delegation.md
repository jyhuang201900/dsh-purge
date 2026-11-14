---
name: competition-kerberos-delegation
description: Kerberos 委派专项：追踪 S4U、RBCD、委派边与票据被接受的事实
whenToUse: 域内怀疑存在委派关系（约束/非约束/RBCD）要拿票并证明被接受时加载
---

> 主题：Kerberos 委派（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Kerberos Delegation

Use this skill when the hard part is not "is there Kerberos here," but which delegation edge exists, which ticket is being minted, and which service really accepts it.

## Quick Start

1. Write the trust chain first: principal -> delegation edge -> ticket type -> target SPN -> accepting service -> resulting privilege.
2. Separate ticket possession from accepted privilege.
3. Keep SPNs, delegation mode, PAC/group data, encryption type, and service acceptance in one compact evidence block.
4. Reproduce one minimal delegation chain before broadening into variants.
5. Tie every privilege claim to a specific accepted ticket or service-side effect.

## Workflow

### 1. Identify The Delegation Edge

- Determine whether the path is constrained delegation, unconstrained delegation, resource-based constrained delegation, protocol transition, or another trust edge.
- Inspect SPNs, ACLs, service accounts, SIDHistory, certificate templates, and replication rights only when they affect the active path.

### 2. Trace Ticket Minting And Acceptance

- Record TGT/TGS type, S4U steps when relevant, delegation flags, PAC or group data, encryption type, cache location, and target SPN.
- Prove which service actually accepts the ticket and what capability appears after acceptance.

### 3. Report The Effective Edge

- Compress the chain into one replayable path, not a vague "domain compromise" statement.
- Separate candidate edges from the edge that really lands privilege.

## Read This Reference

- Load `references/kerberos-delegation.md` for the delegation checklist, ticket fields to preserve, and common proof mistakes.

## What To Preserve

- SPN, ticket type, delegation mode, PAC/group data, encryption type, cache location, accepting service
- Service-side logs, event IDs, logon session changes, or group changes proving effective privilege
- The exact trust edge that makes the ticket replayable

---

## 检查清单与常见坑（上游参考并入）

### kerberos-delegation

###### Kerberos Delegation Checklist

###### Write The Chain Explicitly

- source principal
- delegation edge
- ticket minted or transformed
- target SPN
- accepting service
- resulting privilege

###### Ticket Fields To Preserve

- TGT or TGS type
- SPN
- delegation mode
- S4U step if present
- PAC or group data
- encryption type
- cache location
- accepting service

###### Trust Edges To Inspect

- constrained delegation
- unconstrained delegation
- resource-based constrained delegation
- protocol transition
- SIDHistory or ACL-based privilege edges when they affect ticket usability

###### Common Pitfalls

- Treating a minted ticket as proof of accepted privilege
- Reporting the delegation mode without naming the accepting service
- Expanding into every AD edge before one replayable chain is proven

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透
- **互补**（同类场景一起用）：`competition-identity-windows`、`competition-k8s-control-plane`、`competition-kernel-container-escape`、`competition-linux-credential-pivot`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 提权 | T1134 | 访问令牌操纵 |
| 凭据访问 | T1558 | 窃取或伪造 Kerberos 票据 |
| 横向移动 | T1550 | 使用备用认证材料 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。
