---
name: ghidra-reverse
description: Use for free/open reverse engineering with Ghidra (headless or GUI), including decompile, cross-refs, and optional Ghidra MCP workflows when IDA is unavailable.
whenToUse: Use for free/open reverse engineering with Ghidra (headless or GUI), including decompile, 
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Ghidra Reverse Engineering

## 适用场景

- 无 IDA 许可证时的主逆向入口
- 批量 headless 分析 / CI 中反编译
- Ghidra 脚本（Java/Python Jython/PyGhidra）自动化
- 与 `binary-diff` / `patch-diff-exploit` 的 ghidriff 联动

## 与 IDA 分工

| 需求 | 优先 |
|------|------|
| 已有 IDA MCP 深挖 | `ida-reverse/` |
| 开源 / 批量 / 教学 | **本 skill** |
| 仅 CLI 快速侦察 | `radare2/` |

## 工作流

### 1. 项目与自动分析

```text
□ 新建 Project → Import 文件 → Analyze（默认分析器）
□ 记录语言/编译器识别结果与基址
□ 标记入口、导出表、字符串 xref
```

### 2. 关键函数

```text
□ 从字符串 / 导入 API 反查
□ Decompile 窗口还原算法
□ 重命名函数/变量；写 Plate comment
□ 需要动态时交接 Frida/GDB（reverse-engineering 动态章）
```

### 3. Headless（批量）

```bash
# 示例：analyzeHeadless 路径因安装而异，MUST 从 工具索引 取
analyzeHeadless /path/to/project Proj -import sample.bin -postScript ExportDecomp.py
```

### 4. MCP（若已配置）

```text
□ 确认 ghidra MCP 端口（常见 8765，以 工具索引 为准）
□ 用 MCP 工具拉反编译 / xrefs，禁止猜端口
```

## 工具链

| 工具 | 用途 | 自举 |
|------|------|------|
| Ghidra | 反编译主工具 | 手动 release / 包管理器 |
| ghidra-mcp | AI 桥 | （本机未装） 能力名 `ghidra-mcp` |
| ghidriff | 补丁差分 | 见 `patch-diff-exploit` |

## 参考

- `references/ghidra-cheatsheet.md`
- `../ida-reverse/` `../radare2/` `../binary-diff/`

## 路由上下文

**上游**: MASTER R22  
**下游**: 动态验证 → Frida/GDB；利用 → `pwn-chain`  
**同级**: `ida-reverse`（商业深挖）

## 任务完成自检

- [ ] 是否基于真实 Ghidra/工具索引 路径？
- [ ] 是否标注函数地址与重命名？
- [ ] 是否有可复现步骤？
- [ ] Checklist / journal？

## 本机工具实况（自动探测，非猜测）

| 工具 | 状态 |
| --- | --- |
| `exportdecomp` | ❌ 未装（用前先装，或改用等价工具） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `radare2` | ❌ 未装（用前先装，或改用等价工具） |
| `frida` | ❌ 未装（用前先装，或改用等价工具） |



<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`binary-diff`、`dotnet-reverse`、`go-rust-reverse`、`ida-reverse`

2. **前提没满足就先回去**：`reverse-engineering` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`reverse-engineering`
- **下游**（产出交给谁）：`patch-diff-exploit`
- **互补**（同类场景一起用）：`binary-diff`、`dotnet-reverse`、`go-rust-reverse`、`ida-reverse`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台

<!-- /skill-link-graph -->
