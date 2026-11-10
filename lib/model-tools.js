import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readDrillGrant } from "./drill-grant.js";
import { readAllowText, allowFilePath } from "./net-scope.js";
import { hostEnumerationLine } from "./core.js";
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

/**
 * 读红队技能正文（日常会话按需读用）。
 * 红队技能由演练预设的 customSkillDirs 发现，日常会话的 skill 工具加载不到它们，
 * 所以 purge_skills id= 是唯一的按需读法。只回链路位置 + 正文头部，完整正文给路径：
 * 有界——技能最长 27k 字，整篇灌进上下文没有意义。
 */
function skillBodyFor(id) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  for (const p of [path.join(home, "redteam", "skills", id + ".md")]) {
    try {
      const t = fs.readFileSync(p, "utf8");
      const li = t.indexOf("## 链路位置");
      const link = li >= 0 ? t.slice(li, Math.min(t.length, li + 460)).trim() : "";
      const body = t.replace(/^---[\s\S]*?\n---\s*/, "").trim();
      return { link, head: body.slice(0, 900), path: p, total: t.length };
    } catch { /* 下一个候选 */ }
  }
  return null;
}

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
  // shot 的 target 是图片路径（store 侧要真实文件，缺了就 throw），name 当标签、text 当备注。
  shot: { method: "addShot", build: (a) => ({ path: a.target, label: a.name || a.target, note: a.text }) },
  // savePrompt(id, role, content) 是位置参数，且 role 只能取内置六个（实测 attacker/defender/observer 全部 unknown role）。
  prompt: { method: "savePrompt", positional: (a) => [a.kind, a.text] },
  // 配置表两个成员：saveScorePoint 建自定义得分点（内置点删不掉，见 delete 的说明），saveStage 是按 code 的 upsert。
  scorepoint: {
    method: "saveScorePoint", need: "name", needHint: "entity_add scorepoint 用 name=<得分点名称> value=<分值>（例 name=拿到打印机后台 value=100）。",
    build: (a) => ({ name: a.name, points: Number.isFinite(Number(a.value)) ? Number(a.value) : undefined }),
    readBack: (store, id) => {
      const mine = (((store.listScorePoints(id) || {}).items) || []).filter((x) => !x.builtin);
      const last = mine[mine.length - 1];
      return `自建得分点 ${mine.length} 个${last ? `，最新「${last.name}」=${last.points} 分` : ""}`;
    },
  },
  stage: {
    method: "saveStage", need: "stage", needHint: "entity_add stage 用 stage=<阶段 code> name=<阶段名>（text 当副标题、kind 当颜色）。",
    build: (a) => ({ code: a.stage, name: a.name, subtitle: a.text, color: a.kind }),
    readBack: (store, id, a) => {
      const arr = Array.isArray(store.listStages(id)) ? store.listStages(id) : [];
      const hit = arr.find((x) => x.code === String(a.stage));
      return `阶段表 ${arr.length} 个${hit ? `，${hit.code}=${hit.name}${hit.subtitle ? "/" + hit.subtitle : ""}` : ""}`;
    },
  },
  // POC 是全局库、savePoc(p) 不吃 engagement id（标 noEngagement）；同标题再存是 upsert，不会造第二条。
  poc: {
    method: "savePoc", noEngagement: true, need: "name",
    needHint: "entity_add poc 用 name=<POC 标题> text=<正文>（kind 可选 poc|exp）。例：op=entity_add entity=poc name=Fastjson 1.2.83 RCE text=use: java -jar ...",
    build: (a) => ({ title: a.name, content: String(a.text || ""), kind: a.kind || "poc" }),
    readBack: (store, id, a, res) => {
      const code = String(res?.poc?.code || "");
      const one = code ? (store.getPoc(code) || {}) : {};
      const total = (store.pocStats() || {}).total ?? "?";
      return `${res?.created ? "新建" : "覆盖（同标题 upsert，不产生第二条）"} 「${code || "?"}」｜库总量 ${total}｜正文 ${String(one.content || "").length} 字`;
    },
  },
  // 资产是发现面：唯一写入口是 importBundle(id, bundle)，所以这里把单条参数包成 bundle（不是另开 op）。
  asset: {
    method: "importBundle", need: "target",
    needHint: "entity_add asset 用 target=<IP> name=<主名>（可选 kind=状态 up/down）。例：op=entity_add entity=asset target=10.0.0.31 name=cam-31。",
    // importBundle 天生吃数组：target 给逗号/空格分隔的多个 IP 就一次铺完（贴 20 个 IP 不必调 20 次）。
    build: (a) => ({ assets: String(a.target).split(/[,;\s]+/).filter(Boolean).map((ip) => ({ ip, primary_name: a.name, state: a.kind || "unknown" })) }),
    readBack: (store, id, a, res, preTotal) => {
      const ls = store.listAssets(id, {}) || {};
      const rows = Array.isArray(ls.items) ? ls.items : (Array.isArray(ls) ? ls : []);
      const total = typeof ls.total === "number" ? ls.total : rows.length;
      const it = rows.find((x) => String(x.ip) === String(a.target)) || {};
      const c = (res && res.counts) || {};
      const want = String(a.target).split(/[,;\s]+/).filter(Boolean);
      // counts.assets 是「处理条数（含 upsert）」，不是新增条数 —— 拿它当新增会骗人，所以用写前写后差算真新增。
      const grew = typeof preTotal === "number" ? total - preTotal : null;
      return `提交 ${want.length} 个 IP｜新增 ${grew === null ? "?" : grew} 条（同 IP 走 upsert 不算新增）｜表内现有 ${total} 条${it.ip && want.length === 1 ? `｜${it.ip}${it.primary_name ? "/" + it.primary_name : ""}` : ""}`;
    },
    preTotal: (store, id) => {
      const ls0 = store.listAssets(id, {}) || {};
      return typeof ls0.total === "number" ? ls0.total : (Array.isArray(ls0.items) ? ls0.items.length : 0);
    },
  },
};

