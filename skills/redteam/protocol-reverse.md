---
name: protocol-reverse
description: Use for authorized reverse engineering of custom binary protocols, Protobuf/gRPC, WebSocket frames, and PCAP-driven protocol recovery.
whenToUse: Use for authorized reverse engineering of custom binary protocols, Protobuf/gRPC, WebSocke
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Protocol Reverse Engineering

## 适用场景

- 自定义 TCP/UDP 二进制协议
- Protobuf / gRPC / FlatBuffers / MessagePack
- WebSocket / MQTT / 私有 RPC
- PCAP / PCAPNG 还原字段与状态机
- 客户端-服务端校验、序列号、加密帧头

## 不走本 skill

| 情况 | 去哪 |
|------|------|
| 仅 HTTP 参数签名 / JS 加密 | `js-reverse/` |
| 仅 TLS 证书问题 | `pentest-tools/` 或浏览器代理 |
| 固件内协议栈深挖 + 仿真 | `firmware-pentest/` 后再回本 skill |

## 工作流

### Phase 1 — 采集与分诊

```text
□ 拿到样本：PCAP / 代理导出 / 客户端日志 / 二进制
□ 标记方向：C→S / S→C；是否有握手、心跳、重连
□ 固定头？魔数？长度字段？TLV？定长？
□ 是否压缩（zlib/gzip/lz4）或加密（AES/ChaCha 帧内）
□ tshark -r cap.pcap -T fields -e frame.number -e ip.src -e tcp.payload
```

### Phase 2 — 帧布局还原

```text
□ 对齐多个同类消息，找不变字节 / 自增序列号
□ 长度字段：大端/小端、含头/不含头
□ 校验：CRC16/32、checksum、HMAC 位置
□ 画出状态机：Connect → Auth → Ready → Request/Response → Close
□ 工具：Wireshark 自定义 dissector 草稿 / ImHex / 010 Editor 模板 / Kaitai Struct
```

### Phase 3 — 序列化与加密

```text
□ Protobuf：.proto 恢复（blackboxprotobuf / pbtk / protoc --decode_raw）
□ gRPC：HTTP/2 headers + protobuf body
□ 加密：找密钥派生（客户端 so/dll/JS）→ 联合 ida-reverse / js-reverse / apk-reverse
□ 重放：仅在授权 scope 内；先无害字段再敏感操作
```

### Phase 4 — 产物

```text
MUST 产出：
- 消息类型表（name / opcode / fields）
- 至少 1 条可复现的解码命令或脚本
- Evidence：原始 hex 摘录 + 解码结果（脱敏）
```

## 工具链

| 工具 | 必需 | 用途 | 自举 |
|------|------|------|------|
| tshark / Wireshark | 强烈建议 | PCAP 解析 | 手动 / winget |
| Python3 | 是 | 解码脚本 | 系统 |
| blackboxprotobuf | 可选 | 未知 protobuf | pip |
| ImHex / 010 | 可选 | 结构模板 | 手动 |
| IDA / r2 / Ghidra | 按需 | 客户端序列化函数 | 见对应 skill |

## 参考

- `references/protocol-workflow.md` — 帧布局与 Protobuf 速查
- 相关：`../ida-reverse/` `../js-reverse/` `../firmware-pentest/` `../pentest-tools/`

## 路由上下文

**上游**: `MASTER-ROUTING` R21 · `routing.md`  
**下游**: 需客户端算法 → `ida-reverse`/`js-reverse`；需利用重放 → `pentest-tools`/`api-security`  
**同级**: `malware-analysis`（C2 协议）、`digital-forensics`（流量取证）

## 任务完成自检

- [ ] 是否还原了消息布局或状态机（而非只贴 hex）？
- [ ] 是否有可复现解码命令？
- [ ] 是否遵守 scope / 脱敏？
- [ ] 是否回写 落地记录 / 报告 Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `tshark` | ✓ 已装 |
| `wireshark` | ✓ 已装 |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `r2` | ❌ 未装（用前先装，或改用等价工具） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`ghidra`、`pip`
- `ghidra`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建
- `pip`：用 `python -m pip` 代替裸 `pip`

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`ida-reverse`、`patch-diff-exploit`、`pwn-chain`、`radare2`

2. **前提没满足就先回去**：`reverse-engineering`、`thick-client` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

4. **目标比预期更深**：换到同主题的专项靶子面 `competition-custom-protocol-replay`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`reverse-engineering`
- **下游**（产出交给谁）：`competition-custom-protocol-replay`
- **专项下游**（同主题更深的靶子面）：`competition-custom-protocol-replay`
- **互补**（同类场景一起用）：`ida-reverse`、`patch-diff-exploit`、`pwn-chain`、`radare2`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名


<!-- /skill-link-graph -->
