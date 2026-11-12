#!/usr/bin/env node
/**
 * 用途：发版前一键自检——语法、体积预算、双语文案、清单一致性、包自证、工具面、端到端情景、弹药层审计、JSON 合法性九关一起过（替代 README 里那串手工 node --check）。
 * 用法：node scripts/verify.mjs [--root PATH] [--skip-size] [--skip write,cli] [--host <ai_base>]     # 默认跑全部关
 * 依赖：Node ≥18；内部调用 node --check 与 scripts/check-size.mjs，零第三方包。
 * 验证：2026-11-09 在 dsh-purge 实跑通过（exit=0，五关全绿：语法 / 体积 / 双语 2×328 key 零漂移 / 清单 COPY_NAMES 全覆盖 / JSON 全合法）。各关计数以实跑输出为准，不写死在注释里。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
// 收集器必须**先**声明：下面的宿主探测里就会写 failures（面判定模块读不到要报红），
// 声明放在 78 行会让那条分支落进 TDZ —— 平时不触发，一触发就是 ReferenceError（比原缺陷更糟）。
const failures = [];
const notes = [];
const rootIdx = argv.indexOf("--root");
const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// **宿主自动探测**（第 145 轮）：write-smoke / tools-smoke 需要宿主 ai_base 当拷源，
// 只认 DSH_BASE；不设就报「跳过」并按通过退出——**跳过等于这两关没跑**。
// 而本机宿主在 E: 盘，%ProgramFiles% 是 C:，写死环境变量探不到，所以这里主动探一次，
// 并显式 env 传给子进程（spawnSync 默认继承 process.env，但探测结果要写回才生效）。
{
  const cands = [];
  // `--host <ai_base>`：宿主装在非常规位置（不在 Get-Process 路径、也不在 E:/D: Program Files）时
  // 唯一的出路。不设 DSH_BASE 而探测又落空 → 两关冒烟只会红，用户却没有入口，这条参数就是那个入口。
  const hostIdx = argv.indexOf("--host");
  if (hostIdx >= 0) {
    const given = String(argv[hostIdx + 1] || "").trim();
    if (!given) failures.push("--host 后面没有给路径（用法：--host \"X:/路径/resources/app/dsh/node_modules/@deepseek-ai\"）");
    else if (!fs.existsSync(given)) failures.push(`--host 指向不存在的路径：${given}`);
    else process.env.DSH_BASE = given;
  }
  try {
    const out = spawnSync("powershell", ["-NoProfile", "-Command",
      "(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], { encoding: "utf8", timeout: 8000 });
    const exePath = String(out.stdout || "").trim();
    if (exePath) {
      const resDir = path.join(path.dirname(exePath), "resources");
      cands.push(path.join(resDir, "app", "dsh", "node_modules", "@deepseek-ai"));
    }
  } catch { /* 进程查不到就走常见位置 */ }
  for (const r of [process.env.ProgramFiles, "E:\\Program Files", "D:\\Program Files"]) {
    if (!r) continue;
    cands.push(path.join(r, "harness", "resources", "app", "dsh", "node_modules", "@deepseek-ai"));
  }
  const hit = cands.find((x) => { try { return fs.existsSync(x); } catch { return false; } });
  if (hit && !process.env.DSH_BASE) process.env.DSH_BASE = hit;
  // 面也要跟着宿主走：ai_base 在 resources/app/dsh/ 下，但 detectSurface() 在没有桌面进程特征的
  // node 子进程里判成非桌面 → gatherState 取不到 ai_base → write-smoke / tools-smoke 静默「跳过」，
  // 包自证那边 targetFiles 也会假缩水（实测 56 → 52）。设一次，子进程继承。
  try {
    const { adoptSurfaceForAiBase } = await import("../lib/surface.js");
    adoptSurfaceForAiBase(process.env.DSH_BASE);
  } catch (e) {
    // **不许空 catch**（第 150 轮）：导入失败会让面判定停在 web，接着两关冒烟「跳过」、
    // 包自证「映射 52 键」——现象全指向宿主，真凶却在这里。失败本身必须报出来。
    failures.push(`面判定模块读不到（lib/surface.js）：${String(e && e.message || e).slice(0, 90)}｜后果：桌面宿主会被判成 web，冒烟与包自证一起缩水`);
  }
}
const skipSize = argv.includes("--skip-size");
// 按名点跳：--skip write,cli（名字取自下面各关的短名）。
// 为什么需要它：实测 22.1 秒里 write-smoke 一门占 14.4 秒（65%），迭代时想只看其余关就得有这个旋钮；
// 而旧参数 --skip-size 其实是「除语法外全跳」，名字说一件事、做另一件 —— 保留兼容，但新用法以 --skip 为准。
const skipSet = new Set((argv[argv.indexOf("--skip") + 1] || process.env.DSH_VERIFY_SKIP || "").split(",").map((x) => String(x).trim().toLowerCase()).filter(Boolean));
const skip = (name) => skipSize || skipSet.has(name);
// **「跳过」不是通过**（第 148 轮）：子进程用 exit 2 表示「这一关没跑」；禁止再出现「带病绿」。
// 返回三态字符串，别用布尔：exit 3（本关在当前宿主形态下不适用，例：密封 asar 没有解包源树）
// 既不是失败也不是通过 —— 只记 note，绝不写 ✓。布尔返回值上一次就因此把「不适用」又判成了失败。
const gateVerdict = (status, out, name) => {
  const last = (out[out.length - 1] || "").trim();
  if (status === 3) { notes.push(`${name}：不适用——${last.replace(/^[^：]*：/, "").slice(0, 110)}`); return "na"; }
  if (status === 2) { failures.push(`${name}：未跑（本机找不到宿主 ai_base；跳过不是通过）`); return "fail"; }
  if (status === 0 && /跳过|未跑/.test(last)) { failures.push(`${name}：未跑——${last.slice(0, 110)}`); return "fail"; }
  return "run";
};
if (argv.includes("--skip") && !argv[argv.indexOf("--skip") + 1]) {
  console.log("--skip 需要名单，例如：node scripts/verify.mjs --skip write,cli（可用：size,locale,manifest,package,tools,scenario,ammo,hygiene,cli,write,json）");
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// 关 1：语法。逐个 node --check，失败即记文件名（不中断，一次看全）。
const files = walk(root);
for (const file of files) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) {
    failures.push(`语法 ${path.relative(root, file)}: ${(res.stderr || "").split("\n")[0]}`);
  }
}
notes.push(`语法：${files.length} 个文件，失败 ${failures.length}`);

