import fs from "node:fs";
import path from "node:path";

/**
 * profile 配置层守护。
 *
 * 宿主启动时如果发现 profiles/<name>/cordis.patch.yml 里有加载不动的条目
 * （最典型的是引用了已经卸载的插件），会把它整体重置成空数组 `[]`。
 * 重置是静默的：用户的 provider、UI 设置、预设全部消失，只留下三行注释。
 * 2026-11-12 一天之内发生了两次（01:39、12:55），两次都是 dsh-super-code
 * 卸载后 patch 里的引用还在。
 *
 * 这里做的是「事后自愈」，不碰宿主任何文件：
 *   1. 只在当前 patch 已经是空数组时动手，绝不覆盖有内容的配置；
 *   2. 只从 .bak-* 备份里挑，且备份本身不能为空；
 *   3. 备份里如果还引用了 node_modules 里不存在的第三方包，就不恢复，
 *      只报告缺哪些包 —— 把脏备份写回去，宿主会再重置一次，白折腾。
 */

/** 去掉注释与空白后只剩 `[]`（或什么都没有），就是宿主重置后的样子。 */
export function profilePatchIsEmpty(text) {
  if (typeof text !== "string") return true;
  const stripped = text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\s+/g, "");
  return stripped === "" || stripped === "[]";
}

