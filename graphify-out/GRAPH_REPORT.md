# Graph Report - dsh-purge  (2026-11-13)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2863 nodes · 7289 edges · 116 communities (109 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 241 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `998808a2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ctf-sandbox-orchestrator（流程/编排 / flow）
- update.js
- desktop.js
- uninstall.js
- skills.js
- store-core.js
- lib/index.js
- core.js
- identity.js
- rules.js
- client.js
- rewind.js
- .db
- net-scope.js
- redteam/client.js
- restart-desktop.js
- check-package.mjs
- ref_node_path
- main
- verify.mjs
- RedteamStore
- ui.js
- scripts
- build-skill-graph.mjs
- extract-asar.js
- RewindButton
- reapply.js
- check-tools.mjs
- handlePurgeCommand
- tools.js
- continue-retry.js
- findDshHome
- .openEngagement
- PurgeDock
- hide-console.js
- check-anchors.mjs
- ref_node_process
- cmd-route.js
- platform-config.js
- inject-second-shot.mjs
- applyPatches
- package.json
- revertAll
- defaultOverrideText
- skill-availability.js
- model-tools.js
- silenceCmdFlash
- gatherState
- validate-input.js
- write-smoke.mjs
- report.mjs
- tools-smoke.mjs
- steps
- graph-audit.mjs
- prune-host-leftovers.mjs
- isRedteamSession
- inject-runnability.mjs
- PurgifySection
- host.js
- isFile
- host-sync.mjs
- redteam-setup.sh
- apiJson
- README.md（中文主文档）
- child-process-hide.mjs
- check-skill-runnable.mjs
- graphify-sync.mjs
- check-locale.mjs
- ref_node_fs
- role-section.js
- anchor-gate.mjs
- build-locale.mjs
- toolkit-windows.mjs
- market-sweep.mjs
- scenario-drill.mjs
- table-read.js
- surface.js
- scope.js
- check-manifest.mjs
- score-radar.js
- build-client.mjs
- check-scope-gate.mjs
- settings.js
- audit-skills.mjs
- wordlists-windows.mjs
- .scoreReport
- official-update.js
- check-upstream.mjs
- install
- export-engagement-report.mjs
- buildModelTools
- profile-guard.js
- ip-utils.js
- .dirOf
- normalize-skill-headings.mjs
- embed-default-prompt.mjs
- exports
- 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）
- ingest.js
- store.js
- 0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）
- RewindSafe
- RtBoundary
- drill-grant.js
- searchIndex
- presentLoose
- ContinueSafe
- preset.yml
- default-prompt-inject.zh.md（中文版注入正文）
- repository
- derivePrevVersion
- extractPatches
- has
- discoverPkgs
- outOfScope

## God Nodes (most connected - your core abstractions)
1. `RedteamStore` - 116 edges
2. `installWebServer()` - 65 edges
3. `findDshHome()` - 57 edges
4. `ctf-sandbox-orchestrator（流程/编排 / flow）` - 46 edges
5. `default-prompt-inject.md（当前生效的注入正文）` - 42 edges
6. `角色 攻击面专项（由 ctf-sandbox-orchestrator 路由）（41 个技能）` - 41 edges
7. `scripts` - 38 edges
8. `buildModelTools()` - 37 edges
9. `handlePurgeCommand()` - 35 edges
10. `nowIso()` - 35 edges

## Surprising Connections (you probably didn't know these)
- `#82 教训：打包注释 //#region 不能当锚点第二行` --semantically_similar_to--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED] [semantically similar]
  lib/core.js → docs/适配-0.2.1-rc.2-差异分析.md
- `settings.png（1064×1972，补丁页截图）` --references--> `applyPatches()`  [AMBIGUOUS]
  docs/preview/settings.png → lib/core.js
- `ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）` --semantically_similar_to--> `进攻条令 — ATTACK DOCTRINE（输出即火力）`  [INFERRED] [semantically similar]
  docs/v1.1.34-prompt-inject.md → lib/default-prompt-inject.md
- `CTF CORE CONTRACT / SCOPE / EVIDENCE / WORKFLOW 四段` --semantically_similar_to--> `Little Code Sauce / YG 人格框架（SANDBOX — STABLE）`  [INFERRED] [semantically similar]
  docs/v1.1.34-prompt-inject.md → lib/default-prompt-inject.md
- `asar 密封态 = 补丁是否真生效的判据` --references--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED]
  lib/restart-desktop.js → docs/适配-0.2.1-rc.2-差异分析.md

## Import Cycles
- 2-file cycle: `lib/core.js -> lib/desktop.js -> lib/core.js`
- 3-file cycle: `lib/core.js -> lib/hide-console.js -> lib/desktop.js -> lib/core.js`

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

