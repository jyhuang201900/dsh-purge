# Graph Report - dsh-purge  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2888 nodes · 7329 edges · 118 communities (113 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 241 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `457c5eb8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Plugin Update Channels
- Drill Grants & Presets
- Core Config & Execution Control
- Skills Management
- ASAR Extraction & Sealed Host
- Knowledge DB Schema & Migration
- Host Patch Management
- Client UI Components
- Rules Management & File Ops
- Capability Protocol & Identity Guard
- Session Rewind
- Host Patching
- Security Assessment Tooling
- Agent Plugin Infrastructure
- Skill Build Scripts
- CTF Attack Surface Skills
- Version Patch Comparison
- Network Access Control
- Model Tooling & Entity Briefs
- Red Team UI Tabs
- Desktop Process Restart
- Package Check Script
- Skill Update & Config
- Build & Audit Scripts
- main
- Skill Graph Builder
- Chat Conversation Composer
- RedteamStore
- Client Patch UI Helpers
- Toolkit Health Check
- Agent Role Bindings
- Override Management
- CLI Smoke Testing
- Release Gate Audits
- Continue-Retry Logic
- Vulnerability Discovery Skills
- .openEngagement
- PurgeDock
- Profile Backup Management
- Command Routing Flags
- Platform Config Detection
- Second Shot Injection
- Sealed Runtime Patching
- Detection Pairing Verification
- Skill Availability Check
- Patch Application
- Directory Discovery & State
- Desktop Install Detection
- Pentest Agent Roles & Prompts
- Issue Validation & Reporting
- Package Publishing & Host Sync
- Smoke Test Fixtures & Hashing
- Debt Report Generation
- GitHub Release Workflow
- Dependency Graph Audit
- AI Base Discovery
- Desktop Surface Detection
- Intranet Penetration Skills
- CLI Shim Patching
- MCP Server Runtime
- Installability Checks
- Host File Sync
- Red Team Setup
- Child Process Hiding
- Skill Runnable Check
- Graph Sync Merge
- README.md（中文主文档）
- Locale Check And Build
- Subagent Role Tracking
- Reasoning Promotion Gate
- Reverse Engineering Exploits
- Locale Build Script
- Windows Toolkit CLI
- Patch Status Tracking
- Restart Scheduling
- Market Sweep Diffs
- Host Leftover Pruning
- Pentest Attack Doctrine
- Slot Table Keys
- Target File Resolution
- Network Scope Validation
- Package Manifest Checking
- HTTP Request Replay
- Prompt Injection Defense
- HTTP Routing Middleware
- Radar Scoring Fingerprinting
- API Client Builder
- Label Batch Processing
- Scenario Drill Runner
- IP Network Utilities
- Agent Settings Config
- Skill Audit Validation
- Wordlist Fetching
- Upstream Drift Detection
- Host Clean Verification
- Profile Guard Health
- Package Installation
- Desktop Install Path Resolution
- Attack File Management
- Security Workflow Skills
- Skill Heading Normalization
- Ecosystem Intelligence Report
- Prompt Asset Embedding
- CLI Shim Repair
- Display Rendering & Health Checks
- Package Exports & Module Structure
- Bundle Sync CLI
- Store Injection Registry
- React Error Boundary
- React Error Boundary
- Search Index Text Processing
- React Error Boundary
- CTF Prompt Framework
- Preset Config Fields
- Package Engine Config
- Repository Metadata
- Feature Flags

## God Nodes (most connected - your core abstractions)
1. `RedteamStore` - 116 edges
2. `installWebServer()` - 65 edges
3. `findDshHome()` - 57 edges
4. `ctf-sandbox-orchestrator（流程/编排 / flow）` - 46 edges
5. `default-prompt-inject.md（当前生效的注入正文）` - 42 edges
6. `角色 攻击面专项（由 ctf-sandbox-orchestrator 路由）（41 个技能）` - 41 edges
7. `scripts` - 39 edges
8. `buildModelTools()` - 37 edges
9. `handlePurgeCommand()` - 35 edges
10. `nowIso()` - 35 edges

## Surprising Connections (you probably didn't know these)
- `#82 教训：打包注释 //#region 不能当锚点第二行` --semantically_similar_to--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED] [semantically similar]
  lib/core.js → docs/适配-0.2.1-rc.2-差异分析.md
- `settings.png（1064×1972，补丁页截图）` --references--> `applyPatches()`  [AMBIGUOUS]
  docs/preview/settings.png → lib/core.js
- `生态漂移探测 sweep:market：把六趟手打的复查口径写死进代码（FIELDS + 正则 + 基线），交集被吃进即判失败` --part_of--> `生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字`  [INFERRED]
  scripts/market-sweep.mjs → docs/dsh-mcp-ecosystem-notes.md
- `社区同路原则：one stable proxy tool instead of N tool schemas（dsh-mcp-lazy / dsh-mcp-lens 按需加载 schema）` --supports--> `purge_drill：56 个 preset 平面工具收成聚合入口，18 op（读 8 + 写面收纳 update 四方法 / delete 三方法 / open / switch）`  [INFERRED]
  docs/dsh-mcp-ecosystem-notes.md → lib/model-tools.js
- `双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）` --references--> `default-prompt-inject.en.md（英文版注入正文）`  [INFERRED]
  scripts/check-locale.mjs → lib/default-prompt-inject.en.md

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

