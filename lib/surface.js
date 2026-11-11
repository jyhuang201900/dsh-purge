import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

/** 当前已接线的宿主面。gui / tui 先能识别，适配仍回退 web。 */
export const SURFACES = Object.freeze(["web", "desktop", "gui", "tui"]);

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function exeName(execPath) {
  return path.basename(String(execPath || "")).toLowerCase();
}

export function pathLooksDesktop(p) {
  const n = slash(p);
  if (!n) return false;
  // 安装目录可能叫 "DeepSeek Harness" / "deepseek-harness" / "DeepseekHarnessDesktop"。
  // 源码仓库也常带 deepseek-harness 名字，所以还要带 resources/、exe、.app/ 才算桌面安装。
  const harnessDir =
    n.includes("/deepseek harness/") ||
    n.includes("/deepseek-harness/") ||
    n.includes("/deepseekharness") ||
    /\/deepseek[\s._-]*harness/.test(n);
  return (
    n.includes("/dsh desktop/") ||
    n.includes("/dsh desktop.app/") ||
    n.includes("dsh-desktop") ||
    n.includes("dsh-plugin-desktop") ||
    n.includes("/deepseek harness.app/") ||
    (harnessDir && (n.includes("/resources/") || n.includes("/contents/resources/") || n.endsWith("/resources"))) ||
    /\/dsh desktop\.exe$/i.test(n) ||
    /\/deepseek[\s._-]*harness\.exe$/i.test(n) ||
    n.endsWith("/host-process-entry.js") ||
    n.endsWith("/desktop-cli.js")
  );
}

