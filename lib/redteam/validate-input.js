/**
 * 带字段路径的校验：把「静默降级」变成「当场说清错在哪、该写什么」。
 *
 * 为什么需要（实测，第 120 轮）：靶标开出来「看起来成功」，但边界全是空的——
 *   · `scope="techs=noisy"`（键名写错）→ **静默忽略**，技法授权丢失，靶标照样建成；
 *   · `scope="tech=noisy;passive"`（分隔符写错）→ 只剩 noisy，passive **静默消失**；
 *   · `target="10.0.0.999/24"`（IP 段越界）→ **原样接受**，范围闸从此永不生效；
 *   · `scope="from=2026/11/11"`（时间格式错）→ 时间窗**静默丢弃**。
 * 这四类里最危险的是「靶标建成但边界为空」：人以为有边界，实际等于无授权作业。
 *
 * 机制参照 `@stofone/dsh-agent-roster` 的校验层（只借机制）：报错必须带
 * **字段路径**（`scope.tech`）、**期望形状**（enumerated/format）、**实际值**（收到的原文），
 * 并且**不允许静默降级**——要么收下，要么报错，不能"收下一个残缺的"。
 */

/** 一条校验问题：字段路径 + 期望 + 实际 + 怎么改 */
export function issue(field, expected, actual, hint = "") {
  return { field, expected, actual: String(actual ?? ""), hint };
}

/** 渲染成人能直接照做的一行 */
export function renderIssue(i) {
  const a = i.actual === "" ? "（空）" : `「${i.actual}」`;
  return `${i.field}：期望 ${i.expected}，实际 ${a}${i.hint ? ` —— ${i.hint}` : ""}`;
}