## Communities (116 total, 7 thin omitted)

### Community 0 - "ctf-sandbox-orchestrator（流程/编排 / flow）"
Cohesion: 0.05
Nodes (151): v1.1.34-prompt-inject.md（历史版本快照）, CTF CORE CONTRACT / SCOPE / EVIDENCE / WORKFLOW 四段, WEB PENTEST ROUTING 与 canned slots（技能路由表的前身）, ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）, default-prompt-inject.md（当前生效的注入正文）, 生成物即资产：工程性 / 连续性 / 项目性三纪律, 进攻条令 — ATTACK DOCTRINE（输出即火力）, 火力阶梯五级（打光弹药才停火） (+143 more)

### Community 1 - "update.js"
Cohesion: 0.07
Nodes (84): 生态约定对照：8 个同机插件里 4 个声明 engines.dsh、4 个用 dsh.compatibility, 渠道双车道与钉选（stable=master / beta，pin 固定旧版本）, atomicWriteSync(), applyUpdate(), _applyUpdateImpl(), archiveTarballUrl(), archiveZipUrl(), autoUpdateGuardPath() (+76 more)

### Community 2 - "desktop.js"
Cohesion: 0.06
Nodes (79): rememberDesktopInstallForHandoff(), scheduleSealedDesktopRestart(), ASAR_RENAME_WHEN_IDLE_PS1, ASAR_RENAME_WHEN_IDLE_SH, ASAR_SWAP_PS1, cleanupLegacyRestartScripts(), cmdEntryAlreadyGood(), commonDesktopInstallDirs() (+71 more)

### Community 3 - "uninstall.js"
Cohesion: 0.06
Nodes (68): clearLiveSelectedDefault(), clearOwnedSelectedDefault(), configSet(), configValue(), isOwnedPresetId(), listProfilePatchFiles(), OWNED_PRESET_IDS, readText() (+60 more)

### Community 4 - "skills.js"
Cohesion: 0.10
Nodes (61): handleSkillsCommand(), handleSkillsOp(), renderSkillsStatus(), assertImportSourceOutsideSkills(), assertInside(), backupExisting(), blockScalarValue(), copyDir() (+53 more)

### Community 5 - "store-core.js"
Cohesion: 0.08
Nodes (51): RFC-1918, ASSET_FTS_DDL, DDL, guessPocCategory(), HAS_FTS5, KNOWLEDGE_DDL, migrate(), migrateKnowledge() (+43 more)

### Community 6 - "lib/index.js"
Cohesion: 0.07
Nodes (58): pinDshHome(), repairOfficialCliAfterUnpack(), currentSurface(), isMnemonPluginMessage(), allowPluginRequest(), apply(), applyHostHooks(), autoApply() (+50 more)

### Community 7 - "core.js"
Cohesion: 0.06
Nodes (58): AI_RESOLVE_IDS, allExisting(), ALLOW_EXEC_CORE, allowTargetForPatch(), allowTargetPath(), allowTargetPathForAiBase(), ALWAYS_SOFT_STATUSES, APPLY_STATUS_RANK (+50 more)

### Community 8 - "identity.js"
Cohesion: 0.07
Nodes (55): 锚点核对法：上游源码 + npm 已发布产物双重比对, 四层防御：注入在前 / stripHarnessPersona / overlayOfficialIdentity / 文件级补丁短路, 注入位置前置（order -100000 / cap -99999）, 注入方式改造方案-1.1.34化.md（注入前置）, CAPABILITY_SECTION, capabilityProtocolText(), Little Code Sauce / YG 人格框架（SANDBOX — STABLE）, HARD OUTPUT RULES + 拒绝对抗（禁止词表与整轮重写） (+47 more)

### Community 9 - "rules.js"
Cohesion: 0.12
Nodes (52): atomicCopyFile(), atomicWriteFile(), hangOperatorPrompt(), hungOperatorPrompt(), peekCommittedOverride(), handleRulesCommand(), handleRulesOp(), renderRulesStatus() (+44 more)

### Community 10 - "client.js"
Cohesion: 0.08
Nodes (46): AgentsTab(), applyDrillParts(), AssetsTab(), AttackFilesTab(), bothInjectEmpty(), ChainTab(), clampRtGeom(), Clip() (+38 more)

### Community 11 - "rewind.js"
Cohesion: 0.11
Nodes (48): analyzeRewind(), applyRewind(), asEventList(), createBlank(), disarmRewoundSession(), disposeObservation(), doRewindOneSession(), errorText() (+40 more)

### Community 12 - ".db"
Cohesion: 0.08
Nodes (9): nowIso(), tunnelIsLegit(), normGained(), parseJson(), targetKey(), normalizeShellStatus(), normalizeShellType(), WEBSHELL_STATUSES (+1 more)

