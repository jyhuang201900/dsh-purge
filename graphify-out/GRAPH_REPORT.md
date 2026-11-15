# Graph Report - dsh-purge  (2026-11-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3316 nodes · 7935 edges · 135 communities (130 shown, 5 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 408 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `945e23d7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Offensive Security Attack Surfaces
- Plugin Update & Versioning
- Code Patch Execution Permissions
- Drill Grant & Preset Config
- Attack Precision Audit
- IP Address Utilities
- Skills Management
- Host Patch Management
- client.js
- installWebServer
- Prompt Injection Defense
- Rules Management
- Session Rewind Engine
- Plugin Request Guard
- Network Access Control
- Attack Path Assessment
- Skill Graph Building
- ASAR Archive Extraction
- Model Tool Building
- check-package.mjs
- Package Version Tooling
- Red Team Dashboard UI
- Clarify Contract Checks
- Redteam Engagement Store
- Desktop Process Restart
- Security Testing & Exploitation
- Build and Audit Scripts
- Desktop Runtime Packaging
- Validation Check Scripts
- Agent Role Configuration
- Skill Update Management
- dsh-purge.js
- Conversation Composer Input
- Patch UI Theming
- Reverse Engineering & Exploitation
- Node Build Tooling
- Release Gate Audits
- ATT&CK Technique Mapping
- CLI Smoke Tests
- Continue-Retry Tracker
- Dock UI Gating
- Patch Reapply & Healing
- Platform Config Detection
- Command Routing Flags
- Second Shot Injection
- AI Base Discovery
- Backup and Snapshot Management
- Package Tooling Gates
- Patch Application Utilities
- JS Deobfuscation & Reverse Engineering
- Tool Budget Checks
- Vulnerability Issue Tracking
- Offensive Security Techniques
- Search Index Key Analysis
- Skill Availability Check
- Console Hiding Hook
- Smoke Test Fixtures
- IoT/OT Firmware Security
- Tech Debt Reporting
- GitHub Release Workflow
- Recon & Asset Scanning
- Graph Audit Utilities
- Agent Session Context
- Pentest Workflow Orchestration
- Installability Check
- POC Knowledge Base
- Shim Patching and Revert
- Skill Runnable Check
- Graph Edge Sync
- Host File Sync
- Red Team Setup
- Bilingual Locale Check
- Child Process Execution
- Desktop Install Discovery
- Docs and Screenshot Assets
- Desktop Restart Logic
- Database Insert Audit
- Subagent Role Sessions
- Reasoning Promotion Gate
- Locale Build i18n
- Windows Fetch Toolkit
- release-notes.md（1.1.72 → 1.1.83 演化史）
- Atomic Build Fetcher
- Market Sweep Diff
- Host Leftover Cleanup
- Host Patch Status
- Asset Slot Table
- Scope Validation
- ASAR Patch Verification
- Fingerprint Scoring Radar
- Client Build Script
- Scope Gate Check
- Preset Sync Parity Check
- Tool Reachability Check
- Graph Label Generation
- Scenario Drill Runner
- HTTP Request Building
- Agent Settings Config
- Desktop Surface Detection
- Graph Validation Report
- ASAR Library Resolution
- Wordlist Fetching
- Community Intelligence & Tool Contracts
- Upstream Drift Detection
- Package Installation
- Engagement Report Export
- Profile Patching and Health
- Asset Stage Management
- Attack File Management
- Path Boundary Validation
- Size Budget Checking
- Community Naming
- Skill Heading Normalization
- ASAR Toggle Utility
- Prompt Embedding Pipeline
- Host Clean Script
- Toolkit Health Scanning
- Web Server Restart
- Package Exports & Redteam
- Graph Freshness Check
- Transaction Atomicity Check
- Probe Gate Runner
- Patch & Upgrade Log
- Module Resolution
- Settings Management
- React Error Boundary
- React Error Boundary
- Desktop Install Path Detection
- React Error Boundaries
- CTF Prompt Injection Framework
- Scoped Prompt Injection Rules
- Preset Configuration Metadata
- Node Runtime Engines
- Repository Configuration

## God Nodes (most connected - your core abstractions)
1. `RedteamStore` - 119 edges
2. `installWebServer()` - 65 edges
3. `findDshHome()` - 57 edges
4. `ctf-sandbox-orchestrator（流程/编排 / flow）` - 53 edges
5. `default-prompt-inject.md（当前生效的注入正文）` - 42 edges
6. `角色 攻击面专项（由 ctf-sandbox-orchestrator 路由）（41 个技能）` - 41 edges
7. `buildModelTools()` - 40 edges
8. `scripts` - 39 edges
9. `nowIso()` - 35 edges
10. `handlePurgeCommand()` - 35 edges

## Surprising Connections (you probably didn't know these)
- `#82 教训：打包注释 //#region 不能当锚点第二行` --semantically_similar_to--> `适配-0.2.1-rc.2-差异分析.md（宿主升级核对）`  [INFERRED] [semantically similar]
  lib/core.js → docs/适配-0.2.1-rc.2-差异分析.md
- `settings.png（1064×1972，补丁页截图）` --references--> `applyPatches()`  [AMBIGUOUS]
  docs/preview/settings.png → lib/core.js
- `硬编码 replace 清理的措辞漂移风险` --semantically_similar_to--> `死补丁清理：#40 COMPLETE_PROMPT_KEEP_INJECT，补丁数 84 → 83`  [INFERRED] [semantically similar]
  docs/注入方式改造方案-1.1.34化.md → release-notes.md
- `生态漂移探测 sweep:market：把六趟手打的复查口径写死进代码（FIELDS + 正则 + 基线），交集被吃进即判失败` --part_of--> `生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字`  [INFERRED]
  scripts/market-sweep.mjs → docs/dsh-mcp-ecosystem-notes.md
- `生态 tag 口径门禁：7 个 tag 全部满足「2000 条样本在用 + purge 真具备」，词形分裂按生态现状并存` --depends_on--> `生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字`  [INFERRED]
  scripts/check-package.mjs → docs/dsh-mcp-ecosystem-notes.md

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

## Communities (135 total, 5 thin omitted)

