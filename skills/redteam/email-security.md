---
name: email-security
description: Use for authorized email security review including phishing analysis, header authentication (SPF/DKIM/DMARC), BEC patterns, and mailbox token abuse research.
whenToUse: Use for authorized email security review including phishing analysis, header authenticatio
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Email Security & Phishing Analysis

## 适用场景

- 钓鱼邮件拆解与 IOC
- SPF/DKIM/DMARC 配置评估
- BEC 商务邮件欺诈模式
- OAuth 应用钓鱼 / 邮箱令牌滥用（联合 llm/cloud 身份）
- 安全意识演练设计（授权）

## 工作流

```text
□ 完整原始头：Received 链、From/Return-Path 一致性
□ SPF/DKIM/DMARC 对齐结果
□ URL 沙箱与附件静态（联合 malware-analysis）
□ 仿冒品牌与回复地址差异
□ 租户：反钓鱼策略、外部标记、MFA、OAuth app 同意
```

## 工具链

| 工具 | 用途 |
|------|------|
| 邮件客户端「查看源」 | 头 |
| dig/nslookup | SPF/DMARC 记录 |
| urlscan / 沙箱 | 链接与附件 |
| 租户管理中心 | 策略 |

## 参考

- `references/email-auth-checklist.md`
- `../malware-analysis/` `../attack-chain/`（钓鱼阶段） `../windows-ad/`（令牌）

## 路由上下文

**上游**: MASTER R36  
**MUST NOT**: 未授权对第三方域群发测试钓鱼

## 任务完成自检

- [ ] 头认证结论是否完整？
- [ ] IOC 是否可检测化（联合 threat-hunting）？
- [ ] Checklist？



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`code-audit`、`database-security`、`llm-security`、`supply-chain-security`

2. **前提没满足就先回去**：`recon-pipeline` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现｜**角色**：`vuln-scan`
- **上游**（先做完这些再进来）：`recon-pipeline`
- **下游**（产出交给谁）：`credential-attack`
- **互补**（同类场景一起用）：`code-audit`、`database-security`、`llm-security`、`supply-chain-security`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