## Communities (118 total, 5 thin omitted)

### Community 0 - "Plugin Update Channels"
Cohesion: 0.07
Nodes (84): 生态约定对照：8 个同机插件里 4 个声明 engines.dsh、4 个用 dsh.compatibility, 渠道双车道与钉选（stable=master / beta，pin 固定旧版本）, atomicWriteSync(), applyUpdate(), _applyUpdateImpl(), archiveTarballUrl(), archiveZipUrl(), autoUpdateGuardPath() (+76 more)

### Community 1 - "Drill Grants & Presets"
Cohesion: 0.06
Nodes (72): clearDrillGrant(), drillGrantPath(), readDrillGrant(), writeDrillGrant(), clearLiveSelectedDefault(), clearOwnedSelectedDefault(), configSet(), configValue() (+64 more)

### Community 2 - "Core Config & Execution Control"
Cohesion: 0.05
Nodes (66): AI_RESOLVE_IDS, ALLOW_EXEC_CORE, allowTargetPath(), allowTargetPathForAiBase(), ALWAYS_SOFT_STATUSES, APPLY_STATUS_RANK, CODE_PATCHES, DESIGN_SKIPPED_VERIFIED (+58 more)

### Community 3 - "Skills Management"
Cohesion: 0.10
Nodes (61): handleSkillsCommand(), handleSkillsOp(), renderSkillsStatus(), assertImportSourceOutsideSkills(), assertInside(), backupExisting(), blockScalarValue(), copyDir() (+53 more)

### Community 4 - "ASAR Extraction & Sealed Host"
Cohesion: 0.08
Nodes (60): aiBaseUnderAppDir(), ensureHiddenConsole(), findDshBinRoot(), openSealedDesktopHost(), restoreSealedExtract(), restoreUnusableExtract(), isAsarSealedPath(), activeProbes() (+52 more)

### Community 5 - "Knowledge DB Schema & Migration"
Cohesion: 0.08
Nodes (51): RFC-1918, ASSET_FTS_DDL, DDL, guessPocCategory(), HAS_FTS5, KNOWLEDGE_DDL, migrate(), migrateKnowledge() (+43 more)

### Community 6 - "Host Patch Management"
Cohesion: 0.08
Nodes (52): 三条破损补丁 #77 / #68 / #26, 死补丁 #40 移除与 84 → 83 计数, 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）, 0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）, 宿主实况：桌面 EXE 0.2.2-rc.1 / runtime 0.2.2-rc.1 / cordis 4.1.0, 0.2.2-rc.1 包搬家两例：PTC 执行器拆成 dsh-tool-executor-ptc、交付物提示词拆成 dsh-deliverable-file-references, #82 教训：打包注释 //#region 不能当锚点第二行, asar 密封态 = 补丁是否真生效的判据 (+44 more)

### Community 7 - "Client UI Components"
Cohesion: 0.07
Nodes (48): AgentsTab(), applyDrillParts(), AssetsTab(), AttackFilesTab(), bothInjectEmpty(), ChainTab(), clampRtGeom(), clearStoredDraft() (+40 more)

### Community 8 - "Rules Management & File Ops"
Cohesion: 0.12
Nodes (51): atomicCopyFile(), atomicWriteFile(), hangOperatorPrompt(), hungOperatorPrompt(), handleRulesCommand(), handleRulesOp(), renderRulesStatus(), activateRule() (+43 more)

### Community 9 - "Capability Protocol & Identity Guard"
Cohesion: 0.08
Nodes (47): CAPABILITY_SECTION, capabilityProtocolText(), ASSEMBLE_GUARD, assemblyHasExactInject(), assemblyLooksRedteam(), attachRedteamOpsOnly(), childOrigin(), ensureFullInject() (+39 more)

### Community 10 - "Session Rewind"
Cohesion: 0.11
Nodes (49): analyzeRewind(), applyRewind(), asEventList(), createBlank(), disarmRewoundSession(), disposeObservation(), doRewindOneSession(), errorText() (+41 more)

### Community 11 - "Host Patching"
Cohesion: 0.10
Nodes (48): aiBaseBelongsToExe(), allPatchHostsWritten(), applyPatchesAllHosts(), applyRuntimeEnv(), clearDesktopLocateCache(), desktopAsarStillSealed(), ensureHostClean(), enumeratePatchAiBases() (+40 more)

### Community 12 - "Security Assessment Tooling"
Cohesion: 0.08
Nodes (9): nowIso(), tunnelIsLegit(), normGained(), parseJson(), targetKey(), normalizeShellStatus(), normalizeShellType(), WEBSHELL_STATUSES (+1 more)

### Community 13 - "Agent Plugin Infrastructure"
Cohesion: 0.10
Nodes (42): findDshHome(), pinDshHome(), installAssembleGuard(), isChildAgentContext(), isMnemonPluginMessage(), addPromptSection(), apply(), applyHostHooks() (+34 more)

### Community 14 - "Skill Build Scripts"
Cohesion: 0.05
Nodes (29): PROMPTS, checkOnly, dry, root, STEPS, checks, problems, root (+21 more)

### Community 15 - "CTF Attack Surface Skills"
Cohesion: 0.17
Nodes (44): 角色 攻击面专项（由 ctf-sandbox-orchestrator 路由）（41 个技能）, cloud-k8s（内网渗透 / internal）, competition-ad-certificate-abuse（内网渗透）, competition-agent-cloud（内网渗透）, competition-android-hooking（漏洞利用）, competition-browser-persistence（漏洞发现）, competition-bundle-sourcemap-recovery（漏洞发现）, competition-cloud-metadata-path（内网渗透） (+36 more)