### Community 0 - "Offensive Security Attack Surfaces"
Cohesion: 0.05
Nodes (92): AD 攻击路径全图：从普通域用户到 Domain Admin, AD CS 证书滥用：ESC1–ESC15 逐条判据与验伤, AI Agent 云基础设施：推理服务、向量库、权重与 MCP 暴露面, Android Hook：Xposed vs Frida、Java/Native 层与时机, 浏览器持久化：五种落地位置与"重启后仍在"的证明, Sourcemap 恢复：从打包产物还原源码结构, 容器逃逸与 Kubernetes 提权：判据、验伤与假成功, 云元数据路径：从 169.254.169.254 到被接受的凭据 (+84 more)

### Community 1 - "Plugin Update & Versioning"
Cohesion: 0.07
Nodes (84): 生态约定对照：8 个同机插件里 4 个声明 engines.dsh、4 个用 dsh.compatibility, 渠道双车道与钉选（stable=master / beta，pin 固定旧版本）, atomicWriteSync(), applyUpdate(), _applyUpdateImpl(), archiveTarballUrl(), archiveZipUrl(), autoUpdateGuardPath() (+76 more)

### Community 2 - "Code Patch Execution Permissions"
Cohesion: 0.05
Nodes (79): AI_RESOLVE_IDS, allExisting(), ALLOW_EXEC_CORE, allowTargetForPatch(), allowTargetPath(), allowTargetPathForAiBase(), ALWAYS_SOFT_STATUSES, APPLY_STATUS_RANK (+71 more)

### Community 3 - "Drill Grant & Preset Config"
Cohesion: 0.06
Nodes (72): clearDrillGrant(), drillGrantPath(), readDrillGrant(), writeDrillGrant(), clearLiveSelectedDefault(), clearOwnedSelectedDefault(), configSet(), configValue() (+64 more)

### Community 4 - "Attack Precision Audit"
Cohesion: 0.03
Nodes (52): corpus, DIMS, files, rows, coarse, DIR, files, PARENT_SUBS (+44 more)

### Community 5 - "IP Address Utilities"
Cohesion: 0.08
Nodes (54): RFC-1918, cidrOf(), defaultPocFilename(), expandIpv6(), ipToInt(), isIpv6(), slugify(), slugPoc() (+46 more)

### Community 6 - "Skills Management"
Cohesion: 0.10
Nodes (61): handleSkillsCommand(), handleSkillsOp(), renderSkillsStatus(), assertImportSourceOutsideSkills(), assertInside(), backupExisting(), blockScalarValue(), copyDir() (+53 more)

### Community 7 - "Host Patch Management"
Cohesion: 0.08
Nodes (58): aiBaseBelongsToExe(), allPatchHostsWritten(), applyPatchesAllHosts(), collectDirs(), desktopAsarStillSealed(), dirHasDshLauncher(), dshBaseEnvStatus(), ensureHostClean() (+50 more)

### Community 8 - "client.js"
Cohesion: 0.07
Nodes (48): AgentsTab(), applyDrillParts(), AssetsTab(), AttackFilesTab(), bothInjectEmpty(), ChainTab(), clampRtGeom(), clearStoredDraft() (+40 more)

### Community 9 - "installWebServer"
Cohesion: 0.11
Nodes (53): main(), printStatus(), alignSummary(), applyRuntimeEnv(), clearDesktopLocateCache(), commitOverrideOnApply(), defaultOverrideHash(), defaultOverrideText() (+45 more)

### Community 10 - "Prompt Injection Defense"
Cohesion: 0.08
Nodes (49): 锚点核对法：上游源码 + npm 已发布产物双重比对, 四层防御：注入在前 / stripHarnessPersona / overlayOfficialIdentity / 文件级补丁短路, 硬编码 replace 清理的措辞漂移风险, 注入位置前置（order -100000 / cap -99999）, 注入方式改造方案-1.1.34化.md（注入前置）, CAPABILITY_SECTION, capabilityProtocolText(), ASSEMBLE_GUARD (+41 more)

### Community 11 - "Rules Management"
Cohesion: 0.13
Nodes (49): atomicCopyFile(), atomicWriteFile(), peekCommittedOverride(), handleRulesCommand(), handleRulesOp(), renderRulesStatus(), activateRule(), ancestorChainForCwd() (+41 more)

### Community 12 - "Session Rewind Engine"
Cohesion: 0.11
Nodes (49): analyzeRewind(), applyRewind(), asEventList(), createBlank(), disarmRewoundSession(), disposeObservation(), doRewindOneSession(), errorText() (+41 more)

### Community 13 - "Plugin Request Guard"
Cohesion: 0.08
Nodes (46): currentSurface(), isMnemonPluginMessage(), allowPluginRequest(), apply(), currentSettleScope(), DEFAULTS, denyCrossOrigin(), ensureRestartReady() (+38 more)

### Community 14 - "Network Access Control"
Cohesion: 0.09
Nodes (43): core0(), defaultRenderStatus(), addHost(), allowCache, allowDecision(), allowFilePath(), appendDenial(), BANK_HOSTS (+35 more)

### Community 15 - "Attack Path Assessment"
Cohesion: 0.08
Nodes (8): nowIso(), tunnelIsLegit(), normGained(), targetKey(), normalizeShellStatus(), normalizeShellType(), WEBSHELL_STATUSES, WEBSHELL_TYPES

### Community 16 - "Skill Graph Building"
Cohesion: 0.05
Nodes (40): agents, assigned, byDomainStage, CN_NOISE, DOMAIN_RULES, dry, dupRel, EN_COMMON (+32 more)

### Community 17 - "ASAR Archive Extraction"
Cohesion: 0.10
Nodes (43): aiBaseUnderAppDir(), openSealedDesktopHost(), restoreSealedExtract(), restoreUnusableExtract(), scheduleSealedDesktopRestart(), activeProbes(), archiveFs(), asarEntrySize() (+35 more)

### Community 18 - "Model Tool Building"
Cohesion: 0.08
Nodes (31): BRIEF_SUFFIX, buildModelTools(), DRILL_ENTITIES, DRILL_WRITE_ENTITIES, escapeRe(), expandQuery(), isAsciiWord(), loadSearchIndex() (+23 more)