### Community 13 - "net-scope.js"
Cohesion: 0.09
Nodes (40): addHost(), allowCache, allowDecision(), allowFilePath(), appendDenial(), BANK_HOSTS, bankHit(), collectFromText() (+32 more)

### Community 14 - "redteam/client.js"
Cohesion: 0.10
Nodes (36): AgentsTab(), apply(), AssetsTab(), AttackFilesTab(), ChainTab(), clampRtGeom(), Clip(), ConcurrencyCard() (+28 more)

### Community 15 - "restart-desktop.js"
Cohesion: 0.10
Nodes (36): 三份 spawnEnv 分叉：只有 desktop 那份兜底 DSH_PROFILE, 重启阶梯（web 杀旧服务等端口 / desktop 杀兄弟进程挪 asar / 卸载走 rmtree）, envForDetachedSpawn(), asarStillSealed(), commandMatchesExe(), darwinBundleName(), darwinBundleOf(), killOtherDesktopProcesses() (+28 more)

### Community 16 - "check-package.mjs"
Cohesion: 0.05
Nodes (37): asJson, CLAIM_FILES, CN, cnNum, declaredParams, descNumM, EN, fileKeyList (+29 more)

### Community 17 - "ref_node_path"
Cohesion: 0.06
Nodes (26): 关 11 CLI 冒烟：真跑 bin 的只读模式（此前十关没一关执行过 CLI 分发）, PROMPTS, checkOnly, dry, root, STEPS, checks, problems (+18 more)

### Community 18 - "main"
Cohesion: 0.08
Nodes (32): args, main(), MODES, printStatus(), alignSummary 建议行分档 + 设计内 skipped 清单（DESIGN_SKIPPED_VERIFIED，带 checkedAgainst/证据文档，第 22 项守它别烂）, CLI 实时验收 --verify-live：契约表/补丁分桶/注入状态/路由 live 四查，有 ⚠ 即非 0, lib/mcp-server.js：MCP 协议单一来源 mcpRespond —— stdio 循环与宿主 HTTP 路由 POST /dsh-purge/mcp 共用, alignSummary() (+24 more)

### Community 19 - "verify.mjs"
Cohesion: 0.06
Nodes (34): 社区情报主文档：独占性、目录规模、restart∩patch=0、长尾抽样、产物级对照、模块化判定、成本自述做法（七轮实测累计）, 同地盘地图：600 条样本里无人做提示词优先级治理，purge 的三档作用域已被 purge_rules 报出, 生态漂移探测 sweep:market：把六趟手打的复查口径写死进代码（FIELDS + 正则 + 基线），交集被吃进即判失败, 生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字, 社区同路原则：one stable proxy tool instead of N tool schemas（dsh-mcp-lazy / dsh-mcp-lens 按需加载 schema）, 关 9 弹药层一致性审计：技能引用的工具名与条令点名的技能都必须真实存在, 发版七关闸门：语法 / 体积预算 / 双语 key 一致性 / 清单一致性 / 包自证 / 工具面 / JSON 合法（npm run verify 一票过）, 生态 tag 口径门禁：7 个 tag 全部满足「2000 条样本在用 + purge 真具备」，词形分裂按生态现状并存 (+26 more)

### Community 20 - "RedteamStore"
Cohesion: 0.11
Nodes (8): purge_drill：56 个 preset 平面工具收成聚合入口，18 op（读 8 + 写面收纳 update 四方法 / delete 三方法 / open / switch）, 组合式收纳：一个 entity 参数换 10 读面 + 13 写面（POC 五面闭环、资产登记/评估/测试回写）, op=entity_add：一个 op 覆盖六个写面（+92 字符 ≈15/面），shot/poc 明确不接并说明原因, defaultPocFilename(), slugPoc(), pocCategoryName(), promptHash(), RedteamStore

### Community 21 - "ui.js"
Cohesion: 0.12
Nodes (36): mergeConfigEnv(), officialSkillSummaries(), summarizeSkills(), dispatchAsync(), apply(), applyUpdate(), checkLatest(), checkLatestFromGithub() (+28 more)

### Community 22 - "scripts"
Cohesion: 0.05
Nodes (37): scripts, audit:graph, audit:skills, build:client, build:locale, build:skills, build:skills-graph, check-anchors (+29 more)

### Community 23 - "build-skill-graph.mjs"
Cohesion: 0.06
Nodes (31): agents, assigned, byDomainStage, CN_NOISE, DOMAIN_RULES, dry, dupRel, files (+23 more)

### Community 24 - "extract-asar.js"
Cohesion: 0.13
Nodes (33): restoreSealedExtract(), restoreUnusableExtract(), activeProbes(), archiveFs(), asarEntrySize(), asarFileIn(), asarShadowsPath(), commitExtractedDir() (+25 more)