/** 各实体挑一个最能说明问题的字段来显示。 */
// 可改的三个实体额外带状态后缀，让 op=list 能当「改没改成」的复核面（update 的字段不在这里也会露出来）。
const BRIEF_SUFFIX = {
  vuln: (r) => [r.severity, r.status].filter(Boolean).join("/"),
  webshell: (r) => [r.shell_type, r.status].filter(Boolean).join("/"),
  tunnel: (r) => [r.kind, r.reach].filter(Boolean).join("/"),
};

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
  const sfx = BRIEF_SUFFIX[entity] ? BRIEF_SUFFIX[entity](r) : "";
  for (const k of prefer[entity] || []) {
    if (r?.[k]) {
      const base = `${k}=${String(r[k]).slice(0, 60)}`;
      // 第一个真值字段就是主标识；状态后缀只在有值时追加，避免把空字段刷成噪音。
      return sfx && !base.includes(sfx) ? `${base}｜${sfx}` : base;
    }
  }
  const anyKey = Object.keys(r || {}).find((k) => typeof r[k] === "string" && r[k].length > 1 && r[k].length < 70);
  return anyKey ? `${anyKey}=${r[anyKey]}` : JSON.stringify(r).slice(0, 70);
}

export function defaultRenderStatus(state, opts = {}) {
  if (!state) return "状态：无（gatherState 未返回）";
  const rows = [];
  if (opts.settings === true) {
    const home = state && state.dsh_home ? String(state.dsh_home) : (core.findDshHome ? core.findDshHome() : "");
    let g = null;
    try { g = readDrillGrant(home); } catch (e) { g = { error: String(e?.message ?? e).slice(0, 60) }; }
    let allow = "";
    let allowPath = "";
    try { allow = String(readAllowText(home) || ""); allowPath = String(allowFilePath(home) || ""); } catch (e) { allow = "读取失败:" + String(e?.message ?? e).slice(0, 40); }
    rows.push(`配置：drill 授权=${g && g.granted ? `已授（${String(g.at || "").slice(0, 10)}）` : (g && g.error ? `读取失败：${g.error}` : "未授权")}｜net-scope 允许清单=${allow.trim() ? `${allow.trim().split(/\r?\n/).length} 条` : "空"}（${allowPath.split(/[\\/]/).slice(-1)[0] || "?"}）`);
  }
    if (opts.patches === true) {
    // 只用 gatherState 真给出的字段（原先读了个没人写的 state.__tally，恒 null）。
    rows.push(`明细：${state.patches_applied ?? "?"}/${state.patches_total ?? "?"} 已清洗｜待清洗 ${state.patches_pending ?? 0}｜未生效 ${state.patches_skipped ?? 0}`);
  }
  rows.push(hostEnumerationLine(state));
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
    description: `查看 dsh 指令权威性清洗状态（${core.ALL_PATCHES.length} patch 进度、shim、override、app.asar 是否还封着）。默认紧凑视图；三个 section 按需。`,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        files: { type: "boolean", description: "列目标文件映射（全量绝对路径，排路径用；加上体积涨约 20 倍）。" },
        patches: { type: "boolean", description: "逐条列补丁明细；不给则只报计数与未生效 id。" },
        settings: { type: "boolean", description: "列面板侧配置：drill 授权状态与 net-scope 允许清单。" },
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
          description: "逗号分隔的补丁 id（如 14,17,74）；缺省=全部。选打会先恢复 .bak，未选中的会被回滚，选完要再跑一次全量 apply。",
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
      return { text: `清洗完成 / hosts=${(toolMulti.hosts || []).length}, applied=${applied}, already=${already}.${scrubNote}${scopeNote} phase-1=${flash.phase1} 重启 dsh 生效.` };
    },
  };

  const revert = {
    name: "purge_revert",
    description: "回滚 dsh 指令权威性清洗到备份原件（保留 prompt-inject.md 用户文件）。",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    output: TEXT_OUT,
    async execute() {
      const lines = [];
      const { reverted, errors, hosts } = await core.revertAllHosts();
      lines.push(`hosts=${(hosts || []).length}`);
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
          `补丁 ${all.length - notApplied.length}/${all.length} 已清洗｜宿主 ${state.patch_hosts ?? "?"} 个｜分层：${head.join("、")}`,
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
        // 日常会话读技能正文：红队技能由演练预设的 customSkillDirs 发现，**不在日常会话的
        // <available_skills> 里**，所以 skill 工具加载不到——这条是唯一的按需读法。
        // 只回「链路位置 + 正文头部」，完整正文给路径：有界，不把 27k 字的技能灌进上下文。
        const body = skillBodyFor(String(args.id));
        if (body) {
          if (body.link) lines.push("", body.link);
          lines.push("", `正文头部（共 ${body.total} 字，完整读 ${body.path}）：`, body.head);
        }
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

  const overrideTool = {
    name: "purge_override",
    description: "注入正文文件（$DSH_HOME/prompt-inject.md）：show 报体积/状态/差值（只读），reset 装回内置默认并回读校验（会写盘）。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { type: "string", description: "show（缺省，只读）| reset（写盘，等价面板「恢复默认」，会覆盖本地改动）| adopt（只对齐记录，不动文件）" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const st = await core.gatherState();
      const fp = String(st.override_path || "");
      if (!fp) return { text: "没有注入文件路径（宿主未定位？先设 DSH_BASE 或跑 dsh-purge --status）。" };
      const home = fp.replace(/[\\/][^\\/]+$/, "");
      const readLen = () => {
        try { return fs.existsSync(fp) ? fs.readFileSync(fp, "utf8").length : 0; } catch { return 0; }
      };
      const bundledLen = String(core.defaultOverrideText() || "").length;
      const explain = {
        default: "与当前内置默认一致，无需动作",
        custom: "判为用户自改稿：sync/apply 不会覆盖它。想要新条款就跑 reset，想留自己的稿就别动",
        "stale-default": "是我们的旧默认没跟上：下次启动会自动升级到当前内置默认",
        missing: "还没种过注入文件：跑 reset 或等下次启动种下",
      };
      const mode2 = String(args.mode || "show").toLowerCase();
      if (mode2 === "adopt") {
        // adopt = 把插件记录对齐到磁盘现状：只写 override-state.json，绝不重抄 prompt-inject.md。
        // 实测过两条候选：不带 explicitSave 会让状态翻成 stale-default（下次启动被覆盖）——那正是我们要避免的相反效果。
        let cur = "";
        try { cur = fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : ""; } catch { cur = ""; }
        if (!core.normalizeOverride(cur)) return { text: "adopt 无从下手：生效注入文件读不到或为空。" };
        if (core.normalizeOverride(cur) === core.normalizeOverride(core.defaultOverrideText())) return { text: "adopt 不必做：生效文件就是当前内置默认（" + cur.length + " 字）。" };
        const was = await core.overrideStatus(home);
        try { await core.markOverrideCustomized(home, true, cur, { explicitSave: true }); } catch (e) {
          return { text: `adopt 写记录失败：${cut(String(e?.message ?? e), 110)}` };
        }
        const now2 = await core.overrideStatus(home);
        const keepable = (() => { try { return core.isKeepableUserOverride(home, cur); } catch { return null; } })();
        return { text: `adopt 已把记录对齐到磁盘（文件未动，${cur.length} 字）｜状态 ${was} → ${now2}｜sync ${keepable ? '不会覆盖你的稿 ✓' : '仍可能覆盖，去面板确认'}` };
      }
      const before = readLen();
      const statusNow = await core.overrideStatus(home);
      if (mode2 !== "reset") {
        const gap = bundledLen - before;
        return {
          text: [
            `注入文件=${fp.replace(home, "$DSH_HOME")}`,
            `生效 ${before} 字｜内置默认 ${bundledLen} 字｜${gap > 0 ? `少 ${gap} 字` : gap < 0 ? `多 ${-gap} 字` : "完全等长"}`,
            `状态 ${statusNow}：${explain[statusNow] || "（未知状态，按 missing 处理）"}`,
          ].join("\n"),
        };
      }
      let res = null;
      try { res = await core.installOverride(home, true); } catch (e) { return { text: `reset 失败：${cut(String(e?.message ?? e), 110)}` }; }
      const after = readLen();
      const afterStatus = await core.overrideStatus(home);
      return {
        text: [
          `reset ${res} @${fp.replace(home, "$DSH_HOME")}`,
          `生效 ${before} → ${after} 字｜内置默认 ${bundledLen} 字`,
          `回读状态 ${statusNow} → ${afterStatus}${afterStatus === "default" && after === bundledLen ? " ✓ 已是当前默认" : " ✗ 没到位，去面板或 dsh-purge --status 复核"}`,
        ].join("\n"),
      };
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
            "读：summary(缺省)|engagements(=summary 别名)|assets|chain|scores|attackfiles|stages|list(entity)|pocs（text 检索｜name 读单条正文）|report（战报，kind=score|targets）；写：chain_add|score_add|attackfile_add|entity_add；靶标：open|switch；改删：update|delete（参数见各自说明）",
        },
        engagement: { type: "string", description: "靶标 id，缺省当前靶标" },
        limit: { type: "number", description: "读：条数上限，缺省 8" },
        row: { type: "number", description: "update/delete 用：行 id，取自 op=list 的 #号" },
        entity: { type: "string", description: "读：vuln|credential|access|webshell|tunnel|web|http|shot|prompt|segment；写：vuln|credential|access|webshell|tunnel|http|shot|prompt|scorepoint|stage|asset|poc" },
        name: { type: "string", description: "attackfile 文件名；entity_add 的标题/账号名/隧道本地端；poc 的 code（pocs 读正文、delete 删）" },
        text: { type: "string", description: "写：内容/证据；pocs 检索词" },
        stage: { type: "string", description: "chain 阶段 code（缺省 recon）；update entity=vuln 当 status" },
        tool: { type: "string", description: "chain：工具名，缺省 drill" },
        point: { type: "string", description: "score：得分点 code" },
        value: { type: "number", description: "score_add 台/条数；scorepoint 分值；asset 易打性分" },
        target: { type: "string", description: "归属 IP/URL/C 段（entity_add/attackfile_add 的宿主）；asset 可多个 IP（逗号/空格）；poc 用它记一次使用" },
        kind: { type: "string", description: "attackfile 类别；report 用 score|targets；update：vuln 当 severity，webshell/tunnel/poc 当列名（取值见报错）" },
        content: { type: "string", description: "attackfile：正文，不给用 text" },
      },
    },
    output: TEXT_OUT,
    async execute(args = {}) {
      const store = deps.redteamStore ?? new RedteamStore(
        process.env.REDTEAM_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "redteam"),
      );
      let op = String(args.op || "summary");
      if (op === "engagements") op = "summary"; // 实测：engagements 的每一行都在 summary 里（重叠 2/2），留成别名不再占 op 名额
      const list = Array.isArray(store.listEngagements()) ? store.listEngagements() : [];
      const activeId = args.engagement || (list.length ? store.activeEngagementId() : undefined);
      const cap = Number.isFinite(args.limit) ? args.limit : 8;
      if (op === "summary" || op === "engagements") {
        const lines = [
          `靶标 ${list.length} 个｜当前=${activeId || "无"}`,
          list.length ? `清单：${list.slice(0, cap).map((e) => `${e.name && e.name !== e.id ? `${e.id}(${e.name})` : e.id}${e.state ? `·${e.state}` : ""}`).join(", ")}${list.length > cap ? ` …共 ${list.length}` : ""}` : "引导：还没开靶标——跑 purge_drill op=open name=<靶名> target=<IP/网段> 就地开一个（不必切红队预设，也不必去界面）。",
        ];
        if (activeId && op === "summary") {
          const s = store.stats(activeId) || {};
          // 不盲取前 10 个键：那样会把 chainSteps/files 这类真正有用的计数切掉（情景测试抓到的）。
          const KEYS = ["chainSteps", "vulns", "accesses", "credentials", "files", "assets", "liveAssets", "openPorts", "segments", "services", "fingerprints"];
          const shown = KEYS.filter((k) => typeof s[k] === "number");
          const extra = Object.entries(s).filter(([k, v]) => typeof v === "number" && !KEYS.includes(k)).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(" ");
          const chainN = (Array.isArray(store.listChain(activeId)) ? store.listChain(activeId) : []).length;
          lines.push(`事实库 stats：chainSteps=${chainN} ${shown.map((k) => `${k}=${s[k]}`).join(" ")}${extra ? ` ${extra}` : ""}`.trimEnd());
        }
        return { text: lines.join("\n") };
      }
      // op 写错要当场说清，别让「本机没靶标」把真实原因盖住（有靶标的机器才会走到下面的未知 op 分支）。
      const KNOWN = ["summary", "assets", "chain", "scores", "attackfiles", "stages", "list", "entity_add", "chain_add", "score_add", "attackfile_add", "pocs", "report", "open", "switch", "update", "delete"];
      if (!KNOWN.includes(op)) {
        return { text: `未知 op「${op}」｜读：${KNOWN.slice(0, 7).join(" | ")}；写：${KNOWN.slice(7).join(" | ")}` };
      }
            if (op === "open") {
        const nm = args.name ? String(args.name).trim() : "";
        if (!nm) return { text: "open 需要 name（靶标名/主域）。例：op=open name=example.com target=203.0.113.0/24" };
        const sc = args.target ? String(args.target) : "";
        let made = null;
        try { made = store.openEngagement(nm, sc); } catch (e) {
          return { text: `开靶失败：${cut(e?.message ?? e, 120)}｜若说 scope 不合法，target 用 IP 或 CIDR（如 203.0.113.0/24）。` };
        }
        const now = store.listEngagements() || [];
        return { text: `open 已建靶 @${made?.id || nm}｜靶标共 ${now.length} 个｜当前=${store.activeEngagementId() || "未设定"}｜范围=${sc || "（未填）"}` };
      }
      if (op === "switch") {
        const wantSw = String(args.engagement || args.name || "").trim();
        if (!wantSw) {
          const have = (Array.isArray(store.listEngagements()) ? store.listEngagements() : []).map((x) => x.id);
          return { text: `switch 需要 engagement=<靶标 id>。现有：${have.join(", ") || "（无，先 op=open）"}｜当前=${store.activeEngagementId() || "无"}` };
        }
        const known = (Array.isArray(store.listEngagements()) ? store.listEngagements() : []).some((x) => x.id === wantSw);
        if (!known) return { text: `没有靶标「${wantSw}」｜现有：${(store.listEngagements() || []).map((x) => x.id).join(", ") || "（无）"}` };
        try { store.setActiveEngagement(wantSw); } catch (e) {
          return { text: `切靶失败：${cut(e?.message ?? e, 120)}` };
        }
        const back = store.activeEngagementId();
        return { text: `switch 已切到 @${wantSw}｜校验 active=${back}${back === wantSw ? " ✓" : " ✗ 没切过去"}` };
      }

