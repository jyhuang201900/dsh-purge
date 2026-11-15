---
name: competition-bundle-sourcemap-recovery
description: 前端产物还原专项：恢复 sourcemap、chunk 加载器与隐藏的运行时结构
whenToUse: 拿到打包后的前端（webpack/vite）要找源码结构、隐藏接口或加密逻辑时加载
---

> 主题：前端打包与 sourcemap 还原（上游 `@dhicoc/dsh-reverse-skill` 的 CTF-Sandbox-Orchestrator 系列，MIT；已按本仓格式改写）

# Competition Bundle Sourcemap Recovery

Use this skill when runtime truth lives in built assets, source maps, chunk tables, or obfuscated loader flow rather than in checked-in source alone.

## Quick Start

1. Start from the served artifact set: entry HTML, build manifest, bootstrap bundle, chunk map, and source maps.
2. Record chunk ids, route chunks, loader functions, endpoint strings, and config keys before broad manual deobfuscation.
3. Reconstruct the smallest runtime graph that explains which asset executes now.
4. Keep served artifact truth separate from repository source unless parity is proven.
5. Reproduce the smallest asset-to-runtime boundary that proves the decisive behavior.

## Workflow

### 1. Map The Served Artifact Set

- Record entry HTML, script tags, preload hints, manifest files, asset map, chunk registry, and source map URLs.
- Note framework-specific artifacts such as route manifests, client reference manifests, or lazy-loader tables when present.
- Keep emitted filenames, hash suffixes, and route ownership tied together.

### 2. Reconstruct Runtime Structure

- Follow bootstrap code, chunk loaders, module registry, string decoders, and lazy import boundaries.
- Use source maps, manifest files, and stable symbol clusters to recover route names, API calls, feature flags, and hidden panels.
- Distinguish build-time intent from the bundle that is actively served now.

### 3. Reduce To The Decisive Bundle Path

- Compress the result to the smallest sequence: served asset -> loader path -> module or symbol -> runtime effect.
- State clearly whether the decisive weakness lives in manifest drift, chunk loading, hidden route code, string decoding, or stale source assumptions.
- If the task shifts from built assets to SSR or template enforcement, hand back to the tighter template-render skill.

## Read This Reference

- Load `references/bundle-sourcemap-recovery.md` for the artifact checklist, deobfuscation checklist, and evidence packaging.

## What To Preserve

- Served filenames, chunk ids, manifest entries, source map paths, recovered symbols, and endpoint strings
- The exact executing bundle or module that proves the runtime branch
- One minimal asset-to-runtime sequence that reaches the decisive effect

---

## 检查清单与常见坑（上游参考并入）

### bundle-sourcemap-recovery

###### Bundle And Sourcemap Recovery Checklist

###### First Pass

- Entry HTML, script tags, preload links, manifests, chunk registries, source map URLs
- Bootstrap bundle, lazy chunks, route chunks, loader helpers, string decoders
- Framework clues: route manifest, client reference manifest, build id, asset map

###### Chain To Reconstruct

1. Served asset selected
2. Bootstrap or loader resolves chunk or module
3. Module registry or source map reveals structure
4. Hidden route, API call, or branch is recovered
5. Runtime effect is reproduced from the emitted asset set

###### Evidence To Keep Together

- Asset side: filenames, hashes, chunk ids, manifest entries, source map path
- Recovery side: recovered symbol, route, endpoint, loader helper, or decoded string
- Effect side: rendered panel, hidden route, accepted request, or client behavior

###### Common Pitfalls

- Trusting repository source over the currently served artifact set
- Opening huge minified bundles before checking manifests and source maps
- Recovering names without proving which bundle path actually executes at runtime



## 检测视角（防守方在日志里看到什么）

| 动作 | 防守方看哪里 | 典型信号 |
| --- | --- | --- |
| 载荷混淆/加密 | AV/EDR 扫描日志 | 静态特征缺失但行为特征明显（加解密调用 + 内存执行） |
| 反射加载 / 内存执行 | Sysmon 1 / 7 | 进程镜像未签名、`ImageLoaded` 指向临时目录或无名段 |
| 脚本混淆（base64 / 加密） | 4688 命令行 / PowerShell 4104 | `-enc` 长串、`FromBase64String`、`IEX` 组合 |
| 加壳 / 改节区 | AV（文件信誉） | 熵值高 + 节区名异常（`.text` 变 `.data`、新增可执行段） |

**实用推论**：**判据是「静态特征失效但行为仍在」**：混淆只改变检出方式，不改变它要调的系统 API。所以防守方看行为链比看特征更稳 —— 这也是为什么免杀对抗永远打的是 EDR 不是 AV。

## ATT&CK 映射

> 本技能会执行的手法对应 MITRE ATT&CK v20.1 下列技术（编号来自 `lib/redteam/attack-map.js`，唯一来源）。

| 战术 | 编号 | 技术 |
| --- | --- | --- |
| 隐匿 | T1027 | 混淆文件或信息 |
| 隐匿 | T1140 | 去混淆/解码文件或信息 |
| 收集 | T1213 | 信息存储库数据 |

落到事实库时，把这几个编号写进 `attack_step` 的标题或 `detail`：报告与检测配对要靠它们对齐；
**没写编号的动作在「按 ATT&CK 复核」时等于不存在**（防守方按技术编号查日志，查不到就是漏）。

<!-- skill-link-graph:build-skill-graph.mjs 生成，勿手改 -->

## 链路位置（本技能不是孤岛：上游先做、下游交给谁、结果落哪个库）

- **阶段**：3 漏洞发现
- **互补**（同类场景一起用）：`competition-browser-persistence`、`competition-custom-protocol-replay`、`competition-file-parser-chain`
- **落库**（做完必须记进演练台，没落库的发现等于没发生）：`vuln` —— 用对应的 `redteam_*` 工具写入，带上原始请求/证据
- **收口必做**（打完不算完，要能证明）：命中判定走 `verification-discipline`（误报排除 + 修复五档判定）；打完之后要**补丁后复测**（补丁/修复后再打一遍，确认真的关掉了，而不是换个入口还能打）也走它；说清对手能不能发现走 `detection-pairing`（检测规则 + 响度）；战果归到哪个战术走 `attack-traceability`（ATT&CK 映射）。**出交付物用 `redteam_report`**（kind=score 出计分战报、kind=targets 出靶标清单），整条链路串起来看用 `redteam_attack_chain` / `redteam_attack_path` —— 这两个只在 `redteam-setup` 的工具表里登记过，做具体攻击时不会想到去翻，所以在这里点名

- **配套工具**（做完这步要落库/查询时用，别只记在上下文里）：`redteam_vuln_query`（按 severity/status/cve/cidr 组合筛，别在长列表里翻）

<!-- /skill-link-graph -->
