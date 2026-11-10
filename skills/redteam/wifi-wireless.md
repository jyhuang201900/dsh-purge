---
name: wifi-wireless
description: Use for authorized wireless security assessment including Wi-Fi capture, WPA handshake analysis, rogue AP detection research, and lab-only deauth testing.
whenToUse: Use for authorized wireless security assessment including Wi-Fi capture, WPA handshake ana
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---
# wifi-wireless

# Wi-Fi / Wireless Security

## 适用场景

- 授权 Wi-Fi 安全评估
- WPA/WPA2 握手采集与离线评估
- 流氓 AP / 钓鱼热点检测研究
- 企业无线隔离与门户安全

## 工作流

```text
□ iwconfig / airmon-ng 进入 monitor（合法环境）
□ airodump-ng 锁定目标 BSSID 频道
□ 握手或 PMKID 采集（仅目标）
□ hashcat/aircrack 离线评估口令策略
□ 报告：加密类型、隔离、门户绕过、建议
```

## 工具链

| 工具 | 用途 |
|------|------|
| aircrack-ng suite | 采集/评估 |
| hcxdumptool / hcxtools | PMKID |
| hashcat | 口令评估 |
| Wireshark | 管理帧分析 |

## 参考

- `references/wireless-lab-rules.md`
- `../pentest-tools/` `../attack-chain/`（近源章节）

## 路由上下文

**上游**: MASTER R29  
**MUST NOT**: 未授权 deauth、对非目标客户网络操作

## 任务完成自检

- [ ] 是否严格锁定目标 BSSID？
- [ ] 是否在报告中给出加固建议？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `hashcat` | ❌ 未装（用前先装，或改用等价工具） |
| `aircrack-ng` | ❌ 未装（用前先装，或改用等价工具） |
| `wireshark` | ✓ 已装 |

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：5 内网渗透｜**角色**：`internal`
- **上游**（先做完这些再进来）：`recon-pipeline`
- **下游**（产出交给谁）：`netexec-scan`
- **专项下游**（同主题更深的靶子面）：`competition-pcap-protocol`
- **互补**（同类场景一起用）：`radio-sdr`、`threat-hunting`、`windows-ad`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