### Community 19 - "check-package.mjs"
Cohesion: 0.05
Nodes (40): asJson, CLAIM_FILES, CN, cnNum, declaredParams, descNumM, EN, fileKeyList (+32 more)

### Community 20 - "Package Version Tooling"
Cohesion: 0.06
Nodes (39): argv, asPatched, asPostPatch, asWhitespace, cmpVer(), collapse(), collapsedIdx(), decodeLit() (+31 more)

### Community 21 - "Red Team Dashboard UI"
Cohesion: 0.10
Nodes (36): AgentsTab(), apply(), AssetsTab(), AttackFilesTab(), ChainTab(), clampRtGeom(), Clip(), ConcurrencyCard() (+28 more)

### Community 22 - "Clarify Contract Checks"
Cohesion: 0.05
Nodes (34): extractBlock(), judge(), notes, problems, root, userFp, factory, notes (+26 more)

### Community 23 - "Redteam Engagement Store"
Cohesion: 0.12
Nodes (7): 真 bug：openEngagement 把 scope 串直接存进 scope_cidrs，导致 report() 的 .join 抛错, op=report：战报 / kind=score 得分报告 / kind=targets 目标汇总（零新增参数收纳，输出 2-16 行有界）, cidrList(), promptHash(), readMeta(), RedteamStore, writeMeta()

### Community 24 - "Desktop Process Restart"
Cohesion: 0.10
Nodes (36): 三份 spawnEnv 分叉：只有 desktop 那份兜底 DSH_PROFILE, 重启阶梯（web 杀旧服务等端口 / desktop 杀兄弟进程挪 asar / 卸载走 rmtree）, envForDetachedSpawn(), asarStillSealed(), commandMatchesExe(), darwinBundleName(), darwinBundleOf(), killOtherDesktopProcesses() (+28 more)

### Community 25 - "Security Testing & Exploitation"
Cohesion: 0.15
Nodes (40): Agent 服从性工程：优先级、工具描述可信度、拒绝与执行的双向测试, Agent 安全测试：工具面、权限边界、记忆污染、多 Agent 信任传递, CI/CD 流水线攻击面：Workflow 注入、runner 滥用、secret 泄露, 数据库配置错误清单：五类库的危险默认项与一条命令查完, JVM / PHP 中间件漏洞利用载荷, JWT 攻击全表：六类缺陷的手工利用与验伤, JWT 与 OAuth 测试：头部攻击面、claim 篡改、重定向绕过, OWASP LLM Top 10 落地版：判定、载荷、证明 (+32 more)

### Community 26 - "Build and Audit Scripts"
Cohesion: 0.05
Nodes (38): scripts, audit:graph, audit:skills, build:client, build:locale, build:skills, build:skills-graph, check-anchors (+30 more)

### Community 27 - "Desktop Runtime Packaging"
Cohesion: 0.09
Nodes (35): repairOfficialCliAfterUnpack(), ASAR_RENAME_WHEN_IDLE_PS1, ASAR_RENAME_WHEN_IDLE_SH, ASAR_SWAP_PS1, clearDesktopLocateCache(), cmdEntryAlreadyGood(), ensureAppRuntimeSymlink(), INTERNAL_LOG_PATH (+27 more)

### Community 28 - "Validation Check Scripts"
Cohesion: 0.05
Nodes (32): PROMPTS, all, byTitle, fails, problems, ROOT, s, tmp (+24 more)

### Community 29 - "Agent Role Configuration"
Cohesion: 0.09
Nodes (28): mergeConfigEnv(), redteamSummariesForCheck(), skillLibraryOf(), PLANNER_ROLE, ROLE_ORDER, ROLE_TITLES, addCandidate(), AGENT_PARAM (+20 more)

### Community 30 - "Skill Update Management"
Cohesion: 0.12
Nodes (34): officialSkillSummaries(), summarizeSkills(), dispatchAsync(), apply(), applyUpdate(), checkLatest(), checkLatestFromGithub(), dshHomeCandidates() (+26 more)

### Community 31 - "dsh-purge.js"
Cohesion: 0.08
Nodes (28): args, MODES, alignSummary 建议行分档 + 设计内 skipped 清单（DESIGN_SKIPPED_VERIFIED，带 checkedAgainst/证据文档，第 22 项守它别烂）, CLI 实时验收 --verify-live：契约表/补丁分桶/注入状态/路由 live 四查，有 ⚠ 即非 0, 关 10 磁盘卫生夹具 + 面板路由存活矩阵（12 条断言：阈值、负载形状、反腐蚀）, lib/mcp-server.js：MCP 协议单一来源 mcpRespond —— stdio 循环与宿主 HTTP 路由 POST /dsh-purge/mcp 共用, dirMb(), resolveResources() (+20 more)

### Community 32 - "Conversation Composer Input"
Cohesion: 0.11
Nodes (26): apiJson(), apiTimeoutMs(), apiUrl(), armComposerFill(), ContinueButton(), conversationFace(), conversationInput(), currentSessionId() (+18 more)

### Community 33 - "Patch UI Theming"
Cohesion: 0.09
Nodes (33): Btn(), clientCurrentCwd(), clientGuessSurface(), ContinueRetrySection(), detectHostTheme(), formatSize(), hostSurfaceOf(), hostText() (+25 more)

### Community 34 - "Reverse Engineering & Exploitation"
Cohesion: 0.13
Nodes (33): 移动端反检测绕过：Root/越狱、模拟器、Frida、SSL Pinning, radare2 速查：分析、xref、patch、调试、脚本化, .NET 逆向通用工作流：从判定到重签名, 浏览器扩展分析：从 crx 到源码，权限到能力的映射, Frida 与 Objection 深度用法, Ghidra 实操速查：headless、脚本、反编译器, Go / Rust 二进制逆向：元数据恢复与语言特性, 堆利用：glibc 版本差异、原语与 house 选择 (+25 more)

### Community 35 - "Node Build Tooling"
Cohesion: 0.07
Nodes (20): checkOnly, dry, root, STEPS, checks, problems, root, toggle (+12 more)