// 关 2：体积预算（交给 check-size.mjs，单一来源，不在这儿重写规则）。
if (!skip("size")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-size.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").pop() || "";
  if (res.status !== 0) failures.push(`体积闸门未过：${tail}`);
  else notes.push(`体积：${tail}`);
}

// 关 3：双语文案——① client.js 里中英两块 key 必须一模一样；② locale 源 JSON 与内联块不许静默分叉。
// 第 ② 条是探针总表（scripts/probe-gates.mjs）发现的洞：build-locale --check 早就存在，但没接进闸门，
// 改了 locale/zh.json 忘了 npm run build:locale 时，八关照样全绿 —— 门禁在管的东西必须被调用才算数。
if (!skip("locale")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-locale.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`双语闸门未过：${(res.stderr || tail).trim().split("\n")[0]}`);
  else notes.push(`双语：${tail.replace(/^双语闸门：/, "")}`);
  const res2 = spawnSync(process.execPath, [path.join(root, "scripts", "build-locale.mjs"), "--check"], { encoding: "utf8" });
  const tail2 = (res2.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res2.status !== 0) failures.push(`locale 源与内联块分叉：${(res2.stderr || tail2).trim().split("\n")[0]}｜跑 npm run build:locale`);
  else notes.push(`源↔内联：${tail2.replace(/^双语源→内联：/, "")}`);
}

// 关 4：清单一致性——COPY_NAMES（自更新拷贝清单）与 files（发布白名单）不许分叉。
if (!skip("manifest")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-manifest.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`清单闸门未过：${(res.stderr || head).trim().split("\n")[0]}`);
  else notes.push(`清单：${head.replace(/^清单闸门：/, "")}`);
}

// 关 5：包自证——manifest 口径与全仓数量声明（交给 check-package.mjs，真相取自 lib/core.js）。
if (!skip("package")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-package.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`包自证未过：${(res.stderr || head).trim().split("\n").slice(-1)[0]}`);
  else notes.push(`包自证：${head.replace(/^包自证：/, "")}`);
}

// 关 6：工具面闸门——结构 + 描述成本 + 返回值成本 + op/entity 可发现性。
if (!skip("tools")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-tools.mjs")], { encoding: "utf8" });
  const head = (res.stdout || "").trim().split("\n").filter(Boolean)[0] || "";
  if (res.status !== 0) failures.push(`工具面闸门未过：${(res.stderr || head).trim().split("\n").slice(-1)[0]}`);
  else notes.push(`工具面：${head.replace(/^工具面闸门：/, "")}`);
}

