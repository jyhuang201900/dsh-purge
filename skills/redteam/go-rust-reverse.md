---
name: go-rust-reverse
description: Use for reverse engineering stripped Go and Rust binaries including runtime recognition, pclntab/moduel data recovery, panic strings, and idiomatic decompilation recovery.
whenToUse: Use for reverse engineering stripped Go and Rust binaries including runtime recognition, p
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---
# go-rust-reverse

# Go / Rust Binary Reverse Engineering

## 适用场景

- 剥离符号的 Go 恶意软件/工具
- Rust 发行二进制、panic 字符串驱动分析
- 与通用 ida/ghidra 互补的语言专用方法

## 工作流

### Go

```text
□ 识别 go.buildid、runtime 符号残留、pclntab
□ GoReSym / redress / IDA Go 插件恢复函数名
□ 注意 interface、slice、string 结构在反编译中的形态
□ 网络/加密库路径：crypto/* net/http
```

### Rust

```text
□ panic 字符串、rust_begin_unwind、crate 路径暗示
□ 范型实例化导致的代码膨胀；先定位字符串 xref
□ 异步/tokio 状态机需结合交叉引用
```

### 动态

```text
□ 仍可用 Frida；注意 Go 栈与调度
□ 优先日志与配置字符串驱动断点
```

## 工具链

| 工具 | 用途 |
|------|------|
| GoReSym | Go 元数据 |
| IDA/Ghidra + Go/Rust 插件 | 反编译 |
| radare2 | 快速字符串 |
| strings / rabin2 | 分诊 |

## 参考

- `references/go-rust-notes.md`
- `../reverse-engineering/go-reverse.md` `../ida-reverse/` `../ghidra-reverse/`
- seed: `落地记录/seed-002_go-malware-stripped.md`

## 路由上下文

**上游**: MASTER R33  
**下游**: 恶意样本流程 `malware-analysis`；通用 RE `reverse-engineering`

## 任务完成自检

- [ ] 是否恢复关键函数名或等价映射？
- [ ] 是否标注语言运行时证据？
- [ ] Checklist？

## 本机工具实况（自动探测，非猜测）

| 工具 | 状态 |
| --- | --- |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `frida` | ❌ 未装（用前先装，或改用等价工具） |
| `radare2` | ❌ 未装（用前先装，或改用等价工具） |
| `strings` | ❌ 未装（用前先装，或改用等价工具） |

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **互补**（同类场景一起用）：`frp-tunnel`、`ghidra-reverse`、`ida-reverse`、`iot-iiot-netdev`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