### Community 16 - "Version Patch Comparison"
Cohesion: 0.06
Nodes (39): argv, asPatched, asPostPatch, asWhitespace, cmpVer(), collapse(), collapsedIdx(), decodeLit() (+31 more)

### Community 17 - "Network Access Control"
Cohesion: 0.09
Nodes (40): addHost(), allowCache, allowDecision(), allowFilePath(), appendDenial(), BANK_HOSTS, bankHit(), collectFromText() (+32 more)

### Community 18 - "Model Tooling & Entity Briefs"
Cohesion: 0.09
Nodes (32): hostEnumerationLine(), BRIEF_SUFFIX, buildModelTools(), core0(), defaultRenderStatus(), DRILL_ENTITIES, DRILL_WRITE_ENTITIES, escapeRe() (+24 more)

### Community 19 - "Red Team UI Tabs"
Cohesion: 0.10
Nodes (36): AgentsTab(), apply(), AssetsTab(), AttackFilesTab(), ChainTab(), clampRtGeom(), Clip(), ConcurrencyCard() (+28 more)

### Community 20 - "Desktop Process Restart"
Cohesion: 0.10
Nodes (36): 三份 spawnEnv 分叉：只有 desktop 那份兜底 DSH_PROFILE, 重启阶梯（web 杀旧服务等端口 / desktop 杀兄弟进程挪 asar / 卸载走 rmtree）, envForDetachedSpawn(), asarStillSealed(), commandMatchesExe(), darwinBundleName(), darwinBundleOf(), killOtherDesktopProcesses() (+28 more)

### Community 21 - "Package Check Script"
Cohesion: 0.05
Nodes (36): asJson, CLAIM_FILES, CN, cnNum, declaredParams, descNumM, EN, fnEnd (+28 more)

### Community 22 - "Skill Update & Config"
Cohesion: 0.12
Nodes (36): mergeConfigEnv(), officialSkillSummaries(), summarizeSkills(), dispatchAsync(), apply(), applyUpdate(), checkLatest(), checkLatestFromGithub() (+28 more)

### Community 23 - "Build & Audit Scripts"
Cohesion: 0.05
Nodes (38): scripts, audit:graph, audit:skills, build:client, build:locale, build:skills, build:skills-graph, check-anchors (+30 more)

### Community 24 - "main"
Cohesion: 0.09
Nodes (30): args, main(), MODES, printStatus(), CLI 实时验收 --verify-live：契约表/补丁分桶/注入状态/路由 live 四查，有 ⚠ 即非 0, 关 10 磁盘卫生夹具 + 面板路由存活矩阵（12 条断言：阈值、负载形状、反腐蚀）, lib/mcp-server.js：MCP 协议单一来源 mcpRespond —— stdio 循环与宿主 HTTP 路由 POST /dsh-purge/mcp 共用, patchTally() (+22 more)

### Community 25 - "Skill Graph Builder"
Cohesion: 0.06
Nodes (31): agents, assigned, byDomainStage, CN_NOISE, DOMAIN_RULES, dry, dupRel, files (+23 more)

### Community 26 - "Chat Conversation Composer"
Cohesion: 0.11
Nodes (26): apiJson(), apiTimeoutMs(), apiUrl(), armComposerFill(), ContinueButton(), conversationFace(), conversationInput(), currentSessionId() (+18 more)

### Community 27 - "RedteamStore"
Cohesion: 0.14
Nodes (5): purge_drill：56 个 preset 平面工具收成聚合入口，18 op（读 8 + 写面收纳 update 四方法 / delete 三方法 / open / switch）, 组合式收纳：一个 entity 参数换 10 读面 + 13 写面（POC 五面闭环、资产登记/评估/测试回写）, op=entity_add：一个 op 覆盖六个写面（+92 字符 ≈15/面），shot/poc 明确不接并说明原因, promptHash(), RedteamStore

### Community 28 - "Client Patch UI Helpers"
Cohesion: 0.09
Nodes (33): Btn(), clientCurrentCwd(), clientGuessSurface(), ContinueRetrySection(), detectHostTheme(), formatSize(), hostSurfaceOf(), hostText() (+25 more)

### Community 29 - "Toolkit Health Check"
Cohesion: 0.07
Nodes (28): describeToolkit(), scanToolkit(), shellAdvice(), asJson, blocks, BUDGET, drillTool, entBlock (+20 more)

### Community 30 - "Agent Role Bindings"
Cohesion: 0.09
Nodes (23): PLANNER_ROLE, ROLE_ORDER, ROLE_TITLES, addCandidate(), AGENT_PARAM, apply(), bindingKeyOf(), bindings (+15 more)

### Community 31 - "Override Management"
Cohesion: 0.16
Nodes (31): alignSummary 建议行分档 + 设计内 skipped 清单（DESIGN_SKIPPED_VERIFIED，带 checkedAgainst/证据文档，第 22 项守它别烂）, alignSummary(), commitOverrideOnApply(), defaultOverrideHash(), defaultOverrideText(), editOverride(), estimateTokens(), findOverrideFile() (+23 more)