/** 渲染多条，按字段排序（稳定输出，便于比对） */
export function renderIssues(list) {
  const seen = new Set();
  const out = [];
  for (const i of list) {
    const line = renderIssue(i);
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

/* ───────────────────────── scope 串解析（严格） ───────────────────────── */

const SCOPE_KEYS = new Set(["tech", "deny", "from", "to"]);

/**
 * 严格解析 scope 串。与旧实现的关键差别：**任何不认识的东西都报出来**，不静默丢。
 * 允许的分隔：逗号，但只在「下一个 k=」处切（值里本身有逗号，如 `tech=noisy,passive`）；
 * 也接受空格分隔各键。
 * @returns {{ kv: Record<string,string>, issues: Array }}
 */
export function parseScopeString(raw) {
  const text = String(raw ?? "").trim();
  const kv = {};
  const issues = [];
  if (!text) return { kv, issues };

  // 先按「下一个 k=」切；如果整串里一个 k= 都没有，明确报错而不是当成值
  const parts = text.split(/,(?=\s*(?:tech|deny|from|to)\s*=)/i);
  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (!part) continue;
    const m = /^([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(part);
    if (!m) {
      // 没有等号：可能是用分号/空格拼的，或纯手误
      const hint = /[;；]/.test(part)
        ? "分隔符用英文逗号或空格，不要用分号"
        : "每一项都要写成 k=v，如 tech=noisy,deny=destructive";
      issues.push(issue("scope", "k=v 形式的项", part, hint));
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (!SCOPE_KEYS.has(key)) {
      issues.push(issue(`scope.${m[1]}`, "tech | deny | from | to", m[1], "键名写错了，这一项会被丢弃——写错键名等于没授权"));
      continue;
    }
    if (!val) {
      issues.push(issue(`scope.${key}`, "非空值", "", "等号右边是空的"));
      continue;
    }
    if (key in kv) {
      issues.push(issue(`scope.${key}`, "只出现一次", val, "同一个键给了两次，后一个会覆盖前一个"));
    }
    kv[key] = val;
  }
  return { kv, issues };
}

/** 校验技法名：必须是已知类别，或一个真实存在的技能名（无法在这里查技能库，只查类别与形状） */
const TECH_CLASSES = new Set(["destructive", "exploit", "noisy", "passive", "reverse", "specialty", "appsec", "surface"]);

export function validateTechniqueList(field, value) {
  const issues = [];
  const items = String(value || "").split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
  for (const it of items) {
    // 类别名 或 kebab-case 技能名都收；明显不合形状的报出来
    if (TECH_CLASSES.has(it)) continue;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(it)) {
      issues.push(issue(field, "技法类别（noisy/passive/…）或技能名（kebab-case）", it, "含非法字符，这一项会被丢弃"));
    }
  }
  return issues;
}

/** 校验 CIDR / IP / 域名形状。这里只管**形状**，不管是否在授权内（那是范围闸的事） */
export function validateTargetShapes(field, values) {
  const issues = [];
  const list = Array.isArray(values) ? values : [values];
  for (const v of list) {
    const t = String(v || "").trim();
    if (!t) continue;
    // 去掉 URL 外壳与端口后再判
    let host = t;
    const url = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(host);
    if (url) host = url[1];
    host = host.replace(/^[^@/]*@/, "").replace(/:\d+$/, "");
    if (host.includes("/")) {
      const [addr, bits] = host.split("/");
      const seg = addr.split(".");
      if (seg.length !== 4 || seg.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) {
        const bad = seg.find((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255);
        issues.push(issue(field, "IPv4 网段，如 10.0.0.0/24", t, bad ? `段「${bad}」不是 0-255 的整数` : "地址部分不是四段"));
        continue;
      }
      const b = Number(bits);
      if (!Number.isInteger(b) || b < 0 || b > 32) {
        issues.push(issue(field, "掩码位数 0-32", t, `掩码「${bits}」超范围`));
      }
      continue;
    }
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (isIp) {
      const bad = host.split(".").find((x) => Number(x) > 255);
      if (bad !== undefined) issues.push(issue(field, "IPv4 每段 0-255", t, `段「${bad}」超过 255`));
      continue;
    }
    const isDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host);
    const isWild = /^\*\.([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host);
    if (!isDomain && !isWild) {
      issues.push(issue(field, "IPv4 / CIDR / 域名 / URL", t, "既不像 IP 网段也不像域名——写成这样范围闸判不了，等于没有边界"));
    }
  }
  return issues;
}

/** 校验时间格式：接受 YYYY-MM-DD 与 YYYY-MM-DD HH:mm（也接受 T 分隔） */
export function validateTimeField(field, value) {
  const t = String(value || "").trim();
  if (!t) return [];
  const iso = t.includes("T") ? t : t.replace(" ", "T");
  const withTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso : iso + "T00:00";
  if (!Number.isFinite(Date.parse(withTime))) {
    return [issue(field, "YYYY-MM-DD 或 YYYY-MM-DD HH:mm", t, "时间解析不出来——写错格式这一项会被静默丢弃，时间窗等于没设")];
  }
  return [];
}

/**
 * 一站式校验 open 靶标的全部入参。
 * @returns {{ kv: Record<string,string>, issues: Array<{field:string,expected:string,actual:string,hint:string}> }}
 */
export function validateOpenArgs({ target, scope }) {
  const { kv, issues } = parseScopeString(scope);
  const all = [...issues];
  all.push(...validateTargetShapes("target", target));
  if (kv.tech) all.push(...validateTechniqueList("scope.tech", kv.tech));
  if (kv.deny) all.push(...validateTechniqueList("scope.deny", kv.deny));
  if (kv.from) all.push(...validateTimeField("scope.from", kv.from));
  if (kv.to) all.push(...validateTimeField("scope.to", kv.to));
  return { kv, issues: all };
}

/* ───────────────────────── 枚举字段校验（实体写入口） ─────────────────────────
 * 实测缺口（第 121 轮）：`entity_add vuln kind=critcal`（拼错）与「不给 kind」**都会静默降级成 info**。
 * 严重度是报告里最核心的字段，把 critical 报成 info 等于把高危说成信息泄露——
 * 这类降级比报错危险得多，所以这里一律**报错并列出全部合法值**，不猜用户想写哪个。
 */

/* 严重度 / 漏洞状态的枚举**只能有一个来源**（store-core）。
   原先这里写着「与 store 的 SEVERITIES 对齐」却各自复制了一份——注释声明对齐、
   代码实际复制，是最容易骗过 review 的形态：两份值今天相同，明天加一个值就漂。
   实测 tools.js 的 redteam_poc_save 描述写成「critical|high|medium|low」漏了 info，
   而 store 侧是接受的，模型因此以为不能填 info。 */
import { SEVERITIES, VULN_STATUSES } from "./store-core.js";

export { SEVERITIES, VULN_STATUSES };
/**
 * 链路阶段码：**必须与 store-core.js 的 VALID_STAGE_CODES 逐字一致**。
 * 第 120 轮我在这里写成 `recon/assess/vuln-scan/exploit/internal` —— 那是 `ROLE_ORDER` 的**角色名**，
 * 不是阶段码；而 store 真正认识的是 `recon/internet/boundary/internal/target`。
 * 后果很隐蔽：校验器会把 `stage=exploit` 判成「不认识」而拦下，可 store 本来是有 LEGACY_STAGE_MAP
 * 把 exploit 映射到 internet 的——**判据抄错了源，就会拦住本来合法的用法**。
 * 这条教训写在这里：任何「枚举必须一致」的地方，都要去 store 里找那个真正的常量，不要凭记忆写。
 */
export const STAGES = ["recon", "internet", "boundary", "internal", "target"];
/** 旧阶段名 → 新阶段码（与 store 的 LEGACY_STAGE_MAP 对齐；这些也应当被接受） */
export const LEGACY_STAGES = ["vuln", "exploit", "access", "pivot", "data", "other"];

/** 通用枚举校验：给了就必须合法；required 为真时不给也报 */
export function validateEnum(field, value, allowed, { required = false, fallbackHint = "" } = {}) {
  const t = String(value ?? "").trim();
  if (!t) {
    if (!required) return [];
    return [issue(field, `必填，取 ${allowed.join(" | ")}`, "", fallbackHint || "不给会被静默降级成默认值，报告里的等级就不对了")];
  }
  const low = t.toLowerCase();
  if (allowed.includes(low)) return [];
  // 近似拼错给最近的那个（只给建议，不替用户改——静默纠错同样是降级）
  const near = allowed.filter((a) => a.startsWith(low.slice(0, 3)) || low.startsWith(a.slice(0, 3)));
  const hint = near.length === 1
    ? `是不是想写 ${near[0]}？拼错会被静默降级，这里直接拦下`
    : "拼错会被静默降级成默认值，这里直接拦下";
  return [issue(field, allowed.join(" | "), t, hint)];
}

/** 校验 entity_add 的实体专属字段（只校「有枚举」的那几个） */
export function validateEntityAdd(entity, args = {}) {
  const e = String(entity || "").trim();
  const issues = [];
  if (e === "vuln") {
    // 严重度必填：不给就是 info，而 info 在报告里默认被过滤掉（成果漏洞只收中危以上）——
    // 也就是说「忘了给严重度」会让这条漏洞**在报告里整个消失**。
    issues.push(...validateEnum("kind（严重度）", args.kind, SEVERITIES, {
      required: true,
      fallbackHint: "不给会静默降级成 info，而报告只收中危以上——这条漏洞会整个消失",
    }));
    // status（用 stage 传）：第 136 轮实测 `stage=confirmd`（拼错）→ **静默回落 candidate**，
    // 而战报只收 confirmed/exploited，于是这条漏洞永远进不了报告，且没有任何提示。
    // 与 update 那边同一套语义（stage=状态），所以校验也放同一套枚举。
    if (args.stage !== undefined && String(args.stage).trim() !== "") {
      issues.push(...validateEnum("stage（状态）", args.stage, VULN_STATUSES, {
        fallbackHint: `拼错会静默回落 candidate，而战报只收 confirmed/exploited——这条漏洞会进不了报告`,
      }));
    }
  }
  if (e === "scorepoint" && args.value !== undefined && args.value !== "") {
    const v = Number(args.value);
    if (!Number.isFinite(v) || v < 0) issues.push(issue("value（分值）", "非负数字", args.value, "分值不是数字，会被当成没给"));
  }
  return issues;
}

/** 校验 chain_add 的阶段 */
export function validateChainAdd(args = {}) {
  // 接受新阶段码与旧阶段名（store 有 LEGACY_STAGE_MAP 把旧名映射过去，不该在这里拦掉）。
  const allowed = [...STAGES, ...LEGACY_STAGES];
  return validateEnum("stage（链路阶段）", args.stage, allowed, {
    required: false,
    fallbackHint: `写错会静默落成 recon，链路图会把这一步归错阶段；可用 ${STAGES.join("/")}（旧名 ${LEGACY_STAGES.join("/")} 也认）`,
  });
}

/* ───────────────────────── update / report 入口校验 ─────────────────────────
 * 实测缺口（第 123 轮）：
 *   · `update asset stage=testted` → **静默回落 untested**（回读才发现改错了）；
 *   · `update asset kind=urgent` → **静默回落 medium**；
 *   · `report kind=scoer`（拼错）→ **静默出战报**，人以为拿到的是得分报告；
 *   · `report limit=-5` → 静默取默认；
 *   · `update row=-1` / `row=1.7` → 报「不存在」，**是误报**：不是不存在，是行号非法。
 * 这几处的共同点是「写错了也照样干活」，而人只看回读结果，**回读正确反而是最危险的**
 * （它让人确信操作成功了）。
 */

/** 资产测试状态：与 store 的 TST 枚举对齐 */
export const ASSET_TEST_STATES = ["untested", "testing", "tested", "blocked", "abandoned", "no_surface"];
/** 资产优先级：与 store 的 PRI 枚举对齐 */
export const ASSET_PRIORITIES = ["high", "medium", "low"];

/** 行号校验：必须是正整数。负数/小数/NaN 都要说清是「非法」而不是「不存在」 */
export function validateRowId(field, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [issue(field, "正整数行号（取自 op=list）", "", "没给行号")];
  if (!/^\d+$/.test(raw)) {
    const why = /^-/.test(raw) ? "负数" : /\./.test(raw) ? "小数" : "不是整数";
    return [issue(field, "正整数行号（取自 op=list）", raw, `这是${why}——不是「行号不存在」，是行号本身不合法`)];
  }
  if (Number(raw) <= 0) return [issue(field, "正整数行号", raw, "行号从 1 开始")];
  return [];
}

/** 校验 update 的入参（按实体分派） */
export function validateUpdate(entity, args = {}) {
  const e = String(entity || "").trim();
  const issues = [];
  // 行号：只有「有行 id」的实体才需要（asset 按 ip 定位，poc 按 code）
  if (["vuln", "webshell", "tunnel"].includes(e)) {
    issues.push(...validateRowId("row", args.row));
  }
  if (e === "vuln") {
    // 严重度/状态：给了就必须合法（store 对非法枚举返回 updated:true 却什么都不改）
    if (args.kind !== undefined && String(args.kind).trim() !== "") issues.push(...validateEnum("kind（严重度）", args.kind, SEVERITIES));
    if (args.stage !== undefined && String(args.stage).trim() !== "") issues.push(...validateEnum("stage（状态）", args.stage, VULN_STATUSES));
  }
  if (e === "asset") {
    // 资产两个写入口共用 kind/stage：stage=测试状态、kind=优先级（不给 kind 时按评估走）
    if (args.stage !== undefined && String(args.stage).trim() !== "") issues.push(...validateEnum("stage（测试状态）", args.stage, ASSET_TEST_STATES));
    if (args.kind !== undefined && String(args.kind).trim() !== "") issues.push(...validateEnum("kind（优先级）", args.kind, ASSET_PRIORITIES));
  }
  return issues;
}

/** report 的 kind 只认这三种（缺省=战报） */
export const REPORT_KINDS = ["score", "targets", ""];

/** 校验 report 的入参 */
export function validateReport(args = {}) {
  const issues = [];
  const k = String(args.kind ?? "").trim().toLowerCase();
  if (k && !REPORT_KINDS.includes(k)) {
    issues.push(issue("kind（报告类型）", "score | targets | （不写＝战报 markdown）", args.kind, "写错会静默出战报，人以为拿到的是得分报告"));
  }
  if (args.limit !== undefined && args.limit !== "") {
    const n = Number(args.limit);
    if (!Number.isFinite(n) || n <= 0) issues.push(issue("limit（行数）", "正整数", args.limit, "非正数会静默取默认值 14，看到的内容与预期不符"));
  }
  return issues;
}
