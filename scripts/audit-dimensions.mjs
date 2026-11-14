import fs from "node:fs";
import path from "node:path";

/* 12 维度覆盖矩阵：给每维度一组识别词，扫全库 skill 正文算命中率。
   为什么这么做：只看"哪个域少"永远只看得到显眼的那几个（逆向、Web）。
   实测教训：1.1.94 时看似要补的逆向域其实 8851 字第二厚，真空白是检测配对/ATT&CK/误报验证。
   所以判据必须是「维度 × 命中技能数」，不是「目录里谁的文件少」。 */
const DIR = "skills/redteam";
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md"));
const corpus = files.map((f) => ({ f, t: fs.readFileSync(path.join(DIR, f), "utf8") }));

const DIMS = [
  { key: "recon",     name: "信息收集",       words: ["信息收集", "资产测绘", "子域", "端口", "指纹识别", "fofa", "nmap"] },
  { key: "webtest",   name: "Web 测试",       words: ["sql 注入", "sqli", "xss", "ssrf", "rce", "文件上传", "命令注入", "反序列化"] },
  { key: "exploit",   name: "漏洞利用",       words: ["利用链", "exp", "rce", "getshell", "poc", "武器化"] },
  { key: "ad",        name: "AD/域渗透",      words: ["kerberoast", "dcsync", "域控", "ldap", "kerberos", "adcs", "bloodhound"] },
  { key: "cloud",     name: "云与容器",       words: ["kubernetes", "k8s", "容器逃逸", "iam", "元数据", "eks", "容器"] },
  { key: "reverse",   name: "逆向工程",       words: ["ida", "ghidra", "反编译", "脱壳", "汇编", "radare"] },
  { key: "detect",    name: "检测配对",       words: ["检测", "告警", "日志", "sigma", "事件 id", "edr", "sysmon"] },
  { key: "attck",     name: "ATT&CK 映射",    words: ["att&ck", "attck", "t1059", "t1003", "战术编号", "technique id"] },
  { key: "falsepos",  name: "误报验证",       words: ["误报", "复现", "二次确认", "假阳性", "自证", "排除误判"] },
  { key: "evasion",   name: "免杀与规避",     words: ["免杀", "bypass", "规避", "绕过", "加壳", "混淆"] },
  { key: "lateral",   name: "横向与持久化",   words: ["横向", "持久化", "计划任务", "服务注册", "psexec", "wmi"] },
  { key: "report",    name: "取证与报告",     words: ["取证", "时间线", "报告", "证据链", "哈希", "链式保管"] },
];

const rows = [];
for (const d of DIMS) {
  const hits = [];
  for (const c of corpus) {
    const low = c.t.toLowerCase();
    if (d.words.some((w) => low.includes(w.toLowerCase()))) hits.push(c.f);
  }
  rows.push({ ...d, n: hits.length, rate: hits.length / corpus.length, hits });
}

rows.sort((a, b) => a.rate - b.rate);
console.log(`技能总数 ${corpus.length}｜12 维度覆盖（按命中率升序，最前面=最缺）\n`);
console.log("维度            命中   覆盖率   说明");
for (const r of rows) {
  const bar = "█".repeat(Math.round(r.rate * 20)).padEnd(20, "·");
  console.log(`${r.name.padEnd(13, "　")} ${String(r.n).padStart(3)}  ${(r.rate * 100).toFixed(0).padStart(3)}%  ${bar}`);
}
console.log("\n=== 最缺的三维，现有命中样本 ===");
for (const r of rows.slice(0, 3)) {
  console.log(`\n[${r.name}] 命中 ${r.n} 个：${r.hits.slice(0, 6).join(", ") || "（无）"}`);
}