# Graph Report - dsh-purge  (2026-11-11)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2645 nodes · 6561 edges · 101 communities (96 shown, 5 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 241 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3b6de7e2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ctf-sandbox-orchestrator（流程/编排 / flow）
- update.js
- rules.js
- uninstall.js
- core.js
- store-core.js
- skills.js
- lib/index.js
- client.js
- RedteamStore
- rewind.js
- findDshHome
- identity.js
- extract-asar.js
- redteam/client.js
- check-package.mjs
- restart-desktop.js
- net-scope.js
- check-anchors.mjs
- desktop.js
- ui.js
- dsh-purge.js
- RewindButton
- scripts
- build-skill-graph.mjs
- reapply.js
- ref_node_process
- tools.js
- tools-smoke.mjs
- continue-retry.js
- applyPatches
- PurgeDock
- official-update.js
- verify.mjs
- platform-config.js
- inject-second-shot.mjs
- revertAll
- package.json
- .openEngagement
- .scoreReport
- skill-availability.js
- ref_node_fs
- graph-audit.mjs
- report.mjs
- README.md（中文主文档）
- steps
- hide-console.js
- check-tools.mjs
- model-tools.js
- restartOfficialHarness
- findDesktopAppExecutable
- write-smoke.mjs
- .kb
- asLf
- PurgifySection
- targetFiles
- host-sync.mjs
- redteam-setup.sh
- apiJson
- child-process-hide.mjs
- check-skill-runnable.mjs
- graphify-sync.mjs
- inject-runnability.mjs
- check-locale.mjs
- role-section.js
- anchor-gate.mjs
- build-locale.mjs
- scope.js
- market-sweep.mjs
- toolkit-windows.mjs
- 注入方式改造方案-1.1.34化.md（注入前置）
- table-read.js
- check-manifest.mjs
- installIdentityOverride
- build-client.mjs
- scenario-drill.mjs
- settings.js
- audit-skills.mjs
- host.js
- emptyDisposableFoldedYaml
- apply
- .dirOf
- install
- ref_node_path
- export-engagement-report.mjs
- 模型工具契约表：lib/model-tools.js 一处定义，宿主 ctx.tools 与 MCP 共用（8 个工具）
- alignSummary
- check-upstream.mjs
- .promptsDirOf
- surface.js
- embed-default-prompt.mjs
- web.js
- exports
- store.js
- isInsideDesktopInstall
- mnemon-settings.js
- RewindSafe
- RtBoundary
- drill-grant.js
- ContinueSafe
- repository

## God Nodes (most connected - your core abstractions)
1. `RedteamStore` - 115 edges
2. `ctf-sandbox-orchestrator（流程/编排 / flow）` - 46 edges
3. `default-prompt-inject.md（当前生效的注入正文）` - 42 edges
4. `角色 攻击面专项（由 ctf-sandbox-orchestrator 路由）（41 个技能）` - 41 edges
5. `findDshHome()` - 39 edges
6. `nowIso()` - 35 edges
7. `scripts` - 34 edges
8. `README.md（中文主文档）` - 31 edges
9. `release-notes.md（1.1.72 → 1.1.83 演化史）` - 31 edges
10. `角色 漏洞利用（30 个技能）` - 30 edges

## Surprising Connections (you probably didn't know these)
- `#82 教训：打包注释 //#region 不能当锚点第二行` --semantically_similar_to--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED] [semantically similar]
  lib/core.js → docs/适配-0.2.1-rc.2-差异分析.md
- `settings.png（1064×1972，补丁页截图）` --references--> `applyPatches()`  [AMBIGUOUS]
  docs/preview/settings.png → lib/core.js
- `ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）` --semantically_similar_to--> `进攻条令 — ATTACK DOCTRINE（输出即火力）`  [INFERRED] [semantically similar]
  docs/v1.1.34-prompt-inject.md → lib/default-prompt-inject.md
- `双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）` --references--> `default-prompt-inject.en.md（英文版注入正文）`  [INFERRED]
  scripts/check-locale.mjs → lib/default-prompt-inject.en.md
- `宿主重置后的补丁判失与 applied stamp 自愈` --conceptually_related_to--> `装梁神导致 pnpm 把安装副本覆盖回 1.1.72`  [INFERRED]
  lib/reapply.js → .workbuddy-ai/memory/2026-10-22.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **「装上了」到「生效」的三道关：解包 asar → 写补丁 → 重启（web / desktop / uninstall 三条重启路径）** — docs_update_framework_asar_seal, docs_update_framework_restart_ladder, lib_restart_desktop, lib_restart_web, lib_uninstall_restart [EXTRACTED 1.00]