### Community 36 - "Release Gate Audits"
Cohesion: 0.07
Nodes (28): 关 9 弹药层一致性审计：技能引用的工具名与条令点名的技能都必须真实存在, 发版七关闸门：语法 / 体积预算 / 双语 key 一致性 / 清单一致性 / 包自证 / 工具面 / JSON 合法（npm run verify 一票过）, 图谱审计：文件级孤儿判红；导出级只报线索（含结构边修正与 79% 盲区率）, 闸门反向探针总表：每道门都要有「改坏即红」的证据，否则等于不知道真假, 端到端情景第八关：20 步串 op 并断言回读，专抓组合期「说谎的回读」与跨 op 不一致, 关 13 工具层冒烟：真执行 purge_apply / purge_revert（mutating 工具分支此前没有一关跑过）, 关 12 写路径冒烟：夹具起点用保险柜原文；单次 apply→revert 哈希精确等于官方；双次 apply 污染还原点（5 文件停在一次已打补丁态）, asJson (+20 more)

### Community 37 - "ATT&CK Technique Mapping"
Cohesion: 0.09
Nodes (28): ATTACK_VERSION, displayTechniqueId(), lookupTechnique(), normalizeTechniqueId(), TACTICS, TECHNIQUES, DIR, missing (+20 more)

### Community 38 - "CLI Smoke Tests"
Cohesion: 0.06
Nodes (25): 关 11 CLI 冒烟：真跑 bin 的只读模式（此前十关没一关执行过 CLI 分发）, BIN, cases, MODES, root, run, BS, child (+17 more)

### Community 39 - "Continue-Retry Tracker"
Cohesion: 0.12
Nodes (26): ABNORMAL_KINDS, clampCount(), createTracker(), DEFAULT_CONTINUE_RETRY, failureCodeOf(), hasFreshHumanTurn(), inboxBusy(), inspectTurn() (+18 more)

### Community 40 - "Dock UI Gating"
Cohesion: 0.13
Nodes (28): apply(), AuthGate(), clampDockGeom(), defaultDockGeom(), EnvAdaptSendGate(), fetchEnvAdaptStatus(), hasInlinePurgeEntry(), HeroNewSessionMount() (+20 more)

### Community 41 - "Patch Reapply & Healing"
Cohesion: 0.19
Nodes (27): 宿主重置后的补丁判失与 applied stamp 自愈, settleInstalledPatches(), appliedStampPath(), applyPlaceholderVersion(), canHealEmptyStamp(), ensureInstalledRevSeed(), healEmptyAppliedStamp(), hostPatchesStillPending() (+19 more)

### Community 42 - "Platform Config Detection"
Cohesion: 0.18
Nodes (27): adaptInDir(), assignToolkitFolder(), configPathOf(), defaultToolkitDir(), detectKali(), EMPTY(), envAdaptStatus(), findInDir() (+19 more)

### Community 43 - "Command Routing Flags"
Cohesion: 0.13
Nodes (25): ALIASED, commandFor(), commandsForStage(), listWordlists(), NEEDS_PROXY, NUCLEI_FAST_FLAGS, nucleiReady(), PD_MUST_FLAG (+17 more)

### Community 44 - "Second Shot Injection"
Cohesion: 0.08
Nodes (25): asJson, files, minIdx, noSection, qualified, root, rows, SKILLS (+17 more)

### Community 45 - "AI Base Discovery"
Cohesion: 0.16
Nodes (27): aiBaseGuessesAround(), aiBaseGuessesFor(), execFileText(), findAiBaseFromDshHome(), findAiBaseFromRequire(), findAiBaseFromRunningProcess(), findAiBaseRecursive(), findAiBaseWeb() (+19 more)

### Community 46 - "Backup and Snapshot Management"
Cohesion: 0.18
Nodes (26): backupAll(), collectRevertTargets(), dropStaleUserProfilePatchBackups(), ensureOfficialSnapshot(), flattenTargetPaths(), hasBackup(), hostBakDigest(), hostBakVaultRoot() (+18 more)

### Community 47 - "Package Tooling Gates"
Cohesion: 0.08
Nodes (24): 生态 tag 口径门禁：7 个 tag 全部满足「2000 条样本在用 + purge 真具备」，词形分裂按生态现状并存, npm run host-sync：把「仓库 → 宿主 profile 副本」这条重复手工动作固化, 清单一致性闸门：COPY_NAMES（自更新）必须落在 files（发布）之内, 工具面闸门 check-tools：结构 + 描述预算 + 返回值预算 + op/entity 可发现性（七关之一）, COPY_NAMES, bin, dsh-purge, bugs (+16 more)

### Community 48 - "Patch Application Utilities"
Cohesion: 0.17
Nodes (25): applyPatches(), applyReplacementsToText(), asLf(), cloneRegExp(), collapseDuplicateLegacyApplyPath(), endOfBalancedBlock(), fileKeysOf(), filePatchOutcome() (+17 more)

### Community 49 - "JS Deobfuscation & Reverse Engineering"
Cohesion: 0.08
Nodes (25): 反分析技术总览：检测点、绕过、残留, AST 去混淆：从混淆态还原到可读逻辑, 自动化入口：从「看到混淆 JS」到「可执行任务」的入口判定, 补环境：让 Node 跑得动浏览器代码, 回退策略：主路径失败的四类原因与替代路径, 取证与证据链：让报告经得起复核, 取证三角：易失性顺序、关键工件、时间线与证据完整性, 狩猎循环：从假设到可验证查询 (+17 more)

### Community 50 - "Tool Budget Checks"
Cohesion: 0.08
Nodes (23): asJson, blocks, BUDGET, drillTool, entBlock, entSections, fallback, hidden (+15 more)

### Community 51 - "Vulnerability Issue Tracking"
Cohesion: 0.14
Nodes (23): SEVERITIES, VULN_STATUSES, ASSET_PRIORITIES, ASSET_TEST_STATES, issue(), LEGACY_STAGES, parseScopeString(), renderIssue() (+15 more)