### Community 32 - "CLI Smoke Testing"
Cohesion: 0.06
Nodes (25): 关 11 CLI 冒烟：真跑 bin 的只读模式（此前十关没一关执行过 CLI 分发）, BIN, cases, MODES, root, run, BS, child (+17 more)

### Community 33 - "Release Gate Audits"
Cohesion: 0.07
Nodes (25): 关 9 弹药层一致性审计：技能引用的工具名与条令点名的技能都必须真实存在, 发版七关闸门：语法 / 体积预算 / 双语 key 一致性 / 清单一致性 / 包自证 / 工具面 / JSON 合法（npm run verify 一票过）, 图谱审计：文件级孤儿判红；导出级只报线索（含结构边修正与 79% 盲区率）, 闸门反向探针总表：每道门都要有「改坏即红」的证据，否则等于不知道真假, 端到端情景第八关：20 步串 op 并断言回读，专抓组合期「说谎的回读」与跨 op 不一致, 关 13 工具层冒烟：真执行 purge_apply / purge_revert（mutating 工具分支此前没有一关跑过）, 关 12 写路径冒烟：夹具起点用保险柜原文；单次 apply→revert 哈希精确等于官方；双次 apply 污染还原点（5 文件停在一次已打补丁态）, argv (+17 more)

### Community 34 - "Continue-Retry Logic"
Cohesion: 0.12
Nodes (26): ABNORMAL_KINDS, clampCount(), createTracker(), DEFAULT_CONTINUE_RETRY, failureCodeOf(), hasFreshHumanTurn(), inboxBusy(), inspectTurn() (+18 more)

### Community 35 - "Vulnerability Discovery Skills"
Cohesion: 0.22
Nodes (30): 角色 漏洞发现（23 个技能）, ai-infra-attack（漏洞发现 / vuln-scan）, api-security（漏洞发现 / vuln-scan）, cn-oa-exploit（漏洞发现 / vuln-scan）, code-audit（漏洞发现 / vuln-scan）, credential-attack（hydra 在线爆破 + hashcat 离线破解）, http-post-form 的 F=/S= 成败判定, database-security（漏洞发现 / vuln-scan） (+22 more)

### Community 36 - ".openEngagement"
Cohesion: 0.13
Nodes (7): 真 bug：openEngagement 把 scope 串直接存进 scope_cidrs，导致 report() 的 .join 抛错, op=report：战报 / kind=score 得分报告 / kind=targets 目标汇总（零新增参数收纳，输出 2-16 行有界）, slugify(), slugTarget(), cidrList(), readMeta(), writeMeta()

### Community 37 - "PurgeDock"
Cohesion: 0.13
Nodes (28): apply(), AuthGate(), clampDockGeom(), defaultDockGeom(), EnvAdaptSendGate(), fetchEnvAdaptStatus(), hasInlinePurgeEntry(), HeroNewSessionMount() (+20 more)

### Community 38 - "Profile Backup Management"
Cohesion: 0.16
Nodes (28): backupAll(), collectRevertTargets(), dropStaleUserProfilePatchBackups(), ensureOfficialSnapshot(), flattenTargetPaths(), hasBackup(), hostBakDigest(), hostBakVaultRoot() (+20 more)

### Community 39 - "Command Routing Flags"
Cohesion: 0.13
Nodes (25): ALIASED, commandFor(), commandsForStage(), listWordlists(), NEEDS_PROXY, NUCLEI_FAST_FLAGS, nucleiReady(), PD_MUST_FLAG (+17 more)

### Community 40 - "Platform Config Detection"
Cohesion: 0.19
Nodes (26): adaptInDir(), assignToolkitFolder(), configPathOf(), defaultToolkitDir(), detectKali(), EMPTY(), envAdaptStatus(), findInDir() (+18 more)

### Community 41 - "Second Shot Injection"
Cohesion: 0.08
Nodes (25): asJson, files, minIdx, noSection, qualified, root, rows, SKILLS (+17 more)

### Community 42 - "Sealed Runtime Patching"
Cohesion: 0.10
Nodes (25): scheduleSealedDesktopRestart(), ASAR_RENAME_WHEN_IDLE_PS1, ASAR_RENAME_WHEN_IDLE_SH, ASAR_SWAP_PS1, cmdEntryAlreadyGood(), INTERNAL_LOG_PATH, isSealedRuntimeDir(), listSealedRuntimeBins() (+17 more)

### Community 43 - "Detection Pairing Verification"
Cohesion: 0.08
Nodes (20): MUST_PAIR, notes, problems, root, SENSE, SK, VERIFY_SKILLS, argv (+12 more)

### Community 44 - "Skill Availability Check"
Cohesion: 0.14
Nodes (23): 进攻力体检：红队 32 技能可用 32、坏 0；单查给出缺的环境变量与修法, bundledSkillSummaries(), checkSkill(), dshHomeCandidates(), existsUnderAnyHome(), expandSkillPath(), pathCountsOnThisHost(), readSkillFromRoot() (+15 more)

### Community 45 - "Patch Application"
Cohesion: 0.17
Nodes (25): applyPatches(), applyReplacementsToText(), asLf(), cloneRegExp(), collapseDuplicateLegacyApplyPath(), endOfBalancedBlock(), fileKeysOf(), filePatchOutcome() (+17 more)