### Community 25 - "RewindButton"
Cohesion: 0.11
Nodes (25): armComposerFill(), clearStoredDraft(), ContinueButton(), conversationFace(), conversationInput(), currentSessionId(), dropInheritedQueue(), fillComposer() (+17 more)

### Community 26 - "reapply.js"
Cohesion: 0.17
Nodes (31): 宿主重置后的补丁判失与 applied stamp 自愈, hostCleanMarkersPresent(), settleInstalledPatches(), appliedStampPath(), applyPlaceholderVersion(), canHealEmptyStamp(), ensureInstalledRevSeed(), healEmptyAppliedStamp() (+23 more)

### Community 27 - "check-tools.mjs"
Cohesion: 0.07
Nodes (28): describeToolkit(), scanToolkit(), shellAdvice(), asJson, blocks, BUDGET, drillTool, entBlock (+20 more)

### Community 28 - "handlePurgeCommand"
Cohesion: 0.12
Nodes (32): aiBaseBelongsToExe(), allPatchHostsWritten(), applyPatchesAllHosts(), clearDesktopLocateCache(), desktopAsarStillSealed(), ensureHostClean(), mergeApplyReports(), missingAiBaseMessage() (+24 more)

### Community 29 - "tools.js"
Cohesion: 0.09
Nodes (23): PLANNER_ROLE, ROLE_ORDER, ROLE_TITLES, addCandidate(), AGENT_PARAM, apply(), bindingKeyOf(), bindings (+15 more)

### Community 30 - "continue-retry.js"
Cohesion: 0.12
Nodes (26): ABNORMAL_KINDS, clampCount(), createTracker(), DEFAULT_CONTINUE_RETRY, failureCodeOf(), hasFreshHumanTurn(), inboxBusy(), inspectTurn() (+18 more)

### Community 31 - "findDshHome"
Cohesion: 0.14
Nodes (30): aiBaseGuessesAround(), aiBaseGuessesFor(), aiBaseUnderAppDir(), applyRuntimeEnv(), dshBaseEnvStatus(), enumeratePatchAiBases(), findAiBaseDesktop(), findAiBaseFromDshHome() (+22 more)

### Community 32 - ".openEngagement"
Cohesion: 0.13
Nodes (7): 真 bug：openEngagement 把 scope 串直接存进 scope_cidrs，导致 report() 的 .join 抛错, op=report：战报 / kind=score 得分报告 / kind=targets 目标汇总（零新增参数收纳，输出 2-16 行有界）, slugify(), slugTarget(), cidrList(), readMeta(), writeMeta()

### Community 33 - "PurgeDock"
Cohesion: 0.13
Nodes (28): apply(), AuthGate(), clampDockGeom(), defaultDockGeom(), EnvAdaptSendGate(), fetchEnvAdaptStatus(), hasInlinePurgeEntry(), HeroNewSessionMount() (+20 more)

### Community 34 - "hide-console.js"
Cohesion: 0.16
Nodes (27): ensureHiddenConsole(), findDshBinRoot(), isPackagedDesktopDshRoot(), inferDesktopInstallDir(), isAsarSealedPath(), isInsideDesktopInstall(), isSubPath(), looksLikeDesktopNameTail() (+19 more)

### Community 35 - "check-anchors.mjs"
Cohesion: 0.07
Nodes (24): argv, asPatched, asPostPatch, asWhitespace, fetched, fileCache, idxNew, idxOld (+16 more)

### Community 36 - "ref_node_process"
Cohesion: 0.08
Nodes (18): mcpRespond(), runMcpServer(), factory, notes, problems, root, userExists, userFp (+10 more)

### Community 37 - "cmd-route.js"
Cohesion: 0.13
Nodes (25): ALIASED, commandFor(), commandsForStage(), listWordlists(), NEEDS_PROXY, NUCLEI_FAST_FLAGS, nucleiReady(), PD_MUST_FLAG (+17 more)

### Community 38 - "platform-config.js"
Cohesion: 0.19
Nodes (26): adaptInDir(), assignToolkitFolder(), configPathOf(), defaultToolkitDir(), detectKali(), EMPTY(), envAdaptStatus(), findInDir() (+18 more)

### Community 39 - "inject-second-shot.mjs"
Cohesion: 0.08
Nodes (25): asJson, files, minIdx, noSection, qualified, root, rows, SKILLS (+17 more)

### Community 40 - "applyPatches"
Cohesion: 0.15
Nodes (27): applyPatches(), applyReplacementsToText(), asLf(), cloneRegExp(), collapseDuplicateLegacyApplyPath(), endOfBalancedBlock(), fileKeysOf(), filePatchOutcome() (+19 more)

