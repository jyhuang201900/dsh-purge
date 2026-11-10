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