/** 从 `name:` 值里取出包名；官方内置、协议名、相对路径都不算依赖。 */
function packageOf(raw) {
  const clean = String(raw || "").replace(/^['"]|['"]$/g, "").trim();
  if (!clean) return "";
  if (clean.startsWith("cordis:") || clean.startsWith("file:") || clean.startsWith(".")) return "";
  if (clean.startsWith("@")) return clean.split("/").slice(0, 2).join("/");
  return clean.split("/")[0];
}

/**
 * 备份里引用了、但本 profile 没装的第三方包。
 * `@deepseek-ai/*` 由宿主自带（在 app.asar 里），不算缺失。
 */
export function missingPackages(text, profileDir) {
  const missing = new Set();
  const nodeModules = path.join(profileDir, "node_modules");
  for (const m of String(text).matchAll(/\bname:\s*['"]?([@\w./:-][^\s'"#]*)/g)) {
    const pkg = packageOf(m[1]);
    if (!pkg || pkg.startsWith("@deepseek-ai/")) continue;
    if (!fs.existsSync(path.join(nodeModules, pkg))) missing.add(pkg);
  }
  return [...missing];
}

/** 按修改时间倒序列出可用的 patch 备份。 */
function listPatchBackups(fp) {
  const dir = path.dirname(fp);
  const base = path.basename(fp);
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.startsWith(`${base}.bak-`) || name === `${base}.dshpurge.bak`)
      .map((name) => {
        try {
          return { name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

/**
 * 当前 profile 的 patch 被重置时，从最近一份「干净」备份恢复。
 *
 * @param {string} profileDir - profiles/<name> 目录
 * @param {(event: string, detail: object) => void} [log]
 * @returns {{action: string, backup?: string, bytes?: number, missing?: string[], error?: string}}
 */
export function guardProfilePatch(profileDir, log = () => {}) {
  if (!profileDir) return { action: "skip", reason: "no-profile-dir" };
  const fp = path.join(profileDir, "cordis.patch.yml");
  let current = "";
  try {
    current = fs.readFileSync(fp, "utf8");
  } catch {
    return { action: "skip", reason: "no-file" };
  }
  if (!profilePatchIsEmpty(current)) return { action: "ok" };

  const backups = listPatchBackups(fp);
  if (!backups.length) return { action: "skip", reason: "no-backup" };

  let stale = null;
  for (const entry of backups) {
    const src = path.join(path.dirname(fp), entry.name);
    let body = "";
    try {
      body = fs.readFileSync(src, "utf8");
    } catch {
      continue;
    }
    if (profilePatchIsEmpty(body)) continue;
    const missing = missingPackages(body, profileDir);
    if (missing.length) {
      // 记住第一份脏备份，但继续往后找更老的干净版本。
      stale = stale || { backup: entry.name, missing };
      continue;
    }
    try {
      fs.copyFileSync(fp, `${fp}.reset-${Date.now()}`);
      fs.writeFileSync(fp, body, "utf8");
      log("profile-patch-guard", { restored: entry.name, bytes: body.length });
      return { action: "restored", backup: entry.name, bytes: body.length };
    } catch (error) {
      log("profile-patch-guard", { error: String(error?.message || error) });
      return { action: "error", error: String(error?.message || error) };
    }
  }
  if (stale) {
    log("profile-patch-guard", { stale: stale.backup, missing: stale.missing.join(",") });
    return { action: "stale-backup", backup: stale.backup, missing: stale.missing };
  }
  return { action: "skip", reason: "no-usable-backup" };
}

/** 当前 profile 目录（desktop / web / headless）。 */
export function currentProfileDir(dshHome) {
  if (!dshHome) return "";
  const name = process.env.DSH_PROFILE || "desktop";
  return path.join(dshHome, "profiles", name);
}

/**
 * 宿主健康快照。只读，不修任何东西 —— 目的是让「为什么打不开」这类问题
 * 有地方可查，而不是只能翻 crash log 猜。
 *
 * @param {string} profileDir
 * @returns {{at: string, asar: string, extract: string, patch: string, deps: string, notes: string[]}}
 */
export function inspectHostHealth(profileDir) {
  const notes = [];
  let asar = "unknown";
  let extract = "unknown";

  const resources = String(process.resourcesPath || "");
  if (resources) {
    const asarPath = path.join(resources, "app.asar");
    const disabledPath = `${asarPath}.disabled`;
    const appDir = path.join(resources, "app");
    if (fs.existsSync(asarPath)) {
      asar = "ok";
      // 归档在，宿主就走归档；旁边的解包目录只是 dsh-purge 的历史产物，不参与启动。
      extract = fs.existsSync(appDir) ? "idle(archive-in-use)" : "absent";
    } else if (fs.existsSync(disabledPath)) {
      asar = "disabled";
      notes.push("app.asar 被改名，宿主在用解包目录启动；版本错配会直接崩在 IPC");
      extract = fs.existsSync(appDir) ? "in-use" : "missing";
    } else {
      asar = "missing";
      notes.push("app.asar 与 app.asar.disabled 都不在，安装可能不完整");
    }
  } else {
    notes.push("非 Electron 宿主进程，读不到 resourcesPath");
  }

  let patch = "unknown";
  try {
    patch = profilePatchIsEmpty(fs.readFileSync(path.join(profileDir, "cordis.patch.yml"), "utf8"))
      ? "empty(reset)"
      : "ok";
    if (patch !== "ok") notes.push("profile patch 是空的：宿主重置过它，provider / UI / 预设需要从备份恢复");
  } catch {
    patch = "missing";
    notes.push("找不到 profile 的 cordis.patch.yml");
  }

  let deps = "unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
    const names = Object.keys(pkg.dependencies || {});
    const missing = names.filter((name) => !fs.existsSync(path.join(profileDir, "node_modules", name)));
    deps = missing.length ? `missing:${missing.join(",")}` : "ok";
    if (missing.length) notes.push(`package.json 声明了但没装：${missing.join(", ")}`);
  } catch {
    deps = "unreadable";
  }

  return { at: new Date().toISOString(), asar, extract, patch, deps, notes };
}

/** 把健康快照落到 `~/.dsh/dsh-purge/health.json`，供状态页和事后排查读。 */
export function writeHealthReport(dshHome, profileDir) {
  if (!dshHome) return null;
  const report = inspectHostHealth(profileDir);
  try {
    const dir = path.join(dshHome, "dsh-purge");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "health.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } catch {
    return report;
  }
}
