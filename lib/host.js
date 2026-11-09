import fs from "node:fs";
import path from "node:path";
import { adapterFor, detectSurface } from "./surface.js";
import * as desktop from "./desktop.js";
import * as web from "./web.js";

const ADAPTERS = {
  web,
  desktop,
};

function readJsonVersion(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    const value = JSON.parse(text);
    return typeof value?.version === "string" ? value.version : "";
  } catch {
    return "";
  }
}

/**
 * 宿主版本探测：桌面端从安装目录读 app / runtime / cordis 三份 package.json 的版本。
 * 优先 DSH_DESKTOP_INSTALL，其次从 DSH_BASE（…/resources/app/dsh/node_modules/@deepseek-ai）反推。
 * 读不到就返回空串，不猜版本号。
 */
export function dshHostVersion(options = {}) {
  const bases = [];
  const install = options.install || process.env.DSH_DESKTOP_INSTALL || "";
  if (install) bases.push(path.join(install, "resources", "app"));
  const base = options.base || process.env.DSH_BASE || "";
  if (base) {
    // DSH_BASE 指向 …/resources/app/dsh/node_modules/@deepseek-ai → 上溯 3 级到 app
    const appDir = path.resolve(base, "..", "..", "..");
    bases.push(appDir);
    if (path.basename(appDir).toLowerCase() !== "app") bases.push(path.join(path.dirname(appDir), "app"));
  }
  for (const dir of bases) {
    const appPkg = path.join(dir, "package.json");
    const runtimePkg = path.join(dir, "dsh", "package.json");
    const cordisPkg = path.join(dir, "dsh", "node_modules", "@deepseek-ai", "cordis", "package.json");
    const app = readJsonVersion(appPkg);
    const runtime = readJsonVersion(runtimePkg);
    if (!app && !runtime) continue;
    return {
      app,
      runtime,
      cordis: readJsonVersion(cordisPkg),
      source: app ? appPkg : runtimePkg,
    };
  }
  return { app: "", runtime: "", cordis: "", source: "" };
}

/** 适配声明与宿主实况是否一致（比到 主.次.修；rc 标签本身不算差异，但 0.2.1 与 0.2.2 是不同发布）。 */
export function hostAlignment(target, host) {
  const core3 = (value) => String(value || "").split("-")[0].split(".").slice(0, 3).join(".");
  const want = core3(target);
  const got = core3(host);
  if (!want || !got) return { aligned: null, want, got };
  return { aligned: want === got, want, got };
}

export function currentSurface(input) {
  return detectSurface(input);
}

export function hostAdapter(kind = detectSurface()) {
  return ADAPTERS[adapterFor(kind)] || web;
}

export function scheduleRestart(request, ctx, options = {}) {
  return hostAdapter().scheduleRestart(request, ctx, options);
}

export function scheduleCleanupRestart(opts) {
  return hostAdapter().scheduleCleanupRestart(opts);
}

export function restartNote() {
  return hostAdapter().restartNote();
}