### Community 52 - "Offensive Security Techniques"
Cohesion: 0.14
Nodes (24): C2 基础设施实战手册, C2 流量分析（从防守方视角反推怎么改）, 邮件认证检查清单：SPF / DKIM / DMARC 的判定与伪造成本, EDR Hook 侦查：发现、归类、出表, 主机持久化与痕迹清除：每条入口的落地位置、存活判据、留痕, Implant 加载器开发, OAuth 同意钓鱼全流程, 钓鱼基础设施实操手册 (+16 more)

### Community 53 - "Search Index Key Analysis"
Cohesion: 0.08
Nodes (23): attackInKeys, avg, avgKeys, freq, idx, keySets, keyTotal, leftover (+15 more)

### Community 54 - "Skill Availability Check"
Cohesion: 0.15
Nodes (21): 进攻力体检：红队 32 技能可用 32、坏 0；单查给出缺的环境变量与修法, bundledSkillSummaries(), checkSkill(), dshHomeCandidates(), existsUnderAnyHome(), expandSkillPath(), pathCountsOnThisHost(), readSkillFromRoot() (+13 more)

### Community 55 - "Console Hiding Hook"
Cohesion: 0.22
Nodes (22): ensureHiddenConsole(), findDshBinRoot(), isPackagedDesktopDshRoot(), isAsarSealedPath(), builtinChildProcess(), forceHideOptions(), hideConsoleDecision(), hideConsoleEntrySource() (+14 more)

### Community 56 - "Smoke Test Fixtures"
Cohesion: 0.09
Nodes (17): beforePending, childFile, expected, expectedSrc, fakeBase, fixture, home, hostBase (+9 more)

### Community 57 - "IoT/OT Firmware Security"
Cohesion: 0.17
Nodes (23): BLE GATT 攻击手册, 调试接口判型：UART / JTAG / SWD / SPI Flash 的识别与命令, EMBA 自动化固件分析：装、跑、读结果、剔误报, 固件仿真与模糊测试：FirmAE/QEMU、补依赖、fuzz 入口与取舍, 固件提取方法论：先判封装，再选工具，失败怎么兜, 工业协议深度手册：Modbus / DNP3 / S7 / EtherNet/IP / OPC UA, OT / ICS 安全评估：只读优先的纪律与"绝对不做"清单, PCAP 协议分析：tshark 过滤、提取、还原会话 (+15 more)

### Community 58 - "Tech Debt Reporting"
Cohesion: 0.09
Nodes (21): argv, checkDebt, day, dbPath, debtLines, failures, liveLines, md (+13 more)

### Community 59 - "GitHub Release Workflow"
Cohesion: 0.09
Nodes (21): concurrency, cancel-in-progress, group, GH_TOKEN, jobs, release, name, on (+13 more)

### Community 60 - "Recon & Asset Scanning"
Cohesion: 0.32
Nodes (22): default-prompt-inject.md（当前生效的注入正文）, 角色 资产梳理（4 个技能）, 角色 信息收集（15 个技能）, active-scan（主动端口与服务扫描）, asset-correlation（资产关联与易打性排序）, 五种资产关系边（resolves/contains/exposes/shares_cert/trusts）, chisel-tunnel（HTTP/WebSocket 隧道）, fofa-recon（FOFA 资产测绘，限速安全版） (+14 more)

### Community 61 - "Graph Audit Utilities"
Cohesion: 0.10
Nodes (21): asJson, deadExports, fileInbound, g, graphBlind, graphPath, hasName(), inbound (+13 more)

### Community 62 - "Agent Session Context"
Cohesion: 0.17
Nodes (20): childOrigin(), inheritsParentPrompt(), installAssembleGuard(), isChildAgentContext(), isRedteamSession(), isRedteamSubagent(), sessionForInject(), sessionOfContext() (+12 more)

### Community 63 - "Pentest Workflow Orchestration"
Cohesion: 0.18
Nodes (20): 自动化循环模式：观察→假设→验证→落库，以及何时退出, 渗透工具选型速查：按任务给首选与替代, Burp 与 MCP 协作：API 暴露面、批量请求、扫描器触发, 客户端实验手册：本地靶场、代理配置、插件、复现模板, AI Agent 能力矩阵：哪些任务该交给 Agent，哪些不该, 渗透循环：五阶段迭代与阶段间交接物, 侦察流水线：子域 → 解析 → 存活 → 指纹 → 目录，每步的输入输出, 角色 辅助（浏览器桥 / 代理池）（3 个技能） (+12 more)

### Community 64 - "Installability Check"
Cohesion: 0.12
Nodes (19): ALIAS, checkOnly, drift, dry, esc(), files, has(), have (+11 more)

### Community 65 - "POC Knowledge Base"
Cohesion: 0.17
Nodes (4): purge_drill：56 个 preset 平面工具收成聚合入口，18 op（读 8 + 写面收纳 update 四方法 / delete 三方法 / open / switch）, 组合式收纳：一个 entity 参数换 10 读面 + 13 写面（POC 五面闭环、资产登记/评估/测试回写）, op=entity_add：一个 op 覆盖六个写面（+92 字符 ≈15/面），shot/poc 明确不接并说明原因, pocCategoryName()

### Community 66 - "Shim Patching and Revert"
Cohesion: 0.20
Nodes (19): ensureDirSync(), hasLegacyPermissionPin(), insertShimInject(), isTextShim(), patchShim(), restoreFromBak(), revertAllShims(), revertShim() (+11 more)

### Community 67 - "Skill Runnable Check"
Cohesion: 0.11
Nodes (16): argvLimit, asJson, files, have, LINUX_MARKS, linuxRows, missRows, root (+8 more)

### Community 68 - "Graph Edge Sync"
Cohesion: 0.23
Nodes (18): edgesOf(), ensureBaseline(), fail(), FILE_TYPES, foldRationale(), hyperEdgesOf(), INFERRED_OK, injectReferenceEdges() (+10 more)

### Community 69 - "Host File Sync"
Cohesion: 0.11
Nodes (16): argv, copyDir, copyMatches(), dryRun, force, head, home, m (+8 more)

### Community 70 - "Red Team Setup"
Cohesion: 0.27
Nodes (18): ask(), ask_secret(), bad(), BIN, cur_env(), dim(), dl_asset(), doctor() (+10 more)

