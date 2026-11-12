/**
 * 反向语义验证：条款对「明确指令」与「模糊指令」必须给出**不同**的行为要求。
 *
 * 为什么需要它（而不是只查关键词在不在）：真实风险不是"条款缺失"，而是
 * **条款对两种场景一视同仁**——那会导致要么全都问（啰嗦），要么全都不问（回到原病）。
 * 关键词闸门抓不到这种「都写了但没区分」的失效。
 *
 * 做法：把确认条款按「会歪 / 不会歪」两类行为抽成两个判据集合，要求：
 *   ① 两类行为**同时存在**（否则只覆盖了一半场景）
 *   ② 两类行为指向**相反动作**（一个停、一个不停），且各自绑定了触发条件
 *   ③ 存在**判断标准**（"会不会走岔路"），否则模型无法自己分类
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

function extractBlock(text, heads) {
  const start = Math.max(...heads.map((h) => text.lastIndexOf(h)));
  if (!Number.isFinite(start) || start < 0) return "";
  const rest = text.slice(start);
  const bounds = [rest.search(/\n\*\*汇报讲结果/), rest.search(/\n\*\*五个阶段/)].filter((i) => i > 0);
  return bounds.length ? rest.slice(0, Math.min(...bounds)) : rest.slice(0, 1600);
}

function judge(fp, label) {
  let text = "";
  try { text = fs.readFileSync(fp, "utf8"); } catch { return; }
  const block = extractBlock(text, ["开工前一句话", "听懂长官的话"]);
  if (!block) { problems.push(`${label}：抽不到确认条款`); return; }

  /* ① 触发条件必须是「会不会歪」，不是别的。缺了它模型只能全问或全不问。 */
  const hasCriterion = /会不会打歪|会不会走岔路|会走岔路|方向歧义/.test(block);
  if (!hasCriterion) problems.push(`${label}：没有触发条件（会不会打歪）—— 模型无法自己分类，只能全问或全不问`);

  /* ② 「会歪 → 停」这一支必须存在：复述 + 停/等 */
  const hasStop = /停|等一句|等 YG/.test(block) && /复述/.test(block);
  if (!hasStop) problems.push(`${label}：「会歪就停」这一支缺失（复述 + 停下等确认）`);

  /* ③ 「不会歪 → 直打」这一支必须存在，且要明确不许反问。
     这一段必须绑定「条件 + 动作」在同一句/同一行里判，不能全块 includes：
     反向探针实测，删掉整支后 `直接打` 这个词仍残留在别处，全块匹配照样全绿——闸门形同虚设。 */
  const lines = block.split("\n");
  const stopBranch = lines.some((l) => /(会歪|走岔路|方向歧义)/.test(l) && /(停|等一句|等 YG)/.test(l) && /复述/.test(l));
  const goBranch = lines.some((l) => /(不会歪|明确指令|已点名|已经点名)/.test(l) && /(直接打|直打|紧跟|就开火|然后开火)/.test(l));
  if (!stopBranch) problems.push(`${label}：「会歪就停」缺**同一行内的条件+动作**（只有零散关键词，模型读不出因果）`);
  if (!goBranch) problems.push(`${label}：「不会歪就直打」缺**同一行内的条件+动作** —— 会退化成每件事都问`);
  const hasGo = goBranch && /不许反问|不停/.test(block);
  if (goBranch && !/不许反问|不停/.test(block)) problems.push(`${label}：直打支缺「不许反问/不停」 —— 模型仍会先问一句`);

  /* ④ 两支必须指向相反动作。都要求停 = 全啰嗦；都要求打 = 回到原病。 */
  if (hasStop && hasGo) {
    // 「停」只许出现在会歪那一支附近；若全局只有停没有打，或反之，说明没区分
    const stopCount = (block.match(/等一句|停下等|等 YG/g) || []).length;
    const goCount = (block.match(/直接打|直打|紧跟|就开火/g) || []).length;
    if (stopCount === 0) problems.push(`${label}：条款里没有任何「停」—— 模糊指令会被直接开打（回到原病）`);
    if (goCount === 0) problems.push(`${label}：条款里没有任何「直接打」—— 明确指令也会被拦下问（新病：啰嗦）`);
  }

  /* ⑤ 只问一次的上限：没有它，模型会在中途反复请示 */
  if (!/唯一一次|只(问|对第)一次|不再问|中途不问/.test(block)) {
    problems.push(`${label}：缺「只问一次」上限 —— 会反复确认`);
  }

  /* ⑥ 缺细节与方向歧义必须分开（否则缺端口也要问） */
  if (!/缺细节|缺端口|缺路径|缺字典/.test(block)) {
    problems.push(`${label}：缺「缺细节不问」 —— 缺参数也会被当成该问的事`);
  }

  const chars = [...block].length;
  notes.push(`${label}：${chars} 字｜会歪→停 ✓｜不会歪→直打 ✓｜判断标准 ✓｜只问一次 ✓`);
}

judge(path.join(root, "lib", "default-prompt-inject.md"), "出厂默认");
const userFp = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || "", ".dsh"), "prompt-inject.md");
if (fs.existsSync(userFp)) judge(userFp, "用户注入");
else notes.push("用户注入：不存在（出厂默认兜底）");

console.log("反向语义验证：两种场景必须给出相反动作");
for (const n of notes) console.log(`  · ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(problems.length ? 1 : 0);