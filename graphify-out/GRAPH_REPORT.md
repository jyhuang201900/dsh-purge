# Graph Report - dsh-purge  (2026-11-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2055 nodes · 5337 edges · 73 communities (69 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 214 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f7e2e68`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- desktop.js
- update.js
- default-prompt-inject.md（当前生效的注入正文）
- rules.js
- uninstall.js
- net-scope.js
- core.js
- skills.js
- store-core.js
- extract-asar.js
- client.js
- rewind.js
- package.json
- identity.js
- lib/index.js
- .db
- redteam/client.js
- ui.js
- reapply.js
- RedteamStore
- apiJson
- PurgifySection
- findDshHome
- host.js
- tools.js
- continue-retry.js
- PurgeDock
- applyPatches
- platform-config.js
- silenceCmdFlash
- check-anchors.mjs
- revertAll
- restart-desktop.js
- steps
- installWebServer
- skill-availability.js
- ref_node_fs
- isFile
- host-sync.mjs
- child-process-hide.mjs
- findAiBaseWeb
- .dirOf
- graphify-sync.mjs
- check-locale.mjs
- anchor-gate.mjs
- build-locale.mjs
- check-size.mjs
- .reportTargets
- 注入方式改造方案-1.1.34化.md（注入前置）
- table-read.js
- targetFiles
- apply
- role-section.js
- check-manifest.mjs
- build-client.mjs
- settings.js
- skill-fixes.js
- ref_node_path
- dsh-purge.js
- .scoreReport
- ip-utils.js
- scripts
- embed-default-prompt.mjs
- verify.mjs
- web.js
- ref_node_url
- 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）
- mnemon-settings.js
- store.js
- RewindSafe
- RtBoundary
- ContinueSafe
- collectInjectText

## God Nodes (most connected - your core abstractions)
1. `RedteamStore` - 110 edges
2. `default-prompt-inject.md（当前生效的注入正文）` - 42 edges
3. `findDshHome()` - 38 edges
4. `nowIso()` - 34 edges
5. `README.md（中文主文档）` - 30 edges
6. `release-notes.md（1.1.72 → 1.1.83 演化史）` - 29 edges
7. `_applyUpdateImpl()` - 25 edges
8. `PurgifySection()` - 24 edges
9. `isDir()` - 24 edges
10. `rewritePromptAssembly()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `#82 教训：打包注释 //#region 不能当锚点第二行` --semantically_similar_to--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED] [semantically similar]
  lib/core.js → docs/适配-0.2.1-rc.2-差异分析.md
- `settings.png（1064×1972，补丁页截图）` --references--> `applyPatches()`  [AMBIGUOUS]
  docs/preview/settings.png → lib/core.js
- `ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）` --semantically_similar_to--> `进攻条令 — ATTACK DOCTRINE（输出即火力）`  [INFERRED] [semantically similar]
  docs/v1.1.34-prompt-inject.md → lib/default-prompt-inject.md
- `双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）` --references--> `default-prompt-inject.en.md（英文版注入正文）`  [INFERRED]
  scripts/check-locale.mjs → lib/default-prompt-inject.en.md
- `asar 密封态 = 补丁是否真生效的判据` --references--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED]
  lib/restart-desktop.js → docs/适配-0.2.1-rc.2-差异分析.md

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

## Communities (73 total, 4 thin omitted)

### Community 0 - "desktop.js"
Cohesion: 0.05
Nodes (93): asar 密封态 = 补丁是否真生效的判据, 官方客户端升级回写标记 dsh-purge-reapply-asar, appAsarPath(), appDirForExecutable(), ASAR_RENAME_WHEN_IDLE_PS1, ASAR_RENAME_WHEN_IDLE_SH, ASAR_SWAP_PS1, cleanupLegacyRestartScripts() (+85 more)

### Community 1 - "update.js"
Cohesion: 0.07
Nodes (84): 生态约定对照：8 个同机插件里 4 个声明 engines.dsh、4 个用 dsh.compatibility, 渠道双车道与钉选（stable=master / beta，pin 固定旧版本）, atomicWriteSync(), applyUpdate(), _applyUpdateImpl(), archiveTarballUrl(), archiveZipUrl(), autoUpdateGuardPath() (+76 more)