### Community 71 - "Bilingual Locale Check"
Cohesion: 0.12
Nodes (15): 0.2.2-rc.1 锚点漂移已修：7 条补丁重锚或补映射，实况 74/76（追平 0.2.1 基线）, 0.2.2-rc.1 包搬家两例：PTC 执行器拆成 dsh-tool-executor-ptc、交付物提示词拆成 dsh-deliverable-file-references, 双语字典 328×2 key 必须一模一样（按连续文案行自动发现块，不硬编码行号）, 双语文案拆开：源在 locale/*.json，运行时仍走构建期内联（拆源不拆加载）, argv, asJson, blocks, dicts (+7 more)

### Community 72 - "Child Process Execution"
Cohesion: 0.18
Nodes (17): builtinChildProcess(), ChildProcess, cp, exec, execFile, execFileSync, execSync, fork (+9 more)

### Community 73 - "Desktop Install Discovery"
Cohesion: 0.21
Nodes (18): commonDesktopInstallDirs(), exeCandidatesBeside(), exeDirFromRegistryValue(), extraDiscoveredInstallDirs(), extraInstallsFromEnv(), firstExistingExe(), homeSiblingInstalls(), installDirsFromAppScript() (+10 more)

### Community 74 - "Docs and Screenshot Assets"
Cohesion: 0.18
Nodes (17): banner.svg（720×180 项目横幅）, dock-auth.png（850×925，演练台授权页截图）, dock-clean.png（800×850，清洗页侧栏截图）, dock-drill.png（900×850，演练台截图）, own-servers.png（652×509，自己的服务器白名单截图·中文）, own-servers-en.png（652×505，自己的服务器白名单截图·英文）, rules.png（1064×1244，规则集截图）, settings.png（1064×1972，补丁页截图） (+9 more)

### Community 75 - "Desktop Restart Logic"
Cohesion: 0.20
Nodes (17): cleanupLegacyRestartScripts(), desktopRestartChoice(), desktopRuntimeOf(), dshHomeForRelaunch(), helperEnv(), isDesktopExecutable(), logInternal(), officialRestartFlagPath() (+9 more)

### Community 76 - "Database Insert Audit"
Cohesion: 0.12
Nodes (14): db, inserts, KEY, s, src, tableNames, tables, tmp (+6 more)

### Community 77 - "Subagent Role Sessions"
Cohesion: 0.28
Nodes (15): currentEngagementId(), evictRoleBySessionIfOverflow(), installSubagentRoleCapture(), isRedteamChild(), noteClaimedMessage(), parseRedteamRole(), readRoleFile(), remember() (+7 more)

### Community 78 - "Reasoning Promotion Gate"
Cohesion: 0.24
Nodes (15): apply(), buildInstructionHint(), classifyReasoning(), countWord(), decidePromotion(), extractInstructionPaths(), hasAnchoredReasoning(), instructionHintMessages() (+7 more)

### Community 79 - "Locale Build i18n"
Cohesion: 0.13
Nodes (13): block, checkOnly, clientPath, crlf, die(), en, marked, onlyEn (+5 more)

### Community 80 - "Windows Fetch Toolkit"
Cohesion: 0.14
Nodes (12): argv, checkOnly, download(), exists(), force, NL, onlyIdx, picks (+4 more)

### Community 81 - "release-notes.md（1.1.72 → 1.1.83 演化史）"
Cohesion: 0.19
Nodes (15): v1.1.34-prompt-inject.md（历史版本快照）, WEB PENTEST ROUTING 与 canned slots（技能路由表的前身）, ZERO-LATENCY INTERRUPT 与 Σ Integration（旧版思维框架）, 生成物即资产：工程性 / 连续性 / 项目性三纪律, 进攻条令 — ATTACK DOCTRINE（输出即火力）, 火力阶梯五级（打光弹药才停火）, 五阶段主线（信息收集→资产梳理→漏洞发现→漏洞利用→内网渗透）, release-notes.md（1.1.72 → 1.1.83 演化史） (+7 more)

### Community 82 - "Atomic Build Fetcher"
Cohesion: 0.15
Nodes (13): CACHE, cdnPath(), failed, fetchOne(), ids, index, OUT, results (+5 more)

### Community 83 - "Market Sweep Diff"
Cohesion: 0.16
Nodes (13): all, asJson, BASELINE, both, cacheFile, diffs, FIELDS(), got (+5 more)

### Community 84 - "Host Leftover Cleanup"
Cohesion: 0.13
Nodes (12): anchor, apply, asJson, candidates, entries, keepArg, prevs, reclaim (+4 more)

### Community 85 - "Host Patch Status"
Cohesion: 0.19
Nodes (13): 宿主实况：桌面 EXE 0.2.2-rc.1 / runtime 0.2.2-rc.1 / cordis 4.1.0, markersAny=true 的补丁：applied 只代表「至少打了一处」，会藏半个没打的门, 状态面升级：补丁按 已清洗/待清洗/锚点未命中/不适用/缺文件 分桶 + 宿主版本对齐告警, 未安装项整体摘除：83 → 76 条补丁，面板 0 不适用 / 0 缺文件, 宿主枚举可见化：gatherState 出 patch_hosts 四字段 + hostEnumerationLine 单一格式化器，四个状态面共用, ADAPTERS, dshHostVersion(), hostAdapter() (+5 more)

### Community 86 - "Asset Slot Table"
Cohesion: 0.24
Nodes (9): IV, MASK, SLOT, SLOT_ROWS, TAG, MIX, mixKey(), sealSlot() (+1 more)

### Community 87 - "Scope Validation"
Cohesion: 0.30
Nodes (13): checkAction(), checkTarget(), checkTechnique(), cidrInsideCidr(), ipInCidr(), ipv4ToInt(), isDomain(), isIpv4() (+5 more)

### Community 88 - "ASAR Patch Verification"
Cohesion: 0.26
Nodes (12): asar 密封态 = 补丁是否真生效的判据, 官方客户端升级回写标记 dsh-purge-reapply-asar, probeWshJsEngine(), wshJsEngineWorks(), clearStaleExtractedApps(), clearUpgradeMarker(), harnessExeName(), isWshAscii() (+4 more)

### Community 89 - "Fingerprint Scoring Radar"
Cohesion: 0.23
Nodes (12): aggregateHits(), COST_LABEL, FINGERPRINT_RULES, hostKey(), looksWebHost(), matchFingerprints(), radarOneLine(), radarState() (+4 more)

### Community 90 - "Client Build Script"
Cohesion: 0.15
Nodes (12): applyAt, beginAt, body, client, clientPath, drillSrc, end, endAt (+4 more)

### Community 91 - "Scope Gate Check"
Cohesion: 0.15
Nodes (9): asJson, CASES, fails, NOW, root, scope, skipped, TECHS (+1 more)

### Community 92 - "Preset Sync Parity Check"
Cohesion: 0.17
Nodes (11): copies, line, presetContents, presets, problems, profilesRoot, read(), ROOT (+3 more)

### Community 93 - "Tool Reachability Check"
Cohesion: 0.15
Nodes (11): corpus, onceOnly, pct, registered, ROOT, silent, skillDir, skills (+3 more)

### Community 94 - "Graph Label Generation"
Cohesion: 0.15
Nodes (10): batchSize, cfgPath, env, extra, labelsPath, maxConcurrency, missingOnly, passthrough (+2 more)

### Community 95 - "Scenario Drill Runner"
Cohesion: 0.21
Nodes (12): drill, failures, has(), liveStore, main(), not(), re(), root (+4 more)

### Community 96 - "HTTP Request Building"
Cohesion: 0.29
Nodes (7): RFC-3986, buildCurlCommand(), buildHttpRequest(), commandKind(), fillTemplate(), parseCurl(), parseTarget()

### Community 97 - "Agent Settings Config"
Cohesion: 0.32
Nodes (11): clampMaxAgents(), DEFAULT_MAX_AGENTS, MAX_AGENTS_LIMIT, maxAgentsOf(), maxAgentsSourceOf(), readSettings(), saveMaxAgents(), settingsPathOf() (+3 more)

### Community 98 - "Desktop Surface Detection"
Cohesion: 0.33
Nodes (10): adoptSurfaceForAiBase(), aiBaseLooksDesktopInstall(), exeName(), forcedSurface(), isDesktopSurface(), norm(), pathLooksDesktop(), resourcesLookLikeDesktopInstall() (+2 more)

### Community 99 - "Graph Validation Report"
Cohesion: 0.20
Nodes (11): comms, fallback, html, ids, isFallback(), notes, out, problems (+3 more)

### Community 100 - "ASAR Library Resolution"
Cohesion: 0.17
Nodes (9): ASAR, ASAR_CANDIDATES, asarLib, CACHE, names, problems, ROOT, src (+1 more)

### Community 101 - "Wordlist Fetching"
Cohesion: 0.20
Nodes (10): checkOnly, dir, fetchList(), force, LISTS, only, onlyArg, picks (+2 more)

### Community 102 - "Community Intelligence & Tool Contracts"
Cohesion: 0.22
Nodes (9): 社区情报主文档：独占性、目录规模、restart∩patch=0、长尾抽样、产物级对照、模块化判定、成本自述做法（七轮实测累计）, 同地盘地图：600 条样本里无人做提示词优先级治理，purge 的三档作用域已被 purge_rules 报出, 生态漂移探测 sweep:market：把六趟手打的复查口径写死进代码（FIELDS + 正则 + 基线），交集被吃进即判失败, 生态规模与产物级对照：catalog 10063 条；dsh-context 0 工具/65 字，dsh-ops 8 注册/7,566 字，purge 10 工具/3,598 字, 社区同路原则：one stable proxy tool instead of N tool schemas（dsh-mcp-lazy / dsh-mcp-lens 按需加载 schema）, purge_status 按需展开：同一渲染函数两个 section 显式索取，返回值成本 13023 → 538 字符, 模型工具契约表：lib/model-tools.js 一处定义，宿主 ctx.tools 与 MCP 共用（8 个工具）, mcpRespond() (+1 more)

### Community 103 - "Upstream Drift Detection"
Cohesion: 0.24
Nodes (10): 上游漂移探测 check:upstream：latest vs dshTarget vs engines，越界才判失败、离线只报未知, asJson, cmp(), core3(), inRange(), pkg, range, root (+2 more)

### Community 104 - "Package Installation"
Cohesion: 0.18
Nodes (11): patch, inject, platform, dsh, bundle, client, install, git (+3 more)

### Community 105 - "Engagement Report Export"
Cohesion: 0.18
Nodes (9): argv, id, name, outDir, outFile, rep, shotsDst, shotsSrc (+1 more)

### Community 106 - "Profile Patching and Health"
Cohesion: 0.44
Nodes (9): guardProfilePatch(), inspectHostHealth(), listPatchBackups(), missingPackages(), packageInstalled(), packageOf(), profilePatchIsEmpty(), sanitizePatchText() (+1 more)

### Community 107 - "Asset Stage Management"
Cohesion: 0.20
Nodes (3): scopeOfIp(), parseJson(), scoreStageOf()

### Community 109 - "Path Boundary Validation"
Cohesion: 0.20
Nodes (7): allowed, failed, results, ROOT, secret, tmp, validatePath

### Community 110 - "Size Budget Checking"
Cohesion: 0.20
Nodes (8): argv, asJson, BUDGETS, maxDefault, over, root, rows, walk()

### Community 111 - "Community Naming"
Cohesion: 0.20
Nodes (7): byComm, g, gp, hp, labels, lp, still

### Community 112 - "Skill Heading Normalization"
Cohesion: 0.24
Nodes (9): checkOnly, demote(), dropRedundantH1(), dry, files, normalize(), remaining, root (+1 more)

### Community 113 - "ASAR Toggle Utility"
Cohesion: 0.22
Nodes (6): findResourcesDir(), appDir, argv, asar, parked, res

### Community 114 - "Prompt Embedding Pipeline"
Cohesion: 0.22
Nodes (7): embed-prompt, dest, packed, root, src, text, 发版固定流程：改 md 源 → embed-prompt 重封入 asset-table.js → bump 三份 README → pnpm update

### Community 115 - "Host Clean Script"
Cohesion: 0.25
Nodes (7): jsString(), officialRestartScript(), HOST_CLEAN_IDENTITY_MARK, HOST_CLEAN_KEEPS_LEGACY, HOST_CLEAN_KEEPS_MARK, HOST_OFFICIAL_IDENTITY, hostCleanFnSource()

### Community 116 - "Toolkit Health Scanning"
Cohesion: 0.36
Nodes (5): describeToolkit(), scanToolkit(), shellAdvice(), asJson, scan

### Community 117 - "Web Server Restart"
Cohesion: 0.54
Nodes (6): hostFromRequest(), portFromRequest(), restartArgv(), scheduleCleanupRestart(), scheduleRestart(), spawnRestartHelper()

### Community 118 - "Package Exports & Redteam"
Cohesion: 0.25
Nodes (8): exports, ./client, ./locale/*.json, ./package.json, ./redteam, ./redteam/store, ./redteam/tools, ./redteam/ui

### Community 119 - "Graph Freshness Check"
Cohesion: 0.25
Nodes (6): changed, codeChanged, GRAPH, MAX_LAG, ROOT, sample

### Community 120 - "Transaction Atomicity Check"
Cohesion: 0.25
Nodes (6): after, before, problems, ROOT, store, tmp

### Community 121 - "Probe Gate Runner"
Cohesion: 0.25
Nodes (5): bad, probes, root, rows, verbose

### Community 122 - "Patch & Upgrade Log"
Cohesion: 0.38
Nodes (7): 三条破损补丁 #77 / #68 / #26, 死补丁 #40 移除与 84 → 83 计数, 适配-0.2.1-rc.2-差异分析.md（宿主升级核对）, #82 教训：打包注释 //#region 不能当锚点第二行, 装梁神导致 pnpm 把安装副本覆盖回 1.1.72, memory/2026-10-22.md（1.1.73–1.1.75 实战日志）, .workbuddy-ai/memory/MEMORY.md（项目长期记忆）

### Community 123 - "Module Resolution"
Cohesion: 0.38
Nodes (5): apply(), inject, name, readSelfPackage(), resolveRoot()

### Community 124 - "Settings Management"
Cohesion: 0.40
Nodes (4): normalizeRewriteOptions(), DEFAULT_SETTINGS, loadMnemonSettings(), mnemonSettingsPath()

### Community 127 - "Desktop Install Path Detection"
Cohesion: 0.50
Nodes (5): inferDesktopInstallDir(), isInsideDesktopInstall(), isSubPath(), looksLikeDesktopNameTail(), slashNorm()

### Community 129 - "CTF Prompt Injection Framework"
Cohesion: 0.50
Nodes (4): CTF CORE CONTRACT / SCOPE / EVIDENCE / WORKFLOW 四段, Little Code Sauce / YG 人格框架（SANDBOX — STABLE）, HARD OUTPUT RULES + 拒绝对抗（禁止词表与整轮重写）, collectInjectText()

### Community 130 - "Scoped Prompt Injection Rules"
Cohesion: 0.67
Nodes (4): default-prompt-inject.en.md（英文版注入正文）, default-prompt-inject.zh.md（中文版注入正文）, 草稿审查 R1–R8 缺陷清单, Scoped Rules 动态路由（25 条按意图激活）

### Community 131 - "Preset Configuration Metadata"
Cohesion: 0.50
Nodes (3): description, name, order

### Community 132 - "Node Runtime Engines"
Cohesion: 0.67
Nodes (3): engines, dsh, node

### Community 133 - "Repository Configuration"
Cohesion: 0.67
Nodes (3): repository, type, url

## Ambiguous Edges - Review These
- `applyPatches()` → `settings.png（1064×1972，补丁页截图）`  [AMBIGUOUS]
  docs/preview/settings.png · relation: references

## Knowledge Gaps
- **112 isolated node(s):** `RFC-1918`, `BIN`, `RFC-3986`, `AD 攻击路径全图：从普通域用户到 Domain Admin`, `AD CS 证书滥用：ESC1–ESC15 逐条判据与验伤` (+107 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1172 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `README.md（中文主文档）` connect `Docs and Screenshot Assets` to `Plugin Update & Versioning`, `Code Patch Execution Permissions`, `Preset Configuration Metadata`, `Release Gate Audits`, `Skills Management`, `Bilingual Locale Check`, `client.js`, `Prompt Injection Defense`, `Rules Management`, `Session Rewind Engine`, `Plugin Request Guard`, `Network Access Control`, `Package Tooling Gates`, `release-notes.md（1.1.72 → 1.1.83 演化史）`, `Host Patch Status`, `Desktop Process Restart`, `Patch & Upgrade Log`, `dsh-purge.js`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **What connects `RFC-1918`, `BIN`, `RFC-3986` to the rest of the system?**
  _112 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Offensive Security Attack Surfaces` be split into smaller, more focused modules?**
  _Cohesion score 0.05040611562350693 - nodes in this community are weakly interconnected._
- **Why does `release-notes.md（1.1.72 → 1.1.83 演化史）` connect `release-notes.md（1.1.72 → 1.1.83 演化史）` to `Plugin Update & Versioning`, `IP Address Utilities`, `Community Intelligence & Tool Contracts`, `Bilingual Locale Check`, `client.js`, `Patch Reapply & Healing`, `Docs and Screenshot Assets`, `Prompt Injection Defense`, `Offensive Security Techniques`, `Security Testing & Exploitation`, `Patch & Upgrade Log`, `Recon & Asset Scanning`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Should `Plugin Update & Versioning` be split into smaller, more focused modules?**
  _Cohesion score 0.06974789915966387 - nodes in this community are weakly interconnected._
- **Why does `RedteamStore` connect `Redteam Engagement Store` to `HTTP Request Building`, `POC Knowledge Base`, `IP Address Utilities`, `Engagement Report Export`, `Platform Config Detection`, `Asset Stage Management`, `Attack File Management`, `Attack Path Assessment`, `Model Tool Building`, `Module Resolution`, `Scenario Drill Runner`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `applyPatches()` and `settings.png（1064×1972，补丁页截图）`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._