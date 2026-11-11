---
name: ot-ics
description: Use for authorized OT/ICS security assessment covering Purdue model zoning, PLC/SCADA exposure, industrial protocol discovery, and safe passive-first evaluation.
whenToUse: Use for authorized OT/ICS security assessment covering Purdue model zoning, PLC/SCADA expo
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# OT / ICS Security

## 适用场景

- 工控/SCADA/DCS 安全评估（授权）
- Purdue 模型分区与跨区通道
- Modbus/DNP3/S7/EtherNet/IP 等协议暴露
- 工程师站、HMI、历史库、跳板主机
- IT/OT 融合边界（防火墙规则、单向闸）

## 安全铁律（MUST）

```text
MUST NOT 在未明确允许时：
- 对 PLC 写线圈/寄存器
- 全网高速率扫描生产 OT
- 中断安全仪表系统（SIS）相关路径
优先：只读识别、流量镜像、离线固件/配置分析
```

## 工作流

### Phase 1 — 分区与资产

```text
□ Purdue L0–L5 草图：现场设备 → 控制 → 监督 → 站点 DMZ → 企业
□ 资产清单：PLC/RTU/HMI/工程师站/历史库/Jump host
□ 协议与端口基线（仅授权网段）
```

### Phase 2 — 被动与只读

```text
□ SPAN/镜像 PCAP → protocol-reverse / Wireshark 工控解析器
□ 配置与工程文件离线审计（TIA/RSLogix 导出等）
□ 默认口令与明文协议（Modbus 无认证）记录为 Finding，不写盘改值
```

### Phase 3 — 受限主动（仅授权）

```text
□ 低速识别，维护窗口
□ 只读功能码优先
□ 每步 Evidence；异常立即停止并通报
```

### Phase 4 — 固件/补丁面

```text
□ 控制器固件版本 → CVE 映射（不盲刷固件）
□ 联合 firmware-pentest 做离线镜像分析
```

## 工具链

| 工具 | 用途 | 注意 |
|------|------|------|
| Wireshark 工控 dissectors | 被动解析 | 镜像流量 |
| Nmap NSE（受限） | 识别 | 速率与时间窗 |
| Claroty/Nozomi 等 | 资产发现 | 商业/现场 |
| PLC 厂商工程软件 | 配置审计 | 离线优先 |
| binwalk / Ghidra | 固件 | 离线 |

## 参考

- `references/ot-safe-assessment.md`
- `../firmware-pentest/` `../protocol-reverse/` `../network` via pentest-tools

## 路由上下文

**上游**: MASTER R28  
**下游**: 固件深挖 `firmware-pentest`；协议 `protocol-reverse`；IT 横向 `windows-ad`/`attack-chain`  
**同级**: 不要用普通 Web 扫默认参数打 OT

## 任务完成自检

- [ ] 是否默认被动/只读并记录授权边界？
- [ ] 是否避免对控制回路写操作（除非明确允许）？
- [ ] Finding 是否含物理/过程影响说明？
- [ ] Checklist / journal？

## 本机工具实况（自动探测，非猜测）

| 工具 | 状态 |
| --- | --- |
| `wireshark` | ✓ 已装 |
| `nmap` | ❌ 未装（用前先装，或改用等价工具） |
| `binwalk` | ❌ 未装（用前先装，或改用等价工具） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`hardware-security`、`radio-sdr`、`wifi-wireless`

2. **前提没满足就先回去**：`fscan-intranet` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`fscan-intranet`
- **下游**（产出交给谁）：`iot-iiot-netdev`、`competition-kernel-container-escape`
- **互补**（同类场景一起用）：`hardware-security`、`radio-sdr`、`wifi-wireless`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->

<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`ghidra`、`binwalk`
- `ghidra`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `binwalk`：`python -m pip install binwalk`（新版是 python 包）

runnability:end -->