- **提示词（扳机）→ 32 个红队技能（弹药）的意图路由表** — lib_default_prompt_inject_attack_doctrine, lib_default_prompt_inject_five_phase_spine, lib_default_prompt_inject_firepower_ladder [EXTRACTED 1.00]
- **宿主升级适配链：双重锚点比对 → 3 条改锚 → #32/#53 删除 → {{cwd}} 值层崩溃 → #40 移除** — docs_adapt_0_2_1_rc_2_anchor_grounding, docs_adapt_0_2_1_rc_2_broken_three, docs_adapt_0_2_1_rc_2_dead_patch_40 [EXTRACTED 1.00]
- **宿主自更新抗断链：wscript 写 marker → index 读 → reapply 回写 → 清 prev 目录** — docs_update_framework_marker, docs_update_framework_reapply_heal, lib_index, lib_reapply [EXTRACTED 1.00]
- **内网先 gogo 铺面、再 fscan 打点** — skills_redteam_gogo_intranet, skills_redteam_fscan_intranet, skills_redteam_active_scan [EXTRACTED 1.00]
- **内网隧道三选一分工（suo5 / chisel / frp）** — skills_redteam_suo5_tunnel, skills_redteam_chisel_tunnel, skills_redteam_frp_tunnel [EXTRACTED 1.00]
- **文案链：locale/*.json（源）→ build-locale（内联）→ client.js（运行时）→ check-locale 双向守（中英一致 + 源与内联一致）** — gates_locale_split, scripts_build_locale, client, scripts_check_locale [EXTRACTED 1.00]
- **单一契约两处消费：model-tools 表 →（宿主 ctx.tools）+（MCP stdio server），CLI --tools 可离线核对** — lib_model_tools, lib_index, lib_mcp_server, bin_dsh_purge [EXTRACTED 1.00]
- **文档双语三件（README / zh-CN 镜像 / en）** — readme, readme_zh_cn, readme_en [EXTRACTED 1.00]
- **README 界面预览截图组（清洗 / 授权 / 演练台 / 补丁 / 规则集 / 自己的服务器）** — docs_preview_dock_clean, docs_preview_dock_auth, docs_preview_dock_drill, docs_preview_settings, docs_preview_rules, docs_preview_own_servers [EXTRACTED 1.00]
- **发版流水线：md 源 → embed → asset-table 加密表 → pnpm update → 真机复核** — workbuddy_ai_memory_memory_release_pipeline, scripts_embed_default_prompt, lib_asset_table, workbuddy_ai_memory_memory_project_memory [EXTRACTED 1.00]
- **重启环境一致性缺口：三份 spawnEnv 实现分叉，仅 desktop 兜底 DSH_PROFILE** — lib_restart_desktop_spawnenv, lib_uninstall_restart_spawnenv, lib_core_envfordetachedspawn [EXTRACTED 1.00]
- **首次装配：FOFA_KEY + VPS + 工具箱降级口径** — skills_redteam_redteam_setup, skills_redteam_fofa_recon, skills_redteam_vps_reverse_shell [EXTRACTED 1.00]
- **更新框架三份台账：channel.json（有读点）/ version-history.json（新增读点）/ auto-update-guard.json（此前只写不读）** — lib_update_update_ledger, docs_update_framework_channel_lane, lib_update, lib_update_readchannelstate [EXTRACTED 1.00]
- **verify 四关的组成：编排者 verify.mjs + 三个专职脚本 + core 状态来源** — scripts_verify, scripts_check_size, scripts_check_locale, lib_core [EXTRACTED 1.00]
- **内网突破标准通道：加密马落地 → suo5 隧道 → 内网测绘** — skills_redteam_webshell_toolkit, skills_redteam_suo5_tunnel, skills_redteam_gogo_intranet, skills_redteam_fscan_intranet [EXTRACTED 1.00]
- **0.2.2-rc.1 失配的门类：审批 / 沙箱观察 / 组装前置 / 工具 ask 兜底 / 交付话术** — docs_host_alignment_drift, lib_core_applypatches, bin_dsh_purge, lib_reapply [EXTRACTED 1.00]
- **测绘链路：FOFA 被动面 → 主动扫描 → 资产关联排序** — skills_redteam_fofa_recon, skills_redteam_active_scan, skills_redteam_asset_correlation [INFERRED 0.85]
- **进攻面扩张轨迹：技能 23→30→32 与条令逐版加条** — release_notes_skill_count_growth, release_notes_three_layer_sync, lib_default_prompt_inject_firepower_ladder, lib_default_prompt_inject_artifact_discipline [INFERRED 0.85]
- **盲打证据链：载荷 → 外带 → 判定档（confirmed/candidate）** — skills_redteam_oob_verification, skills_redteam_injection_payloads, skills_redteam_nuclei_scan [INFERRED 0.85]
- **被生态验证的三个设计决策：聚合工具（drill）、按需展开（status sections）、三消费方共用契约（ctx.tools + MCP + CLI）** — gates_drill_aggregate, gates_status_sections, gates_tool_surface_contract, lib_mcp_server [INFERRED 0.85]
- **「免费内网地图」模式：堡垒机托管清单 / SNMP 路由表 / CORS 回调白名单** — skills_redteam_secdev_boundary_bastion_map, skills_redteam_iot_iiot_netdev, skills_redteam_asset_correlation_edge_types [INFERRED 0.85]
- **凭据生命周期：转储 → 复用横扫 → 离线破解** — skills_redteam_lateral_movement, skills_redteam_netexec_scan, skills_redteam_credential_attack [INFERRED 0.85]
- **旧版沙箱条款 → 现行进攻条令的演化** — docs_v1_1_34_prompt_inject_web_pentest_slots, docs_v1_1_34_prompt_inject_ctf_contract, lib_default_prompt_inject_attack_doctrine [INFERRED 0.85]
- **回连基础设施：VPS 监听 + 载荷投递 + MSF handler** — skills_redteam_vps_reverse_shell, skills_redteam_shell_handler, skills_redteam_redteam_setup [INFERRED 0.85]
- **落库纪律的共同形态：先查库、只读优先、实测才算数** — skills_redteam_unauth_exploit_readonly_first, skills_redteam_nuclei_scan, skills_redteam_lateral_movement_credential_reuse, skills_redteam_netexec_scan [INFERRED 0.85]
- **Web 载荷 → WAF 绕过 → OOB 证据三件套** — skills_redteam_web_vuln_payloads, skills_redteam_waf_bypass, skills_redteam_oob_verification [INFERRED 0.85]
- **中英不同步的三次实例与把它变成闸门这件事** — gates_locale_parity, lib_default_prompt_inject_en, release_notes, docs_banner [INFERRED 0.85]
- **先实测再声明：宿主版本探测 → 分桶可观测 → 才谈 engines.dsh 范围** — docs_host_alignment_facts, docs_host_alignment_observability, docs_host_alignment_ecosystem, lib_update_updateledger [INFERRED 0.95]
- **宿主重置后的恢复链：marker 回写 → 补丁判失 → stamp 自愈 → 重启阶梯** — docs_update_framework_marker, docs_update_framework_reapply_heal, docs_update_framework_restart_ladder, lib_update_update_ledger [INFERRED 0.95]
- **提示词治理的三层落点：注入正文 / 角色稿 / 每轮 postPrompt** — lib_default_prompt_inject, release_notes_three_layer_sync, readme_inject_precedence_chain [INFERRED 0.95]
- **注入正文三变体（主 / zh / en）+ 历史快照** — lib_default_prompt_inject, lib_default_prompt_inject_zh, lib_default_prompt_inject_en, docs_v1_1_34_prompt_inject [INFERRED 0.95]
- **自更新半升级防线：COPY_NAMES 覆盖核心载荷 + COPY_DIRS 整目录替换 + 清单闸门盯分叉** — gates_manifest_parity, lib_update_copy_names, lib_update_overlayfromzip, skills_redteam_fofa_recon [INFERRED 0.95]
- **注入前置改造（1.1.34 化）的四处代码落点** — lib_identity_rewritepromptassembly, lib_identity_ensurefullinject, lib_identity_foldinjectintopersona, lib_identity_stripharnesspersona [EXTRACTED 1.00]

## Communities (101 total, 5 thin omitted)

### Community 0 - "ctf-sandbox-orchestrator（流程/编排 / flow）"
Cohesion: 0.05
Nodes (148): v1.1.34-prompt-inject.md（历史版本快照）, WEB PENTEST ROUTING 与 canned slots（技能路由表的前身）, ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）, default-prompt-inject.md（当前生效的注入正文）, 生成物即资产：工程性 / 连续性 / 项目性三纪律, 进攻条令 — ATTACK DOCTRINE（输出即火力）, 火力阶梯五级（打光弹药才停火）, 五阶段主线（信息收集→资产梳理→漏洞发现→漏洞利用→内网渗透） (+140 more)

### Community 1 - "update.js"
Cohesion: 0.07
Nodes (84): 生态约定对照：8 个同机插件里 4 个声明 engines.dsh、4 个用 dsh.compatibility, 渠道双车道与钉选（stable=master / beta，pin 固定旧版本）, atomicWriteSync(), applyUpdate(), _applyUpdateImpl(), archiveTarballUrl(), archiveZipUrl(), autoUpdateGuardPath() (+76 more)

### Community 2 - "rules.js"
Cohesion: 0.07
Nodes (77): atomicCopyFile(), atomicWriteFile(), commitOverrideOnApply(), defaultOverrideHash(), defaultOverrideText(), editOverride(), findOverrideFile(), hangOperatorPrompt() (+69 more)

### Community 3 - "uninstall.js"
Cohesion: 0.06
Nodes (67): clearLiveSelectedDefault(), clearOwnedSelectedDefault(), configSet(), configValue(), isOwnedPresetId(), listProfilePatchFiles(), OWNED_PRESET_IDS, readText() (+59 more)

### Community 4 - "core.js"
Cohesion: 0.05
Nodes (67): AI_RESOLVE_IDS, aiBaseBelongsToExe(), ALLOW_EXEC_CORE, allPatchHostsWritten(), ALWAYS_SOFT_STATUSES, APPLY_STATUS_RANK, applyPatchesAllHosts(), clearDesktopLocateCache() (+59 more)

### Community 5 - "store-core.js"
Cohesion: 0.06
Nodes (54): RFC-1918, cidrOf(), expandIpv6(), ipToInt(), isIpv6(), slugify(), ASSET_FTS_DDL, DDL (+46 more)

### Community 6 - "skills.js"
Cohesion: 0.10
Nodes (57): assertImportSourceOutsideSkills(), assertInside(), backupExisting(), blockScalarValue(), copyDir(), deleteSkill(), displayUnderHome(), escapeYamlKey() (+49 more)

### Community 7 - "lib/index.js"
Cohesion: 0.08
Nodes (51): isMnemonPluginMessage(), allowPluginRequest(), applyHostHooks(), autoApply(), DEFAULTS, denyCrossOrigin(), ensureRestartReady(), fsExists() (+43 more)

### Community 8 - "client.js"
Cohesion: 0.08
Nodes (46): AgentsTab(), applyDrillParts(), AssetsTab(), AttackFilesTab(), bothInjectEmpty(), ChainTab(), clampRtGeom(), Clip() (+38 more)

### Community 9 - "RedteamStore"
Cohesion: 0.10
Nodes (5): nowIso(), scopeOfIp(), tunnelIsLegit(), normGained(), RedteamStore

### Community 10 - "rewind.js"
Cohesion: 0.11
Nodes (47): analyzeRewind(), applyRewind(), asEventList(), createBlank(), disarmRewoundSession(), disposeObservation(), doRewindOneSession(), errorText() (+39 more)

### Community 11 - "findDshHome"
Cohesion: 0.10
Nodes (49): aiBaseGuessesAround(), aiBaseGuessesFor(), applyRuntimeEnv(), collectDirs(), dirHasDshLauncher(), dshBaseEnvStatus(), enumeratePatchAiBases(), findAiBase() (+41 more)

### Community 12 - "identity.js"
Cohesion: 0.09
Nodes (46): CTF CORE CONTRACT / SCOPE / EVIDENCE / WORKFLOW 四段, Little Code Sauce / YG 人格框架（SANDBOX — STABLE）, HARD OUTPUT RULES + 拒绝对抗（禁止词表与整轮重写）, ASSEMBLE_GUARD, assemblyHasExactInject(), assemblyLooksRedteam(), attachRedteamOpsOnly(), childOrigin() (+38 more)

### Community 13 - "extract-asar.js"
Cohesion: 0.10
Nodes (45): aiBaseUnderAppDir(), desktopAsarStillSealed(), openSealedDesktopHost(), readUnpackedAsarStamp(), rememberDesktopInstallForHandoff(), rememberUnpackedArchive(), restartSealedDesktopIfNeeded(), restoreSealedExtract() (+37 more)

### Community 14 - "redteam/client.js"
Cohesion: 0.10
Nodes (36): AgentsTab(), apply(), AssetsTab(), AttackFilesTab(), ChainTab(), clampRtGeom(), Clip(), ConcurrencyCard() (+28 more)

### Community 15 - "check-package.mjs"
Cohesion: 0.05
Nodes (39): asJson, CLAIM_FILES, CN, cnNum, declaredParams, descNumM, EN, fileKeys (+31 more)

### Community 16 - "restart-desktop.js"
Cohesion: 0.10
Nodes (36): 三份 spawnEnv 分叉：只有 desktop 那份兜底 DSH_PROFILE, 重启阶梯（web 杀旧服务等端口 / desktop 杀兄弟进程挪 asar / 卸载走 rmtree）, envForDetachedSpawn(), asarStillSealed(), commandMatchesExe(), darwinBundleName(), darwinBundleOf(), killOtherDesktopProcesses() (+28 more)

### Community 17 - "net-scope.js"
Cohesion: 0.10
Nodes (37): addHost(), allowCache, allowDecision(), appendDenial(), BANK_HOSTS, bankHit(), collectFromText(), COMPACT_STREAM_TYPES (+29 more)

### Community 18 - "check-anchors.mjs"
Cohesion: 0.08
Nodes (34): argv, asPostPatch, asWhitespace, cmpVer(), collapse(), collapsedIdx(), decodeLit(), decodeSgl() (+26 more)

### Community 19 - "desktop.js"
Cohesion: 0.09
Nodes (34): appDirForExecutable(), ASAR_RENAME_WHEN_IDLE_PS1, ASAR_RENAME_WHEN_IDLE_SH, ASAR_SWAP_PS1, cmdEntryAlreadyGood(), ensureAppRuntimeSymlink(), INTERNAL_LOG_PATH, isAsarSealedPath() (+26 more)

### Community 20 - "ui.js"
Cohesion: 0.12
Nodes (36): mergeConfigEnv(), officialSkillSummaries(), summarizeSkills(), dispatchAsync(), apply(), applyUpdate(), checkLatest(), checkLatestFromGithub() (+28 more)

### Community 21 - "dsh-purge.js"
Cohesion: 0.09
Nodes (29): args, main(), MODES, printStatus(), CLI 实时验收 --verify-live：契约表/补丁分桶/注入状态/路由 live 四查，有 ⚠ 即非 0, 关 10 磁盘卫生夹具 + 面板路由存活矩阵（12 条断言：阈值、负载形状、反腐蚀）, lib/mcp-server.js：MCP 协议单一来源 mcpRespond —— stdio 循环与宿主 HTTP 路由 POST /dsh-purge/mcp 共用, dirMb() (+21 more)

### Community 22 - "RewindButton"
Cohesion: 0.11
Nodes (25): armComposerFill(), clearStoredDraft(), ContinueButton(), conversationFace(), conversationInput(), currentSessionId(), dropInheritedQueue(), fillComposer() (+17 more)

### Community 23 - "scripts"
Cohesion: 0.06
Nodes (33): scripts, audit:graph, audit:skills, build:client, build:locale, build:skills, build:skills-graph, check-anchors (+25 more)

### Community 24 - "build-skill-graph.mjs"
Cohesion: 0.06
Nodes (28): agents, assigned, byDomainStage, DOMAIN_RULES, dry, dupRel, files, ids (+20 more)

### Community 25 - "reapply.js"
Cohesion: 0.17
Nodes (28): 宿主重置后的补丁判失与 applied stamp 自愈, appliedStampPath(), applyPlaceholderVersion(), canHealEmptyStamp(), ensureInstalledRevSeed(), healEmptyAppliedStamp(), hostPatchesStillPending(), hostStillHasAppliedPatches() (+20 more)

### Community 26 - "ref_node_process"
Cohesion: 0.07
Nodes (20): mcpRespond(), runMcpServer(), asJson, CASES, fails, NOW, root, scope (+12 more)

### Community 27 - "tools.js"
Cohesion: 0.10
Nodes (23): PLANNER_ROLE, ROLE_ORDER, ROLE_TITLES, addCandidate(), AGENT_PARAM, apply(), bindingKeyOf(), bindings (+15 more)

### Community 28 - "tools-smoke.mjs"
Cohesion: 0.07
Nodes (24): 关 11 CLI 冒烟：真跑 bin 的只读模式（此前十关没一关执行过 CLI 分发）, BIN, cases, MODES, root, run, BS, child (+16 more)

### Community 29 - "continue-retry.js"
Cohesion: 0.12
Nodes (26): ABNORMAL_KINDS, clampCount(), createTracker(), DEFAULT_CONTINUE_RETRY, failureCodeOf(), hasFreshHumanTurn(), inboxBusy(), inspectTurn() (+18 more)

### Community 30 - "applyPatches"
Cohesion: 0.14
Nodes (30): applyPatches(), ensureDirSync(), fileKeysOf(), hasLegacyPermissionPin(), insertShimInject(), isFile(), isTextShim(), isWatchedClientBundle() (+22 more)

### Community 31 - "PurgeDock"
Cohesion: 0.13
Nodes (28): apply(), AuthGate(), clampDockGeom(), defaultDockGeom(), EnvAdaptSendGate(), fetchEnvAdaptStatus(), hasInlinePurgeEntry(), HeroNewSessionMount() (+20 more)

### Community 32 - "official-update.js"
Cohesion: 0.11
Nodes (27): 三条破损补丁 #77 / #68 / #26, 死补丁 #40 移除与 84 → 83 计数, 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）, 0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）, 宿主实况：桌面 EXE 0.2.2-rc.1 / runtime 0.2.2-rc.1 / cordis 4.1.0, 0.2.2-rc.1 包搬家两例：PTC 执行器拆成 dsh-tool-executor-ptc、交付物提示词拆成 dsh-deliverable-file-references, #82 教训：打包注释 //#region 不能当锚点第二行, asar 密封态 = 补丁是否真生效的判据 (+19 more)

### Community 33 - "verify.mjs"
Cohesion: 0.08
Nodes (24): 关 9 弹药层一致性审计：技能引用的工具名与条令点名的技能都必须真实存在, 发版七关闸门：语法 / 体积预算 / 双语 key 一致性 / 清单一致性 / 包自证 / 工具面 / JSON 合法（npm run verify 一票过）, 闸门反向探针总表：每道门都要有「改坏即红」的证据，否则等于不知道真假, 端到端情景第八关：20 步串 op 并断言回读，专抓组合期「说谎的回读」与跨 op 不一致, 关 13 工具层冒烟：真执行 purge_apply / purge_revert（mutating 工具分支此前没有一关跑过）, 上游漂移探测 check:upstream：latest vs dshTarget vs engines，越界才判失败、离线只报未知, 关 12 写路径冒烟：夹具起点用保险柜原文；单次 apply→revert 哈希精确等于官方；双次 apply 污染还原点（5 文件停在一次已打补丁态）, argv (+16 more)

### Community 34 - "platform-config.js"
Cohesion: 0.19
Nodes (26): adaptInDir(), assignToolkitFolder(), configPathOf(), defaultToolkitDir(), detectKali(), EMPTY(), envAdaptStatus(), findInDir() (+18 more)

### Community 35 - "inject-second-shot.mjs"
Cohesion: 0.08
Nodes (25): asJson, files, minIdx, noSection, qualified, root, rows, SKILLS (+17 more)

### Community 36 - "revertAll"
Cohesion: 0.17
Nodes (27): backupAll(), collectRevertTargets(), dropStaleUserProfilePatchBackups(), ensureOfficialSnapshot(), flattenTargetPaths(), hasBackup(), hostBakDigest(), hostBakVaultRoot() (+19 more)

### Community 37 - "package.json"
Cohesion: 0.08
Nodes (25): npm run host-sync：把「仓库 → 宿主 profile 副本」这条重复手工动作固化, 清单一致性闸门：COPY_NAMES（自更新）必须落在 files（发布）之内, COPY_NAMES, bin, dsh-purge, bugs, url, description (+17 more)

### Community 38 - ".openEngagement"
Cohesion: 0.15
Nodes (6): 真 bug：openEngagement 把 scope 串直接存进 scope_cidrs，导致 report() 的 .join 抛错, op=report：战报 / kind=score 得分报告 / kind=targets 目标汇总（零新增参数收纳，输出 2-16 行有界）, slugTarget(), cidrList(), readMeta(), writeMeta()

### Community 39 - ".scoreReport"
Cohesion: 0.19
Nodes (17): RFC-3986, buildCurlCommand(), buildHttpRequest(), commandKind(), fillTemplate(), parseCurl(), parseTarget(), evaluateScoreBoard() (+9 more)

### Community 40 - "skill-availability.js"
Cohesion: 0.14
Nodes (22): bundledSkillSummaries(), checkSkill(), dshHomeCandidates(), existsUnderAnyHome(), expandSkillPath(), pathCountsOnThisHost(), readSkillFromRoot(), redteamSummariesForCheck() (+14 more)

### Community 41 - "ref_node_fs"
Cohesion: 0.10
Nodes (16): PROMPTS, checkOnly, dry, root, STEPS, built, client, clientPath (+8 more)

### Community 42 - "graph-audit.mjs"
Cohesion: 0.09
Nodes (22): 图谱审计：文件级孤儿判红；导出级只报线索（含结构边修正与 79% 盲区率）, asJson, deadExports, fileInbound, g, graphBlind, graphPath, hasName() (+14 more)

### Community 43 - "report.mjs"
Cohesion: 0.09
Nodes (21): argv, checkDebt, day, dbPath, debtLines, failures, liveLines, md (+13 more)

### Community 44 - "README.md（中文主文档）"
Cohesion: 0.13
Nodes (21): banner.svg（720×180 项目横幅）, 硬编码 replace 清理的措辞漂移风险, dock-auth.png（850×925，演练台授权页截图）, dock-clean.png（800×850，清洗页侧栏截图）, dock-drill.png（900×850，演练台截图）, own-servers.png（652×509，自己的服务器白名单截图·中文）, own-servers-en.png（652×505，自己的服务器白名单截图·英文）, rules.png（1064×1244，规则集截图） (+13 more)

### Community 45 - "steps"
Cohesion: 0.09
Nodes (21): concurrency, cancel-in-progress, group, GH_TOKEN, jobs, release, name, permissions (+13 more)

### Community 46 - "hide-console.js"
Cohesion: 0.22
Nodes (20): ensureHiddenConsole(), findDshBinRoot(), isPackagedDesktopDshRoot(), builtinChildProcess(), forceHideOptions(), hideConsoleDecision(), hideConsoleEntrySource(), installChildProcessImportHook() (+12 more)

### Community 47 - "check-tools.mjs"
Cohesion: 0.09
Nodes (21): asJson, blocks, BUDGET, drillTool, entBlock, entSections, fallback, hidden (+13 more)

### Community 48 - "model-tools.js"
Cohesion: 0.15
Nodes (13): 进攻力体检：红队 32 技能可用 32、坏 0；单查给出缺的环境变量与修法, BRIEF_SUFFIX, buildModelTools(), DRILL_ENTITIES, DRILL_WRITE_ENTITIES, TEXT_OUT, routeCredentials(), routeIntranet() (+5 more)

### Community 49 - "restartOfficialHarness"
Cohesion: 0.17
Nodes (21): appAsarPath(), cleanupLegacyRestartScripts(), desktopRestartChoice(), desktopRuntimeOf(), dshHomeForRelaunch(), helperEnv(), isDesktopExecutable(), isOfficialHarnessExecutable() (+13 more)

### Community 50 - "findDesktopAppExecutable"
Cohesion: 0.20
Nodes (21): commonDesktopInstallDirs(), exeCandidatesBeside(), exeDirFromRegistryValue(), extraDiscoveredInstallDirs(), extraInstallsFromEnv(), findDesktopAppExecutable(), firstExistingExe(), homeSiblingInstalls() (+13 more)

### Community 51 - "write-smoke.mjs"
Cohesion: 0.10
Nodes (16): beforePending, childFile, expected, expectedSrc, fakeBase, fixture, home, realBase (+8 more)

### Community 52 - ".kb"
Cohesion: 0.16
Nodes (5): 组合式收纳：一个 entity 参数换 10 读面 + 13 写面（POC 五面闭环、资产登记/评估/测试回写）, op=entity_add：一个 op 覆盖六个写面（+92 字符 ≈15/面），shot/poc 明确不接并说明原因, defaultPocFilename(), slugPoc(), pocCategoryName()

### Community 53 - "asLf"
Cohesion: 0.20
Nodes (20): applyReplacementsToText(), asLf(), cloneRegExp(), collapseDuplicateLegacyApplyPath(), endOfBalancedBlock(), filePatchOutcome(), filePatchSettled(), isBareIdentityNeedle() (+12 more)

### Community 54 - "PurgifySection"
Cohesion: 0.15
Nodes (19): clientGuessSurface(), detectHostTheme(), hostSurfaceOf(), hostText(), keepListedVersion(), PatchGroups(), patchIdLabel(), patchRowsOf() (+11 more)

### Community 55 - "targetFiles"
Cohesion: 0.14
Nodes (19): allExisting(), allowTargetForPatch(), allowTargetPath(), allowTargetPathForAiBase(), desktopDshHomeGuesses(), desktopHomeCandidates(), filterTargetFiles(), firstExisting() (+11 more)

### Community 56 - "host-sync.mjs"
Cohesion: 0.11
Nodes (16): argv, copyDir, copyMatches(), dryRun, force, head, home, m (+8 more)

### Community 57 - "redteam-setup.sh"
Cohesion: 0.27
Nodes (18): ask(), ask_secret(), bad(), BIN, cur_env(), dim(), dl_asset(), doctor() (+10 more)

### Community 58 - "apiJson"
Cohesion: 0.15
Nodes (18): apiJson(), apiTimeoutMs(), apiUrl(), Btn(), clientCurrentCwd(), ContinueRetrySection(), formatSize(), isAbortError() (+10 more)

### Community 59 - "child-process-hide.mjs"
Cohesion: 0.18
Nodes (17): builtinChildProcess(), ChildProcess, cp, exec, execFile, execFileSync, execSync, fork (+9 more)

### Community 60 - "check-skill-runnable.mjs"
Cohesion: 0.11
Nodes (15): argvLimit, asJson, files, have, LINUX_MARKS, linuxRows, missRows, root (+7 more)

### Community 61 - "graphify-sync.mjs"
Cohesion: 0.25
Nodes (16): edgesOf(), ensureBaseline(), fail(), FILE_TYPES, foldRationale(), hyperEdgesOf(), INFERRED_OK, isSemantic() (+8 more)

### Community 62 - "inject-runnability.mjs"
Cohesion: 0.13
Nodes (16): checkOnly, drift, dry, esc(), files, has(), have, INSTALLABLE (+8 more)

### Community 63 - "check-locale.mjs"
Cohesion: 0.13
Nodes (13): 双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）, 双语文案拆开：源在 locale/*.json，运行时仍走构建期内联（拆源不拆加载）, argv, asJson, blocks, dicts, expectBlocks, file (+5 more)

### Community 64 - "role-section.js"
Cohesion: 0.28
Nodes (15): currentEngagementId(), evictRoleBySessionIfOverflow(), installSubagentRoleCapture(), isRedteamChild(), noteClaimedMessage(), parseRedteamRole(), readRoleFile(), remember() (+7 more)

### Community 65 - "anchor-gate.mjs"
Cohesion: 0.24
Nodes (15): apply(), buildInstructionHint(), classifyReasoning(), countWord(), decidePromotion(), extractInstructionPaths(), hasAnchoredReasoning(), instructionHintMessages() (+7 more)

### Community 66 - "build-locale.mjs"
Cohesion: 0.13
Nodes (13): block, checkOnly, clientPath, crlf, die(), en, marked, onlyEn (+5 more)

### Community 67 - "scope.js"
Cohesion: 0.28
Nodes (14): checkAction(), checkTarget(), checkTechnique(), cidrInsideCidr(), firstOutOfScope(), ipInCidr(), ipv4ToInt(), isDomain() (+6 more)

### Community 68 - "market-sweep.mjs"
Cohesion: 0.16
Nodes (13): all, asJson, BASELINE, both, cacheFile, diffs, FIELDS(), got (+5 more)

### Community 69 - "toolkit-windows.mjs"
Cohesion: 0.13
Nodes (9): argv, checkOnly, force, NL, onlyIdx, picks, probeOnly, toolkit (+1 more)

### Community 70 - "注入方式改造方案-1.1.34化.md（注入前置）"
Cohesion: 0.19
Nodes (13): 锚点核对法：上游源码 + npm 已发布产物双重比对, 四层防御：注入在前 / stripHarnessPersona / overlayOfficialIdentity / 文件级补丁短路, 注入位置前置（order -100000 / cap -99999）, 注入方式改造方案-1.1.34化.md（注入前置）, CAPABILITY_SECTION, capabilityProtocolText(), isCwdOnlyText(), isWorkspaceBaselineSection() (+5 more)

### Community 71 - "table-read.js"
Cohesion: 0.24
Nodes (9): IV, MASK, SLOT, SLOT_ROWS, TAG, MIX, mixKey(), sealSlot() (+1 more)

### Community 72 - "check-manifest.mjs"
Cohesion: 0.14
Nodes (13): allow, alwaysShipped, asJson, block, copy, denies, extra, pkg (+5 more)

### Community 73 - "installIdentityOverride"
Cohesion: 0.21
Nodes (13): installAssembleGuard(), addPromptSection(), closerFollowBytes(), injectAllowedNow(), installIdentityOverride(), logAssembleDecision(), purgeLog(), readInjectFallback() (+5 more)

### Community 74 - "build-client.mjs"
Cohesion: 0.15
Nodes (12): applyAt, beginAt, body, client, clientPath, drillSrc, end, endAt (+4 more)

### Community 75 - "scenario-drill.mjs"
Cohesion: 0.21
Nodes (12): drill, failures, has(), liveStore, main(), not(), re(), root (+4 more)

### Community 76 - "settings.js"
Cohesion: 0.32
Nodes (11): clampMaxAgents(), DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT, maxAgentsOf(), maxAgentsSourceOf(), readSettings(), saveMaxAgents(), settingsPathOf() (+3 more)

### Community 77 - "audit-skills.mjs"
Cohesion: 0.17
Nodes (11): asJson, doctrineFiles, ghostRefs, linkProblems, missingSkills, realTools, root, skillDir (+3 more)

### Community 78 - "host.js"
Cohesion: 0.24
Nodes (10): markersAny=true 的补丁：applied 只代表「至少打了一处」，会藏半个没打的门, 状态面升级：补丁按 已清洗/待清洗/锚点未命中/不适用/缺文件 分桶 + 宿主版本对齐告警, 未安装项整体摘除：83 → 76 条补丁，面板 0 不适用 / 0 缺文件, ADAPTERS, currentSurface(), hostAdapter(), hostAlignment(), restartNote() (+2 more)

### Community 79 - "emptyDisposableFoldedYaml"
Cohesion: 0.25
Nodes (11): emptyDisposableFoldedYaml(), isDisposableYamlFoldParagraph(), stripOrphanYamlAfterEmptyScalars(), yamlConsumeFoldBody(), yamlDropPaddingOnlyLines(), yamlFoldBodyText(), yamlHasDisposableFoldParagraph(), yamlIndentOf() (+3 more)

### Community 80 - "apply"
Cohesion: 0.27
Nodes (10): apply(), currentSettleScope(), settleInstalledPatches(), uninstallHungPromptGlobal(), DESKTOP_SETTLE_DELAY_MS, isInactiveContextError(), settleDelayMs(), settleMayReapply() (+2 more)

### Community 82 - "install"
Cohesion: 0.18
Nodes (11): patch, inject, platform, dsh, bundle, client, install, git (+3 more)

### Community 83 - "ref_node_path"
Cohesion: 0.22
Nodes (9): checkOnly, demote(), dropRedundantH1(), dry, files, normalize(), remaining, root (+1 more)

### Community 84 - "export-engagement-report.mjs"
Cohesion: 0.18
Nodes (9): argv, id, name, outDir, outFile, rep, shotsDst, shotsSrc (+1 more)

### Community 85 - "模型工具契约表：lib/model-tools.js 一处定义，宿主 ctx.tools 与 MCP 共用（8 个工具）"
Cohesion: 0.20
Nodes (10): 社区情报主文档：独占性、目录规模、restart∩patch=0、长尾抽样、产物级对照、模块化判定、成本自述做法（七轮实测累计）, 同地盘地图：600 条样本里无人做提示词优先级治理，purge 的三档作用域已被 purge_rules 报出, 生态漂移探测 sweep:market：把六趟手打的复查口径写死进代码（FIELDS + 正则 + 基线），交集被吃进即判失败, 生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字, 社区同路原则：one stable proxy tool instead of N tool schemas（dsh-mcp-lazy / dsh-mcp-lens 按需加载 schema）, purge_drill：56 个 preset 平面工具收成聚合入口，18 op（读 8 + 写面收纳 update 四方法 / delete 三方法 / open / switch）, 生态 tag 口径门禁：7 个 tag 全部满足「2000 条样本在用 + purge 真具备」，词形分裂按生态现状并存, purge_status 按需展开：同一渲染函数两个 section 显式索取，返回值成本 13023 → 538 字符 (+2 more)

### Community 86 - "alignSummary"
Cohesion: 0.24
Nodes (10): alignSummary 建议行分档 + 设计内 skipped 清单（DESIGN_SKIPPED_VERIFIED，带 checkedAgainst/证据文档，第 22 项守它别烂）, alignSummary(), estimateTokens(), hostEnumerationLine(), patchTally(), core0(), defaultRenderStatus(), allowFilePath() (+2 more)

### Community 87 - "check-upstream.mjs"
Cohesion: 0.27
Nodes (9): asJson, cmp(), core3(), inRange(), pkg, range, root, target (+1 more)

### Community 89 - "surface.js"
Cohesion: 0.44
Nodes (8): exeName(), forcedSurface(), isDesktopSurface(), norm(), pathLooksDesktop(), resourcesLookLikeDesktopInstall(), slash(), SURFACES

### Community 90 - "embed-default-prompt.mjs"
Cohesion: 0.22
Nodes (7): embed-prompt, dest, packed, root, src, text, 发版固定流程：改 md 源 → embed-prompt 重封入 asset-table.js → bump 三份 README → pnpm update

### Community 91 - "web.js"
Cohesion: 0.54
Nodes (6): hostFromRequest(), portFromRequest(), restartArgv(), scheduleCleanupRestart(), scheduleRestart(), spawnRestartHelper()

### Community 92 - "exports"
Cohesion: 0.25
Nodes (8): exports, ./client, ./locale/*.json, ./package.json, ./redteam, ./redteam/store, ./redteam/tools, ./redteam/ui

### Community 93 - "store.js"
Cohesion: 0.38
Nodes (5): apply(), inject, name, readSelfPackage(), resolveRoot()

### Community 94 - "isInsideDesktopInstall"
Cohesion: 0.40
Nodes (6): inferDesktopInstallDir(), isInsideDesktopInstall(), isSubPath(), looksLikeDesktopNameTail(), slashNorm(), isPackagedDesktopDshRoot()

### Community 95 - "mnemon-settings.js"
Cohesion: 0.40
Nodes (4): normalizeRewriteOptions(), DEFAULT_SETTINGS, loadMnemonSettings(), mnemonSettingsPath()

### Community 98 - "drill-grant.js"
Cohesion: 0.80
Nodes (4): clearDrillGrant(), drillGrantPath(), readDrillGrant(), writeDrillGrant()

### Community 100 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Ambiguous Edges - Review These
- `applyPatches()` → `settings.png（1064×1972，补丁页截图）`  [AMBIGUOUS]
  docs/preview/settings.png · relation: references

## Knowledge Gaps
- **3 isolated node(s):** `RFC-3986`, `BIN`, `RFC-1918`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 717 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `README.md（中文主文档）` connect `README.md（中文主文档）` to `ctf-sandbox-orchestrator（流程/编排 / flow）`, `update.js`, `verify.mjs`, `rules.js`, `core.js`, `package.json`, `skills.js`, `lib/index.js`, `client.js`, `注入方式改造方案-1.1.34化.md（注入前置）`, `rewind.js`, `official-update.js`, `host.js`, `restart-desktop.js`, `net-scope.js`, `dsh-purge.js`, `check-locale.mjs`?**
  _High betweenness centrality (0.137) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `default-prompt-inject.md（当前生效的注入正文）` (e.g. with `v1.1.34-prompt-inject.md（历史版本快照）` and `defaultOverrideText()`) actually correct?**
  _`default-prompt-inject.md（当前生效的注入正文）` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `RFC-3986`, `BIN`, `RFC-1918` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ctf-sandbox-orchestrator（流程/编排 / flow）` be split into smaller, more focused modules?**
  _Cohesion score 0.05478948336091193 - nodes in this community are weakly interconnected._
- **Why does `release-notes.md（1.1.72 → 1.1.83 演化史）` connect `ctf-sandbox-orchestrator（流程/编排 / flow）` to `official-update.js`, `update.js`, `store-core.js`, `client.js`, `README.md（中文主文档）`, `identity.js`, `模型工具契约表：lib/model-tools.js 一处定义，宿主 ctx.tools 与 MCP 共用（8 个工具）`, `reapply.js`, `check-locale.mjs`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Should `update.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06709435979684576 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `applyPatches()` and `settings.png（1064×1972，补丁页截图）`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._