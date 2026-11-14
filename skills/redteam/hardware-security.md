---
name: hardware-security
description: Use for authorized hardware and embedded interface security research including UART/JTAG discovery, debug pad triage, secure boot overview, and offline firmware extraction support.
whenToUse: Use for authorized hardware and embedded interface security research including UART/JTAG d
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Hardware / Embedded Interface Security

## 适用场景

- UART / JTAG / SWD 调试口发现
- 启动日志、root shell、引导打断
- 配合拆机提取 Flash
- 安全启动/加密 Flash 的可行性评估（非破坏性优先）

## 工作流

```text
□ 拆解授权设备；拍照标注测试点
□ 万用表找 GND/VCC/TX/RX；逻辑电平 1.8/3.3/5V
□ USB-TTL 只读日志；记录波特率
□ JTAG：枚举 IDCODE；评估是否锁定
□ 提取镜像 → 交接 firmware-pentest / ghidra
```

## 工具链

| 工具 | 用途 |
|------|------|
| USB-TTL / logic analyzer | UART |
| J-Link / CMSIS-DAP | 调试 |
| bus pirate / flipper（实验室） | 多协议 |
| binwalk / flashrom | 提取 |

## 参考

- `references/debug-interface-triage.md`
- `../firmware-pentest/` `../ot-ics/`

## 路由上下文

**上游**: MASTER R34  
**MUST NOT**: 未授权拆机/损坏他人设备

## 任务完成自检

- [ ] 是否记录接口电平与引脚图？
- [ ] 镜像是否哈希保全？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `binwalk` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`ghidra`、`binwalk`
- `ghidra`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `binwalk`：`python -m pip install binwalk`（新版是 python 包）

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`ot-ics`、`radio-sdr`

2. **前提没满足就先回去**：`firmware-pentest` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`firmware-pentest`
- **下游**（产出交给谁）：`radio-sdr`
- **互补**（同类场景一起用）：`ot-ics`、`radio-sdr`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）

<!-- /skill-link-graph -->
