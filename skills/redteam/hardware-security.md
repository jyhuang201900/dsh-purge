---
name: hardware-security
description: Use for authorized hardware and embedded interface security research including UART/JTAG discovery, debug pad triage, secure boot overview, and offline firmware extraction support.
whenToUse: Use for authorized hardware and embedded interface security research including UART/JTAG d
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---
# hardware-security

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

## 本机工具实况（自动探测，非猜测）

| 工具 | 状态 |
| --- | --- |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `binwalk` | ❌ 未装（用前先装，或改用等价工具） |

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`firmware-pentest`
- **下游**（产出交给谁）：`radio-sdr`
- **互补**（同类场景一起用）：`fscan-intranet`、`gogo-intranet`、`identity-federation`、`lateral-movement`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

