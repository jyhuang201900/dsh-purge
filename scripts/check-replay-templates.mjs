import fs from "node:fs";

/* 审计 score-rules.js 里所有 replay/script 模板：
   ① script 是**实际拿去填充**的模板，占位符不能比 replay 少（少了就等于悄悄丢字段）
   ② mysql 的裸 `-p`（后面没有值）在真实客户端里是"交互式提示输密码"，
      贴进脚本会挂住等输入 —— 比缺字段更糟，因为它看起来像能跑。

   由来：2026-11-14 实测 db-credential 的 script 写成 `mysql -h <host> -u <user> -p -e ...`，
   丢了 <port> 与 <pass>，报告只提示"还有 2 个占位符没填"，读者以为补齐 host/user 就能跑。 */
const src = fs.readFileSync("lib/redteam/score-rules.js", "utf8");
const rules = [...src.matchAll(/'([a-z0-9-]+)':\s*\{([\s\S]*?)\n {2}\},/g)];
const ph = (s) => [...new Set([...String(s).matchAll(/<[^>\s]{1,24}>/g)].map((m) => m[0]))];

console.log("=== 模板占位符审计 ===");
let bad = 0;
let checked = 0;
for (const [, code, body] of rules) {
  const mScript = body.match(/script:\s*'((?:[^'\\]|\\.)*)'/s);
  if (!mScript) continue;
  checked += 1;
  const mReplay = body.match(/replay:\s*'((?:[^'\\]|\\.)*)'/s);
  const script = mScript[1];
  const replay = mReplay ? mReplay[1] : "";
  const onlyReplay = ph(replay).filter((p) => !ph(script).includes(p));

  const issues = [];
  if (onlyReplay.length) issues.push(`script 缺占位符 ${onlyReplay.join(",")}`);
  // 去掉合法的 -p'<pass>' / -p<pass> 以后，再看还有没有裸 -p
  const stripped = script.replace(/-p'[^']*'/g, "").replace(/-p<[^>\s]*>/g, "").replace(/-p"[^"]*"/g, "");
  if (/\bmysql\b/.test(script) && /(^|\s)-p(\s|$)/.test(stripped)) {
    issues.push("裸 -p（真实客户端会交互式等密码，脚本里挂住）");
  }
  if (issues.length) {
    bad += 1;
    console.log(`  ✗ ${code}: ${issues.join("；")}`);
    console.log(`      script: ${script.slice(0, 96)}`);
  }
}
console.log("");
console.log(bad ? `检查 ${checked} 个模板，有 ${bad} 处问题` : `✓ 检查 ${checked} 个模板：占位符与 replay 一致，无裸 -p`);
process.exit(bad ? 1 : 0);