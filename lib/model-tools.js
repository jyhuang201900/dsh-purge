import os from "node:os";
import path from "node:path";
import { RedteamStore } from "./redteam/store-core.js";
import {
  bundledSkillSummaries,
  officialSkillSummaries,
  checkSkill,
  summarizeSkills,
} from "./redteam/skill-availability.js";

/**
 * 模型可见工具的统一契约（单一来源）：宿主 ctx.tools 与 bin --mcp 都读这张表，不再各写一份。
 * 约定：输出统一是 { text }；描述说行为不说实现；参数规则写在参数上。
 */

const TEXT_OUT = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { text: { type: "string" } },
  },
  render: (_args, value) => [{ type: "text", text: String(value?.text ?? "") }],
};

const cut = (value, n = 88) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/**
 * 摘要版状态（给 MCP/bin 用）。宿主侧仍注入自己的完整 renderStatus，输出逐字节不变。
 * 字段名取自 core.gatherState() 的既有导出。
 */
/**
 * 演练台实体清单（组合而非堆叠）：一个 op=list + entity 参数，映射到 store 现成的统一 list* 方法。
 * 返回形状不一（有的分页 {total,items}、有的裸数组），由 drill 的归一逻辑统一处理。
 */
export const DRILL_ENTITIES = {
  vuln: "listVulns",
  credential: "listCredentials",
  access: "listAccess",
  webshell: "listWebshells",
  tunnel: "listTunnels",
  web: "listWeb",
  http: "listHttpEvidence",
  shot: "listShots",
  prompt: "listPrompts",
  segment: "listSegments",
};

/**
 * 通用写入面（组合）：一个 op=entity_add + entity 参数覆盖六个实体族，字段名按 store 的真实列映射。
 * 参数全部复用已有的 target/name/kind/text —— 所以 schema 成本只落在 op 描述串上。
 * shot 需要真实文件路径、savePoc 签名不吃 id，两者不在此表（宁缺不假）。
 */
export const DRILL_WRITE_ENTITIES = {
  vuln: { method: "addVuln", build: (a) => ({ target: a.target, title: a.name, severity: a.kind, evidence: a.text, tool: a.tool || "drill", provenance: "active" }) },
  credential: { method: "addCredential", build: (a) => ({ host: a.target, secret_type: a.kind, username: a.name, secret_value: a.text, tool: a.tool || "drill", provenance: "active" }) },
  access: { method: "addAccess", build: (a) => ({ host: a.target, method: a.kind, username: a.name, note: a.text, tool: a.tool || "drill", provenance: "active" }) },
  webshell: { method: "addWebshell", build: (a) => ({ url: a.target, kind: a.kind, note: a.text, tool: a.tool || "drill", provenance: "active" }) },
  tunnel: { method: "addTunnel", build: (a) => ({ host: a.target, kind: a.kind, local: a.name, remote: a.text, tool: a.tool || "drill", provenance: "active" }) },
  http: { method: "addHttpEvidence", build: (a) => ({ url: a.target, method: a.kind, note: a.text, tool: a.tool || "drill", provenance: "active" }) },
};

/** 各实体挑一个最能说明问题的字段来显示。 */
function entityBrief(entity, r) {
  const prefer = {
    vuln: ["title", "cve", "severity", "target", "status"],
    credential: ["secret_type", "username", "privilege", "host"],
    access: ["method", "username", "privilege", "host"],
    webshell: ["url", "kind", "tool", "target"],
    tunnel: ["kind", "local", "remote", "target"],
    web: ["url", "name", "title", "target"],
    http: ["method", "url", "tool", "note"],
    shot: ["label", "file", "kind", "target"],
    prompt: ["name", "title", "kind", "id"],
    segment: ["segment_cidr", "cidr", "state", "note"],
  };
  for (const k of prefer[entity] || []) if (r?.[k]) return `${k}=${String(r[k]).slice(0, 60)}`;
  const anyKey = Object.keys(r || {}).find((k) => typeof r[k] === "string" && r[k].length > 1 && r[k].length < 70);
  return anyKey ? `${anyKey}=${r[anyKey]}` : JSON.stringify(r).slice(0, 70);
}