// 关 7：端到端情景——把 drill 的 18 个 op 串成一条真实流程逐步断言回读（组合期最容易出「说谎的回读」）。
if (!skip("scenario")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "scenario-drill.mjs")], { encoding: "utf8" });
  const tail = (res.stdout || "").trim().split("\n").filter(Boolean);
  const v3 = gateVerdict(res.status, tail, "情景测试");
  if (v3 === "na") { /* 不适用，已记 note */ }
  else if (res.status !== 0) {
    const bad = (res.stdout || "").split("\n").filter((l) => l.includes("✗")).slice(0, 3).join(" / ");
    failures.push(`情景测试未过：${bad || (tail.slice(-1)[0] || "") || (res.stderr || "").trim().split("\n")[0]}`);
  } else notes.push(`情景：${(tail.slice(-1)[0] || "").replace(/^情景测试：/, "")}`);
}

// 关 9：弹药层一致性——技能正文引用的工具名、条令点名的技能，都必须真实存在（引用不存在的名字 = 模型照做就撞空）。
if (!skip("ammo")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "audit-skills.mjs")], { encoding: "utf8" });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split("\n");
  if (res.status !== 0) {
    failures.push(`弹药层审计未过：${out.slice(1, 3).map((l) => l.trim()).join(" / ").slice(0, 160) || out[0]}`);
  } else notes.push(`弹药层：${(out[0] || "").replace(/^弹药层审计：/, "")}｜${(out[1] || "").trim()}｜${(out[2] || "").trim()}`);
}