### Community 41 - "package.json"
Cohesion: 0.08
Nodes (25): npm run host-sync：把「仓库 → 宿主 profile 副本」这条重复手工动作固化, 清单一致性闸门：COPY_NAMES（自更新）必须落在 files（发布）之内, COPY_NAMES, bin, dsh-purge, bugs, url, description (+17 more)

### Community 42 - "revertAll"
Cohesion: 0.18
Nodes (26): backupAll(), collectRevertTargets(), dropStaleUserProfilePatchBackups(), ensureOfficialSnapshot(), flattenTargetPaths(), hasBackup(), hostBakDigest(), hostBakVaultRoot() (+18 more)

### Community 43 - "defaultOverrideText"
Cohesion: 0.21
Nodes (26): commitOverrideOnApply(), defaultOverrideHash(), defaultOverrideText(), editOverride(), findOverrideFile(), hashOverride(), installOverride(), isKeepableUserOverride() (+18 more)

### Community 44 - "skill-availability.js"
Cohesion: 0.14
Nodes (23): 进攻力体检：红队 32 技能可用 32、坏 0；单查给出缺的环境变量与修法, bundledSkillSummaries(), checkSkill(), dshHomeCandidates(), existsUnderAnyHome(), expandSkillPath(), pathCountsOnThisHost(), readSkillFromRoot() (+15 more)

### Community 45 - "model-tools.js"
Cohesion: 0.11
Nodes (18): hostEnumerationLine(), BRIEF_SUFFIX, core0(), defaultRenderStatus(), DRILL_ENTITIES, DRILL_WRITE_ENTITIES, escapeRe(), expandQuery() (+10 more)

### Community 46 - "silenceCmdFlash"
Cohesion: 0.13
Nodes (24): keepLiangshenOperatorPrompt(), keepSurfaceFile(), liangshenPromptFilterText(), listDoctorCliFiles(), listDshmarketRestartFiles(), listLiangshenBootstrapFiles(), listLiangshenCustomBashFiles(), listLiangshenMinimalPromptFiles() (+16 more)

### Community 47 - "gatherState"
Cohesion: 0.16
Nodes (24): collectDirs(), dirHasDshLauncher(), displayTitleOf(), execFileText(), findDesktopShimDir(), findNpmPrefix(), findShimDir(), gatherState() (+16 more)

### Community 48 - "validate-input.js"
Cohesion: 0.14
Nodes (23): ASSET_PRIORITIES, ASSET_TEST_STATES, issue(), LEGACY_STAGES, parseScopeString(), renderIssue(), renderIssues(), REPORT_KINDS (+15 more)

### Community 49 - "write-smoke.mjs"
Cohesion: 0.09
Nodes (17): beforePending, childFile, expected, expectedSrc, fakeBase, fixture, home, hostBase (+9 more)

### Community 50 - "report.mjs"
Cohesion: 0.09
Nodes (21): argv, checkDebt, day, dbPath, debtLines, failures, liveLines, md (+13 more)

### Community 51 - "tools-smoke.mjs"
Cohesion: 0.09
Nodes (19): BS, child, childFile, env, fakeBase, fx, home, hostBase (+11 more)

### Community 52 - "steps"
Cohesion: 0.09
Nodes (21): concurrency, cancel-in-progress, group, GH_TOKEN, jobs, release, name, on (+13 more)

### Community 53 - "graph-audit.mjs"
Cohesion: 0.10
Nodes (21): asJson, deadExports, fileInbound, g, graphBlind, graphPath, hasName(), inbound (+13 more)

### Community 54 - "prune-host-leftovers.mjs"
Cohesion: 0.12
Nodes (17): ensureAppRuntimeSymlink(), isDir(), repairOfficialCliAfterUnpack(), resourcesDirForExecutable(), anchor, apply, asJson, candidates (+9 more)

### Community 55 - "isRedteamSession"
Cohesion: 0.17
Nodes (20): childOrigin(), inheritsParentPrompt(), installAssembleGuard(), isChildAgentContext(), isRedteamSession(), isRedteamSubagent(), sessionForInject(), sessionOfContext() (+12 more)

### Community 56 - "inject-runnability.mjs"
Cohesion: 0.12
Nodes (19): ALIAS, checkOnly, drift, dry, esc(), files, has(), have (+11 more)

### Community 57 - "PurgifySection"
Cohesion: 0.15
Nodes (19): clientGuessSurface(), detectHostTheme(), hostSurfaceOf(), hostText(), keepListedVersion(), PatchGroups(), patchIdLabel(), patchRowsOf() (+11 more)

