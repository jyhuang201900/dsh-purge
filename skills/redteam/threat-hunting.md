---
name: threat-hunting
description: Use for blue-team threat hunting, detection engineering with Sigma/YARA, SIEM query design, and incident detection validation.
whenToUse: Use for blue-team threat hunting, detection engineering with Sigma/YARA, SIEM query design
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Threat Hunting & Detection Engineering

## 适用场景

- 威胁狩猎（hypothesis-driven）
- Sigma / YARA 检测工程
- 告警调优、误报分析
- 与 `malware-analysis/`：样本侧 IOC → 本 skill 落地检测
- 与 `digital-forensics/`：案件伪影 → 横向狩猎

## 工作流

### 1. 建假说

```text
例：攻击者用 living-off-the-land 做横向
→ 数据源：Sysmon 1/3/10、Windows Security 4624/4648
→ 成功标准：发现异常父进程或罕见账户日志源
```

### 2. 查询与堆叠

```text
□ 基线：正常管理员行为时段与主机
□ 异常：新服务、编码 PowerShell、异常出站
□ 关联：同账号多主机短时登录
```

### 3. 规则化

```yaml
# Sigma 骨架见 malware-analysis；本 skill 强调：
# - 误报面
# - 数据源字段映射
# - 响应 playbook 链接
```

### 4. 验证

```text
□ 原子测试（Atomic Red Team）仅在授权实验室
□ 回放历史日志验证召回
```

## 工具链

| 工具 | 用途 |
|------|------|
| Sigma CLI / sigmac | 规则转换 |
| YARA | 文件/内存 |
| SIEM（ELK/Splunk 等） | 查询 |
| osquery | 端点狩猎 |
| Atomic Red Team | 检测验证（实验室） |

## 参考

- `references/hunting-loop.md`
- `../malware-analysis/references/yara-sigma-rules.md`
- `../digital-forensics/`

## 路由上下文

**上游**: MASTER R27  
**下游**: 确认入侵 → forensics；恶意样本 → malware-analysis  
**MUST NOT**: 在无授权生产环境跑攻击模拟

## 任务完成自检

- [ ] 是否有明确假说与结论？
- [ ] 规则是否注明误报与数据源？
- [ ] Checklist？

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`edr-bypass-re`

2. **前提没满足就先回去**：`edr-bypass-re` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`yara`
- `yara`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`edr-bypass-re`
- **下游**（产出交给谁）：`digital-forensics`
- **互补**（同类场景一起用）：`edr-bypass-re`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->
