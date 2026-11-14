---
name: browser-extension-reverse
description: Use for authorized reverse engineering of browser extensions (Chrome/Firefox) including manifest analysis, background workers, and extension-based credential or traffic logic recovery.
whenToUse: Use for authorized reverse engineering of browser extensions (Chrome/Firefox) including ma
source: dsh-jailbreak-arsenal@1.7.0 bundled_skills（已按本仓格式改写，非照抄）
---

# Browser Extension Reverse Engineering

## 适用场景

- Chrome/Edge MV2/MV3 扩展分析
- Firefox 扩展
- 恶意扩展 IOC、供应链扩展投毒调查
- 扩展实现的签名/加密/代理逻辑还原

## 工作流

### 1. 包体

```text
□ crx 解压 / 从 profile 取扩展目录
□ manifest.json：permissions、host_permissions、background、content_scripts
□ 评估过度权限（<all_urls>、webRequest、debugger）
```

### 2. 逻辑

```text
□ service_worker / background 入口
□ content_script 注入点与世界（isolated）
□ chrome.storage / IndexedDB 密钥
□ 与 `js-reverse` 相同：Observe 网络与消息传递（runtime.sendMessage）
```

### 3. 动态

```text
□ 开发者模式加载解压目录
□ chrome://extensions 检查错误
□ DevTools 附加 service worker
□ 必要时 Frida/浏览器 CDP（jshookmcp）
```

## 工具链

| 工具 | 用途 |
|------|------|
| 解压/jq | manifest |
| Chrome DevTools | worker 调试 |
| js-reverse 工具链 | 深度 JS |
| YARA | 恶意扩展规则 |

## 参考

- `references/extension-analysis.md`
- 落地记录 扩展恢复相关条目
- `../js-reverse/` `../malware-analysis/`

## 路由上下文

**上游**: MASTER R30  
**下游**: 复杂混淆 JS → `js-reverse`；投毒调查 → supply-chain / malware

## 任务完成自检

- [ ] 是否列出权限面与入口脚本？
- [ ] 是否还原关键数据流？
- [ ] Checklist？

## 本机工具实况（导入时快照；当前真值用 `npm run toolkit:check` 或 `node scripts/sync-tool-status.mjs` 复核——表会过期，命令不会）

| 工具 | 状态 |
| --- | --- |
| `frida` | ❌ 未装（用前先装，或改用等价工具） |



<!-- runnability:start scripts/inject-runnability.mjs 生成，勿手改 -->

## 本机可执行性（自动探测；命令是按 Linux/Kali 写的，照抄会撞空）

本技能命令用到的工具里，本机（PATH 与 toolkit 双探）没有：`frida`
- `frida`：`python -m pip install frida-tools`

runnability:end -->

<!-- second-shot:start scripts/inject-second-shot.mjs 生成，勿手改 -->

## 第二发（主力打不出去时，按这个顺序换）

1. **同类替代**（链路里的互补技能，手法最接近）：`js-reverse`、`thick-client`

2. **前提没满足就先回去**：`js-reverse` —— 上一环没做实，本环再试也是空打

3. **无回显 / 被拦**：先用 `oob-verification` 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 `waf-bypass`

**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。

second-shot:end -->

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：4 漏洞利用｜**角色**：`exploit`
- **上游**（先做完这些再进来）：`js-reverse`
- **下游**（产出交给谁）：`thick-client`
- **互补**（同类场景一起用）：`js-reverse`、`thick-client`
- **落库**：本技能不直接产出可落库实体；产出交给下游技能记进演练台
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名


<!-- /skill-link-graph -->
