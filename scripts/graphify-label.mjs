#!/usr/bin/env node
/**
 * 用途：用本机 OpenAI 兼容端点给 graphify 社区命名（`graphify label` 的配置外壳）。
 * 用法：npm run graphify:label [-- --missing-only]
 *
 * 为什么要这层壳：graphify 的 LLM 凭据**只认环境变量**（llm.py 里
 * OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL），没有配置文件支持——
 * .graphifyrc 只管 query_budget / query_depth 这类查询参数。
 * 于是每次跑 label 都要重敲一长串 env，敲错一个变量名就静默退回占位符。
 *
 * 凭据落在 .cache/graphify-llm.json（.cache/ 已 gitignore，不入库）。
 *
 * 两个实测坑，这层壳顺手兜住：
 *   ① 模型（ernie-5.5-flash-preview:free）把预算先花在 reasoning 上：
 *      max_tokens 给 60 会出现 finish_reason=length、content=null，
 *      graphify 判成 "label response is not parseable JSON: ''"。
 *      graphify 内部默认 16384，够用；我们自己直连接口时要给足 2000+。
 *   ② 免费端点偶发空返回，且并发稍高就更容易空。graphify label 一次没命中的
 *      社区会回写「结构兜底名」（hub 文件名），看着像成功、实际没命名。
 *      所以默认 --max-concurrency=1 并允许重试若干轮，直到占位符/文件名残留为 0。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = path.join(root, ".cache", "graphify-llm.json");

if (!fs.existsSync(cfgPath)) {
  console.error(`[graphify-label] 缺少凭据文件：${cfgPath}`);
  console.error(`  格式：{ "baseUrl": "...", "apiKey": "...", "model": "..." }`);
  process.exit(1);
}
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
} catch (e) {
  console.error(`[graphify-label] 凭据文件不是合法 JSON：${String(e.message).slice(0, 80)}`);
  process.exit(1);
}
for (const k of ["baseUrl", "apiKey", "model"]) {
  if (!cfg[k]) { console.error(`[graphify-label] 凭据缺字段 ${k}`); process.exit(1); }
}

const passthrough = process.argv.slice(2);
let missingOnly = passthrough.includes("--missing-only");
const extra = passthrough.filter((a) => a !== "--missing-only");
const maxConcurrency = String(cfg.maxConcurrency ?? 1);
const batchSize = String(cfg.batchSize ?? 4);

const env = {
  ...process.env,
  OPENAI_BASE_URL: cfg.baseUrl,
  OPENAI_API_KEY: cfg.apiKey,
  OPENAI_MODEL: cfg.model,
  GRAPHIFY_OPENAI_MODEL: cfg.model,
};

const labelsPath = path.join(root, "graphify-out", ".graphify_labels.json");
/** 数一遍还剩多少社区没被语义化命名（占位符或 hub 文件名都算没命名） */
const pendingCount = () => {
  try {
    const l = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
    const total = Object.keys(l).length;
    const bad = Object.entries(l).filter(([, v]) => /^Community \d+/.test(String(v)) || /\.(js|mjs|md|json|yml|sh)$/.test(String(v))).length;
    return { total, bad };
  } catch { return { total: 0, bad: 0 }; }
};

const runLabel = () => {
  const args = ["label", ".", "--backend=openai", `--model=${cfg.model}`,
    `--max-concurrency=${maxConcurrency}`, `--batch-size=${batchSize}`,
    ...(missingOnly ? ["--missing-only"] : []), ...extra];
  const res = spawnSync("graphify", args, { cwd: root, env, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const out = `${res.stdout || ""}\n${res.stderr || ""}`;
  const labeled = /labeled (\d+) of (\d+)/.exec(out);
  const done = /Done - (\d+) communities/.exec(out);
  return { ok: res.status === 0, out, labeled, done };
};

console.log(`[graphify-label] ${cfg.model} @ ${cfg.baseUrl}｜并发 ${maxConcurrency}｜批 ${batchSize}`);
let rounds = 0;
const MAX_ROUNDS = 5;
let last = null;
while (rounds < MAX_ROUNDS) {
  rounds += 1;
  const r = runLabel();
  last = r;
  if (!r.ok) {
    const tail = r.out.trim().split("\n").slice(-3).join(" / ");
    console.error(`[graphify-label] 第 ${rounds} 轮失败：${tail}`);
    break;
  }
  const { bad } = pendingCount();
  const msg = r.labeled ? `labeled ${r.labeled[1]}/${r.labeled[2]}` : "";
  console.log(`  轮 ${rounds}：${msg || "已无待命名"}｜未语义化剩 ${bad}`);
  if (bad === 0) break;
  if (!missingOnly && rounds === 1) {
    // 全量轮跑完还有残留，后续轮转成增量，避免重复给已命名的社区花钱
    console.log("  → 转增量模式补跑剩余");
    missingOnly = true;
  }
}

const { total, bad } = pendingCount();
if (bad === 0) {
  console.log(`[graphify-label] 完成：${total}/${total} 社区全部语义化`);
} else {
  console.log(`[graphify-label] 结束：${total - bad}/${total} 已命名，剩 ${bad} 个仍为兜底名`);
  if (last?.out) {
    const fails = last.out.split("\n").filter((l) => l.includes("failed")).slice(0, 3);
    for (const f of fails) console.log(`  · ${f.trim()}`);
  }
  process.exit(1);
}