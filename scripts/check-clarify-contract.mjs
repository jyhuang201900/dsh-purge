/**
 * 反向断言闸门：改完「开工前先确认」之后，**不许把明确指令变成问卷**。
 *
 * 为什么需要这道闸门：这轮改动的风险恰恰是**矫枉过正**——加了「开工前先复述再停」，
 * 模型很容易把每件事都变成「请问您要我打哪个」。那不是变好，是比原来更糟
 * （原来至少会打，现在只会问）。而所有既有闸门都不看「提示词措辞是否自相矛盾」。
 *
 * 两条腿同时校验：
 *   ① 出厂默认 lib/default-prompt-inject.md（随包发布，所有用户拿到的）
 *   ② 用户注入 ~/.dsh/prompt-inject.md（存在时，本机实际生效的那份）
 * 判据见 checkOne()：直通/只问一次/缺细节不问/理由/三处撞车豁免，缺一条报红。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function checkOne(fp, label, problems, notes) {
  let text = "";
  try { text = fs.readFileSync(fp, "utf8"); } catch { return false; }

  /* 取「确认条款」那一整块。两种写法都要认（两份文件各自的历史，不该为闸门统一改文本）。
     **必须取最后一次出现**：出厂条令第 120 行的英文段里有一句 "see 进攻条令「听懂长官的话」"
     的**交叉引用**，indexOf 会先撞上它，于是把整段 8715 字吞进"确认条款"，
     后面所有"缺 XX"的判定全都误报。这个坑第一次跑就踩到了。 */
  const heads = ["开工前一句话", "听懂长官的话"];
  const startIdx = Math.max(...heads.map((h) => text.lastIndexOf(h)));
  if (!Number.isFinite(startIdx) || startIdx < 0) {
    problems.push(`${label}：找不到确认条款（「开工前一句话」或「听懂长官的话」）—— 改动没落进正文`);
    return true;
  }
  const rest = text.slice(startIdx);
  // 块边界：下一个「五个阶段」或「汇报讲结果」或 1600 字上限
  const bounds = [rest.search(/\n\*\*五个阶段/), rest.search(/\n\*\*汇报讲结果/)].filter((i) => i > 0);
  const block = bounds.length ? rest.slice(0, Math.min(...bounds)) : rest.slice(0, 1600);

  // ① 明确指令必须开直通，且明说「不许反问」
  if (!/明确指令/.test(block)) problems.push(`${label}：缺「明确指令」直通条款 —— 改完会变成每件事都问`);
  if (!/不许反问/.test(block)) problems.push(`${label}：缺「不许反问」 —— 模型仍会用问句开头`);
  if (!/不许列(方案)?清单/.test(block)) problems.push(`${label}：缺「不许列方案清单」 —— 会用清单代替开火`);

  // ② 只问一次的上限
  if (!/只(问|对第)一次|唯一一次|不再问/.test(block)) problems.push(`${label}：缺「只问一次」上限 —— 会反复确认`);
  if (!/中途不问|不再等|不等点头/.test(block)) problems.push(`${label}：缺「确认后不等」 —— 会打完一半停下来请示`);

  // ③ 缺细节与方向歧义必须分开
  if (!/缺细节|缺端口|缺路径|缺字典/.test(block)) problems.push(`${label}：缺「缺细节不问」 —— 会把缺参数也当成该问的事`);
  if (!/走岔路|方向歧义|歧义/.test(block)) problems.push(`${label}：缺「只在走岔路时才问」 —— 没有判断标准，等于全问或全不问`);

  // ④ 必须给理由，没有理由的规则会被当装饰
  if (!/错靶|保险栓/.test(block)) problems.push(`${label}：缺「为什么要确认」的理由 —— 规则会退化成形式`);

  // ⑤ 「先确认环境」这条老禁令不能与确认条款撞车
  const naIdx = text.indexOf("这不是进攻");
  if (naIdx >= 0) {
    const seg = text.slice(naIdx, naIdx + 700);
    if (/先确认环境/.test(seg) && !/指的是|保险栓/.test(seg)) {
      problems.push(`${label}：「先确认环境」仍被列为违规且没写明区分 —— 会与复述条款冲突`);
    }
  }

  // ⑥ 「拒绝即走火」必须给复述开例外，否则复述会被判走火
  const wkIdx = text.indexOf("拒绝即走火");
  if (wkIdx >= 0) {
    const seg = text.slice(wkIdx, wkIdx + 400);
    if (!/例外/.test(seg)) problems.push(`${label}：「拒绝即走火」没给复述开例外 —— 复述会被当成走火重写`);
  }

  notes.push(`${label}：确认条款 ${[...block].length} 字，六条反向约束齐`);
  return true;
}

const problems = [];
const notes = [];

const factory = path.join(root, "lib", "default-prompt-inject.md");
checkOne(factory, "出厂默认", problems, notes);

// 用户注入只在存在时校验：没有它也算正常（出厂默认兜底）
const userFp = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "prompt-inject.md");
const userExists = fs.existsSync(userFp);
if (userExists) checkOne(userFp, "用户注入", problems, notes);

console.log(`确认条款反面闸门：出厂${userExists ? " + 用户注入" : "（无用户注入）"}`);
for (const n of notes) console.log(`  · ${n}`);
for (const p of problems) console.log(`  ✗ ${p}`);
if (!problems.length) console.log("  · 明确指令不许变问卷 ✓｜只问一次 ✓｜缺细节不问 ✓");
process.exit(problems.length ? 1 : 0);