### Community 46 - "Directory Discovery & State"
Cohesion: 0.18
Nodes (25): collectDirs(), dirHasDshLauncher(), displayTitleOf(), execFileText(), findAiBase(), findAiBaseWeb(), findDesktopShimDir(), findNpmPrefix() (+17 more)

### Community 47 - "Desktop Install Detection"
Cohesion: 0.18
Nodes (25): rememberDesktopInstallForHandoff(), commonDesktopInstallDirs(), desktopRestartChoice(), exeCandidatesBeside(), exeDirFromRegistryValue(), extraDiscoveredInstallDirs(), extraInstallsFromEnv(), findDesktopAppExecutable() (+17 more)

### Community 48 - "Pentest Agent Roles & Prompts"
Cohesion: 0.26
Nodes (24): default-prompt-inject.md（当前生效的注入正文）, default-prompt-inject.en.md（英文版注入正文）, default-prompt-inject.zh.md（中文版注入正文）, 草稿审查 R1–R8 缺陷清单, Scoped Rules 动态路由（25 条按意图激活）, 角色 资产梳理（4 个技能）, 角色 辅助（浏览器桥 / 代理池）（3 个技能）, 角色 信息收集（13 个技能） (+16 more)

### Community 49 - "Issue Validation & Reporting"
Cohesion: 0.14
Nodes (23): ASSET_PRIORITIES, ASSET_TEST_STATES, issue(), LEGACY_STAGES, parseScopeString(), renderIssue(), renderIssues(), REPORT_KINDS (+15 more)

### Community 50 - "Package Publishing & Host Sync"
Cohesion: 0.09
Nodes (22): npm run host-sync：把「仓库 → 宿主 profile 副本」这条重复手工动作固化, 清单一致性闸门：COPY_NAMES（自更新）必须落在 files（发布）之内, COPY_NAMES, bin, dsh-purge, bugs, url, description (+14 more)

### Community 51 - "Smoke Test Fixtures & Hashing"
Cohesion: 0.09
Nodes (17): beforePending, childFile, expected, expectedSrc, fakeBase, fixture, home, hostBase (+9 more)

### Community 52 - "Debt Report Generation"
Cohesion: 0.09
Nodes (21): argv, checkDebt, day, dbPath, debtLines, failures, liveLines, md (+13 more)

### Community 53 - "GitHub Release Workflow"
Cohesion: 0.09
Nodes (21): concurrency, cancel-in-progress, group, GH_TOKEN, jobs, release, name, on (+13 more)

### Community 54 - "Dependency Graph Audit"
Cohesion: 0.10
Nodes (21): asJson, deadExports, fileInbound, g, graphBlind, graphPath, hasName(), inbound (+13 more)

### Community 55 - "AI Base Discovery"
Cohesion: 0.16
Nodes (21): aiBaseGuessesAround(), aiBaseGuessesFor(), dshBaseEnvStatus(), findAiBaseFromDshHome(), findAiBaseFromRequire(), findAiBaseFromRunningProcess(), findAiBaseRecursive(), findWslWindowsDshHome() (+13 more)

### Community 56 - "Desktop Surface Detection"
Cohesion: 0.15
Nodes (16): adoptSurfaceForAiBase(), aiBaseLooksDesktopInstall(), exeName(), findResourcesDir(), forcedSurface(), isDesktopSurface(), norm(), pathLooksDesktop() (+8 more)

### Community 57 - "Intranet Penetration Skills"
Cohesion: 0.28
Nodes (21): 角色 内网渗透（16 个技能）, chisel-tunnel（HTTP/WebSocket 隧道）, edr-bypass-re（内网渗透 / internal）, firmware-pentest（漏洞利用 / exploit）, frp-tunnel（frps/frpc 内网穿透）, fscan-intranet（内网综合扫描 v2.2.1）, gogo-intranet（内网测绘与指纹引擎 v2.15.0）, gogo 端口预设 tag（top1/top2/win/db/all） (+13 more)

### Community 58 - "CLI Shim Patching"
Cohesion: 0.21
Nodes (20): ensureDirSync(), hasLegacyPermissionPin(), insertShimInject(), isDesktopCommandRuntimeDir(), isFile(), isTextShim(), npmCliJs(), patchShim() (+12 more)

### Community 59 - "MCP Server Runtime"
Cohesion: 0.11
Nodes (14): mcpRespond(), runMcpServer(), extractBlock(), judge(), notes, problems, root, userFp (+6 more)

### Community 60 - "Installability Checks"
Cohesion: 0.12
Nodes (19): ALIAS, checkOnly, drift, dry, esc(), files, has(), have (+11 more)

### Community 61 - "Host File Sync"
Cohesion: 0.11
Nodes (16): argv, copyDir, copyMatches(), dryRun, force, head, home, m (+8 more)

### Community 62 - "Red Team Setup"
Cohesion: 0.27
Nodes (18): ask(), ask_secret(), bad(), BIN, cur_env(), dim(), dl_asset(), doctor() (+10 more)

### Community 63 - "Child Process Hiding"
Cohesion: 0.18
Nodes (17): builtinChildProcess(), ChildProcess, cp, exec, execFile, execFileSync, execSync, fork (+9 more)

### Community 64 - "Skill Runnable Check"
Cohesion: 0.11
Nodes (15): argvLimit, asJson, files, have, LINUX_MARKS, linuxRows, missRows, root (+7 more)

