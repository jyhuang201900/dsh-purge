---
name: go-rust-reverse
description: Use for reverse engineering stripped Go and Rust binaries including runtime recognition, pclntab/moduel data recovery, panic strings, and idiomatic decompilation recovery.
whenToUse: Use for reverse engineering stripped Go and Rust binaries including runtime recognition, p
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

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

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `frida` | ❌ 未装（用前先装，或改用等价工具） |
| `radare2` | ✓ 已装（toolkit 内，非 PATH） |
| `strings` | ✓ 已装 |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`frida`、`ghidra`
- `frida`：`python -m pip install frida-tools`
- `ghidra`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`dotnet-reverse`、`ghidra-reverse`、`ida-reverse`、`patch-diff-exploit`

2. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **互补**（同类场景一起用）：`dotnet-reverse`、`ghidra-reverse`、`ida-reverse`、`patch-diff-exploit`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名


<!-- /skill-link-graph -->