export function defaultRenderStatus(state, opts = {}) {
  if (!state) return "状态：无（gatherState 未返回）";
  const rows = [];
  if (opts.patches === true) {
    // 只用 gatherState 真给出的字段（原先读了个没人写的 state.__tally，恒 null）。
    rows.push(`明细：${state.patches_applied ?? "?"}/${state.patches_total ?? "?"} 已清洗｜待清洗 ${state.patches_pending ?? 0}｜未生效 ${state.patches_skipped ?? 0}`);
  }
  if (opts.files === true) {
    const entries = Object.entries(state.files || {});
    rows.push(`目标文件 ${entries.length} 项：${entries.slice(0, 26).map(([k, v]) => k).join(", ")}`);
  }
  return [...rows,
    `surface=${state.surface || "?"}｜DSH_HOME=${state.dsh_home || "?"}`,
    `插件根=${state.ai_base || core0(state)}`,
    `补丁 ${state.patches_applied ?? "?"}/${state.patches_total ?? "?"} 已清洗｜待清洗 ${state.patches_pending ?? 0}｜锚点未命中 ${state.patches_skipped ?? 0}｜不适用 ${state.patches_na ?? 0}`,
    `注入文件=${state.override_path || "?"}（${state.override_status || "?"}）`,
  ].join("\n");
}

function core0(state) {
  return state?.missing_ai_base ? `未定位（${state.missing_ai_base}）` : "未定位";
}

