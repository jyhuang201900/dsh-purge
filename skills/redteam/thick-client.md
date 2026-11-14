---
name: thick-client
description: Use for authorized security testing of desktop thick clients including local storage, update channels, IPC, traffic, and client-side trust boundaries.
whenToUse: Use for authorized security testing of desktop thick clients including local storage, upda
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Thick Client Security Testing

## 适用场景

- C/S 架构客户端、Electron/Qt/.NET WinForms/WPF
- 本地配置/凭证存储、IPC、命名管道
- 客户端强制校验绕过研究（授权）
- 自动更新通道与代码签名验证

## 工作流

### 1. 建边界

```text
□ 进程树、子进程、驱动/服务
□ 监听端口与出站域名
□ 本地敏感路径：%APPDATA%、Keychain、注册表
```

### 2. 本地攻击面

```text
□ 明文配置、硬编码密钥、调试开关
□ DLL 劫持/搜索顺序（Windows）
□ 数据库文件（SQLite）权限与加密
□ IPC：谁可连接？是否鉴权？
```

### 3. 网络面

```text
□ 系统代理 / 应用自定义 TLS
□ 证书钉扎 → 联合 mobile/js 方法学或 Frida
□ API 越权：客户端隐藏的管理接口
```

### 4. 逆向验证

```text
□ .NET → dotnet-reverse；原生 → ida/ghidra；Electron → asar + js-reverse
```

## 工具链

| 工具 | 用途 |
|------|------|
| Process Monitor / API Monitor | 行为 |
| Burp / mitmproxy | 流量 |
| dnSpy / IDA / Ghidra | 逆向 |
| Sysinternals | Windows 面 |
| asar / nexe 检测 | Electron |

## 参考

- `references/thick-client-checklist.md`
- `../dotnet-reverse/` `../ida-reverse/` `../js-reverse/` `../api-security/`

## 路由上下文

**上游**: MASTER R32  
**下游**: 纯协议 `protocol-reverse`；供应链更新 `supply-chain-security`

## 任务完成自检

- [ ] 是否画出信任边界？
- [ ] 本地+网络面是否都覆盖？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `frida` | ❌ 未装（用前先装，或改用等价工具） |
| `ida` | ❌ 未装（用前先装，或改用等价工具） |
| `ghidra` | ❌ 未装（用前先装，或改用等价工具） |
| `burp` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`frida`、`ghidra`
- `frida`：`python -m pip install frida-tools`
- `ghidra`：本机无、也无已验证替代——先确认它是否必要，必要时找官方 Windows 构建

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`browser-extension-reverse`、`js-reverse`

2. **前提没满足就先回去**：`browser-extension-reverse`、`dotnet-reverse`、`js-reverse` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`dotnet-reverse`、`js-reverse`
- **下游**（产出交给谁）：`protocol-reverse`
- **互补**（同类场景一起用）：`browser-extension-reverse`、`js-reverse`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名


<!-- /skill-link-graph -->