function resourcesLookLikeDesktopInstall(resourcesPath) {
  if (!resourcesPath) return false;
  if (pathLooksDesktop(resourcesPath)) return true;
  const n = slash(resourcesPath);
  if (!(n.endsWith("/resources") || n.includes("/contents/resources"))) return false;
  try {
    const asar = path.join(resourcesPath, "app.asar");
    if (fs.existsSync(asar) && fs.statSync(asar).isFile()) return true;
    if (fs.existsSync(path.join(resourcesPath, "app", "dsh"))) return true;
    if (fs.existsSync(path.join(resourcesPath, "app.asar.unpacked", "dsh"))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function isDesktopSurface(input = {}) {
  const env = input.env ?? process.env;
  const forced = norm(env.DSH_SURFACE);
  if (forced === "desktop") return true;
  if (forced && SURFACES.includes(forced)) return false;

  // **在 source 上认桌面布局**（第 148 轮审阅抓到的半修）：只让 4 个脚本自己去 adopt 是不够的，
  // 任何走 detectSurface() 的入口（如 `bin/dsh-purge.js --status`）都还判成 web，插件根/统计全错。
  if (aiBaseLooksDesktopInstall(input.aiBase ?? env.DSH_BASE)) return true;

  const execPath = input.execPath ?? process.execPath;
  const name = exeName(execPath);
  if (
    name === "dsh desktop.exe" ||
    name === "dsh desktop" ||
    name === "deepseek harness.exe" ||
    name === "deepseek-harness.exe" ||
    name === "deepseek harness" ||
    name === "deepseek-harness" ||
    /^deepseek[\s._-]*harness(\.exe)?$/.test(name)
  ) return true;
  if (pathLooksDesktop(execPath)) return true;

  const resourcesPath = input.resourcesPath ?? process.resourcesPath;
  if (resourcesLookLikeDesktopInstall(resourcesPath)) return true;

  const argv = input.argv ?? process.argv;
  if ((Array.isArray(argv) ? argv : []).some((arg) => pathLooksDesktop(arg))) return true;

  const parentPort = input.parentPort !== undefined ? input.parentPort : process.parentPort;
  if (parentPort && (pathLooksDesktop(execPath) || resourcesLookLikeDesktopInstall(resourcesPath))) return true;

  if (env.ELECTRON_RUN_AS_NODE && (pathLooksDesktop(execPath) || resourcesLookLikeDesktopInstall(resourcesPath))) return true;
  return false;
}

function forcedSurface(env) {
  const forced = norm(env.DSH_SURFACE);
  return SURFACES.includes(forced) ? forced : "";
}

export function detectSurface(input = {}) {
  const env = input.env ?? process.env;
  const forced = forcedSurface(env);
  if (forced) return forced;
  if (isDesktopSurface(input)) return "desktop";
  return "web";
}

/**
 * ai_base 是不是**桌面安装**里的那一份（`…/resources/app(?.asar[.unpacked])/dsh/node_modules/@deepseek-ai`）。
 *
 * 为什么单独判：`pathLooksDesktop()` 要求路径里带 `deepseek harness` 这类名字，而 ai_base 落在
 * `E:\Program Files\harness\resources\app\dsh\…` —— 只带 `resources/app`，于是 detectSurface() 判成
 * 非桌面面 → `allowTargetPath()` 把 desktop-install 的文件全拒。后果实测（第 148 轮）：targetFiles
 * 从 56 键掉到 52（包自证误报「映射缩水」）、write-smoke / tools-smoke 取不到 ai_base 而「跳过」按通过退出。
 *
 * 判据要**两头都对**才成立，否则面会翻错方向：翻成 desktop 后 `allowTargetPath()` 会放开 desktop-install
 * 段的写权限，任何 Electron 应用只要目录里带 `resources/app/dsh/` 就会被当成桌面安装（审阅实测误判）。
 * 所以：① 布局必须是官方桌面的三种解包形态；② 尾部必须是 ai_base 契约里的 `@deepseek-ai` 包目录。
 */
export function aiBaseLooksDesktopInstall(aiBase) {
  const raw = String(aiBase || "").replace(/\\/g, "/");
  if (!raw) return false;
  const n = raw.toLowerCase();
  const at = n.indexOf("/resources/");
  if (at < 0) return false;
  // ai_base 永远是 `@deepseek-ai` 这一层（targetFiles 在它里面找 dsh-* 子包）。
  if (!(n.endsWith("/@deepseek-ai") || n.includes("/node_modules/@deepseek-ai"))) return false;
  const resDir = raw.slice(0, at + "/resources".length);
  // 光看布局还不够：任何 Electron 应用都可能长成 `resources/app/dsh/…`（审阅实抓的误判）。
  // 真正的判据是**这一层 resources 里确实装着 dsh**——有 app.asar、或 app/dsh/package.json 自称 dsh。
  try {
    if (fs.existsSync(path.join(resDir, "app.asar"))) return true;
    if (fs.existsSync(path.join(resDir, "app.asar.unpacked"))) return true;
    const pkg = path.join(resDir, "app", "dsh", "package.json");
    if (fs.existsSync(pkg)) {
      const meta = JSON.parse(fs.readFileSync(pkg, "utf8"));
      if (meta && (meta.name === "dsh" || meta.name === "deepseek-harness" || meta.dsh)) return true;
    }
  } catch { return false; }
  return false;
}

/**
 * 在脚本里（而不是宿主进程里）解析宿主 ai_base：先看 DSH_BASE，再从运行中的桌面进程推，
 * 最后退到常见安装位置。找不到返回 ""。
 *
 * 为什么必须有它：`write-smoke` / `tools-smoke` 单跑时没有 DSH_BASE，`gatherState()` 拿不到 ai_base，
 * 两关就写成「跳过」并按 exit 0 放行——**跳过等于没跑**（审阅实测：单跑仍是 JSON `{"adopted":false}`）。
 */
export function findHostAiBase() {
  const explicit = String(process.env.DSH_BASE || "").trim();
  if (explicit) return explicit;
  const cands = [];
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-Command",
      "(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1).Path"],
      { encoding: "utf8", timeout: 8000 });
    const exe = String((r && r.stdout) || "").trim();
    if (exe) cands.push(path.join(path.dirname(exe), "resources", "app", "dsh", "node_modules", "@deepseek-ai"));
  } catch { /* 进程查不到就走常见位置 */ }
  for (const base of [process.env.ProgramFiles, "E:\\Program Files", "D:\\Program Files"]) {
    if (base) cands.push(path.join(base, "harness", "resources", "app", "dsh", "node_modules", "@deepseek-ai"));
  }
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch { /* 下一个 */ }
  }
  return "";
}

/**
 * 在脚本里对齐「面」：ai_base 是桌面安装就设 DSH_SURFACE=desktop。
 * 返回 true 表示设了。显式设过面就尊重原值，但**只尊重合法值**：
 * 拼错的 DSH_SURFACE（如 `dekstop`）不该让 detectSurface() 回退 web 又把局面翻错。
 */
export function adoptSurfaceForAiBase(aiBase = process.env.DSH_BASE) {
  if (SURFACES.includes(norm(process.env.DSH_SURFACE))) return false;
  if (!aiBaseLooksDesktopInstall(aiBase)) return false;
  process.env.DSH_SURFACE = "desktop";
  return true;
}

/** gui / tui 尚未单独适配，先走 web 重启与探测。 */
export function adapterFor(kind) {
  return kind === "desktop" ? "desktop" : "web";
}