export function buildModelTools(deps) {
  const { core, rules, hostctl, updater, rejectIfNeedPrompt } = deps;
  const renderStatus = deps.renderStatus ?? defaultRenderStatus;

  const status = {
    name: "purge_status",
    description: `查看 dsh 指令权威性清洗状态（${core.ALL_PATCHES.length} patch 进度、shim、override、app.asar 是否还封着）。默认给紧凑视图；两个 section 按需索取。`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        files: { type: "boolean", description: "列出目标文件映射（26 条绝对路径，给人排路径用；加上后体积涨约 20 倍）。" },
        patches: { type: "boolean", description: "逐条列补丁明细；不给则只报计数与未生效 id。" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      return { text: renderStatus(await core.gatherState(), args) };
    },
  };

  const align = {
    name: "purge_align",
    description: "宿主对齐体检：宿主版本、插件适配声明、补丁分桶计数、锚点未命中清单、升级台账与建议。宿主升级后先用它确认破甲面是否还在。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        miss: { type: "boolean", description: "列出未命中补丁的完整名单（含名称）；缺省只给 id。" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      return {
        text: core.alignSummary(await core.gatherState(), {
          host: hostctl.dshHostVersion(),
          target: updater.targetVersion(),
          ledger: updater.updateLedger(1),
          withNames: args.miss === true,
        }),
      };
    },
  };

  const apply = {
    name: "purge_apply",
    description: `应用 dsh 指令权威性清洗：${core.ALL_PATCHES.length} patch（提示词层+代码默认+引擎级审批/沙箱绕过）+ shim 注入 + override 文件。需重启 dsh 完全生效。`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        patches: {
          type: "string",
          description: "逗号分隔的补丁 id（如 14,17,74）；缺省=全部。选打时仍会做 shim 与 override，只缩小补丁范围。",
        },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      core.applyRuntimeEnv();
      const scrubbed = core.sanitizeDesktopCommandRuntimes();
      const state = await core.gatherState();
      if (!state.ai_base) return { text: `ERROR: ${core.missingAiBaseMessage()}` };
      const blocked = rejectIfNeedPrompt(state.dsh_home);
      if (blocked) return { text: `ERROR: ${blocked.error}` };
      const picked = String(args.patches || "").split(",").map((s) => parseInt(s, 10)).filter(Number.isFinite);
      const list = picked.length ? core.ALL_PATCHES.filter((p) => picked.includes(p.id)) : core.ALL_PATCHES;
      const toolMulti = await core.applyPatchesAllHosts(list, { preserveClientBundles: false, forApply: true });
      await core.patchAllShims();
      const flash = core.silenceCmdFlash(toolMulti.hosts[0]?.aiBase || state.ai_base);
      const report = toolMulti.report;
      const applied = report.filter((r) => r.status === "applied").length;
      const already = report.filter((r) => r.status === "already").length;
      const unknown = picked.filter((id) => !core.ALL_PATCHES.some((p) => p.id === id));
      const scrubNote = scrubbed.length ? ` desktop_scrub=${scrubbed.length}` : "";
      const scopeNote = picked.length ? ` 范围=${picked.join(",")}${unknown.length ? `（未知 id: ${unknown.join(",")}）` : ""}` : "";
      return { text: `清洗完成 / applied=${applied}, already=${already}.${scrubNote}${scopeNote} phase-1=${flash.phase1} 重启 dsh 生效.` };
    },
  };

  const revert = {
    name: "purge_revert",
    description: "回滚 dsh 指令权威性清洗到备份原件（保留 prompt-inject.md 用户文件）。",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    output: TEXT_OUT,
    async execute() {
      const lines = [];
      const { reverted, errors } = await core.revertAllHosts();
      lines.push(`reverted=${reverted.length}${errors.length ? ` errors=${errors.length}` : ""}`);
      const shimRevert = await core.revertAllShims();
      lines.push(`shim_dirs=${Object.keys(shimRevert).length}`);
      return { text: `回滚完成 / ${lines.join(", ")}. 重启 dsh 恢复.` };
    },
  };

  const patch = {
    name: "purge_patch",
    description: "查补丁明细：不给参数=按层汇总并列出未生效项；给 id=单条详情；给 layer=该层逐条。用于定位「哪条门还没打上」。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "number", description: "补丁 id。" },
        layer: { type: "string", description: "层名，如 提示词 / 代码 / 工具；与 id 同时给时以 id 为准。" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const state = await core.gatherState();
      const st = state.patch_status || {};
      const all = core.ALL_PATCHES;
      if (args.id !== undefined) {
        const p = all.find((x) => x.id === Number(args.id));
        if (!p) return { text: `没有补丁 #${args.id}（现有 ${all.length} 条）` };
        const files = Array.isArray(p.file) ? p.file.join(", ") : String(p.file);
        return {
          text: [
            `#${p.id} ${p.name}｜${p.layer}/${p.layer_en}`,
            `状态=${st[p.id] ?? "?"}｜说明=${cut(p.desc, 120)}`,
            `目标 file key=${files}｜锚点 ${Array.isArray(p.replacements) ? p.replacements.length : 0} 档｜optional=${p.optional === true}｜markersAny=${p.markersAny === true}`,
          ].join("\n"),
        };
      }
      const notApplied = all.filter((p) => st[p.id] !== "applied" && st[p.id] !== "already");
      if (args.layer) {
        const rows = all.filter((p) => p.layer === args.layer || p.layer_en === args.layer);
        if (!rows.length) return { text: `没有名为「${args.layer}」的层（现有：${[...new Set(all.map((p) => p.layer))].join(" / ")}）` };
        return { text: [`层「${args.layer}」共 ${rows.length} 条：`].concat(rows.map((p) => `  #${p.id} ${(st[p.id] ?? "?").padEnd(8)} ${p.name}`)).join("\n") };
      }
      const byLayer = {};
      for (const p of all) (byLayer[p.layer] ??= []).push(p);
      const head = Object.entries(byLayer).map(([layer, ps]) => `${layer} ${ps.filter((p) => st[p.id] === "applied" || st[p.id] === "already").length}/${ps.length}`);
      return {
        text: [
          `补丁 ${all.length - notApplied.length}/${all.length} 已清洗｜分层：${head.join("、")}`,
          `未生效 ${notApplied.length} 条：${notApplied.map((p) => `#${p.id}(${st[p.id] ?? "?"})`).join(" ") || "无"}`,
          "要细节：purge_patch id=74 或 layer=提示词",
        ].join("\n"),
      };
    },
  };

  const update = {
    name: "purge_update",
    description: "更新框架体检：渠道与钉选、宿主实况版本、适配声明、升级台账。默认只读本地；check=true 才问远端版本（要联网）。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        check: { type: "boolean", description: "联网查远端版本与是否有更新；缺省 false（离线，只报本地台账）。" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const pub = updater.channelPublic();
      const host = hostctl.dshHostVersion();
      const target = updater.targetVersion();
      const ledger = updater.updateLedger(3);
      const lines = [
        `渠道=${pub.channelLabel || pub.channel}${pub.pin ? ` 钉选=${pub.pin}` : ""}`,
        `宿主=${host.app || host.runtime || "?"} cordis=${host.cordis || "?"}｜插件=${updater.localVersion()} 适配 dshTarget=${target}`,
        `台账：last=${ledger.last ? `${ledger.last.version || ledger.last.ref}@${ledger.last.sha}` : "无（面板未执行过更新）"} guard=${ledger.guard ? ledger.guard.sha : "无"}`,
      ];
      if (ledger.history.length > 1) lines.push(`历史：${ledger.history.slice(0, 5).map((h) => `${h.version || h.ref}@${h.sha || "-"}`).join(" → ")}`);
      if (args.check === true) {
        try {
          const r = await updater.checkUpdate();
          lines.push(`远端：hasUpdate=${r.hasUpdate} remote=${r.remoteVersion || r.remoteSha || "?"} local=${r.localVersion || "?"}@${r.localSha || "-"} via=${r.via || "?"}`);
        } catch (e) {
          lines.push(`远端：查询失败 ${cut(e?.message ?? e, 90)}`);
        }
      }
      return { text: lines.join("\n") };
    },
  };

  const rulesTool = {
    name: "purge_rules",
    description: "规则集体检（AGENTS.md / CLAUDE.md 那套）：当前生效项、注入来源、工作区别策略与全部规则条目。给 id 则看该条正文摘要。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "规则 id；给了就附该条正文摘要。" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const home = core.findDshHome();
      const rs = await rules.rulesStatus(home);
      const list = Array.isArray(rs.rules) ? rs.rules : [];
      const lines = [
        `生效=${rs.active || "无"}｜注入来源=${rs.injectSource || "?"}${rs.injectRuleId ? `(${rs.injectRuleId})` : ""}`,
        `规则 ${list.length} 条：${list.map((r) => r.id ?? r).join(", ") || "（本机构建用 prompt-inject.md，无规则集）"}`,
        `workspace 策略=${rs.workspace_policy || rs.workspacePolicy || "?"}｜cwd 候选=${Array.isArray(rs.cwd_candidates) ? rs.cwd_candidates.length : 0}｜AGENTS.md 同步=${String(rs.agents_synced ?? "?")}`,
      ];
      if (args.id) {
        const one = await rules.readRule(home, String(args.id)).catch(() => null);
        lines.push(one ? `规则「${args.id}」：${cut(one, 160)}` : `没有规则「${args.id}」`);
      }
      return { text: lines.join("\n") };
    },
  };

  const skillsTool = {
    name: "purge_skills",
    description: "技能可用性体检：用户 Skill 与红队技能各多少个、哪些真的能用、坏在哪条、怎么修。进攻面缺哪个从这里查，不看目录数。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "技能名；给了就只报该技能的可用性与修复建议。" },
        all: { type: "boolean", description: "列出全部技能名（默认只列有问题的，省上下文）。" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const user = officialSkillSummaries();
      const red = bundledSkillSummaries();
      const nameOf = (s) => String((s && (s.name || s.id)) || "(未命名)");
      if (args.id) {
        const pool = [...red, ...user];
        const one = pool.find((s) => nameOf(s) === String(args.id));
        if (!one) return { text: `没有技能「${args.id}」（红队 ${red.length} + 用户 ${user.length} 个）` };
        const r = checkSkill(one);
        const lines = [`「${nameOf(one)}」status=${r.status}｜来源=${red.includes(one) ? "红队随包" : "用户 Skill"}`];
        for (const it of (r.issues || []).slice(0, 6)) lines.push(`  · ${cut(it.detail, 96)}${it.fix ? `｜修：${cut(it.fix, 96)}` : ""}`);
        if (!(r.issues || []).length) lines.push("  · 无问题");
        return { text: lines.join("\n") };
      }
      const sum = summarizeSkills(red.map((s) => checkSkill(s)));
      const sumU = summarizeSkills(user.map((s) => checkSkill(s)));
      const bad = red
        .map((s) => ({ s, r: checkSkill(s) }))
        .filter((x) => x.r.status !== "available");
      const lines = [
        `红队技能（随包/已同步）：共 ${sum.total}｜可用 ${sum.available}｜坏 ${sum.broken}｜判不了 ${sum.unknown}`,
        `用户 Skill：共 ${sumU.total}｜可用 ${sumU.available}｜坏 ${sumU.broken}｜判不了 ${sumU.unknown}`,
      ];
      if (bad.length) lines.push(`待修：${bad.slice(0, 6).map((x) => `${nameOf(x.s)}(${x.r.status})`).join(", ")}${bad.length > 6 ? ` 等 ${bad.length} 个` : ""}`);
      else lines.push("待修：无");
      if (args.all === true) lines.push(`红队清单：${red.map(nameOf).join(", ")}`);
      lines.push("要细节：purge_skills id=<技能名>");
      return { text: lines.join("\n") };
    },
  };

  const drill = {
    name: "purge_drill",
    description: "演练台聚合入口，普通会话不用切红队预设：缺参给清单、无靶标给引导，不抛错。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        op: {
          type: "string",
          description:
            "读：summary(缺省)|engagements|assets|chain|scores|attackfiles|stages|list(entity)|pocs（POC 库，可带 text 检索）|report（战报；kind=score 得分报告 / kind=targets 目标汇总，limit 控行数）；写：chain_add(text)|score_add(point,text,value?)|attackfile_add(target,name,text)|entity_add(entity,target,name?,kind?,text?)",
        },
        engagement: { type: "string", description: "靶标 id，缺省当前靶标" },
        limit: { type: "number", description: "读：条数上限，缺省 8" },
        entity: { type: "string", description: "list/entity_add 必填。读：vuln|credential|access|webshell|tunnel|web|http|shot|prompt|segment；写：vuln|credential|access|webshell|tunnel|http" },
        name: { type: "string", description: "attackfile 文件名；entity_add 里按实体解释（漏洞标题/账号名/隧道本地端）" },
        text: { type: "string", description: "写：内容/证据；读 pocs 时当检索词" },
        stage: { type: "string", description: "chain：阶段 code，缺省 recon" },
        tool: { type: "string", description: "chain：工具名，缺省 drill" },
        point: { type: "string", description: "score：得分点 code" },
        value: { type: "number", description: "score：台数/条数" },
        target: { type: "string", description: "attackfile：IP/URL/C 段" },
        name: { type: "string", description: "attackfile：文件名" },
        kind: { type: "string", description: "attackfile 类别（poc|exp|script|wordlist|other，缺省 script）；report 时给 score 出得分报告、给 targets 出目标汇总" },
        content: { type: "string", description: "attackfile：正文，不给用 text" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const store = deps.redteamStore ?? new RedteamStore(
        process.env.REDTEAM_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "redteam"),
      );
      const op = String(args.op || "summary");
      const list = Array.isArray(store.listEngagements()) ? store.listEngagements() : [];
      const activeId = args.engagement || (list.length ? store.activeEngagementId() : undefined);
      const cap = Number.isFinite(args.limit) ? args.limit : 8;
      if (op === "summary" || op === "engagements") {
        const lines = [
          `靶标 ${list.length} 个｜当前=${activeId || "无"}`,
          list.length ? `清单：${list.slice(0, cap).map((e) => `${e.name && e.name !== e.id ? `${e.id}(${e.name})` : e.id}${e.state ? `·${e.state}` : ""}`).join(", ")}${list.length > cap ? ` …共 ${list.length}` : ""}` : "引导：还没开靶标——界面「演练台」新建，或红队会话里跑 redteam_engagement_open；此时资产/链条/得分查询都为空。",
        ];
        if (activeId && op === "summary") {
          const s = store.stats(activeId);
          lines.push(`事实库 stats：${Object.entries(s || {}).filter(([, v]) => typeof v === "number").slice(0, 10).map(([k, v]) => `${k}=${v}`).join(" ") || "（空）"}`);
        }
        return { text: lines.join("\n") };
      }
      // op 写错要当场说清，别让「本机没靶标」把真实原因盖住（有靶标的机器才会走到下面的未知 op 分支）。
      const KNOWN = ["summary", "engagements", "assets", "chain", "scores", "attackfiles", "stages", "list", "entity_add", "chain_add", "score_add", "attackfile_add", "pocs", "report"];
      if (!KNOWN.includes(op)) {
        return { text: `未知 op「${op}」｜读：${KNOWN.slice(0, 7).join(" | ")}；写：${KNOWN.slice(7).join(" | ")}` };
      }
      if (!activeId) return { text: `没有靶标，${op} 用不了。先开靶：界面「演练台」新建，或红队会话里跑 redteam_engagement_open（当前共 ${list.length} 个）。` };
      if (op === "chain_add" || op === "score_add" || op === "attackfile_add") {
        const itemsOf = (v) => (Array.isArray(v?.items) ? v.items : (Array.isArray(v) ? v : []));
        let touched = null;
        try {
          if (op === "chain_add") {
            if (!args.text) return { text: "chain_add 需要 text（这一步做了什么）。例：purge_drill op=chain_add text=nmap 摸到 3 个端口" };
            store.addChainStep(activeId, {
              stage_code: String(args.stage || "recon"),
              tool: String(args.tool || "drill"),
              result: String(args.text),
            });
          } else if (op === "attackfile_add") {
            const need = [];
            if (!args.target) need.push("target（IP / URL / C 段）");
            if (!args.name) need.push("name（文件名）");
            if (!args.text) need.push("text 作为 evidence（只收录实际生效的脚本/POC/EXP）");
            if (need.length) {
              return { text: `attackfile_add 缺：${need.join("、")}。例：purge_drill op=attackfile_add target=10.0.0.7 name=slowloris.py text=打到 80 端口回显 408` };
            }
            const res = store.addAttackFile(activeId, {
              target: String(args.target),
              name: String(args.name),
              evidence: String(args.text),
              content: args.content ? String(args.content) : String(args.text),
              kind: args.kind ? String(args.kind) : undefined,
            });
            const files = Array.isArray(store.listAttackFiles(activeId)) ? store.listAttackFiles(activeId) : itemsOf(store.listAttackFiles(activeId));
            const leaf = String(res?.path || "").split(/[\\/]/).slice(-2).join("/");
            return { text: `attackfile_add 已写入 @${activeId}｜台账 ${files.length} 条，落盘=${cut(leaf, 92)}` };
          } else {
            const points = itemsOf(store.listScorePoints(activeId));
            const want = args.point ? String(args.point) : "";
            if (!want) {
              return { text: `score_add 需要 point（得分点 code）。可用：${points.slice(0, 10).map((x) => x.code || x.id).join(", ") || "（未播种，跑一次 op=scores 会自动播）"}` };
            }
            if (!args.text) {
              return { text: "score_add 需要 text 作为证据（store 硬要求：账号/回显/数据量/路径）。例：purge_drill op=score_add point=terminal-access text=摄像头后台" };
            }
            // addScoreHit 只认 point_id / point_name（实测传 point_code 会被判 not found），
            // 所以先自己按 code/名称查表拿 id，把「code 写错」变成一次可解释的返回而不是异常。
            const match = points.find((x) => String(x.code) === want)
              || points.find((x) => String(x.id) === want)
              || points.find((x) => String(x.name || "").includes(want));
            if (!match) {
              return { text: `找不到得分点「${want}」｜可用：${points.slice(0, 10).map((x) => x.code).join(", ")}${points.length > 10 ? ` …共 ${points.length}` : ""}（全表见 op=scores）` };
            }
            touched = match;
            store.addScoreHit(activeId, {
              point_id: Number(match.id),
              value: Number.isFinite(Number(args.value)) ? Number(args.value) : undefined,
              evidence: String(args.text),
            });
          }
        } catch (e) {
          // 实测纠正：store-core 不设 PRAGMA，但 node:sqlite 默认就是 WAL（靶标目录里有 assets.db-wal/-shm）。
          // 所以并发下更常见的是参数不合法而不是锁；先把两者分开，
          // 否则模型会拿着一句锁提示去重试，实际是怎么试都不会成。
          const msg = cut(e?.message ?? e, 130);
          const hint = /not found|required/i.test(msg)
            ? (op === "score_add"
              ? `属参数问题：跑 op=scores 核对 code 与证据要求（当前 ${itemsOf(store.listScorePoints(activeId)).length} 项）。`
              : op === "attackfile_add"
                ? "属参数问题：store 只收录实际生效的脚本/POC/EXP，target 与 name 都得给。"
                : "属参数问题：核对 stage/tool/text。")
            : "若是被宿主进程占用，改在红队会话里用 redteam_score_hit。";
          return { text: `写入失败（${op}）：${msg}｜${hint}` };
        }
        if (op === "chain_add") {
          const back = store.listChain(activeId) || [];
          const last = back.length ? back[back.length - 1] : null;
          return { text: `chain_add 已写入 @${activeId}｜链条共 ${back.length} 步${last ? `，末步=${cut(`${last.stage_code}:${last.result || last.tool}`, 96)}` : ""}` };
        }
        // 得分表不按写入顺序排列，「末条」是假信号 → 回读刚命中的那个得分点本身。
        const after = itemsOf(store.listScorePoints(activeId)).find((x) => Number(x.id) === Number(touched?.id));
        const hitCount = Array.isArray(after?.hits) ? after.hits.length : (after?.hits ?? "?");
        return { text: `score_add 已写入 @${activeId}｜${touched?.code || touched?.id}：命中 ${hitCount} 次 earned=${after?.earned ?? "?"}（档位 ${after?.tier || "?"}）` };
      }

      if (op === "report") {
        const kindArg = String(args.kind || "").toLowerCase();
        // kind 三用：score=得分报告、targets=按目标汇总（无 markdown，读 totals/groups）、缺省=战报 markdown。
        if (kindArg === "targets") {
          const rt = store.reportTargets(activeId) || {};
          // totals 里也有 targets 键，表头已经报过一次目标数，这里剔掉避免「targets=1 … targets=1」重复。
          const totals = Object.entries(rt.totals || {}).filter(([k]) => k !== "targets").map(([k, v]) => `${k}=${v}`).join(" ");
          const groups = Array.isArray(rt.groups) ? rt.groups : [];
          const targets = Array.isArray(rt.targets) ? rt.targets : [];
          // 实测字段：{key,label,kind,segment,stats:{vulns,bySeverity{...},accesses,credentials,files,chainSteps}}
          const rows = targets.slice(0, cap).map((x) => {
            const s = x.stats || {};
            const sev = s.bySeverity || {};
            const hot = Object.entries(sev).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k}${v}`).join(" ");
            return `  · ${cut(x.label || x.key, 46)}（${x.kind || "?"}${x.segment ? ` @ ${x.segment}` : ""}）漏 ${s.vulns ?? 0}${hot ? `｜${hot}` : ""}${s.accesses ? `｜控 ${s.accesses}` : ""}${s.credentials ? `｜凭据 ${s.credentials}` : ""}`;
          });
          return {
            text: [
              `目标汇总 @${activeId}：目标 ${targets.length} 个 / 分组 ${groups.length} 段${totals ? `｜${totals}` : ""}`,
              rows.length ? rows.join("\n") : "  （还没有目标行——先 op=entity_add entity=vuln 记一发）",
              targets.length > cap ? `  …另 ${targets.length - cap} 个（limit 可调）` : "",
            ].filter(Boolean).join("\n"),
          };
        }
        const wantScore = kindArg === "score";
        const obj = wantScore ? store.scoreReport(activeId) : store.report(activeId);
        const md = String(obj?.markdown ?? "");
        const allLines = md ? md.split("\n") : [];
        const n = Number.isFinite(args.limit) ? args.limit : 14;
        const stats = obj && typeof obj.stats === "object"
          ? Object.entries(obj.stats).filter(([, v]) => typeof v === "number").slice(0, 8).map(([k, v]) => `${k}=${v}`).join(" ")
          : "";
        const sum = obj?.summary && typeof obj.summary === "object"
          ? Object.entries(obj.summary).filter(([, v]) => typeof v === "number").slice(0, 8).map(([k, v]) => `${k}=${v}`).join(" ")
          : "";
        if (!allLines.length) return { text: `${wantScore ? "得分报告" : "战报"}为空（这个靶标还没记账）。可先跑 op=chain_add 或 op=score_add。` };
        return {
          text: [
            `${wantScore ? "得分报告" : "战报"} @${activeId}：${allLines.length} 行 / ${md.length} 字符${stats ? `｜${stats}` : ""}${sum ? `｜${sum}` : ""}`,
            allLines.slice(0, n).map((l) => (l ? "  " : "") + l).join("\n"),
            allLines.length > n ? `  …另 ${allLines.length - n} 行（加 limit=${allLines.length} 看全量）` : "",
          ].filter(Boolean).join("\n"),
        };
      }
      if (op === "pocs") {
        const q = args.text ? String(args.text) : "";
        const rawP = store.searchPocs(q ? { q } : {});
        const rowsP = Array.isArray(rawP?.items) ? rawP.items : (Array.isArray(rawP) ? rawP : []);
        const ps = store.pocStats() || {};
        // pocStats().byKind 实测是 [{kind,n}] 数组（不是对象 map），两种形状都容忍。
        const kindRows = Array.isArray(ps.byKind) ? ps.byKind : Object.entries(ps.byKind || {}).map(([kind, v]) => ({ kind, n: typeof v === "number" ? v : (v?.n ?? "?") }));
        const byKind = kindRows.map((x) => `${x.kind}:${x.n ?? "?"}`).join(" ") || "（无）";
        return {
          text: [
            `${q ? `POC 检索「${q}」命中 ${rowsP.length} 条` : `POC 库列出 ${rowsP.length} 条`}｜库总量 ${ps.total ?? "?"}｜已验证 ${ps.verified ?? "?"}｜带正文 ${ps.withContent ?? "?"}｜被复用 ${ps.reused ?? "?"}`,
            `按 kind：${byKind}`,
            rowsP.length
              ? rowsP.slice(0, cap).map((r) => `  · ${cut(r.title || r.code || r.name || r.id, 104)}`).join("\n") + (rowsP.length > cap ? `\n  …另 ${rowsP.length - cap} 条` : "")
              : "  （空）",
            q ? "" : "可加 text=<关键词> 收窄（如 text=fastjson）。",
          ].filter(Boolean).join("\n"),
        };
      }
      if (op === "entity_add") {
        const want = args.entity ? String(args.entity) : "";
        const wkeys = Object.keys(DRILL_WRITE_ENTITIES);
        if (!want) return { text: `entity_add 需要 entity。可用：${wkeys.join(" | ")}` };
        const spec = DRILL_WRITE_ENTITIES[want];
        if (!spec) return { text: `entity_add 不支持「${want}」｜可写：${wkeys.join(" | ")}（shot 需真实文件路径、poc 走预设工具）` };
        if (!args.target) return { text: `entity_add ${want} 需要 target（归属：IP / URL / 主机）。例：op=entity_add entity=credential target=10.0.0.7 name=admin kind=password text=admin123` };
        if (typeof store[spec.method] !== "function") return { text: `这版 store 没有 ${spec.method}（entity=${want}）` };
        try {
          store[spec.method](activeId, spec.build(args));
        } catch (e) {
          return { text: `entity_add ${want} 写入失败：${cut(e?.message ?? e, 130)}｜参数问题请按 store 点名的字段补齐。` };
        }
        const back = store[DRILL_ENTITIES[want]] ? store[DRILL_ENTITIES[want]](activeId, {}) : [];
        const rowsB = Array.isArray(back?.items) ? back.items : (Array.isArray(back) ? back : []);
        const totalB = typeof back?.total === "number" ? back.total : rowsB.length;
        const first = rowsB[0];
        return { text: `entity_add ${want} 已写入 @${activeId}｜${want} 现共 ${totalB} 条${first ? `，首条=${cut(entityBrief(want, first), 96)}` : ""}` };
      }
      if (op === "list") {
        const itemsOf2 = (v) => (Array.isArray(v?.items) ? v.items : (Array.isArray(v) ? v : []));
        const want = args.entity ? String(args.entity) : "";
        const available = Object.keys(DRILL_ENTITIES).filter((k) => typeof store[DRILL_ENTITIES[k]] === "function");
        if (!want) return { text: `list 需要 entity。可用：${available.join(" | ")}` };
        const method = DRILL_ENTITIES[want];
        if (!method) return { text: `未知 entity「${want}」｜可用：${available.join(" | ")}` };
        if (!available.includes(want)) return { text: `这版 store 没有 ${method}（entity=${want}）｜可用：${available.join(" | ")}` };
        const raw2 = store[method](activeId, {});
        const rows2 = itemsOf2(raw2);
        const total2 = typeof raw2?.total === "number" ? raw2.total : rows2.length;
        return {
          text: [
            `list ${want} @${activeId}：共 ${total2} 条`,
            rows2.length
              ? rows2.slice(0, cap).map((r) => `  · ${cut(entityBrief(want, r), 108)}`).join("\n") + (rows2.length > cap ? `\n  …另 ${rows2.length - cap} 条` : "")
              : "  （空）",
          ].join("\n"),
        };
      }
      const fn = { assets: "listAssets", chain: "listChain", scores: "listScorePoints", attackfiles: "listAttackFiles", stages: "listStages" }[op];
      const raw = store[fn](activeId);
      // 实测形状不一：listAssets={total,sort,items}、listScorePoints={items,ruleGroups,summary}，
      // 而 listChain/listAttackFiles/listStages 是裸数组 —— 统一归一，不按单一假设写死。
      const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
      const total = typeof raw?.total === "number" ? raw.total : rows.length;
      const brief = (r) => {
        const key = r.name || r.title || r.point || r.file || r.stage_code || r.code || r.ip || r.target || r.id || "?";
        const extra = r.state || r.status || r.severity || r.kind || r.result || r.tool || "";
        return `${key}${extra ? `(${extra})` : ""}`;
      };
      return {
        text: [
          `${op} @靶标 ${activeId}：共 ${total} 条${total !== rows.length ? `（本页 ${rows.length}）` : ""}`,
          rows.length
            ? rows.slice(0, cap).map((r) => `  · ${cut(brief(r), 110)}`).join("\n") + (rows.length > cap ? `\n  …另 ${rows.length - cap} 条` : "")
            : total ? "  （本页无数据）" : "  （空）",
        ].join("\n"),
      };
    },
  };

  return [status, align, apply, revert, patch, update, rulesTool, skillsTool, drill];
}
