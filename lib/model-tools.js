import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readDrillGrant } from "./drill-grant.js";
import { readAllowText, allowFilePath } from "./net-scope.js";
import { hostEnumerationLine } from "./core.js";
import { RedteamStore } from "./redteam/store-core.js";
// 范围闸：落库前判目标是否在靶标授权范围内（机制借自 @integsec/agentic-pentest-proxy 的 scope manifest）
import { checkTarget, checkTechnique } from "./redteam/scope.js";
// 漏洞 → 具体打法分流：让「下一步」看手里真实的漏洞，而不是给一句通用正确的话
import { routeVulns, describeVulnRoute } from "./redteam/vuln-route.js";
// 阶段分流：把「点个技能名 + 通用说明」换成「按手里真实数据说这一发打哪」
import { routeRecon, routeIntranet, routeTunnel, routeCredentials } from "./redteam/stage-route.js";
// 可执行命令：把「下一步」变成能直接复制的命令，并按本机实况给（缺工具给装法/替代）
import { commandsForStage, probeTool } from "./redteam/cmd-route.js";
// 入参严格校验：带字段路径的报错，不允许静默降级（机制借自 @stofone/dsh-agent-roster 的校验层）
import { validateOpenArgs, renderIssues, validateEntityAdd, validateChainAdd, validateUpdate, validateReport } from "./redteam/validate-input.js";
// 越界压力判定：检测到失控要知道「该停」，而不是继续打同一发
import { judgeScopePressure, renderPressure, pressureNext } from "./redteam/pressure.js";
// 侦察管道：把 subfinder→dnsx→naabu 串起来，并且每一步都收敛（限流 + 抽样判活）
import { reconPipeline, writePipelineScripts } from "./redteam/pipeline.js";
// 管道产物落库：runs/*.txt 只落盘不算结果，「没落库的发现等于没发生」
import { parseArtifacts, importCommands, toBundle } from "./redteam/ingest.js";
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

/** 通用反引号：包命令、实体名等。里面**不一定是技能名**，别拿它当技能引用。 */
const S = (s) => "`" + s + "`";
/**
 * SK = skill：**只有技能名才用它**。函数名即契约——`audit-skills` 扫 `SK("…")` 并要求那个技能真实存在，
 * 所以名字不能漂，也不能拿它包实体名。分开是因为 `S("asset")` 这类实体名本身就长得像技能名，
 * 混用会让审计误报「技能不存在」（第 108 轮实测踩到）。
 */