### Community 2 - "default-prompt-inject.md（当前生效的注入正文）"
Cohesion: 0.07
Nodes (83): v1.1.34-prompt-inject.md（历史版本快照）, WEB PENTEST ROUTING 与 canned slots（技能路由表的前身）, ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）, default-prompt-inject.md（当前生效的注入正文）, 生成物即资产：工程性 / 连续性 / 项目性三纪律, 进攻条令 — ATTACK DOCTRINE（输出即火力）, default-prompt-inject.en.md（英文版注入正文）, 火力阶梯五级（打光弹药才停火） (+75 more)

### Community 3 - "rules.js"
Cohesion: 0.07
Nodes (75): atomicCopyFile(), atomicWriteFile(), commitOverrideOnApply(), defaultOverrideHash(), defaultOverrideText(), editOverride(), findOverrideFile(), hangOperatorPrompt() (+67 more)

### Community 4 - "uninstall.js"
Cohesion: 0.06
Nodes (67): clearLiveSelectedDefault(), clearOwnedSelectedDefault(), configSet(), configValue(), isOwnedPresetId(), listProfilePatchFiles(), OWNED_PRESET_IDS, readText() (+59 more)

### Community 5 - "net-scope.js"
Cohesion: 0.06
Nodes (60): banner.svg（720×180 项目横幅）, 硬编码 replace 清理的措辞漂移风险, dock-auth.png（850×925，演练台授权页截图）, dock-clean.png（800×850，清洗页侧栏截图）, dock-drill.png（900×850，演练台截图）, own-servers.png（652×509，自己的服务器白名单截图·中文）, own-servers-en.png（652×505，自己的服务器白名单截图·英文）, rules.png（1064×1244，规则集截图） (+52 more)

### Community 6 - "core.js"
Cohesion: 0.05
Nodes (59): markersAny=true 的补丁：applied 只代表「至少打了一处」，会藏半个没打的门, 状态面升级：补丁按 已清洗/待清洗/锚点未命中/不适用/缺文件 分桶 + 宿主版本对齐告警, 未安装项整体摘除：83 → 76 条补丁，面板 0 不适用 / 0 缺文件, AI_RESOLVE_IDS, aiBaseBelongsToExe(), ALL_PATCHES, ALLOW_EXEC_CORE, allPatchHostsWritten() (+51 more)

### Community 7 - "skills.js"
Cohesion: 0.10
Nodes (57): assertImportSourceOutsideSkills(), assertInside(), backupExisting(), blockScalarValue(), copyDir(), deleteSkill(), displayUnderHome(), escapeYamlKey() (+49 more)

### Community 8 - "store-core.js"
Cohesion: 0.08
Nodes (50): RFC-1918, ASSET_FTS_DDL, DDL, guessPocCategory(), HAS_FTS5, KNOWLEDGE_DDL, migrate(), migrateKnowledge() (+42 more)

### Community 9 - "extract-asar.js"
Cohesion: 0.08
Nodes (56): aiBaseUnderAppDir(), ensureHiddenConsole(), findDshBinRoot(), isPackagedDesktopDshRoot(), openSealedDesktopHost(), restoreSealedExtract(), restoreUnusableExtract(), scheduleSealedDesktopRestart() (+48 more)

### Community 10 - "client.js"
Cohesion: 0.07
Nodes (48): AgentsTab(), applyDrillParts(), AssetsTab(), AttackFilesTab(), bothInjectEmpty(), ChainTab(), clampRtGeom(), clearStoredDraft() (+40 more)

### Community 11 - "rewind.js"
Cohesion: 0.11
Nodes (47): analyzeRewind(), applyRewind(), asEventList(), createBlank(), disarmRewoundSession(), disposeObservation(), doRewindOneSession(), errorText() (+39 more)

### Community 12 - "package.json"
Cohesion: 0.04
Nodes (47): npm run host-sync：把「仓库 → 宿主 profile 副本」这条重复手工动作固化, 清单一致性闸门：COPY_NAMES（自更新）必须落在 files（发布）之内, COPY_NAMES, bin, dsh-purge, bugs, url, patch (+39 more)

### Community 13 - "identity.js"
Cohesion: 0.10
Nodes (43): ASSEMBLE_GUARD, assemblyHasExactInject(), assemblyLooksRedteam(), attachRedteamOpsOnly(), childOrigin(), ensureFullInject(), eventList(), foldInjectIntoPersona() (+35 more)

