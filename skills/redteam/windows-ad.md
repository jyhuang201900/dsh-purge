---
name: windows-ad
description: Use for authorized Active Directory and Windows identity attacks including Kerberos, AD CS, BloodHound paths, NTLM relay, and domain privilege escalation research.
whenToUse: Use for authorized Active Directory and Windows identity attacks including Kerberos, AD CS
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---
# windows-ad

# Windows / Active Directory Security

## 适用场景

- 域渗透、Kerberoasting、AS-REP、委派
- AD CS（ESC1–ESC8 等）证书攻击
- BloodHound / SharpHound 攻击路径
- NTLM Relay / Coercer 强制认证
- 本地提权到域路径（Potato 等作为跳板）

## 与 attack-chain 关系

- **多阶段从外网到域控** → PRIMARY 可仍是 `attack-chain/`，本 skill 为 **AD 专科**
- **已在域内专注身份** → PRIMARY = 本 skill

## 工作流

### 1. 枚举

```bash
# 示例 Impacket / 内置（需凭据与授权）
nxc smb <range> -u user -p pass
bloodhound-python -d domain.local -u user -p pass -c All -ns <DC>
```

### 2. 常见路径（先图后枪）

```text
□ Kerberoast / AS-REP → 离线破解
□ ACL 滥用（GenericAll/WriteDacl）
□ 委派（非约束/约束/基于资源）
□ AD CS 模板错误 → Certipy
□ 中继：LLMNR/NBT-NS + ntlmrelayx（确认授权）
```

### 3. 凭证与横向

```text
□ secretsdump / lsassy / mimikatz（严格授权与清理）
□ PtH / PtT / 黄金票仅在授权红队范围
□ 每步写 Evidence；高危等用户确认
```

## 工具链

| 工具 | 用途 |
|------|------|
| BloodHound / SharpHound | 路径图 |
| Certipy | AD CS |
| Impacket / NetExec | 横向与枚举 |
| Rubeus / Mimikatz | 票据与凭证（授权） |
| Coercer / Responder | 强制认证 / 投毒 |

## 参考

- `references/ad-attack-paths.md`
- `../pentest-tools/references/network-attack-defense.md`
- `../attack-chain/`
- seeds: `落地记录/seed-005_ad-certipy-esc1.md` `seed-007_ntlm-relay-coercer.md` `seed-013_kerberoasting-spn.md`

## 路由上下文

**上游**: MASTER R24  
**下游**: 报告 `docs-generator`；需 EDR 研究 `edr-bypass-re`  
**MUST NOT**: 无授权 DCSync / 黄金票打生产

## 任务完成自检

- [ ] 是否先有图/枚举再有利用？
- [ ] 是否记录可复现命令并脱敏？
- [ ] 是否遵守 scope 禁止项？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `bloodhound` | ❌ 未装（用前先装，或改用等价工具） |
| `sharphound` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`nxc`
- `nxc`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`lateral-movement`、`netexec-scan`
- **下游**（产出交给谁）：`identity-federation`、`edr-bypass-re`、`competition-kerberos-delegation`
- **专项下游**（同主题更深的靶子面）：`competition-ad-certificate-abuse`、`competition-kerberos-delegation`、`competition-lsass-ticket-material`、`competition-windows-pivot`
- **互补**（同类场景一起用）：`identity-federation`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`credential`、`access` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