// 关 10：磁盘卫生模块的夹具自测（阈值边界得有人看着：保留 2 份、孤儿 >5、坏 JSON 不许静默跳过）。
if (!skip("hygiene")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "hygiene-selftest.mjs")], { encoding: "utf8" });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split("\n");
  if (res.status !== 0) {
    failures.push(`卫生夹具未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}

// 关 11：CLI 冒烟——真跑 bin 的只读模式（此前十关没有一关执行过 CLI 分发，改坏 bin 也可能全绿）。
if (!skip("cli")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "cli-smoke.mjs")], { encoding: "utf8" });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  if (res.status !== 0) {
    failures.push(`CLI 冒烟未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}
// 关 12：写路径冒烟——apply/revert 往返（此前没有任何一关执行过写路径；它也是唯一能抓到 revert 不对称的关）。
//   exit 2 = 本机没宿主、这一关没跑；「跳过」按失败处理，不再带病绿。
if (!skip("write")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "write-smoke.mjs")], { encoding: "utf8", timeout: 300000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  const v1 = gateVerdict(res.status, out, "写路径冒烟");
  if (v1 === "na") { /* 不适用，已记 note */ }
  else if (res.status !== 0) {
    failures.push(`写路径冒烟未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}
// 关 13：工具层冒烟——真跑 purge_apply / purge_revert（mutating 的工具分支此前没有一关执行过）。
//   注意 skip 名是 toolsmoke：关 6 已用 "tools"，同名会让 `--skip tools` 一次关掉两关（审阅抓到的碰撞）。
if (!skip("toolsmoke")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "tools-smoke.mjs")], { encoding: "utf8", timeout: 180000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  const v2 = gateVerdict(res.status, out, "工具层冒烟");
  if (v2 === "na") { /* 不适用，已记 note */ }
  else if (res.status !== 0) {
    failures.push(`工具层冒烟未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 150) || out[out.length - 1]}`);
  } else notes.push((out[out.length - 1] || "").trim());
}

// 关 14：纸面功夫——每个引用了「本机没装」的工具的技能，都必须自带「本机可执行性」块。
//   为什么单独成关：技能厚不等于打得出去。实测 114 个里有 33 个引用了本机没有的工具，
//   其中 9 个连一个字都没说——模型照抄命令就撞空。这关保证「落差一定写在技能自己的上下文里」。
if (!skip("runnable")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "inject-runnability.mjs"), "--check"], { encoding: "utf8", timeout: 120000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/);
  if (res.status !== 0) failures.push(`纸面功夫未过：${out.filter((l) => l.trim()).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 130)}`);
  else notes.push((out[out.length - 1] || "").trim());
}

// 关 15：技能构建流水线自检——标题层级 / 本机可执行性 / 第二发 三项一起校验。
//   为什么成关：技能「厚」不等于「能打」也不等于「结构清楚」。第 111 轮实测三条落差：
//   77 个技能有多个 H1（结构被压平）、33 个引用了本机没装的工具（其中 9 个一字未提）、
//   只有 9 个同时具备失败分支小节与 ≥2 条分支。这三项都得有人看着，否则会慢慢退回去。
//   （链路层的产物一致性不在这儿管，由 audit-skills 的链路层那一关负责。）
if (!skip("skillsbuild")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "build-skills.mjs"), "--check"], { encoding: "utf8", timeout: 180000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/).filter((l) => l.trim());
  if (res.status !== 0) failures.push(`技能流水线未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 130)}`);
  else notes.push(out[out.length - 1].trim());
}

// 关 16：范围闸自测——越界打靶不是技术问题，是事故。
//   实测缺口：靶标授权 203.0.113.0/24 时，落 198.51.100.9 的资产与漏洞都能静默写进去。
//   这关同时钉两层：判定机制本身（排除项优先 / CIDR 不跨界 / 判不了即不过）
//   与「拦截真的发生在写入路径上」（函数对但没接上，是这类改动最常见的假成功）。
if (!skip("scopegate")) {
  const res = spawnSync(process.execPath, [path.join(root, "scripts", "check-scope-gate.mjs")], { encoding: "utf8", timeout: 120000 });
  const out = ((res.stdout || "") + (res.stderr || "")).trim().split(/[\r\n]+/).filter((l) => l.trim() && !/ExperimentalWarning|trace-warnings/.test(l));
  if (res.status !== 0) failures.push(`范围闸未过：${out.filter((l) => l.includes("✗")).slice(0, 2).map((l) => l.trim()).join(" / ").slice(0, 130)}`);
  else notes.push(out[0].trim());
}

// 关 8：JSON 合法性——package.json / screenshots / locale 文案源 / 图谱语义层手写件。
const jsons = ["package.json", "screenshots.json", "locale/zh.json", "locale/en.json", "docs/debt-baseline.json"]
  .filter((f) => fs.existsSync(path.join(root, f)))
  .concat(fs.readdirSync(path.join(root, "graphify-out", "semantic")).filter((f) => f.endsWith(".json")).map((f) => `graphify-out/semantic/${f}`));
let parsed = 0;
for (const rel of jsons) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    parsed += 1;
  } catch (e) {
    failures.push(`JSON ${rel}: ${e.message}`);
  }
}
notes.push(`JSON：${parsed}/${jsons.length} 合法`);

for (const line of notes) process.stdout.write(`  ${line}\n`);
for (const line of failures) process.stderr.write(`  ✗ ${line}\n`);
// 已知偶发标注：闸门红的时候，人第一件要判断的是「这是新问题还是老 flake」。
// 以前这个判断全靠人肉查 docs/debt-baseline.json——连续三轮我都得手查一遍才算数。
// 现在直接标出来：命中基线里的已知偶发项就明说，并给出「再跑一次确认」的具体命令。
// 注意：**标注不等于放过**——退出码仍然是 1，因为偶发也可能是真问题恰好撞上，
// 只有人能决定「再跑一次」还是「动手查」。
// 顺序要紧：标注必须打在 `[verify] 未通过` **之前**，否则人先读到结论再看解释，
// 中间那行"已知偶发"就容易被跳过（实测第一版就是这个顺序）。
const knownFlakes = [];
if (failures.length) {
  try {
    const debtPath = path.join(root, "docs", "debt-baseline.json");
    const debt = JSON.parse(fs.readFileSync(debtPath, "utf8"));
    const KNOWN = [
      { match: /写路径冒烟未过/, key: "gate12", label: "写路径冒烟（双次 apply 幂等）" },
    ];
    for (const k of KNOWN) {
      if (!failures.some((f) => k.match.test(f))) continue;
      const d = debt[k.key] || {};
      // redSample 形如 "1/18"：直接把分子分母算成百分比，别让人自己除
      let rate = String(d.redSample || d.note || "");
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(rate);
      if (m) rate = `${rate}（≈${Math.round((Number(m[1]) / Number(m[2])) * 100)}%）`;
      knownFlakes.push(`  ⓘ 「${k.label}」是**已知偶发**：${rate.slice(0, 130)}`);
      knownFlakes.push(`     先复跑确认：node scripts/verify.mjs（连绿 3 次即 flake，红就动手查）`);
    }
  } catch { /* 基线读不到就不标，不影响退出码 */ }
}
for (const line of knownFlakes) process.stderr.write(`${line}\n`);
// 失败时全部走 stderr：stdout/stderr 是两条流，合并（2>&1）后顺序由缓冲决定，
// 实测会出现「[verify] 未通过」夹在 ✗ 与 ⓘ 之间——**结论跑到解释前面**，
// 那行「已知偶发」就容易被跳过。同一流里顺序才是确定的。
if (failures.length) process.stderr.write(`[verify] 未通过：${failures.length} 项\n`);
else process.stdout.write("[verify] 全部通过 ✓\n");
process.exit(failures.length ? 1 : 0);
