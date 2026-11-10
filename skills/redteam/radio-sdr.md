---
name: radio-sdr
description: Use for authorized RF/SDR security research including signal identification, replay feasibility study in shielded labs, and wireless protocol analysis outside classic Wi-Fi.
whenToUse: Use for authorized RF/SDR security research including signal identification, replay feasib
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# RF / SDR Security Research

## 适用场景

- 无线遥控/传感器等非 Wi-Fi RF（授权）
- ADS-B/遥控等协议研究（合法接收）
- 与 wifi-wireless 分工：本 skill 偏 **SDR 通用 RF**；Wi-Fi 攻防走 R29

## 工作流

```text
□ 法规与许可确认
□ 只收：识别中心频率与调制
□ GNU Radio / URH 分析
□ 重放仅屏蔽室且书面允许
□ 结论侧重：是否可未授权控制 / 加固建议
```

## 工具链

| 工具 | 用途 |
|------|------|
| RTL-SDR / HackRF（合规） | 收发硬件 |
| URH / GNU Radio | 分析 |
| Inspectrum | 信号 |

## 参考

- `references/sdr-lab-rules.md`
- `../wifi-wireless/` `../ot-ics/` `../hardware-security/`

## 路由上下文

**上游**: MASTER R38  
**MUST NOT**: 干扰公共通信、未授权发射

## 任务完成自检

- [ ] 是否默认只收并记录法规边界？
- [ ] Checklist？



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`hardware-security`、`ot-ics`、`wifi-wireless`

2. **前提没满足就先回去**：`hardware-security` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`hardware-security`
- **互补**（同类场景一起用）：`hardware-security`、`ot-ics`、`wifi-wireless`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->