### Community 14 - "lib/index.js"
Cohesion: 0.09
Nodes (42): installAssembleGuard(), isMnemonPluginMessage(), addPromptSection(), applyHostHooks(), closerFollowBytes(), DEFAULTS, fsExists(), handlePurgeCommand() (+34 more)

### Community 15 - ".db"
Cohesion: 0.08
Nodes (9): nowIso(), tunnelIsLegit(), normGained(), parseJson(), targetKey(), normalizeShellStatus(), normalizeShellType(), WEBSHELL_STATUSES (+1 more)

### Community 16 - "redteam/client.js"
Cohesion: 0.10
Nodes (36): AgentsTab(), apply(), AssetsTab(), AttackFilesTab(), ChainTab(), clampRtGeom(), Clip(), ConcurrencyCard() (+28 more)

### Community 17 - "ui.js"
Cohesion: 0.12
Nodes (35): mergeConfigEnv(), officialSkillSummaries(), dispatchAsync(), apply(), applyUpdate(), checkLatest(), checkLatestFromGithub(), dshHomeCandidates() (+27 more)

### Community 18 - "reapply.js"
Cohesion: 0.13
Nodes (33): 0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）, 宿主实况：桌面 EXE 0.2.2-rc.1 / runtime 0.2.2-rc.1 / cordis 4.1.0, 0.2.2-rc.1 包搬家两例：PTC 执行器拆成 dsh-tool-executor-ptc、交付物提示词拆成 dsh-deliverable-file-references, 宿主重置后的补丁判失与 applied stamp 自愈, dshHostVersion(), readJsonVersion(), appliedStampPath(), applyPlaceholderVersion() (+25 more)

### Community 19 - "RedteamStore"
Cohesion: 0.12
Nodes (5): defaultPocFilename(), slugPoc(), pocCategoryName(), promptHash(), RedteamStore

### Community 20 - "apiJson"
Cohesion: 0.11
Nodes (26): apiJson(), apiTimeoutMs(), apiUrl(), armComposerFill(), ContinueButton(), conversationFace(), conversationInput(), currentSessionId() (+18 more)

### Community 21 - "PurgifySection"
Cohesion: 0.09
Nodes (33): Btn(), clientCurrentCwd(), clientGuessSurface(), ContinueRetrySection(), detectHostTheme(), formatSize(), hostSurfaceOf(), hostText() (+25 more)

### Community 22 - "findDshHome"
Cohesion: 0.12
Nodes (32): aiBaseGuessesAround(), aiBaseGuessesFor(), applyRuntimeEnv(), desktopDshHomeGuesses(), desktopHomeCandidates(), enumeratePatchAiBases(), findAiBase(), findAiBaseDesktop() (+24 more)

### Community 23 - "host.js"
Cohesion: 0.11
Nodes (30): desktopAsarStillSealed(), displayTitleOf(), dshBaseEnvStatus(), gatherState(), groupPatchesForDisplay(), missingAiBaseMessage(), patchAppliesHere(), patchStatusReady() (+22 more)

### Community 24 - "tools.js"
Cohesion: 0.10
Nodes (23): PLANNER_ROLE, ROLE_ORDER, ROLE_TITLES, addCandidate(), AGENT_PARAM, apply(), bindingKeyOf(), bindings (+15 more)

### Community 25 - "continue-retry.js"
Cohesion: 0.12
Nodes (26): ABNORMAL_KINDS, clampCount(), createTracker(), DEFAULT_CONTINUE_RETRY, failureCodeOf(), hasFreshHumanTurn(), inboxBusy(), inspectTurn() (+18 more)

### Community 26 - "PurgeDock"
Cohesion: 0.13
Nodes (28): apply(), AuthGate(), clampDockGeom(), defaultDockGeom(), EnvAdaptSendGate(), fetchEnvAdaptStatus(), hasInlinePurgeEntry(), HeroNewSessionMount() (+20 more)

### Community 27 - "applyPatches"
Cohesion: 0.15
Nodes (28): applyPatches(), applyReplacementsToText(), asLf(), clientBundlePackageName(), cloneRegExp(), collapseDuplicateLegacyApplyPath(), endOfBalancedBlock(), fileKeysOf() (+20 more)

