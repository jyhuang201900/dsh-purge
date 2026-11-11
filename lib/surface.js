import path from "node:path";
import fs from "node:fs";

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

/** gui / tui 尚未单独适配，先走 web 重启与探测。 */
/**
 * ai_base 是不是**桌面安装**里的那一份（`resources/app/dsh/node_modules/...`）。
 *
 * 为什么单独判：`pathLooksDesktop()` 要求路径里带 `deepseek harness` 这类名字，
 * 而 ai_base 落在 `E:\Program Files\harness\resources\app\dsh\...` —— 只带 `resources/app`，
 * 于是 detectSurface() 判成非桌面面 → `allowTargetPath()` 把 desktop-install 的文件全拒。
 * 后果实测（第 148 轮）：targetFiles 从 56 键掉到 52，包自证报「映射缩水」；write-smoke /
 * tools-smoke 拿不到 ai_base，两关静默「跳过」按通过退出。
 *
 * 判据只看安装布局，不看进程名：`resources/app/dsh/`、`resources/app.asar/`、
 * `resources/app.asar.unpacked/` 这三种都是官方桌面的解包形态。
 */
export function aiBaseLooksDesktopInstall(aiBase) {
  const n = slash(aiBase);
  if (!n) return false;
  if (!n.includes("/resources/")) return false;
  return (
    n.includes("/resources/app/dsh/") ||
    n.includes("/resources/app.asar/") ||
    n.includes("/resources/app.asar.unpacked/")
  );
}

/**
 * 在脚本里（而不是宿主进程里）对齐「面」：探测到桌面安装的 ai_base 就设 DSH_SURFACE=desktop。
 * 返回 true 表示设了。已经显式设过 DSH_SURFACE 的尊重原值，不覆盖。
 */
export function adoptSurfaceForAiBase(aiBase = process.env.DSH_BASE) {
  if (process.env.DSH_SURFACE) return false;
  if (!aiBaseLooksDesktopInstall(aiBase)) return false;
  process.env.DSH_SURFACE = "desktop";
  return true;
}

export function adapterFor(kind) {
  return kind === "desktop" ? "desktop" : "web";
}