const SK = (name) => "`" + name + "`";

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
  // vuln：store 的 addVuln **本来就认 status**（VULN_STATUSES 白名单，非法值回落 candidate），
  // 但 build 一直没往里传，于是每条漏洞都只能先记成 candidate、再单独 update 一次改状态。
  // 第 136 轮实测：这就是「记了漏洞战报却 0 分」的一半原因——两步漏了第二步就永远进不了战报。
  // 现在一次写到位：kind=严重度、stage=状态（沿用 update 的字段语义，不另造参数）。
  vuln: {
    method: "addVuln",
    build: (a) => {
      const v = { target: a.target, title: a.name, severity: a.kind, evidence: a.text, tool: a.tool || "drill", provenance: "active" };
      // stage 走状态：update 那边也是 stage=状态，两处语义保持一致
      if (a.stage !== undefined && String(a.stage).trim() !== "") v.status = String(a.stage).trim();
      return v;
    },
  },
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
    // 靶标授权边界（三道）与越界汇总。放在 settings 里是因为这是**人做决定时**要看的东西：
    // 「这次作业被允许打到哪、用什么手法、什么时段、有没有已经踩线」。
    // 之前只有战报里有——那是作业结束才看的，来不及。
    try {
      const st0 = opts.store;
      const list = Array.isArray(st0?.listEngagements?.()) ? st0.listEngagements() : [];
      const aid = st0?.activeEngagementId?.() || (list[0] && list[0].id);
      if (aid) {
        const meta = st0.readEngagementMeta?.(aid) || {};
        const scope = Array.isArray(meta.scope) ? meta.scope : [];
        const tech = Array.isArray(meta.authorizedTechniques) ? meta.authorizedTechniques : [];
        const deny = Array.isArray(meta.excludedTechniques) ? meta.excludedTechniques : [];
        const wf = meta.windowFrom || "";
        const wt = meta.windowTo || "";
        rows.push(`靶标 @${aid} 授权：目标 ${scope.length ? scope.join(",") : "（未设）"}｜技法 ${tech.length ? tech.join(",") : "不限"}${deny.length ? `（排除 ${deny.join(",")}）` : ""}｜窗口 ${wf || wt ? `${wf || "—"}→${wt || "—"}` : "不限"}`);
        const sm = st0.scopeBlockSummary?.(aid) || { total: 0, byReason: [] };
        rows.push(sm.total > 0
          ? `越界拦截：共 ${sm.total} 次（目标 ${sm.byLayer.target} / 技法 ${sm.byLayer.technique}）｜最多：${(sm.byReason || []).slice(0, 3).map((x) => `${x.reason}×${x.n}`).join("、")}`
          : "越界拦截：0 次");
      } else {
        rows.push("靶标授权：尚无靶标（先 op=open 建一个，再给 scope 串设技法与时间窗）");
      }
    } catch { /* 读不到就不报，别让 settings 崩 */ }
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
      // 把 store 一并交给渲染器：settings 里要报靶标授权边界与越界汇总，没有 store 拿不到。
      // 注意**不能直接引用 `store`**：它在函数后半段才用 `const` 定义，这里引用会踩 TDZ
      // （`node --check` 抓不到，实跑才炸）。改用 deps.redteamStore，没有就按需新建一个——
      // 路径解析必须与 drill 里那一处**逐字一致**（REDTEAM_HOME → DSH_HOME/redteam），
      // 否则新建的实例指向别处，读出来永远是「尚无靶标」（实测踩过）。
      let st0 = deps.redteamStore;
      if (!st0) {
        try {
          st0 = new RedteamStore(
            process.env.REDTEAM_HOME || path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "redteam")
          );
        } catch { st0 = undefined; }
      }
      return { text: renderStatus(await core.gatherState(), { ...args, store: st0 }) };
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
        all: { type: "string", description: "true=全列；给 1-5 或 flow 只看该段。" },
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
      if (args.all === true || args.all === "true") lines.push(`红队清单：${red.map(nameOf).join(", ")}`);
      else {
        // 按阶段列技能：日常会话没有红队技能的 <available_skills>，这是「按场景找技能」的入口。
        // 阶段归属读 lib/generated/skills-index.json（build:skills-graph 的产物），不在这儿重算规则。
        const want = String(args.all || "").trim();
        if (want && want !== "false") {
          let idx = null;
          try {
            const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
            for (const p of [path.join(home, "dsh-purge", "skills-index.json"), path.join(process.cwd(), "lib", "generated", "skills-index.json")]) {
              if (fs.existsSync(p)) { idx = JSON.parse(fs.readFileSync(p, "utf8")); break; }
            }
          } catch { idx = null; }
          if (!idx) lines.push("按阶段查需要链路索引：跑 npm run build:skills-graph 生成 lib/generated/skills-index.json");
          else {
            const stage = want === "flow" ? "flow" : want.replace(/[^1-5]/g, "");
            const hit = idx.skills.filter((s) => (stage === "flow" ? s.stage === "flow" : String(s.stage) === stage)).map((s) => s.id);
            lines.push(hit.length
              ? `阶段${stage || "?"}（${idx.stages ? idx.stages[stage] || stage : stage}）${hit.length} 个：${hit.join(", ")}`
              : `阶段「${want}」没有技能（可用：1-5 / flow）`);
          }
        }
      }
      if (args.all === true || args.all === "true" || (args.all && String(args.all) !== "false")) lines.push("要细节：purge_skills id=<技能名>（回链路位置 + 正文头部）");
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
            "读：summary(缺省)|engagements(=summary 别名)|assets|chain|scores|attackfiles|stages|list(entity)|pocs（text 检索｜name 读单条正文）|report（战报，kind=score|targets）；写：chain_add|score_add|attackfile_add|entity_add|ingest（把 runs/*.txt 落库）；靶标：open|switch；改删：update|delete（参数见各自说明）",
        },
        engagement: { type: "string", description: "靶标 id，缺省当前靶标" },
        limit: { type: "number", description: "条数上限，缺省 8" },
        row: { type: "number", description: "行 id（取自 op=list）" },
        entity: { type: "string", description: "读：vuln|credential|access|webshell|tunnel|web|http|shot|prompt|segment；写：vuln|credential|access|webshell|tunnel|http|shot|prompt|scorepoint|stage|asset|poc" },
        name: { type: "string", description: "标题/账号/文件名/code" },
        text: { type: "string", description: "内容/证据；pocs 检索词" },
        stage: { type: "string", description: "阶段 code，缺省 recon" },
        tool: { type: "string", description: "工具名，缺省 drill" },
        scope: { type: "string", description: "open：tech=技法 deny=排除 from=起 to=止" },        point: { type: "string", description: "得分点 code" },
        value: { type: "number", description: "台数/分值" },
        target: { type: "string", description: "归属目标（IP/URL/网段）；asset 可多个" },
        kind: { type: "string", description: "类别/列名，取值见报错" },
        content: { type: "string", description: "attackfile 正文" },
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
      // ingest：把管道产物（runs/*.txt）落库。放在 summary 之前，因为它属于「写」。
      // 没有这一步，管道跑完的成果只躺在磁盘上——本仓条令是「没落库的发现等于没发生」。
      if (op === "ingest") {
        const files = String(args.name || args.text || "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
        if (!files.length) return { text: "ingest 需要 files：把 runs/ 下的产物路径给它（例：name=runs/httpx.txt,runs/nuclei.txt）" };
        const bodies = {};
        const missing = [];
        for (const f of files) {
          try { bodies[path.basename(f)] = fs.readFileSync(f, "utf8"); }
          catch { missing.push(f); }
        }
        if (!Object.keys(bodies).length) return { text: `ingest：这些文件都读不到 —— ${missing.join(", ")}（先跑管道，产物在 runs/）` };
        const batch = parseArtifacts(bodies);
        // 资产走 importBundle（按 ip upsert，重复导入不产生重复行）
        let assetsRes = null;
        if (batch.assets.length) {
          // 必须走 toBundle：只传 ip 会把端口与指纹全丢掉（第 133 轮实测）
          try { assetsRes = store.importBundle(activeId, { assets: toBundle(batch) }); }
          catch (e) { assetsRes = { error: String(e && e.message || e) }; }
        }
        // 漏洞逐条落（严重度必填，否则会静默降级成 info 而报告只收中危以上）
        let vulnOk = 0;
        const vulnErr = [];
        for (const v of batch.vulns) {
          try {
            store.addVuln(activeId, { target: v.target, title: v.title, severity: v.severity, evidence: v.evidence });
            vulnOk += 1;
          } catch (e) { vulnErr.push(`${v.title}: ${String(e && e.message || e)}`); }
        }
        const L = [];
        const fpCount = batch.assets.reduce((n, a) => n + (Array.isArray(a.tech) ? a.tech.length : 0), 0);
        // **失败不能报成成功**：importBundle 抛错时 batch.assets.length 仍是解析出来的条数，
        // 若直接报「资产 N」会让人以为进库了（第 133 轮实测：报了 1 条，实际 0 条）。
        const assetFailed = !!(assetsRes && assetsRes.error);
        const assetLine = assetFailed
          ? `资产 0（解析 ${batch.assets.length} 条但导入失败）`
          : `资产 ${batch.assets.length}`;
        L.push(`落库 ${Object.keys(bodies).length} 个产物｜${assetLine}｜端口 ${batch.ports.length}｜指纹 ${fpCount}｜漏洞 ${batch.vulns.length}（成功 ${vulnOk}）`);
        if (missing.length) L.push(`读不到：${missing.join(", ")}`);
        if (assetsRes && assetsRes.error) L.push(`资产导入失败：${assetsRes.error}`);
        // 跳过要报出来，否则用户以为全落库了
        if (batch.skipped.length) {
          L.push(`跳过 ${batch.skipped.length} 行（不静默丢）：`);
          for (const s of batch.skipped.slice(0, 6)) L.push(`    [${s.file}] ${s.why}｜${s.line.slice(0, 50)}`);
          if (batch.skipped.length > 6) L.push(`    …另 ${batch.skipped.length - 6} 行`);
        }
        if (vulnErr.length) L.push(`漏洞落库失败 ${vulnErr.length} 条：${vulnErr.slice(0, 3).join("；")}`);
        L.push("→ 下一步：op=summary 看落库后的资产与阶段");
        return { text: L.join("\n") };
      }
      if (op === "summary" || op === "engagements") {
        const lines = [
          `靶标 ${list.length} 个｜当前=${activeId || "无"}`,
          list.length ? `清单：${list.slice(0, cap).map((e) => `${e.name && e.name !== e.id ? `${e.id}(${e.name})` : e.id}${e.state ? `·${e.state}` : ""}`).join(", ")}${list.length > cap ? ` …共 ${list.length}` : ""}` : "引导：还没开靶标——跑 purge_drill op=open name=<靶名> target=<IP/网段> 就地开一个（不必切红队预设，也不必去界面）。",
        ];
        if (activeId && op === "summary") {
          const s = store.stats(activeId) || {};
          // 不盲取前 10 个键：那样会把 chainSteps/files 这类真正有用的计数切掉（情景测试抓到的）。
          const KEYS = ["chainSteps", "vulns", "accesses", "credentials", "files", "assets", "internalAssets", "liveAssets", "openPorts", "segments", "services", "fingerprints"];
          const shown = KEYS.filter((k) => typeof s[k] === "number");
          const extra = Object.entries(s).filter(([k, v]) => typeof v === "number" && !KEYS.includes(k)).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(" ");
          const chainN = (Array.isArray(store.listChain(activeId)) ? store.listChain(activeId) : []).length;
          lines.push(`事实库 stats：chainSteps=${chainN} ${shown.map((k) => `${k}=${s[k]}`).join(" ")}${extra ?  ` ${extra}` : ""}`.trimEnd());
          // ★ 记账断点：**记了漏洞不等于有得分**。
          // 第 135 轮实测：漏洞 status 从 candidate 改成 confirmed 之后，战报仍然 count=0——
          // 因为 scoreReport() 从 score_hit 表读，而只有 score_add 才往那张表写。
          // 这不是 bug（得分是独立记账动作），但**没有任何地方提示**，人会以为「记了漏洞战报就有分」，
          // 直到交报告时才发现是 0 分。所以在 summary 里把这个差额报出来。
          try {
            const confirmedN = (((store.listVulns(activeId, {}) || {}).items) || [])
              .filter((v) => v.status === "confirmed" || v.status === "exploited").length;
            const sr = store.scoreReport ? store.scoreReport(activeId) : null;
            const scoredN = Number(sr?.summary?.count ?? 0);
            const pointsN = Number(sr?.summary?.points ?? 0);
            if (confirmedN > scoredN) {
              lines.push(`⚠ 计分缺口：已确认成果 ${confirmedN} 条，但计分只有 ${scoredN} 条（${pointsN} 分）——记漏洞不会自动计分，要 op=score_add point=<得分点> target=<目标> text=<证据> 才算进战报`);
            } else if (confirmedN > 0) {
              lines.push(`计分：已确认 ${confirmedN} 条 → 计分 ${scoredN} 条（${pointsN} 分）`);
            }
          } catch { /* 计分口径取不到就不报，不影响 summary 主体 */ }
          // 授权边界：summary 是日常会话唯一会看的入口，边界不报出来，
          // 人就只能等出报告才知道「刚才被拦了几次、拦的是什么」——那太晚了。
          // 三道边界 + 越界汇总（按理由归类，回答「最容易踩哪条线」）。
          try {
            const meta = store.readEngagementMeta?.(activeId) || {};
            const allow = Array.isArray(meta.scope) ? meta.scope : [];
            const tech = Array.isArray(meta.authorizedTechniques) ? meta.authorizedTechniques : [];
            const deny = Array.isArray(meta.excludedTechniques) ? meta.excludedTechniques : [];
            const winFrom = meta.windowFrom || "";
            const winTo = meta.windowTo || "";
            const bounds = [
              `目标 ${allow.length ? allow.join(",") : "（未设）"}`,
              `技法 ${tech.length ? tech.join(",") : "不限"}${deny.length ? `（排除 ${deny.join(",")}）` : ""}`,
              winFrom || winTo ? `窗口 ${winFrom || "—"}→${winTo || "—"}` : "窗口 不限",
            ].join("｜");
            lines.push(`授权边界：${bounds}`);
            const sm = store.scopeBlockSummary?.(activeId) || { total: 0, byReason: [] };
            if (sm.total > 0) {
              const top = (sm.byReason || []).slice(0, 3).map((x) => `${x.reason}×${x.n}`).join("、");
              lines.push(`越界拦截：共 ${sm.total} 次（目标越界 ${sm.byLayer.target} / 技法越权 ${sm.byLayer.technique}）｜最多：${top}`);
              // 时间维度：连续被拦是正常探测，**短时间激增**才是作业失控的信号——只看总数看不出区别
              if (sm.trend && sm.trend !== "无拦截") lines.push(`越界趋势：${sm.trend}`);
            } else {
              lines.push("越界拦截：0 次（至今没有动作被范围闸或技法闸拦下）");
            }
          } catch { /* 读不到元数据就不报，别让这一行把 summary 弄崩 */ }
          // 「下一步」——日常会话没有演练预设的五阶段条令，光看计数不知道往哪打。
          // 这里按事实库状态给**一句**针对性指引并点名该加载的技能：靶子即方向，一针封喉。
          // 技能名必须在 skills/redteam 里真实存在（已把本文件纳入 audit-skills 的 doctrineFiles 防漂）。
          let tunnels = 0, shells = 0;
          try { tunnels = (store.listTunnels(activeId) || []).length; } catch { tunnels = 0; }
          try { shells = (store.listWebshells(activeId) || []).length; } catch { shells = 0; }
          const n = (k) => Number(s[k] || 0);
          let next;
          if (n("assets") === 0) next = "阶段① 信息收集 —— 加载 " + SK("recon-pipeline") + "（已知域名用 " + SK("fofa-recon") + "），产出落 " + S("asset");
          else if (n("vulns") === 0) {
            // 按真实网段/存活/未测数说「先打哪块」，而不是「逐条过」
            let r3 = "";
            try {
              const segs3 = store.listSegments(activeId) || [];
              r3 = routeRecon({ segments: segs3, untested: n("untestedAssets"), assets: n("assets") });
            } catch { /* 分流失败退回通用句 */ }
            next = "阶段③ 漏洞发现 —— " + (r3 || ("先 " + SK("asset-correlation") + " 排「先打谁」，再 " + SK("nuclei-scan") + " 逐条过（未测资产 " + n("untestedAssets") + " 个）"));
          }
          else if (n("accesses") === 0 && shells === 0) {
            // 按手里**真实存在的漏洞**分流，而不是给一句「按漏洞类型选」——
            // 后者等于把最该帮模型判断的那一步推回给它（实测三条不同漏洞给出同一句指引）。
            let routed = "";
            try {
              const all = (store.listVulns(activeId, { limit: 50 }) || {}).items || [];
              const unhandled = all.filter((v) => v.status !== "exploited");
              const rv = routeVulns(unhandled);
              if (rv.ranked.length) routed = describeVulnRoute(rv.ranked);
            } catch { /* 分流失败就退回通用指引，别让「下一步」消失 */ }
            next = routed
              ? "阶段④ 漏洞利用 —— " + routed + "｜拿到权限后 " + SK("webshell-toolkit") + " 落马 + 实测能连上"
              : "阶段④ 漏洞利用 —— 按漏洞类型选 " + SK("injection-payloads") + " / " + SK("web-vuln-payloads") + "，拿到权限后 " + SK("webshell-toolkit") + " 落马 + 实测能连上";
          }
          else if (tunnels === 0) {
            let rT = "";
            try { rT = routeTunnel({ shells, liveAssets: n("liveAssets"), assets: n("assets") }); } catch { /* 退回通用句 */ }
            next = "建隧道 —— " + (rT || (SK("suo5-tunnel") + "（备选 " + SK("chisel-tunnel") + "），建完必须实测能访问内网才算打通"));
          }
          else if (n("internalAssets") === 0) {
            let r5 = "";
            try { r5 = routeIntranet({ segments: store.listSegments(activeId) || [] }); } catch { /* 退回通用句 */ }
            next = "阶段⑤ 内网铺面 —— " + (r5 || ("走隧道 " + SK("gogo-intranet") + " 铺面，挖出所有网段（每发现新网段再跑一轮）"));
          }
          else if (n("untestedAssets") > 0) next = "内网打点 —— " + SK("fscan-intranet") + " 扫剩余 " + n("untestedAssets") + " 个未测资产（弱口令/未授权/高危）";
          else if (n("credentials") > 0) {
            // 按凭据**类型**分流：hash 走离线破、key 直接试、明文才在线登
            let rC = "";
            try { rC = routeCredentials({ creds: (store.listCredentials(activeId, {}) || {}).items || [] }); } catch { /* 退回通用句 */ }
            next = "凭据验证 —— " + (rC || (SK("netexec-scan") + " 逐条实测登录（只有凭据不算拿到账号）"));
          }
          else next = "链路走通 —— 深挖横向与域：" + SK("lateral-movement") + " / " + SK("windows-ad") + "，或按靶子面加载 " + SK("ctf-sandbox-orchestrator") + " 找专项";
          // 越界压力：判定「该不该停」。这一步是闭环的关键——趋势进了报告却不影响行动，
          // 等于心电图画出来没人看。stop 级别时**把下一步换成先停手**，不给「继续打」的指引。
          try {
            const smP = store.scopeBlockSummary?.(activeId) || { total: 0 };
            const press = judgeScopePressure(smP);
            // stop 场景下紧接着还有一行「→ 下一步：先核对授权…」，所以这里只报**为什么**，
            // 不重复行动（首版两行说的是同一句话，读起来像回声）。
            const stopNow = press.must && press.level === "stop";
            const line = renderPressure(press, { short: stopNow });
            if (line) lines.push(line);
            if (stopNow) next = pressureNext(press);
          } catch { /* 判定失败不影响下一步 */ }
          lines.push("→ 下一步：" + next);
          // 命令一行：只给**一条**（第一条），避免把 summary 撑破（工具返回预算 1500）。
          // 命令按本机实况生成：装了给绝对路径（防 PATH 撞同名异构），没装给安装命令或替代。
          try {
            // 阶段映射必须与上面「下一步」的**分支顺序完全一致**，不能只看计数：
            // 首版按 assets>0 就判 intranet，结果手里只有 3 个未探活资产时给出「装 gogo」——
            // 而 routeRecon 说的是「先 naabu 探存活」。阶段判错，命令就指错方向。
            let stg = "recon";
            if (n("assets") === 0) stg = "recon";
            else if (n("vulns") === 0) stg = "recon";          // 还在收集/发现阶段，用 recon 那套命令
            else if (n("accesses") === 0 && shells === 0) stg = "vuln";
            else if (tunnels === 0) stg = "tunnel";
            else if (n("internalAssets") === 0) stg = "intranet";
            else if (n("credentials") > 0) stg = "cred";
            else stg = "intranet";
            // 目标：优先取**有资产的真实 IP**，其次才是网段。
            // 第 134 轮实测的坑：原来优先取「资产最多的网段」，于是命令变成
            // `curl ... "http://10.0.0.0/24/"` —— **把网段当主机名用**，那条命令必然打不出去。
            // 网段只是授权范围，不是可访问目标；命令里的 target 必须是单台主机。
            let tgt = "";
            try {
              const rowsA1 = ((store.listAssets(activeId, {}) || {}).items) || [];
              const withIp = rowsA1.find((x) => x.ip && !String(x.ip).includes("/"));
              if (withIp) tgt = String(withIp.ip);
            } catch { /* 取不到资产就看网段 */ }
            if (!tgt) {
              try {
                const segs = store.listSegments(activeId) || [];
                const top = segs.slice().sort((x, y) => Number(y.assets || 0) - Number(x.assets || 0))[0];
                // 网段落到具体主机：/24 取 .1 没有意义，所以只在**网段里只有一台**时才用；
                // 否则留空，让下面的 scope 兜底（域名/IP）——宁可给域名，也不给一条打不出去的命令。
                if (top && String(top.cidr).endsWith("/32")) tgt = String(top.cidr).replace(/\/32$/, "");
              } catch { /* 取不到就看靶标 scope */ }
            }
            // 没有真实主机时用靶标授权范围里的第一个（域名或 IP）——否则命令会带占位符 TARGET，
            // 而同一段下面的管道用的是真实域名，**同一处两条命令一条能跑一条不能**（实测踩到）。
            if (!tgt) {
              try {
                const m0 = store.readEngagementMeta?.(activeId) || {};
                const s0 = Array.isArray(m0.scope) ? m0.scope : [];
                // scope 里可能是网段，网段不能当主机——跳过带 / 的项
                const host = s0.find((x) => !String(x).includes("/"));
                if (host) tgt = String(host);
              } catch { /* 取不到就留空 */ }
            }
            // vuln 阶段要带上**漏洞类型**，命令才跟下一步说的一致（下一步说 redis-cli，命令就不能给 nuclei）
            let vk = "";
            if (stg === "vuln") {
              try {
                const allV = (store.listVulns(activeId, { limit: 50 }) || {}).items || [];
                const rv0 = routeVulns(allV.filter((v) => v.status !== "exploited"));
                if (rv0.ranked.length) vk = rv0.ranked[0].rule.id;
              } catch { /* 取不到类型就给通用命令 */ }
            }
            const cmds = commandsForStage({ stage: stg, target: tgt || "TARGET", vulnKind: vk });
            const c0 = cmds[0];
            if (c0) lines.push("→ 命令：" + (c0.ok ? "" : "[需先装] ") + c0.cmd + (c0.note && !c0.ok ? "（" + c0.note + "）" : ""));
            // 阶段① 且靶标是域名形态时，给**整条管道**而不是一条命令：
            // 单跑 subfinder 会收几万条死域名，单跑 dnsx 会白等十几分钟（实测 25k 条 / 396 秒）。
            // 管道带限流与抽样判活，才是能落地的做法。
            try {
              const meta0 = store.readEngagementMeta?.(activeId) || {};
              const sc0 = Array.isArray(meta0.scope) ? meta0.scope : [];
              const dom = sc0.find((x) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(String(x)));
              if (stg === "recon" && dom) {
                const steps = reconPipeline({ domain: String(dom), toolkit: probeTool, cap: 2000, sample: 200 });
                const okSteps = steps.filter((s) => s.ok);
                if (okSteps.length >= 2) {
                  lines.push("→ 管道（" + okSteps.length + " 步，逐步落盘 runs/）：");
                  for (const s of okSteps) lines.push("    " + s.step + "：" + s.cmd.slice(0, 150));
                  lines.push("    ⚠ ② 的解析率 < 5% 就别跑 ③——实测 25k 条死域名白等 396 秒");
                  // 跑完之后必须落库：文件在磁盘上而演练台里没有记录，下一轮又从零开始收。
                  // 光给命令文本不够：一次复制 6 条命令容易漏条，而且断了没法续。
                  // writePipelineScripts 把它们落成 runs/recon.ps1 与 runs/recon.sh——
                  // **写了不接等于没写**（第 143 轮审阅发现的孤儿导出）。
                  try {
                    const w = writePipelineScripts(okSteps);
                    if (w.ps1) lines.push("    → 已写成脚本：" + w.ps1.replace(/\\/g, "/") + "（Windows 用 pwsh 直接跑，断哪步改哪步）");
                    if (w.sh) lines.push("      同内容 sh 版：" + w.sh.replace(/\\/g, "/"));
                  } catch { /* 脚本落盘失败不影响命令文本 */ }
                  lines.push("→ 落库：跑完把 runs/ 喂回来（op=ingest files=runs/httpx.txt,runs/nuclei.txt），别让成果只躺在磁盘上");
                }
              }
            } catch { /* 管道生成失败不影响命令 */ }
          } catch { /* 命令生成失败不影响下一步 */ }
          lines.push("（技能正文用 " + S("purge_skills id=<技能名>") + " 读；按阶段找技能用 " + S("purge_skills all=1..5") + "）");
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
        // 入参先严格校验，**不允许静默降级**：实测四种写法都会让靶标「建成功但边界全空」——
        //   techs=noisy（键名错）、tech=noisy;passive（分号）、10.0.0.999/24（IP 越界）、
        //   from=2026/11/11（时间格式错）。最危险的是「建成了但边界为空」：人以为有边界，
        //   实际等于无授权作业。所以有错就**拒绝建靶**，把字段路径与改法一次说清。
        let vOpen;
        try { vOpen = validateOpenArgs({ target: sc, scope: args.scope || "" }); } catch { vOpen = { kv: {}, issues: [] }; }
        if (vOpen.issues && vOpen.issues.length) {
          return {
            text: [
              `open 未建靶：入参有 ${vOpen.issues.length} 处问题（不静默降级——建成一个边界为空的靶标比报错危险得多）`,
              ...renderIssues(vOpen.issues).map((l) => "  · " + l),
              `改好后重试。scope 写法：scope="tech=noisy,passive,deny=destructive,from=2026-11-11T00:00,to=2026-11-12T00:00"`,
            ].join("\n"),
          };
        }
        let made = null;
        try {
          // 开靶时可以一并给另外两道边界：技法与时间窗，用 scope 串传（k=v 逗号分隔）。
          // 四个独立参数会把工具面顶破预算（实测 3939/3600），合并成一个既省字也不减功能。
          // 解析用 validate-input.js 的严格版（已在上一步校验过，这里直接用结果）。
          const kv = vOpen.kv || {};
          made = store.openEngagement(nm, sc, {
            authorizedTechniques: kv.tech || "",
            excludedTechniques: kv.deny || "",
            windowFrom: kv.from || "",
            windowTo: kv.to || "",
          });
        } catch (e) {
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
        // 技法闸：chain_add 的 `tool`（以及 stage）就是「这一步用了什么手法」的证据。
        // 目标在范围内 ≠ 这种手法被授权；时间窗也一样——三条边界缺一条就等于没有边界。
        // 机制借自 @integsec/agentic-pentest-proxy 的 authorized/excluded_techniques + 时间窗。
        try {
          if (op === "chain_add" && activeId && typeof store.readEngagementMeta === "function") {
            const meta = store.readEngagementMeta(activeId) || {};
            const hasTech = (meta.authorizedTechniques || []).length || (meta.excludedTechniques || []).length;
            const hasWin = meta.windowFrom || meta.windowTo;
            if (hasTech || hasWin) {
              const tech = checkTechnique(String(args.tool || args.stage || "drill"), {
                authorizedTechniques: meta.authorizedTechniques || [],
                excludedTechniques: meta.excludedTechniques || [],
                window: { from: meta.windowFrom || undefined, to: meta.windowTo || undefined },
              });
              if (!tech.ok) {
                  try { store.recordScopeBlock?.(activeId, { layer: "technique", target: String(args.tool || args.stage || "drill"), detail: tech.reason, action: "chain_add" }); } catch { /* 记录失败不影响拦截 */ }
                return {
                  text: `chain_add 被技法闸拦下｜手法「${String(args.tool || args.stage || "drill")}」（类别 ${tech.cls}）：${tech.reason}\n`
                    + `靶标 @${activeId} 授权技法：${(meta.authorizedTechniques || []).join(", ") || "（未限制）"}`
                    + `${(meta.excludedTechniques || []).length ? "｜排除：" + meta.excludedTechniques.join(", ") : ""}`
                    + `${hasWin ? `｜窗口：${meta.windowFrom || "—"} → ${meta.windowTo || "—"}` : ""}\n`
                    + `换一个已授权的手法，或由人确认后重开同名靶标并给新的技法/时间窗。`,
                };
              }
            }
          }
        } catch { /* 元数据读不到就不拦，别让技法闸自己变成故障点 */ }
        let touched = null;
        try {
          if (op === "chain_add") {
            if (!args.text) return { text: "chain_add 需要 text（这一步做了什么）。例：purge_drill op=chain_add text=nmap 摸到 3 个端口" };
            // 阶段写错会被静默落成 recon（实测 reconn → recon），链路图会把这一步归错阶段
            try {
              const vCh = validateChainAdd(args);
              if (vCh.length) {
                return { text: ["chain_add 未写入：阶段有问题（不静默落成 recon）", ...renderIssues(vCh).map((l) => "  · " + l)].join("\n") };
              }
            } catch { /* 校验器出错就不拦 */ }
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
        // 入参先严格校验：**对所有实体生效**，所以必须放在 asset 分支之前。
        // store 对非法枚举会「updated:true 却什么都不改」，回读正确反而是最危险的——
        // 它让人确信操作成功了（实测 asset 状态/优先级都是静默回落）。
        try {
          const vUp = validateUpdate(wantUp, args);
          if (vUp.length) {
            return { text: ["update " + wantUp + " 未写入：入参有 " + vUp.length + " 处问题（不静默回落——回读正确会让人以为改成功了）", ...renderIssues(vUp).map((l) => "  · " + l)].join("\n") };
          }
        } catch { /* 校验器出错就不拦 */ }
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
        if (!Object.keys(patch).length) return { text: `update ${wantUp} #${rowId} 没给可改字段${dropped.length ? `：${dropped.join("；")}` : "（kind/stage/text/name 至少一个）"}｜vuln 用 kind=严重度 **stage=状态** text=证据 name=标题（状态走 stage 不走 status——命名反直觉，实测给 status=exploited 会得到这条报错）` };
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
        // 入参校验：kind 拼错会静默出战报（人以为拿到的是得分报告），limit 负数会静默取默认
        try {
          const vRep = validateReport(args);
          if (vRep.length) {
            return { text: ["report 未生成：入参有 " + vRep.length + " 处问题（不静默降级）", ...renderIssues(vRep).map((l) => "  · " + l)].join("\n") };
          }
        } catch { /* 校验器出错就不拦 */ }
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
        // 审计段不能被 limit 截断：默认 14 行会把「授权边界与越界尝试」整段切掉，
        // 而那段恰恰是报告里最该给审计方看的东西（证明「没打什么」）。
        // 做法：按原顺序拼接，但**审计段永远完整保留**——不挪位置（markdown 里它就在「一、」之前），
        // 也不计入 limit 的行数预算。
        const auditStart = allLines.findIndex((l) => /^##\s*零、授权边界/.test(l));
        let auditEnd = -1;
        if (auditStart >= 0) {
          let k = auditStart + 1;
          while (k < allLines.length && !/^##\s/.test(allLines[k])) k += 1;
          auditEnd = k;
        }
        const inAudit = (i) => auditStart >= 0 && i >= auditStart && i < auditEnd;
        const rendered = [];
        let budget = n;
        for (let i = 0; i < allLines.length; i += 1) {
          const l = allLines[i];
          if (inAudit(i)) { rendered.push((l ? "  " : "") + l); continue; } // 审计段：不计预算、必出
          if (budget <= 0) continue;
          rendered.push((l ? "  " : "") + l);
          budget -= 1;
        }
        const outsideCount = allLines.length - (auditEnd > auditStart ? auditEnd - auditStart : 0);
        return {
          text: [
            `${wantScore ? "得分报告" : "战报"} @${activeId}：${allLines.length} 行 / ${md.length} 字符${stats ? `｜${stats}` : ""}${sum ? `｜${sum}` : ""}`,
            rendered.join("\n"),
            outsideCount > n ? `  …另 ${outsideCount - n} 行（加 limit=${allLines.length} 看全量）` : "",
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
        // 实体专属枚举校验：严重度/阶段这类字段拼错会被静默降级成默认值，
        // 而严重度降级会让这条漏洞在报告里整个消失（报告只收中危以上）。
        try {
          const vEnt = validateEntityAdd(want, args);
          if (vEnt.length) {
            return { text: ["entity_add " + want + " 未写入：入参有 " + vEnt.length + " 处问题（不静默降级——写成 info 的漏洞在报告里会消失）", ...renderIssues(vEnt).map((l) => "  · " + l)].join("\n") };
          }
        } catch { /* 校验器自身出错就不拦，别让它变成故障点 */ }
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
        // 范围闸：落库前先判 target 是否在靶标授权范围内。
        // 为什么卡在这里而不是各个 store 方法里：这里是所有实体写入的**唯一入口**，一处拦截覆盖
        // asset/vuln/credential/access/webshell/tunnel/http 全部类型；写进 store 就会散成七八处、早晚漏一处。
        // 机制来自 @integsec/agentic-pentest-proxy 的 scope manifest：一个越界就整条拦下、排除项优先、
        // 判不了也算不过。实测过缺口：靶标授权 203.0.113.0/24 时，落 198.51.100.9 的资产与漏洞
        // 都能静默写进去——「门口验票、进场随便走」。
        try {
          // 只对「target 确实是网络目标」的实体做范围校验。
          // 别的实体 target 是别的东西：shot 是图片文件路径、poc 是归属标签（"scenario 新建 POC"）、
          // prompt/scorepoint/stage 是配置项——一刀切会把它们全拦死（实测情景测试立刻红 3 条）。
          const NET_TARGET_ENTITIES = new Set(["asset", "vuln", "credential", "access", "webshell", "tunnel", "http"]);
          const meta = activeId && NET_TARGET_ENTITIES.has(want) && typeof store.readEngagementMeta === "function"
            ? store.readEngagementMeta(activeId) || {}
            : {};
          const allowList = Array.isArray(meta.scope) ? meta.scope : [];
          if (activeId && allowList.length && NET_TARGET_ENTITIES.has(want)) {
            const rawTgt = String(args.target || args.name || "").trim();
            // asset 支持批量：target 是逗号/空格分隔的多个目标。按 scope manifest 的规矩
            // 「提取所有可见目标、逐个校验、一个越界就整条拦下」——不能只验第一个，
            // 也不能把整串当一个目标（那样会判成「无法判定」而误拦合法批量，实测情景测试就红在这）。
            const targets = /^(asset)$/.test(want)
              ? rawTgt.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
              : [rawTgt];
            for (const one of targets) {
              const verdict = checkTarget(one, { allow: allowList });
              if (!verdict.ok) {
                try { store.recordScopeBlock?.(activeId, { layer: "target", target: verdict.host || one, detail: verdict.reason, action: "entity_add " + want }); } catch { /* 记录失败不影响拦截 */ }
                return {
                  text: `entity_add ${want} 被范围闸拦下｜目标 ${verdict.host || one}：${verdict.reason}\n`
                    + `靶标 @${activeId} 授权范围：${allowList.join(", ")}\n`
                    + `要么换授权范围内的目标，要么由人确认后扩大靶标范围（op=open 同名靶标并给新 target）。越界打靶不是技术问题，是事故。`,
                };
              }
            }
          }
        } catch { /* 取不到元数据就不拦，别让范围闸自己变成故障点 */ }
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
      // assets 视图补端口/指纹：端口以前**只写不读**，`assets` 只显示 `example.com(unknown)`，
      // 443 与 Cloudflare 明明进库了却看不见（第 133 轮补 listPorts 后在这里露出来）。
      // 「写了看不见等于没写」——和「存了不读等于没存」是同一条。
      let portLines = [];
      if (op === "assets" && typeof store.listPorts === "function" && rows.length) {
        try {
          const all = store.listPorts(activeId, {});
          const byIp = new Map();
          for (const p of (all.items || [])) {
            if (!byIp.has(p.ip)) byIp.set(p.ip, []);
            byIp.get(p.ip).push(p);
          }
          for (const r of rows.slice(0, cap)) {
            const ps = byIp.get(String(r.ip)) || [];
            if (!ps.length) continue;
            const desc = ps.slice(0, 6).map((p) => `${p.port}${p.service ? "/" + p.service : ""}${p.fingerprints ? "[" + String(p.fingerprints).split(",").slice(0, 3).join(",") + "]" : ""}`).join(" ");
            portLines.push(`      ↳ ${r.ip} 端口：${desc}${ps.length > 6 ? ` …另 ${ps.length - 6} 个` : ""}`);
          }
        } catch { /* 端口读不到不影响资产列表 */ }
      }
      return {
        text: [
          `${op} @靶标 ${activeId}：共 ${total} 条${total !== rows.length ? `（本页 ${rows.length}）` : ""}`,
          rows.length
            ? rows.slice(0, cap).map((r) => `  · ${cut(brief(r), 110)}`).join("\n") + (rows.length > cap ? `\n  …另 ${rows.length - cap} 条（加 limit=${total} 看全量）` : "") + (portLines.length ? "\n" + portLines.join("\n") : "")
            : total ? "  （本页无数据）" : (op === "assets"
                ? "  （空）资产是发现面：只有 importBundle 铺入才会建行。要登记一条资产：op=entity_add entity=asset target=<IP> name=<主名>；要评估/记测试请先铺入。"
                : "  （空）"),
        ].join("\n"),
      };
    },
  };

  return [status, align, apply, revert, patch, update, rulesTool, skillsTool, overrideTool, drill];
}