### Community 58 - "host.js"
Cohesion: 0.17
Nodes (16): markersAny=true 的补丁：applied 只代表「至少打了一处」，会藏半个没打的门, 状态面升级：补丁按 已清洗/待清洗/锚点未命中/不适用/缺文件 分桶 + 宿主版本对齐告警, 未安装项整体摘除：83 → 76 条补丁，面板 0 不适用 / 0 缺文件, ADAPTERS, hostAdapter(), hostAlignment(), restartNote(), scheduleCleanupRestart() (+8 more)

### Community 59 - "isFile"
Cohesion: 0.22
Nodes (19): ensureDirSync(), hasLegacyPermissionPin(), insertShimInject(), isFile(), isTextShim(), patchShim(), restoreFromBak(), revertAllShims() (+11 more)

### Community 60 - "host-sync.mjs"
Cohesion: 0.11
Nodes (16): argv, copyDir, copyMatches(), dryRun, force, head, home, m (+8 more)

### Community 61 - "redteam-setup.sh"
Cohesion: 0.27
Nodes (18): ask(), ask_secret(), bad(), BIN, cur_env(), dim(), dl_asset(), doctor() (+10 more)

### Community 62 - "apiJson"
Cohesion: 0.15
Nodes (18): apiJson(), apiTimeoutMs(), apiUrl(), Btn(), clientCurrentCwd(), ContinueRetrySection(), formatSize(), isAbortError() (+10 more)

### Community 63 - "README.md（中文主文档）"
Cohesion: 0.17
Nodes (18): banner.svg（720×180 项目横幅）, 硬编码 replace 清理的措辞漂移风险, dock-auth.png（850×925，演练台授权页截图）, dock-clean.png（800×850，清洗页侧栏截图）, dock-drill.png（900×850，演练台截图）, own-servers.png（652×509，自己的服务器白名单截图·中文）, own-servers-en.png（652×505，自己的服务器白名单截图·英文）, rules.png（1064×1244，规则集截图） (+10 more)

### Community 64 - "child-process-hide.mjs"
Cohesion: 0.18
Nodes (17): builtinChildProcess(), ChildProcess, cp, exec, execFile, execFileSync, execSync, fork (+9 more)

### Community 65 - "check-skill-runnable.mjs"
Cohesion: 0.11
Nodes (15): argvLimit, asJson, files, have, LINUX_MARKS, linuxRows, missRows, root (+7 more)

### Community 66 - "graphify-sync.mjs"
Cohesion: 0.25
Nodes (17): edgesOf(), ensureBaseline(), fail(), FILE_TYPES, foldRationale(), hyperEdgesOf(), INFERRED_OK, isSemantic() (+9 more)