if (!activeId) return { text: `没有靶标，${op} 用不了。先开靶：purge_drill op=open name=<靶名> target=<IP/网段>（当前共 ${list.length} 个）。` };
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

      if (op === "delete") {
        // store 里有显式删除方法的只有三个（deleteScorePoint/deleteShot/deletePoc）；
        // vuln/credential 等没有删除方法，正确姿势是 update 标 status，这里如实说明而不是假装能删。
        const DEL = { scorepoint: "deleteScorePoint", shot: "deleteShot", poc: "deletePoc" };
        const delKeys = Object.keys(DEL);
        const wantDel = args.entity ? String(args.entity).toLowerCase() : "";
        if (!wantDel) return { text: `delete 需要 entity。可删：${delKeys.join(" | ")}（其余实体没有删除方法，用 op=update 标 status=fixed）` };
        if (!DEL[wantDel]) return { text: `${wantDel} 没有删除方法｜可删：${delKeys.join(" | ")}；要给漏洞收尾请用 op=update entity=vuln stage=fixed` };
        const isPoc = wantDel === "poc";
        const key = isPoc ? String(args.name || "").trim() : String(args.row ?? "").trim();
        if (!key) {
          if (isPoc) return { text: "delete entity=poc 需要 name=<POC code>（见 op=pocs 清单）。" };
          const rowsD = wantDel === "shot"
            ? ((store.listShots(activeId, {}) || {}).items || [])
            : ((store.listScorePoints(activeId, {}) || {}).items || []);
          const mine = rowsD.filter((x) => !x.builtin).slice(0, 8);
          return { text: `delete ${wantDel} 需要 row。可删的 id：${mine.map((x) => `#${x.id}`).join(" ") || "（无自定义项，内置得分点不可删）"}` };
        }
        let res = null;
        try {
          res = isPoc ? store.deletePoc(key) : store[DEL[wantDel]](activeId, Number(key));
        } catch (e) {
          // 两个会抛（shot/scorepoint），一个返回 ok:false（poc）——两种失败风格在这里合成同一种可执行提示。
          const msg = String(e?.message ?? e);
          if (/不能删除|builtin|内置/i.test(msg)) return { text: `${cut(msg, 130)}｜想改数值请用 op=update entity=scorepoint。` };
          return { text: `delete ${wantDel} 失败：${cut(msg, 120)}｜id 是否存在请先 op=list entity=${wantDel === "scorepoint" ? "prompt" : wantDel} 看 #号` };
        }
        if (res && res.ok === false) return { text: `delete ${wantDel}：${cut(res.error || "没删掉", 110)}` };
        const remain = wantDel === "poc" ? ((store.pocStats() || {}).total ?? "?")
          : wantDel === "shot" ? (((store.listShots(activeId, {}) || {}).items || []).length)
          : (((store.listScorePoints(activeId, {}) || {}).items || []).length);
        return { text: `delete ${wantDel} 已删 ${isPoc ? `「${key}」` : `#${key}`} @${activeId}｜回读剩 ${remain}${res && res.removed_files ? `｜连带删掉 ${res.removed_files} 个文件` : ""}` };
      }
      if (op === "update") {
        const UPDATABLE = { vuln: "updateVuln", webshell: "updateWebshell", tunnel: "updateTunnel", poc: "updatePoc", asset: "assessAsset" };
        const LISTFN = { vuln: "listVulns", webshell: "listWebshells", tunnel: "listTunnels" };
        const itemsOf3 = (v) => (Array.isArray(v?.items) ? v.items : (Array.isArray(v) ? v : []));
        const upKeys = Object.keys(UPDATABLE);
        const wantUp = args.entity ? String(args.entity) : "";
        if (!wantUp) return { text: `update 需要 entity。可改：${upKeys.join(" | ")}` };
        if (!UPDATABLE[wantUp]) return { text: `update 暂不支持「${wantUp}」｜可改：${upKeys.join(" | ")}（其余实体只增不改）` };
        // 资产有两个写入口、形状都是 (id, patch) 按 ip 定位（没有行 id），字段是枚举 + 静默回落，所以先校验再写：
        //   评估 assessAsset：kind=优先级(high|medium|low)、text=理由、value=潜在攻击面
        //   测试 updateAssetTest（给了 stage 就走这条）：stage=状态(untested|testing|tested|blocked|abandoned|no_surface)、kind=还剩攻击面、text=结论、value=受阻次数
        if (wantUp === "asset") {
          const ip = String(args.target || "").trim();
          if (!ip) return { text: "update asset 需要 target=<IP>（资产按 ip 定位，没有行 id）。评估：kind=high|medium|low text=<理由>；测试：stage=tested text=<结论>。" };
          const rowsA0 = ((store.listAssets(activeId, {}) || {}).items) || [];
          if (!rowsA0.some((x) => String(x.ip) === ip)) return { text: `update asset：没有资产「${ip}」｜现有：${rowsA0.slice(0, 8).map((x) => x.ip).join(", ") || "（空表——先 op=entity_add entity=asset target=<IP>）"}` };
          const PRI = ["high", "medium", "low"];
          const TST = ["untested", "testing", "tested", "blocked", "abandoned", "no_surface"];
          const dropped = [];
          const isTest = args.stage !== undefined && String(args.stage) !== "";
          let patchA = null;
          if (isTest) {
            const s = String(args.stage);
            if (!TST.includes(s)) dropped.push(`状态「${s}」不在枚举（${TST.join("|")}）→ 静默回落`);
            patchA = { ip, status: s };
            if (args.kind) patchA.surface = String(args.kind);
            if (args.text) patchA.test = String(args.text);
            if (Number.isFinite(Number(args.value))) patchA.blocked = Number(args.value);
          } else {
            const pr = String(args.kind || "");
            if (pr && !PRI.includes(pr)) dropped.push(`优先级「${pr}」不在枚举（${PRI.join("|")}）→ 静默回落 medium`);
            if (pr) patchA = { ip, priority: pr };
            if (args.text) (patchA ??= { ip }).reason = String(args.text);
            if (args.value !== undefined) (patchA ??= { ip }).potential = String(args.value);
            patchA = patchA && Object.keys(patchA).length > 1 ? patchA : null;
          }
          if (!patchA) return { text: "update asset 没给可改字段：评估用 kind=<high|medium|low> text=<理由>，测试用 stage=<状态> text=<结论>。" };
          let resA = null;
          try { resA = isTest ? store.updateAssetTest(activeId, patchA) : store.assessAsset(activeId, patchA); } catch (e) {
            return { text: `update asset 失败：${cut(String(e?.message ?? e), 120)}` };
          }
          const itA = (((store.listAssets(activeId, {}) || {}).items) || []).find((x) => String(x.ip) === ip) || {};
          const shown = isTest
            ? `test_status=${itA.test_status ?? "?"} test_notes=${cut(String(itA.test_notes || "无"), 36)} 剩余面=${cut(String(itA.test_surface || "无"), 24)}`
            : `priority=${itA.priority ?? "?"} 潜在面=${cut(String(itA.potential || "无"), 24)} 理由=${cut(String(itA.assess_reason || "无"), 30)}`;
          return { text: `update asset ${ip} ${isTest ? "已回写测试" : "已评估"} @${activeId}｜回读 ${shown}${dropped.length ? `｜${dropped.join("；")}` : ""}` };
        }

        // POC 库是全局的、按 code 索引（不是 engagement 的行 id），所以走 name 而不是 row；
        // 两条语义：kind+text = 改列（updatePoc），只给 target = 记一次使用（markPocUsed，usedOn 是标量不是对象）。
        if (wantUp === "poc") {
          const code = String(args.name || "").trim();
          if (!code) {
            const codes = (Array.isArray(store.searchPocs({})) ? store.searchPocs({}) : ((store.searchPocs({}) || {}).items || [])).slice(0, 10).map((x) => x.code);
            return { text: `update poc 需要 name=<POC code>。现有：${codes.join(", ") || "（库里没有条目）"}` };
          }
          if (!store.getPoc(code)) return { text: `update poc：没有 POC「${code}」｜见 op=pocs 清单` };
          if (args.target && !args.kind) {
            let r2 = null;
            try { r2 = store.markPocUsed(code, String(args.target)); } catch (e) { return { text: `update poc 记账失败：${cut(String(e?.message ?? e), 110)}｜usedOn 只能是单个字符串（目标 IP/URL），不是对象。` }; }
            if (r2 && r2.ok === false) return { text: `update poc：${cut(r2.error || "没记上", 90)}` };
            const back2 = store.getPoc(code) || {};
            return { text: `update poc 「${code}」记一次使用 @${args.target}｜回读 hit_count=${back2.hit_count ?? "?"} used_on=${cut(String(back2.used_on ?? "无"), 40)}` };
          }
          if (!args.kind || !args.text) return { text: `update poc 用 kind=<列名> text=<值>（如 kind=severity text=high、kind=verified text=0），或只给 target=<用它的目标> 记一次使用。` };
          // store 的白名单：不在这里的列名会被 ?? 静默忽略（和 updateVuln 谎报 updated:true 同一类陷阱）。
          const POC_COLS = ["title", "kind", "category", "cve", "component", "versions", "severity", "language", "source", "source_url", "description", "usage", "verified"];
          const col = String(args.kind);
          if (!POC_COLS.includes(col)) return { text: `update poc：列名「${col}」不在白名单（${POC_COLS.slice(0, 7).join(" | ")} …共 ${POC_COLS.length} 个）→ store 会静默不改` };
          let val = String(args.text);
          // verified 走真值转换：字符串 "0"/"false"/"no" 会被 JS 当真，必须显式转假，否则想取消验证反而标成已验证。
          if (col === "verified") val = !/^(0|false|no|否|unverified)$/i.test(val);
          try { store.updatePoc(code, { [col]: val }); } catch (e) { return { text: `update poc 失败：${cut(String(e?.message ?? e), 110)}` }; }
          const back = store.getPoc(code) || {};
          const shown = col === "verified" ? (back.verified ? "已验证" : "未验证") : String(back[col] ?? "?");
          return { text: `update poc 「${code}」已改｜回读 ${col}=${cut(shown, 60)}` };
        }

        const rowsNow = itemsOf3(store[LISTFN[wantUp]](activeId, {}));
        const rowId = Number(args.row);
        if (!Number.isFinite(rowId)) {
          return { text: `update ${wantUp} 需要 row（行 id）。现有：${rowsNow.slice(0, 8).map((x) => `#${x.id}`).join(" ") || "（无，先 entity_add）"}` };
        }
        const SEVERITIES = ["critical", "high", "medium", "low", "info"];
        const STATUSES = ["candidate", "confirmed", "false-positive", "exploited", "fixed"];
        const patch = {};
        const dropped = [];
        if (wantUp === "vuln") {
          if (args.kind) {
            if (SEVERITIES.includes(String(args.kind))) patch.severity = String(args.kind);
            else dropped.push(`severity「${args.kind}」不在枚举（${SEVERITIES.join("|")}）→ store 静默不改`);
          }
          if (args.stage) {
            if (STATUSES.includes(String(args.stage))) patch.status = String(args.stage);
            else dropped.push(`status「${args.stage}」不在枚举（${STATUSES.join("|")}）→ store 静默不改`);
          }
          if (args.text) patch.evidence = String(args.text);
          if (args.name) patch.title = String(args.name);
        } else {
          if (!args.kind || !args.text) return { text: `update ${wantUp} 用 kind=<列名> text=<值>，例：entity=${wantUp} kind=${wantUp === "tunnel" ? "reach" : "status"} text=${wantUp === "tunnel" ? "10.0.0.0/24" : "confirmed"}` };
          patch[String(args.kind)] = String(args.text);
        }
        if (!Object.keys(patch).length) return { text: `update ${wantUp} #${rowId} 没给可改字段${dropped.length ? `：${dropped.join("；")}` : "（kind/stage/text/name 至少一个）"}` };
        let res = null;
        try { res = store[UPDATABLE[wantUp]](activeId, rowId, patch); } catch (e) {
          const msg = String(e?.message ?? e);
          if (/nothing to update/i.test(msg)) return { text: `update ${wantUp} #${rowId} 没改到东西：列名「${args.kind || "?"}」可能不在表里（${Object.keys(patch).join(",") || "空 patch"}）` };
          return { text: `update ${wantUp} 失败：${cut(msg, 120)}` };
        }
        if (res && res.updated === false) return { text: `update ${wantUp}：#${rowId} 不存在（updated:false）｜现有 id 见 op=list entity=${wantUp}` };
        // 回读校验：updateVuln 对非法枚举会返回 updated:true 却什么都不改，只有回读不说谎。
        const after = itemsOf3(store[LISTFN[wantUp]](activeId, {})).find((x) => Number(x.id) === rowId);
        const show = after ? Object.keys(patch).map((k) => `${k}=${after[k] ?? "?"}`).join(" ") : "（回读没找到该行）";
        return { text: `update ${wantUp} #${rowId} 已改 @${activeId}｜回读 ${show}${dropped.length ? `｜${dropped.join("；")}` : ""}` };
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
        // name 给了就当「读单条正文」：getPoc 对不存在的 code 返回 undefined（不抛也不给空对象，不能直接点它）。
        if (args.name) {
          const one = store.getPoc(String(args.name));
          const tail2 = (v) => String(v || "").split(/[\\/]/).slice(-2).join("/");
          if (!one || one.ok === false) {
            const pool = (() => { const v = store.searchPocs({}); return Array.isArray(v?.items) ? v.items : (Array.isArray(v) ? v : []); })();
            return { text: `没有 POC「${args.name}」｜可用：${pool.slice(0, 10).map((x) => x.code).join(", ") || "（库里没有条目）"}` };
          }
          const body0 = String(one.content || "").split(/\r\n/).join("\n");
          const blines = body0 ? body0.split("\n") : [];
          const meta = [one.kind && `kind=${one.kind}`, one.category && `类=${one.category}`, one.verified ? "已验证" : "未验证",
            Number.isFinite(one.hit_count) ? `命中 ${one.hit_count}` : null, one.language && `语言=${one.language}`, one.cve && `CVE=${one.cve}`].filter(Boolean).join("｜");
          const head = `POC「${one.code}」${one.title ? " " + one.title : ""}｜${meta || "（无元数据）"}`;
          if (!blines.length) return { text: head + "\n" + (one.path ? `  （库里没有正文，文件=${cut(tail2(one.path), 70)}）` : "  （库里没有正文，也没有文件记录）") };
          return {
            text: [
              head,
              `  用法：${cut(one.usage || "（未记）", 96)}`,
              `  正文 ${blines.length} 行 / ${body0.length} 字符｜文件=${cut(tail2(one.path), 70)}`,
              blines.slice(0, cap).map((l) => `  | ${cut(l, 100)}`).join("\n"),
              blines.length > cap ? `  …另 ${blines.length - cap} 行（加 limit=${blines.length} 看全量）` : "",
            ].filter(Boolean).join("\n"),
          };
        }
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
              ? rowsP.slice(0, cap).map((r) => `  · ${cut(String(r.code || "?") + "｜" + (r.title || r.name || ""), 104)}`).join("\n") + (rowsP.length > cap ? `\n  …另 ${rowsP.length - cap} 条` : "")
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
        if (spec.positional) {
          const role = String(args.kind || "").trim();
          const body2 = String(args.text || "").trim();
          const rolesOf = () => (Array.isArray(store.listPrompts(activeId)) ? store.listPrompts(activeId) : []).map((x) => x.role).filter(Boolean);
          if (!role || !body2) return { text: `entity_add ${want} 用 kind=<角色> text=<正文>。角色只能取：${rolesOf().join(" | ") || "（listPrompts 没给出）"}` };
          try { store[spec.method](activeId, ...spec.positional(args)); } catch (e) {
            const msg = String(e?.message ?? e);
            if (/unknown role/i.test(msg)) return { text: `entity_add ${want}：${cut(msg, 60)}｜可用角色：${rolesOf().join(" | ")}` };
            return { text: `entity_add ${want} 写入失败：${cut(msg, 120)}` };
          }
          const rowsP = Array.isArray(store.listPrompts(activeId)) ? store.listPrompts(activeId) : [];
          const hit = rowsP.find((x) => x.role === role);
          return { text: `entity_add ${want} 已写入 @${activeId}｜${role}${hit && hit.title ? `（${hit.title}）` : ""} 正文 ${body2.length} 字，现共 ${rowsP.length} 个角色` };
        }
        if (spec.need ? !args[spec.need] : !args.target) return { text: spec.need ? spec.needHint : (want === "shot" ? "entity_add shot 的 target 是图片文件路径（例 target=D:\\tmp\\home.png），name 当标签、text 当备注。" : `entity_add ${want} 需要 target（归属：IP / URL / 主机）。例：op=entity_add entity=credential target=10.0.0.7 name=admin kind=password text=admin123`) };
        if (typeof store[spec.method] !== "function") return { text: `这版 store 没有 ${spec.method}（entity=${want}）` };
        let resAdd = null;
        const preA = spec.preTotal ? spec.preTotal(store, activeId) : undefined;
        try {
          resAdd = spec.noEngagement ? store[spec.method](spec.build(args)) : store[spec.method](activeId, spec.build(args));
        } catch (e) {
          return { text: `entity_add ${want} 写入失败：${cut(e?.message ?? e, 130)}｜参数问题请按 store 点名的字段补齐。` };
        }
        if (spec.readBack) return { text: `entity_add ${want} 已写入 @${activeId}｜${spec.readBack(store, activeId, args, resAdd, preA)}` };
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
              ? rows2.slice(0, cap).map((r) => `  · ${r.id === undefined ? "" : "#" + r.id + " "}${cut(entityBrief(want, r), 104)}`).join("\n") + (rows2.length > cap ? `\n  …另 ${rows2.length - cap} 条（加 limit=${total2} 看全量）` : "")
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
        // scores 必须报 code：score_add 的 point 参数要的是 id，而表里的 name 是几十个字的人话。
        // 上一版只印 name，等于让模型「去 op=scores 取 id」却拿不到 id —— 本轮实测发现的自造拒绝链。
        if (op === "scores") return `${r.code || "?"}（${r.points ?? "?"} 分）${cut(String(r.name || r.category || ""), 46)}`;
        // stages 同理，而且更要紧：chain_add 与 entity_add entity=stage 的 stage 参数吃的就是 code，
        // 只印「信息收集」这种中文名的话，模型根本不知道该填 recon。
        if (op === "stages") return `${r.code || "?"}（${cut(String(r.name || ""), 40)}）`;
        const key = r.name || r.title || r.point || r.file || r.stage_code || r.code || r.ip || r.target || r.id || "?";
        const extra = r.state || r.status || r.severity || r.kind || r.result || r.tool || "";
        return `${key}${extra ? `(${extra})` : ""}`;
      };
      return {
        text: [
          `${op} @靶标 ${activeId}：共 ${total} 条${total !== rows.length ? `（本页 ${rows.length}）` : ""}`,
          rows.length
            ? rows.slice(0, cap).map((r) => `  · ${cut(brief(r), 110)}`).join("\n") + (rows.length > cap ? `\n  …另 ${rows.length - cap} 条（加 limit=${total} 看全量）` : "")
            : total ? "  （本页无数据）" : (op === "assets"
                ? "  （空）资产是发现面：只有 importBundle 铺入才会建行。要登记一条资产：op=entity_add entity=asset target=<IP> name=<主名>；要评估/记测试请先铺入。"
                : "  （空）"),
        ].join("\n"),
      };
    },
  };

  return [status, align, apply, revert, patch, update, rulesTool, skillsTool, overrideTool, drill];
}