### Community 65 - "Graph Sync Merge"
Cohesion: 0.25
Nodes (17): edgesOf(), ensureBaseline(), fail(), FILE_TYPES, foldRationale(), hyperEdgesOf(), INFERRED_OK, isSemantic() (+9 more)

### Community 66 - "README.md（中文主文档）"
Cohesion: 0.20
Nodes (16): banner.svg（720×180 项目横幅）, dock-auth.png（850×925，演练台授权页截图）, dock-clean.png（800×850，清洗页侧栏截图）, dock-drill.png（900×850，演练台截图）, own-servers.png（652×509，自己的服务器白名单截图·中文）, own-servers-en.png（652×505，自己的服务器白名单截图·英文）, rules.png（1064×1244，规则集截图）, settings.png（1064×1972，补丁页截图） (+8 more)

### Community 67 - "Locale Check And Build"
Cohesion: 0.13
Nodes (13): 双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）, 双语文案拆开：源在 locale/*.json，运行时仍走构建期内联（拆源不拆加载）, argv, asJson, blocks, dicts, expectBlocks, file (+5 more)

### Community 68 - "Subagent Role Tracking"
Cohesion: 0.28
Nodes (15): currentEngagementId(), evictRoleBySessionIfOverflow(), installSubagentRoleCapture(), isRedteamChild(), noteClaimedMessage(), parseRedteamRole(), readRoleFile(), remember() (+7 more)

### Community 69 - "Reasoning Promotion Gate"
Cohesion: 0.24
Nodes (15): apply(), buildInstructionHint(), classifyReasoning(), countWord(), decidePromotion(), extractInstructionPaths(), hasAnchoredReasoning(), instructionHintMessages() (+7 more)

### Community 70 - "Reverse Engineering Exploits"
Cohesion: 0.39
Nodes (16): 角色 漏洞利用（30 个技能）, apk-reverse（漏洞利用 / exploit）, binary-diff（漏洞利用 / exploit）, browser-extension-reverse（漏洞利用 / exploit）, dotnet-reverse（漏洞利用 / exploit）, ghidra-reverse（漏洞利用 / exploit）, go-rust-reverse（漏洞利用 / exploit）, ida-reverse（漏洞利用 / exploit） (+8 more)

### Community 71 - "Locale Build Script"
Cohesion: 0.13
Nodes (13): block, checkOnly, clientPath, crlf, die(), en, marked, onlyEn (+5 more)

### Community 72 - "Windows Toolkit CLI"
Cohesion: 0.14
Nodes (12): argv, checkOnly, download(), exists(), force, NL, onlyIdx, picks (+4 more)

### Community 73 - "Patch Status Tracking"
Cohesion: 0.22
Nodes (11): markersAny=true 的补丁：applied 只代表「至少打了一处」，会藏半个没打的门, 状态面升级：补丁按 已清洗/待清洗/锚点未命中/不适用/缺文件 分桶 + 宿主版本对齐告警, 未安装项整体摘除：83 → 76 条补丁，面板 0 不适用 / 0 缺文件, ADAPTERS, hostAlignment(), hostFromRequest(), portFromRequest(), restartArgv() (+3 more)

### Community 74 - "Restart Scheduling"
Cohesion: 0.22
Nodes (15): cleanupLegacyRestartScripts(), desktopRuntimeOf(), dshHomeForRelaunch(), helperEnv(), logInternal(), officialRestartFlagPath(), officialRestartLogState(), planOfficialRestart() (+7 more)

### Community 75 - "Market Sweep Diffs"
Cohesion: 0.16
Nodes (13): all, asJson, BASELINE, both, cacheFile, diffs, FIELDS(), got (+5 more)

### Community 76 - "Host Leftover Pruning"
Cohesion: 0.13
Nodes (12): anchor, apply, asJson, candidates, entries, keepArg, prevs, reclaim (+4 more)

### Community 77 - "Pentest Attack Doctrine"
Cohesion: 0.21
Nodes (14): v1.1.34-prompt-inject.md（历史版本快照）, WEB PENTEST ROUTING 与 canned slots（技能路由表的前身）, ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）, 生成物即资产：工程性 / 连续性 / 项目性三纪律, 进攻条令 — ATTACK DOCTRINE（输出即火力）, 火力阶梯五级（打光弹药才停火）, 五阶段主线（信息收集→资产梳理→漏洞发现→漏洞利用→内网渗透）, release-notes.md（1.1.72 → 1.1.83 演化史） (+6 more)

### Community 78 - "Slot Table Keys"
Cohesion: 0.24
Nodes (9): IV, MASK, SLOT, SLOT_ROWS, TAG, MIX, mixKey(), sealSlot() (+1 more)

### Community 79 - "Target File Resolution"
Cohesion: 0.19
Nodes (14): allExisting(), allowTargetForPatch(), desktopDshHomeGuesses(), desktopHomeCandidates(), filterTargetFiles(), firstExisting(), listPiAiApiFiles(), nestedPkg() (+6 more)

### Community 80 - "Network Scope Validation"
Cohesion: 0.30
Nodes (13): checkAction(), checkTarget(), checkTechnique(), cidrInsideCidr(), ipInCidr(), ipv4ToInt(), isDomain(), isIpv4() (+5 more)

### Community 81 - "Package Manifest Checking"
Cohesion: 0.14
Nodes (13): allow, alwaysShipped, asJson, block, copy, denies, extra, pkg (+5 more)

### Community 82 - "HTTP Request Replay"
Cohesion: 0.26
Nodes (8): RFC-3986, buildCurlCommand(), buildHttpRequest(), commandKind(), fillTemplate(), parseCurl(), parseTarget(), scoreConfirmOf()

### Community 83 - "Prompt Injection Defense"
Cohesion: 0.21
Nodes (13): 锚点核对法：上游源码 + npm 已发布产物双重比对, 四层防御：注入在前 / stripHarnessPersona / overlayOfficialIdentity / 文件级补丁短路, 硬编码 replace 清理的措辞漂移风险, 注入位置前置（order -100000 / cap -99999）, 注入方式改造方案-1.1.34化.md（注入前置）, isCwdOnlyText(), isWorkspaceBaselineSection(), looksLikeOfficialIdentity() (+5 more)

### Community 84 - "HTTP Routing Middleware"
Cohesion: 0.22
Nodes (13): allowPluginRequest(), denyCrossOrigin(), headerOf(), installRulesHttp(), installSkillsHttp(), methodNotAllowed(), readJsonBody(), registerRoute() (+5 more)

### Community 85 - "Radar Scoring Fingerprinting"
Cohesion: 0.23
Nodes (12): aggregateHits(), COST_LABEL, FINGERPRINT_RULES, hostKey(), looksWebHost(), matchFingerprints(), radarOneLine(), radarState() (+4 more)

### Community 86 - "API Client Builder"
Cohesion: 0.15
Nodes (12): applyAt, beginAt, body, client, clientPath, drillSrc, end, endAt (+4 more)

### Community 87 - "Label Batch Processing"
Cohesion: 0.15
Nodes (10): batchSize, cfgPath, env, extra, labelsPath, maxConcurrency, missingOnly, passthrough (+2 more)

### Community 88 - "Scenario Drill Runner"
Cohesion: 0.21
Nodes (12): drill, failures, has(), liveStore, main(), not(), re(), root (+4 more)

### Community 89 - "IP Network Utilities"
Cohesion: 0.23
Nodes (8): cidrOf(), defaultPocFilename(), expandIpv6(), ipToInt(), isIpv6(), scopeOfIp(), slugPoc(), scoreStageOf()

### Community 90 - "Agent Settings Config"
Cohesion: 0.32
Nodes (11): clampMaxAgents(), DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT, maxAgentsOf(), maxAgentsSourceOf(), readSettings(), saveMaxAgents(), settingsPathOf() (+3 more)

### Community 91 - "Skill Audit Validation"
Cohesion: 0.17
Nodes (11): asJson, doctrineFiles, ghostRefs, linkProblems, missingSkills, realTools, root, skillDir (+3 more)

### Community 92 - "Wordlist Fetching"
Cohesion: 0.20
Nodes (10): checkOnly, dir, fetchList(), force, LISTS, only, onlyArg, picks (+2 more)

### Community 93 - "Upstream Drift Detection"
Cohesion: 0.24
Nodes (10): 上游漂移探测 check:upstream：latest vs dshTarget vs engines，越界才判失败、离线只报未知, asJson, cmp(), core3(), inRange(), pkg, range, root (+2 more)

### Community 94 - "Host Clean Verification"
Cohesion: 0.18
Nodes (10): jsString(), officialRestartScript(), systemPromptFiles(), unpackedHostIsClean(), HOST_CLEAN_IDENTITY_MARK, HOST_CLEAN_KEEPS_LEGACY, HOST_CLEAN_KEEPS_MARK, HOST_OFFICIAL_IDENTITY (+2 more)

### Community 95 - "Profile Guard Health"
Cohesion: 0.38
Nodes (10): currentProfileDir(), guardProfilePatch(), inspectHostHealth(), listPatchBackups(), missingPackages(), packageInstalled(), packageOf(), profilePatchIsEmpty() (+2 more)

### Community 96 - "Package Installation"
Cohesion: 0.18
Nodes (11): patch, inject, platform, dsh, bundle, client, install, git (+3 more)

### Community 97 - "Desktop Install Path Resolution"
Cohesion: 0.22
Nodes (10): findAiBaseDesktop(), isPackagedDesktopDshRoot(), inferDesktopInstallDir(), isInsideDesktopInstall(), isSubPath(), looksLikeDesktopName(), looksLikeDesktopNameTail(), resolveDesktopAiBase() (+2 more)

### Community 99 - "Security Workflow Skills"
Cohesion: 0.42
Nodes (10): 角色 流程/编排（9 个技能）, attack-chain（流程/编排 / flow）, attack-traceability（流程/编排 / flow）, case-review（流程/编排 / flow）, ctf-sandbox（流程/编排 / flow）, detection-pairing（流程/编排 / flow）, digital-forensics（漏洞发现 / vuln-scan）, malware-analysis（漏洞发现 / vuln-scan） (+2 more)

### Community 100 - "Skill Heading Normalization"
Cohesion: 0.24
Nodes (9): checkOnly, demote(), dropRedundantH1(), dry, files, normalize(), remaining, root (+1 more)

### Community 101 - "Ecosystem Intelligence Report"
Cohesion: 0.22
Nodes (9): 社区情报主文档：独占性、目录规模、restart∩patch=0、长尾抽样、产物级对照、模块化判定、成本自述做法（七轮实测累计）, 同地盘地图：600 条样本里无人做提示词优先级治理，purge 的三档作用域已被 purge_rules 报出, 生态漂移探测 sweep:market：把六趟手打的复查口径写死进代码（FIELDS + 正则 + 基线），交集被吃进即判失败, 生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字, 社区同路原则：one stable proxy tool instead of N tool schemas（dsh-mcp-lazy / dsh-mcp-lens 按需加载 schema）, 生态 tag 口径门禁：7 个 tag 全部满足「2000 条样本在用 + purge 真具备」，词形分裂按生态现状并存, purge_status 按需展开：同一渲染函数两个 section 显式索取，返回值成本 13023 → 538 字符, 工具面闸门 check-tools：结构 + 描述预算 + 返回值预算 + op/entity 可发现性（七关之一） (+1 more)

### Community 102 - "Prompt Asset Embedding"
Cohesion: 0.22
Nodes (7): embed-prompt, dest, packed, root, src, text, 发版固定流程：改 md 源 → embed-prompt 重封入 asset-table.js → bump 三份 README → pnpm update

### Community 103 - "CLI Shim Repair"
Cohesion: 0.32
Nodes (8): repairOfficialCliAfterUnpack(), ensureAppRuntimeSymlink(), isDir(), patchOfficialCliShimText(), repairOfficialCliAfterUnpack(), resourcesDirForExecutable(), stripShimEntryBlock(), resolveResourcesDir()

### Community 104 - "Display Rendering & Health Checks"
Cohesion: 0.25
Nodes (8): tallyDisplayPatches(), currentSurface(), currentSettleScope(), fsExists(), line(), renderStatus(), shimNeedsPatch(), readHealthReport()

### Community 105 - "Package Exports & Module Structure"
Cohesion: 0.25
Nodes (8): exports, ./client, ./locale/*.json, ./package.json, ./redteam, ./redteam/store, ./redteam/tools, ./redteam/ui

### Community 106 - "Bundle Sync CLI"
Cohesion: 0.25
Nodes (6): argv, BUNDLES, dry, force, root, walk()

### Community 107 - "Store Injection Registry"
Cohesion: 0.38
Nodes (5): apply(), inject, name, readSelfPackage(), resolveRoot()

### Community 110 - "Search Index Text Processing"
Cohesion: 0.40
Nodes (5): applySynonyms(), extractCnFromHeadings(), extractProper(), isGoodCn(), searchIndex

### Community 112 - "CTF Prompt Framework"
Cohesion: 0.50
Nodes (4): CTF CORE CONTRACT / SCOPE / EVIDENCE / WORKFLOW 四段, Little Code Sauce / YG 人格框架（SANDBOX — STABLE）, HARD OUTPUT RULES + 拒绝对抗（禁止词表与整轮重写）, collectInjectText()

### Community 113 - "Preset Config Fields"
Cohesion: 0.50
Nodes (3): description, name, order

### Community 114 - "Package Engine Config"
Cohesion: 0.67
Nodes (3): engines, dsh, node

### Community 115 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 116 - "Feature Flags"
Cohesion: 0.67
Nodes (3): has(), missingShots, noInstall

## Ambiguous Edges - Review These
- `applyPatches()` → `settings.png（1064×1972，补丁页截图）`  [AMBIGUOUS]
  docs/preview/settings.png · relation: references

## Knowledge Gaps
- **3 isolated node(s):** `RFC-1918`, `BIN`, `RFC-3986`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 833 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `README.md（中文主文档）` connect `README.md（中文主文档）` to `Plugin Update Channels`, `Release Gate Audits`, `Core Config & Execution Control`, `Locale Check And Build`, `Skills Management`, `Host Patch Management`, `Client UI Components`, `Rules Management & File Ops`, `Patch Status Tracking`, `Session Rewind`, `Agent Plugin Infrastructure`, `Pentest Attack Doctrine`, `Network Access Control`, `Package Publishing & Host Sync`, `Preset Config Fields`, `Desktop Process Restart`, `Prompt Injection Defense`, `main`?**
  _High betweenness centrality (0.162) - this node is a cross-community bridge._
- **What connects `RFC-1918`, `BIN`, `RFC-3986` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Plugin Update Channels` be split into smaller, more focused modules?**
  _Cohesion score 0.06974789915966387 - nodes in this community are weakly interconnected._
- **Why does `release-notes.md（1.1.72 → 1.1.83 演化史）` connect `Pentest Attack Doctrine` to `Plugin Update Channels`, `README.md（中文主文档）`, `Locale Check And Build`, `Vulnerability Discovery Skills`, `Ecosystem Intelligence Report`, `Host Patch Management`, `Client UI Components`, `Knowledge DB Schema & Migration`, `Capability Protocol & Identity Guard`, `Pentest Agent Roles & Prompts`, `Prompt Injection Defense`, `Intranet Penetration Skills`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Should `Drill Grants & Presets` be split into smaller, more focused modules?**
  _Cohesion score 0.05927405927405927 - nodes in this community are weakly interconnected._
- **Why does `RedteamStore` connect `RedteamStore` to `Attack File Management`, `.openEngagement`, `Knowledge DB Schema & Migration`, `Platform Config Detection`, `Store Injection Registry`, `Security Assessment Tooling`, `Detection Pairing Verification`, `Model Tooling & Entity Briefs`, `HTTP Request Replay`, `Scenario Drill Runner`, `IP Network Utilities`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `applyPatches()` and `settings.png（1064×1972，补丁页截图）`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._