### Community 67 - "check-locale.mjs"
Cohesion: 0.12
Nodes (14): 双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）, 双语文案拆开：源在 locale/*.json，运行时仍走构建期内联（拆源不拆加载）, default-prompt-inject.en.md（英文版注入正文）, argv, asJson, blocks, dicts, expectBlocks (+6 more)

### Community 68 - "ref_node_fs"
Cohesion: 0.12
Nodes (12): findResourcesDir(), appDir, argv, asar, parked, res, extractBlock(), judge() (+4 more)

### Community 69 - "role-section.js"
Cohesion: 0.28
Nodes (15): currentEngagementId(), evictRoleBySessionIfOverflow(), installSubagentRoleCapture(), isRedteamChild(), noteClaimedMessage(), parseRedteamRole(), readRoleFile(), remember() (+7 more)

### Community 70 - "anchor-gate.mjs"
Cohesion: 0.24
Nodes (15): apply(), buildInstructionHint(), classifyReasoning(), countWord(), decidePromotion(), extractInstructionPaths(), hasAnchoredReasoning(), instructionHintMessages() (+7 more)

### Community 71 - "build-locale.mjs"
Cohesion: 0.13
Nodes (13): block, checkOnly, clientPath, crlf, die(), en, marked, onlyEn (+5 more)

### Community 72 - "toolkit-windows.mjs"
Cohesion: 0.14
Nodes (12): argv, checkOnly, download(), exists(), force, NL, onlyIdx, picks (+4 more)

### Community 73 - "market-sweep.mjs"
Cohesion: 0.16
Nodes (13): all, asJson, BASELINE, both, cacheFile, diffs, FIELDS(), got (+5 more)

### Community 74 - "scenario-drill.mjs"
Cohesion: 0.19
Nodes (13): 端到端情景第八关：20 步串 op 并断言回读，专抓组合期「说谎的回读」与跨 op 不一致, drill, failures, has(), liveStore, main(), not(), re() (+5 more)

### Community 75 - "table-read.js"
Cohesion: 0.24
Nodes (9): IV, MASK, SLOT, SLOT_ROWS, TAG, MIX, mixKey(), sealSlot() (+1 more)

### Community 76 - "surface.js"
Cohesion: 0.31
Nodes (12): findAiBase(), adoptSurfaceForAiBase(), aiBaseLooksDesktopInstall(), detectSurface(), exeName(), forcedSurface(), isDesktopSurface(), norm() (+4 more)

### Community 77 - "scope.js"
Cohesion: 0.30
Nodes (13): checkAction(), checkTarget(), checkTechnique(), cidrInsideCidr(), ipInCidr(), ipv4ToInt(), isDomain(), isIpv4() (+5 more)

### Community 78 - "check-manifest.mjs"
Cohesion: 0.14
Nodes (13): allow, alwaysShipped, asJson, block, copy, denies, extra, pkg (+5 more)

### Community 79 - "score-radar.js"
Cohesion: 0.23
Nodes (12): aggregateHits(), COST_LABEL, FINGERPRINT_RULES, hostKey(), looksWebHost(), matchFingerprints(), radarOneLine(), radarState() (+4 more)

### Community 80 - "build-client.mjs"
Cohesion: 0.15
Nodes (12): applyAt, beginAt, body, client, clientPath, drillSrc, end, endAt (+4 more)

### Community 81 - "check-scope-gate.mjs"
Cohesion: 0.15
Nodes (9): asJson, CASES, fails, NOW, root, scope, skipped, TECHS (+1 more)

### Community 82 - "settings.js"
Cohesion: 0.32
Nodes (11): clampMaxAgents(), DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT, maxAgentsOf(), maxAgentsSourceOf(), readSettings(), saveMaxAgents(), settingsPathOf() (+3 more)

### Community 83 - "audit-skills.mjs"
Cohesion: 0.17
Nodes (11): asJson, doctrineFiles, ghostRefs, linkProblems, missingSkills, realTools, root, skillDir (+3 more)

### Community 84 - "wordlists-windows.mjs"
Cohesion: 0.20
Nodes (10): checkOnly, dir, fetchList(), force, LISTS, only, onlyArg, picks (+2 more)

### Community 85 - ".scoreReport"
Cohesion: 0.33
Nodes (8): RFC-3986, buildCurlCommand(), buildHttpRequest(), commandKind(), fillTemplate(), parseCurl(), parseTarget(), scoreConfirmOf()

### Community 86 - "official-update.js"
Cohesion: 0.33
Nodes (10): asar 密封态 = 补丁是否真生效的判据, 官方客户端升级回写标记 dsh-purge-reapply-asar, hostFs, clearStaleExtractedApps(), clearUpgradeMarker(), harnessExeName(), upgradeMarkerExists(), upgradeMarkerPath() (+2 more)

### Community 87 - "check-upstream.mjs"
Cohesion: 0.24
Nodes (10): 上游漂移探测 check:upstream：latest vs dshTarget vs engines，越界才判失败、离线只报未知, asJson, cmp(), core3(), inRange(), pkg, range, root (+2 more)

### Community 88 - "install"
Cohesion: 0.18
Nodes (11): patch, inject, platform, dsh, bundle, client, install, git (+3 more)

### Community 89 - "export-engagement-report.mjs"
Cohesion: 0.18
Nodes (9): argv, id, name, outDir, outFile, rep, shotsDst, shotsSrc (+1 more)

### Community 90 - "buildModelTools"
Cohesion: 0.31
Nodes (8): buildModelTools(), judgeScopePressure(), pressureNext(), renderPressure(), routeCredentials(), routeIntranet(), routeRecon(), routeTunnel()

### Community 91 - "profile-guard.js"
Cohesion: 0.44
Nodes (9): guardProfilePatch(), inspectHostHealth(), listPatchBackups(), missingPackages(), packageInstalled(), packageOf(), profilePatchIsEmpty(), sanitizePatchText() (+1 more)

### Community 92 - "ip-utils.js"
Cohesion: 0.29
Nodes (6): cidrOf(), expandIpv6(), ipToInt(), isIpv6(), scopeOfIp(), scoreStageOf()

### Community 94 - "normalize-skill-headings.mjs"
Cohesion: 0.24
Nodes (9): checkOnly, demote(), dropRedundantH1(), dry, files, normalize(), remaining, root (+1 more)

### Community 95 - "embed-default-prompt.mjs"
Cohesion: 0.22
Nodes (7): embed-prompt, dest, packed, root, src, text, 发版固定流程：改 md 源 → embed-prompt 重封入 asset-table.js → bump 三份 README → pnpm update

### Community 96 - "exports"
Cohesion: 0.25
Nodes (8): exports, ./client, ./locale/*.json, ./package.json, ./redteam, ./redteam/store, ./redteam/tools, ./redteam/ui

### Community 97 - "适配-0.2.1-rc.2-差异分析.md（宿主升级核对）"
Cohesion: 0.38
Nodes (7): 三条破损补丁 #77 / #68 / #26, 死补丁 #40 移除与 84 → 83 计数, 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）, #82 教训：打包注释 //#region 不能当锚点第二行, 装梁神导致 pnpm 把安装副本覆盖回 1.1.72, memory/2026-10-22.md（1.1.73–1.1.75 实战日志）, .workbuddy-ai/memory/MEMORY.md（项目长期记忆）

### Community 98 - "ingest.js"
Cohesion: 0.43
Nodes (6): importCommands(), parseArtifacts(), parseHttpxLine(), parseNucleiLine(), parsePortLine(), toBundle()

### Community 99 - "store.js"
Cohesion: 0.38
Nodes (5): apply(), inject, name, readSelfPackage(), resolveRoot()

### Community 100 - "0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）"
Cohesion: 0.47
Nodes (6): 0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）, 宿主实况：桌面 EXE 0.2.2-rc.1 / runtime 0.2.2-rc.1 / cordis 4.1.0, 0.2.2-rc.1 包搬家两例：PTC 执行器拆成 dsh-tool-executor-ptc、交付物提示词拆成 dsh-deliverable-file-references, 宿主枚举可见化：gatherState 出 patch_hosts 四字段 + hostEnumerationLine 单一格式化器，四个状态面共用, dshHostVersion(), readJsonVersion()

### Community 103 - "drill-grant.js"
Cohesion: 0.80
Nodes (4): clearDrillGrant(), drillGrantPath(), readDrillGrant(), writeDrillGrant()

### Community 104 - "searchIndex"
Cohesion: 0.40
Nodes (5): applySynonyms(), extractCnFromHeadings(), extractProper(), isGoodCn(), searchIndex

### Community 105 - "presentLoose"
Cohesion: 0.50
Nodes (5): collapse(), collapsedIdx(), postPatch(), presentLoose(), whitespaceOnly()

### Community 107 - "preset.yml"
Cohesion: 0.50
Nodes (3): description, name, order

### Community 108 - "default-prompt-inject.zh.md（中文版注入正文）"
Cohesion: 1.00
Nodes (3): default-prompt-inject.zh.md（中文版注入正文）, 草稿审查 R1–R8 缺陷清单, Scoped Rules 动态路由（25 条按意图激活）

### Community 109 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 110 - "derivePrevVersion"
Cohesion: 0.67
Nodes (3): cmpVer(), derivePrevVersion(), verKey()

### Community 111 - "extractPatches"
Cohesion: 0.67
Nodes (3): decodeLit(), decodeSgl(), extractPatches()

### Community 112 - "has"
Cohesion: 0.67
Nodes (3): has(), missingShots, noInstall

## Ambiguous Edges - Review These
- `applyPatches()` → `settings.png（1064×1972，补丁页截图）`  [AMBIGUOUS]
  docs/preview/settings.png · relation: references

## Knowledge Gaps
- **3 isolated node(s):** `RFC-3986`, `RFC-1918`, `BIN`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 813 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `README.md（中文主文档）` connect `README.md（中文主文档）` to `ctf-sandbox-orchestrator（流程/编排 / flow）`, `update.js`, `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`, `check-locale.mjs`, `skills.js`, `lib/index.js`, `core.js`, `identity.js`, `rules.js`, `client.js`, `rewind.js`, `package.json`, `net-scope.js`, `preset.yml`, `restart-desktop.js`, `main`, `verify.mjs`, `host.js`?**
  _High betweenness centrality (0.136) - this node is a cross-community bridge._
- **What connects `RFC-3986`, `RFC-1918`, `BIN` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `ctf-sandbox-orchestrator（流程/编排 / flow）` be split into smaller, more focused modules?**
  _Cohesion score 0.053863134657836646 - nodes in this community are weakly interconnected._
- **Why does `release-notes.md（1.1.72 → 1.1.83 演化史）` connect `ctf-sandbox-orchestrator（流程/编排 / flow）` to `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`, `update.js`, `check-locale.mjs`, `0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）`, `store-core.js`, `identity.js`, `client.js`, `verify.mjs`, `reapply.js`, `README.md（中文主文档）`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Should `update.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06974789915966387 - nodes in this community are weakly interconnected._
- **Why does `RedteamStore` connect `RedteamStore` to `.openEngagement`, `store.js`, `store-core.js`, `platform-config.js`, `scenario-drill.mjs`, `.db`, `model-tools.js`, `.scoreReport`, `export-engagement-report.mjs`, `ip-utils.js`, `.dirOf`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `applyPatches()` and `settings.png（1064×1972，补丁页截图）`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._