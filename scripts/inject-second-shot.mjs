#!/usr/bin/env node
/**
 * 用途：给「只有怎么打、没有打不出去怎么办」的技能生成一节「第二发」。
 * 用法：node scripts/inject-second-shot.mjs [--dry] [--check]
 * 依赖：Node ≥18；只读链路产物 + 技能正文，不联网。
 *
 * 为什么需要它：军规要求每发至少两条失败分支，但实测 114 个技能里只有 9 个同时具备
 * 「失败分支小节 + ≥2 行分支表述」——**多数技能只写怎么打一次，没写打不出去怎么改打**。
 * 只教一招的技能，遇到一次失败就让模型换个技能或干脆放弃，这正是「弱」的来源。
 *
 * 为什么不手写：105 个技能手写失败分支就是 slop（重复、走样、维护不动），而且YT 的规矩是
 * 「不要自己造轮子」。**链路里本来就有替代关系**——relation 表里的 complementary（同类替代）、
 * specializes（同主题更深的靶子面）、upstream（前提没满足就先回去），所以这一节由链路生成：
 * 每个技能拿到的替代清单都不一样，是**具体**的，不是套话。
 *
 * 只在「本来没有失败分支小节」的技能上追加（46 个），已有小节的 68 个不动——避免与作者原文打架。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
// 判据与闸门共用一份（scripts/lib/skill-quality.mjs）：只写个「兜底」标题不算作者已写分支
import { countBranches } from "./lib/skill-quality.mjs";

const dry = process.argv.includes("--dry");
const checkOnly = process.argv.includes("--check");
const root = process.cwd();
const SKILLS = path.join(root, "skills", "redteam");
const START = "<!-- second-shot:start";
const END = "second-shot:end -->";
const HEAD = /^#{2,4}\s*.*(失败分支|第二发|打不出去|被拦|无回显|退路|兜底|不成立时|不通时|失败了|注意事项|常见坑)/m;

const idx = JSON.parse(fs.readFileSync(path.join(root, "lib", "generated", "skills-index.json"), "utf8"));
const rel = JSON.parse(fs.readFileSync(path.join(root, "lib", "generated", "skills-relations.json"), "utf8"));
const byId = new Map(idx.skills.map((s) => [s.id, s]));
const names = new Set(idx.skills.map((s) => s.id));

/** 从关系表取该技能的各类邻居 */
function neighbors(id) {
  const comp = new Set(), spec = new Set(), up = new Set();
  for (const r of rel.relations) {
    if (r.relationship === "complementary") {
      if (r.source === id) comp.add(r.target);
      else if (r.target === id) comp.add(r.source);
    } else if (r.relationship === "specializes" && r.source === id) spec.add(r.target);
    else if (r.relationship === "next" && r.target === id) up.add(r.source);
  }
  comp.delete(id); spec.delete(id); up.delete(id);
  return { comp: [...comp].filter((x) => names.has(x)), spec: [...spec].filter((x) => names.has(x)), up: [...up].filter((x) => names.has(x)) };
}

const q = String.fromCharCode(96);
const S = (x) => q + x + q;

function render(id) {
  const s = byId.get(id);
  if (!s) return "";
  const { comp, spec, up } = neighbors(id);
  // 方向歧义的邻居不当「前提」用：既在 up 又在 down 的（例如 credential-attack 与 netexec-scan
  // 互为上下游——从它拿凭据、又用它验证），说「回去做它」与「下一步交给它」会互相打架。
  const down = new Set(rel.relations.filter((r) => r.relationship === "next" && r.source === id).map((r) => r.target));
  const cleanUp = up.filter((x) => !down.has(x));
  const L = [START + " scripts/inject-second-shot.mjs 生成，勿手改 -->", "", "## 第二发（主力打不出去时，按这个顺序换）"];
  let n = 0;
  if (comp.length) { n += 1; L.push("", `${n}. **同类替代**（链路里的互补技能，手法最接近）：${comp.slice(0, 4).map(S).join("、")}`); }
  if (s.stage !== "1" && cleanUp.length) { n += 1; L.push("", `${n}. **前提没满足就先回去**：${cleanUp.slice(0, 3).map(S).join("、")} —— 上一环没做实，本环再试也是空打`); }
  const generic = ["oob-verification", "waf-bypass"].filter((x) => names.has(x) && x !== id);
  if (generic.length) { n += 1; L.push("", `${n}. **无回显 / 被拦**：先用 ${S("oob-verification")} 确认是不是真没打进去（没回显 ≠ 没命中）；确认被 WAF 拦就转 ${S("waf-bypass")}`); }
  if (spec.length) { n += 1; L.push("", `${n}. **目标比预期更深**：换到同主题的专项靶子面 ${spec.slice(0, 3).map(S).join("、")}`); }
  L.push("", `**纪律**：同一手法不许连打三次（第一次是验证、第二次换参数、第三次必须换手法）；换完还不动，就**如实回报**试过哪几条、各自现象是什么——这是下一次改打的依据，不是失败。`);
  L.push("", END);
  return L.join("\n");
}

const files = fs.readdirSync(SKILLS).filter((f) => f.endsWith(".md"));
let written = 0, skipped = 0;
const missing = [];
for (const f of files) {
  const id = f.replace(/\.md$/, "");
  const p = path.join(SKILLS, f);
  let t = fs.readFileSync(p, "utf8");
  const s = t.indexOf(START), e = t.indexOf(END);
  const stripped = (s >= 0 && e > s) ? (t.slice(0, s).replace(/\s+$/, "") + "\n\n" + t.slice(e + END.length).replace(/^[\r\n]+/, "")).replace(/\s+$/, "") : t;
  // 与闸门同一判据：作者那节真的写到 ≥2 条分支才跳过，只写了个"兜底"标题不算（第 111 轮踩过）
  const hasOwn = countBranches(stripped).branches >= 2;
  if (hasOwn) {
    skipped += 1;
    if (checkOnly && s >= 0) missing.push(id + "（已有作者写的失败分支，却还挂着生成块）");
    if (s >= 0 && e > s && !dry) fs.writeFileSync(p, stripped, "utf8");
    continue;
  }
  const block = render(id);
  if (!block) { skipped += 1; continue; }
  if (checkOnly) { if (!(s >= 0 && e > s)) missing.push(id); continue; }
  const next = stripped.replace(/[ \t]+$/, "") + "\n\n" + block + "\n";
  if (next !== t) { if (!dry) fs.writeFileSync(p, next, "utf8"); written += 1; }
}

if (checkOnly) {
  if (missing.length) { console.log(`  有 ${missing.length} 个技能缺「第二发」块：${missing.slice(0, 8).join(", ")}`); process.exit(1); }
  console.log("  所有该带「第二发」的技能都带了 ✓");
  process.exit(0);
}
console.log(`第二发：写入/更新 ${written} 个技能｜作者已写失败分支、跳过 ${skipped} 个${dry ? "（--dry 未写盘）" : ""}`);
