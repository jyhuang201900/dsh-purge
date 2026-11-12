/**
 * 用途：toolkit 健康度扫描——把「目录在、里面没有任何 exe」识别成**装过被删**，而不是「没装」。
 * 依赖：Node ≥18；只读目录，不启动任何工具进程。
 *
 * 为什么单独成模块（第 150 轮）：这段判据原先内联在 scripts/check-tools.mjs 里，
 * 于是只有「跑 verify / 跑工具面闸门」时才会被发现——suo5 那晚被安全软件清空的那一刻，
 * 所有闸门都是绿的。抽成模块后，定时巡检（scripts/watch-toolkit.mjs）与闸门共用同一套判据，
 * 不会出现「巡检说没事、闸门说有洞」的两套口径。
 */
import fs from "node:fs";
import path from "node:path";

/** 默认 toolkit 目录：$DSH_HOME/redteam/toolkit。 */
export function toolkitDir(home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || "", ".dsh")) {
  return path.join(home, "redteam", "toolkit");
}

/**
 * 扫描 toolkit。
 * 返回 { dir, installed: [目录名], shells: [目录名], exists }：
 *   · installed —— 目录里至少有一个 .exe，算装上了（能不能跑由 probeTool 负责，这里只判文件形态）；
 *   · shells    —— 目录存在但零 exe，这是「装过被删」的指纹（腾讯电脑管家/Defender 实测 20 秒内静默删除）；
 *   · exists    —— toolkit 根目录是否存在（不存在＝一个都没装，不算缺陷）。
 */
export function scanToolkit(dir = toolkitDir()) {
  const installed = [];
  const shells = [];
  let exists = false;
  try {
    exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return { dir, installed, shells, exists };
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { dir, installed, shells, exists };
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    let exes = 0;
    try {
      exes = fs.readdirSync(path.join(dir, e.name)).filter((f) => /\.exe$/i.test(f)).length;
    } catch {
      exes = 0;
    }
    if (exes) installed.push(e.name);
    else shells.push(e.name);
  }
  return { dir, installed, shells, exists };
}

/** 一句话人话：给闸门与巡检共用，避免两处措辞各自漂。 */
export function describeToolkit(scan) {
  if (!scan.exists) return "toolkit 目录不存在（一个工具都没装）";
  if (!scan.shells.length) return `toolkit 实况：${scan.installed.length} 个目录有可执行文件，无空壳`;
  return `toolkit 实况：${scan.installed.length} 个目录有可执行文件，空壳 ${scan.shells.length} 个（${scan.shells.join("、")}）`;
}

/** 空壳的处置建议：先加白名单再重装，否则重装会被再删一次。 */
export function shellAdvice(scan) {
  if (!scan.shells.length) return "";
  return `toolkit 空壳目录 ${scan.shells.join("、")}：目录在但没有任何 .exe——多为安全软件静默删除（实测 20 秒内）。先把 ${scan.dir} 加进信任区/排除项，再 npm run toolkit:windows -- --only ${scan.shells.join(",")}；直接重装会被再删一次`;
}