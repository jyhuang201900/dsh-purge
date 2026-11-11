---
name: identity-federation
description: Use for authorized assessment of federated identity systems including SAML, OIDC, OAuth2 flows, SSO misconfiguration, and token confusion issues.
whenToUse: Use for authorized assessment of federated identity systems including SAML, OIDC, OAuth2 f
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Identity Federation (SAML / OIDC / OAuth)

## 适用场景

- SAML Response 签名/断言篡改面（经典缺陷模式）
- OIDC 隐式/授权码 + PKCE 缺失
- redirect_uri / state / nonce 问题
- IdP 与 SP 元数据、多租户 issuer 混淆
- 与 `api-security` JWT 攻击互补（本 skill 偏联邦与 SSO 流）

## 工作流

```text
□ 画清：User → SP → IdP → Token → SP
□ 收集：/.well-known/openid-configuration、SAML metadata
□ 检查：redirect_uri 精确匹配、state 绑定、PKCE
□ 检查：SAML 签名覆盖范围、algorithm 降级
□ 会话固定与登出失效
```

## 工具链

| 工具 | 用途 |
|------|------|
| Burp + SAML Raider 等 | 断言编辑（授权） |
| jwt_tool | JWT 段 |
| 浏览器 DevTools | 重定向链 |
| IdP 管理日志 | 审计 |

## 参考

- `references/sso-flow-checklist.md`
- `../api-security/` `../windows-ad/`（企业 IdP）

## 路由上下文

**上游**: MASTER R37  
**下游**: 纯 API JWT → api-security；云 IdP → cloud-k8s

## 任务完成自检

- [ ] 是否映射完整 SSO 流？
- [ ] 每个 Finding 是否有复现与影响？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `burp` | ❌ 未装（用前先装，或改用等价工具） |



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`windows-ad`

2. **前提没满足就先回去**：`windows-ad`、`lateral-movement` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-oauth-oidc-chain`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`windows-ad`
- **下游**（产出交给谁）：`cloud-k8s`、`competition-oauth-oidc-chain`
- **专项下游**（同主题更深的靶子面）：`competition-oauth-oidc-chain`
- **互补**（同类场景一起用）：`windows-ad`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`credential`、`access` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据

<!-- /skill-link-graph -->