### Community 28 - "platform-config.js"
Cohesion: 0.19
Nodes (26): adaptInDir(), assignToolkitFolder(), configPathOf(), defaultToolkitDir(), detectKali(), EMPTY(), envAdaptStatus(), findInDir() (+18 more)

### Community 29 - "silenceCmdFlash"
Cohesion: 0.12
Nodes (26): keepLiangshenOperatorPrompt(), keepSurfaceFile(), liangshenPromptFilterText(), listDoctorCliFiles(), listDshmarketRestartFiles(), listLiangshenBootstrapFiles(), listLiangshenCustomBashFiles(), listLiangshenMinimalPromptFiles() (+18 more)

### Community 30 - "check-anchors.mjs"
Cohesion: 0.09
Nodes (20): argv, decodeLit(), decodeSgl(), discoverPkgs(), extractPatches(), fetched, flag(), idxNew (+12 more)

### Community 31 - "revertAll"
Cohesion: 0.20
Nodes (24): backupAll(), collectRevertTargets(), dropStaleUserProfilePatchBackups(), ensureOfficialSnapshot(), flattenTargetPaths(), hasBackup(), hostBakDigest(), hostBakVaultRoot() (+16 more)

### Community 32 - "restart-desktop.js"
Cohesion: 0.21
Nodes (21): asarStillSealed(), commandMatchesExe(), darwinBundleName(), darwinBundleOf(), listDarwinPids(), listDesktopPids(), listPosixPids(), log() (+13 more)

### Community 33 - "steps"
Cohesion: 0.09
Nodes (21): concurrency, cancel-in-progress, group, GH_TOKEN, jobs, release, name, permissions (+13 more)

### Community 34 - "installWebServer"
Cohesion: 0.14
Nodes (21): clearDrillGrant(), drillGrantPath(), readDrillGrant(), writeDrillGrant(), allowPluginRequest(), denyCrossOrigin(), ensureRestartReady(), handleSkillsOp() (+13 more)

### Community 35 - "skill-availability.js"
Cohesion: 0.18
Nodes (17): 进攻力体检：红队 32 技能可用 32、坏 0；单查给出缺的环境变量与修法, buildModelTools(), core0(), defaultRenderStatus(), TEXT_OUT, bundledSkillSummaries(), checkSkill(), dshHomeCandidates() (+9 more)

### Community 36 - "ref_node_fs"
Cohesion: 0.16
Nodes (15): 三份 spawnEnv 分叉：只有 desktop 那份兜底 DSH_PROFILE, 重启阶梯（web 杀旧服务等端口 / desktop 杀兄弟进程挪 asar / 卸载走 rmtree）, envForDetachedSpawn(), killOtherDesktopProcesses(), child, killOldServer(), openBrowser(), portFree() (+7 more)

### Community 37 - "isFile"
Cohesion: 0.22
Nodes (20): ensureDirSync(), hasLegacyPermissionPin(), insertShimInject(), isFile(), isTextShim(), patchShim(), restoreFromBak(), revertAllShims() (+12 more)

### Community 38 - "host-sync.mjs"
Cohesion: 0.11
Nodes (16): argv, copyDir, copyMatches(), dryRun, force, head, home, m (+8 more)

### Community 39 - "child-process-hide.mjs"
Cohesion: 0.18
Nodes (17): builtinChildProcess(), ChildProcess, cp, exec, execFile, execFileSync, execSync, fork (+9 more)

### Community 40 - "findAiBaseWeb"
Cohesion: 0.24
Nodes (18): collectDirs(), dirHasDshLauncher(), execFileText(), findAiBaseWeb(), findDesktopShimDir(), findNpmPrefix(), findShimDir(), guessedPrefixDirs() (+10 more)

### Community 41 - ".dirOf"
Cohesion: 0.17
Nodes (4): slugify(), pngSize(), writeMeta(), assertPathWithin()

### Community 42 - "graphify-sync.mjs"
Cohesion: 0.25
Nodes (16): edgesOf(), ensureBaseline(), fail(), FILE_TYPES, foldRationale(), hyperEdgesOf(), INFERRED_OK, isSemantic() (+8 more)

### Community 43 - "check-locale.mjs"
Cohesion: 0.13
Nodes (13): 双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）, 双语文案拆开：源在 locale/*.json，运行时仍走构建期内联（拆源不拆加载）, argv, asJson, blocks, dicts, expectBlocks, file (+5 more)

### Community 44 - "anchor-gate.mjs"
Cohesion: 0.24
Nodes (15): apply(), buildInstructionHint(), classifyReasoning(), countWord(), decidePromotion(), extractInstructionPaths(), hasAnchoredReasoning(), instructionHintMessages() (+7 more)

### Community 45 - "build-locale.mjs"
Cohesion: 0.13
Nodes (13): block, checkOnly, clientPath, crlf, die(), en, marked, onlyEn (+5 more)

### Community 46 - "check-size.mjs"
Cohesion: 0.13
Nodes (13): alignSummary 的建议行：把状态灯翻译成下一步命令, 发版五关闸门：语法 / 体积预算 / 双语 key 一致性 / 清单一致性 / JSON 合法（npm run verify 一票过）, 模型工具契约表：lib/model-tools.js 一处定义，宿主 ctx.tools 与 MCP 共用（8 个工具）, alignSummary(), patchTally(), argv, asJson, BUDGETS (+5 more)

### Community 48 - "注入方式改造方案-1.1.34化.md（注入前置）"
Cohesion: 0.19
Nodes (13): 锚点核对法：上游源码 + npm 已发布产物双重比对, 四层防御：注入在前 / stripHarnessPersona / overlayOfficialIdentity / 文件级补丁短路, 注入位置前置（order -100000 / cap -99999）, 注入方式改造方案-1.1.34化.md（注入前置）, CAPABILITY_SECTION, capabilityProtocolText(), isCwdOnlyText(), isWorkspaceBaselineSection() (+5 more)

### Community 49 - "table-read.js"
Cohesion: 0.24
Nodes (9): IV, MASK, SLOT, SLOT_ROWS, TAG, MIX, mixKey(), sealSlot() (+1 more)

### Community 50 - "targetFiles"
Cohesion: 0.19
Nodes (14): allExisting(), allowTargetForPatch(), allowTargetPath(), allowTargetPathForAiBase(), filterTargetFiles(), firstExisting(), nestedPkg(), nestedTargetFiles() (+6 more)

### Community 51 - "apply"
Cohesion: 0.22
Nodes (13): apply(), autoApply(), currentSettleScope(), log(), settleInstalledPatches(), shimNeedsPatch(), uninstallHungPromptGlobal(), DESKTOP_SETTLE_DELAY_MS (+5 more)

### Community 52 - "role-section.js"
Cohesion: 0.32
Nodes (13): currentEngagementId(), evictRoleBySessionIfOverflow(), installSubagentRoleCapture(), isRedteamChild(), noteClaimedMessage(), parseRedteamRole(), readRoleFile(), remember() (+5 more)

### Community 53 - "check-manifest.mjs"
Cohesion: 0.14
Nodes (13): allow, alwaysShipped, asJson, block, copy, denies, extra, pkg (+5 more)

### Community 54 - "build-client.mjs"
Cohesion: 0.15
Nodes (12): applyAt, beginAt, body, client, clientPath, drillSrc, end, endAt (+4 more)

### Community 55 - "settings.js"
Cohesion: 0.32
Nodes (11): clampMaxAgents(), DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT, maxAgentsOf(), maxAgentsSourceOf(), readSettings(), saveMaxAgents(), settingsPathOf() (+3 more)

### Community 56 - "skill-fixes.js"
Cohesion: 0.23
Nodes (11): safeFix(), asArray(), canonicalTool(), cleanToolName(), ENV_HINTS, fixesForIssue(), FRP_FIX, LIGOLO_FIX (+3 more)

### Community 57 - "ref_node_path"
Cohesion: 0.17
Nodes (9): argv, id, name, outDir, outFile, rep, shotsDst, shotsSrc (+1 more)

### Community 58 - "dsh-purge.js"
Cohesion: 0.27
Nodes (5): args, main(), printStatus(), purge_drill：56 个 preset 平面工具收成一个只读聚合入口（接入而非堆叠）, lib/mcp-server.js：stdio 上的 JSON-RPC MCP server（initialize / tools/list / tools/call / ping）

### Community 59 - ".scoreReport"
Cohesion: 0.38
Nodes (7): RFC-3986, buildCurlCommand(), buildHttpRequest(), commandKind(), fillTemplate(), parseCurl(), parseTarget()

### Community 60 - "ip-utils.js"
Cohesion: 0.29
Nodes (6): cidrOf(), expandIpv6(), ipToInt(), isIpv6(), scopeOfIp(), scoreStageOf()

### Community 61 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build:client, build:locale, check-anchors, check:locale, check:manifest, check-size, graphify (+2 more)

### Community 62 - "embed-default-prompt.mjs"
Cohesion: 0.22
Nodes (7): embed-prompt, dest, packed, root, src, text, 发版固定流程：改 md 源 → embed-prompt 重封入 asset-table.js → bump 三份 README → pnpm update

### Community 63 - "verify.mjs"
Cohesion: 0.22
Nodes (8): argv, failures, files, jsons, notes, rootIdx, skipSize, walk()

### Community 64 - "web.js"
Cohesion: 0.54
Nodes (6): hostFromRequest(), portFromRequest(), restartArgv(), scheduleCleanupRestart(), scheduleRestart(), spawnRestartHelper()

### Community 65 - "ref_node_url"
Cohesion: 0.25
Nodes (6): built, client, clientPath, LEGAL, legalPath, root

### Community 66 - "适配-0.2.1-rc.2-差异分析.md（宿主升级核对）"
Cohesion: 0.38
Nodes (7): 三条破损补丁 #77 / #68 / #26, 死补丁 #40 移除与 84 → 83 计数, 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）, #82 教训：打包注释 //#region 不能当锚点第二行, 装梁神导致 pnpm 把安装副本覆盖回 1.1.72, memory/2026-10-22.md（1.1.73–1.1.75 实战日志）, .workbuddy-ai/memory/MEMORY.md（项目长期记忆）

### Community 67 - "mnemon-settings.js"
Cohesion: 0.48
Nodes (6): normalizeRewriteOptions(), atomicWriteFileSync(), DEFAULT_SETTINGS, loadMnemonSettings(), mnemonSettingsPath(), saveMnemonSettings()

### Community 68 - "store.js"
Cohesion: 0.38
Nodes (5): apply(), inject, name, readSelfPackage(), resolveRoot()

### Community 72 - "collectInjectText"
Cohesion: 0.50
Nodes (4): CTF CORE CONTRACT / SCOPE / EVIDENCE / WORKFLOW 四段, Little Code Sauce / YG 人格框架（SANDBOX — STABLE）, HARD OUTPUT RULES + 拒绝对抗（禁止词表与整轮重写）, collectInjectText()

## Ambiguous Edges - Review These
- `applyPatches()` → `settings.png（1064×1972，补丁页截图）`  [AMBIGUOUS]
  docs/preview/settings.png · relation: references

## Knowledge Gaps
- **3 isolated node(s):** `BIN`, `RFC-3986`, `RFC-1918`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 360 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `README.md（中文主文档）` connect `net-scope.js` to `update.js`, `default-prompt-inject.md（当前生效的注入正文）`, `rules.js`, `ref_node_fs`, `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`, `core.js`, `skills.js`, `client.js`, `check-locale.mjs`, `rewind.js`, `package.json`, `check-size.mjs`, `lib/index.js`, `注入方式改造方案-1.1.34化.md（注入前置）`, `dsh-purge.js`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `default-prompt-inject.md（当前生效的注入正文）` (e.g. with `v1.1.34-prompt-inject.md（历史版本快照）` and `defaultOverrideText()`) actually correct?**
  _`default-prompt-inject.md（当前生效的注入正文）` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `BIN`, `RFC-3986`, `RFC-1918` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `desktop.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05326460481099656 - nodes in this community are weakly interconnected._
- **Why does `RedteamStore` connect `RedteamStore` to `skill-availability.js`, `store.js`, `store-core.js`, `.dirOf`, `platform-config.js`, `.db`, `.reportTargets`, `ref_node_path`, `dsh-purge.js`, `.scoreReport`, `ip-utils.js`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Should `update.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06583072100313479 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `applyPatches()` and `settings.png（1064×1972，补丁页截图）`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._