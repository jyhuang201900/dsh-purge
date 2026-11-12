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
  // `name:` 在这个文件里有两个身份：插件条目（`@deepseek-ai/x`、`dsh-super-code/super-code`）
  // 和**模型/预设的显示名**（`name: DeepSeek V4.1 Flash`、`name: Super Code 模式`）。
  // 不区分就会把显示名当包名去找 node_modules，永远找不到 → 干净备份被判「脏」→ 自愈恒不执行。
  // 判据：带空格的必然是显示名；裸词（atomcode / loomy 这类 provider 别名）不算包；
  //       真正的插件条目要么是 `@scope/name`，要么带 `/` 子路径。
  if (/\s/.test(clean)) return "";
  if (clean.startsWith("@")) return clean.split("/").slice(0, 2).join("/");
  if (!clean.includes("/")) return "";
  return clean.split("/")[0];
}

/** 这个 profile 的 node_modules 里有没有这个包。 */
function packageInstalled(pkg, profileDir) {
  if (!pkg || !profileDir) return true;
  return fs.existsSync(path.join(profileDir, "node_modules", pkg));
}

/**
 * 备份里引用了、但本 profile 没装的第三方包。
 * `@deepseek-ai/*` 由宿主自带（在 app.asar 里），不算缺失。
 */
export function missingPackages(text, profileDir) {
  const missing = new Set();
  for (const m of String(text).matchAll(/\bname:\s*['"]?([@\w./:-][^\s'"#]*)/g)) {
    const pkg = packageOf(m[1]);
    if (!pkg || pkg.startsWith("@deepseek-ai/")) continue;
    if (!packageInstalled(pkg, profileDir)) missing.add(pkg);
  }
  return [...missing];
}

/**
 * 把「引用了缺失包」的列表条目**整块**删掉，剩下的配置仍然可加载。
 *
 * 为什么需要：宿主重置 patch 的原因就是里面有一条加载不动；备份要是也带这条，
 * 写回去只会再被重置一次。删掉那一条，provider / UI / 预设就能回来。
 * 只处理 `- name: <包>` 这种插件条目；模型与预设的显示名（值带空格）不会被碰。
 */
export function sanitizePatchText(text, profileDir) {
  const dropped = [];
  const lines = String(text || "").split("\n");
  const out = [];
  // 已知缺失的包名：既用来判「name 直接指向它」，也用来判「条目里别处引用了它」。
  const missingPkgs = missingPackages(text, profileDir);
  const indentOf = (line) => line.length - line.trimStart().length;
  const isDash = (line) => /^\s*-\s/.test(line);
  const mentionsIn = (body) => missingPkgs.filter((name) => body.includes(name));

  /** 处理 lines[from, to)：条目级判断，必要时递归进嵌套条目。 */
  const walk = (from, to) => {
    let i = from;
    while (i < to) {
      const line = lines[i];
      if (!isDash(line)) {
        out.push(line);
        i += 1;
        continue;
      }
      const dashIndent = indentOf(line);
      let end = i + 1;
      while (end < to) {
        const next = lines[end];
        if (!next.trim()) {
          end += 1;
          continue;
        }
        if (indentOf(next) <= dashIndent) break;
        end += 1;
      }
      const block = lines.slice(i, end);
      // 条目自己的包名：条目范围内第一条 `name:`（`- id: x` + `name: y` 和 `- name: y` 都覆盖）
      const nameLine = block.find((l) => /^\s*(?:-\s+)?name:\s*\S/.test(l));
      const pkg = nameLine ? packageOf(/^\s*(?:-\s+)?name:\s*(.+?)\s*$/.exec(nameLine)[1]) : "";
      if (pkg && !pkg.startsWith("@deepseek-ai/") && !packageInstalled(pkg, profileDir)) {
        dropped.push(pkg);
        i = end; // 整块丢弃，子行（config: / 嵌套条目）一起走
        continue;
      }
      // 条目自身（不含嵌套条目）提到缺失包 → 这条自己就依赖它，整条删；
      // 典型：`name: file:///…/.super-code-recovery/…` + `owner: dsh-super-code`。
      let firstChild = end;
      for (let k = i + 1; k < end; k += 1) {
        if (isDash(lines[k])) {
          firstChild = k;
          break;
        }
      }
      const own = mentionsIn(lines.slice(i, firstChild).join("\n"));
      if (own.length) {
        dropped.push(own[0]);
        i = end;
        continue;
      }
      // 只在嵌套条目里提到 → 保留这一条（它是可加载的容器，比如预设），递归清它的子条目。
      if (mentionsIn(block.join("\n")).length) {
        out.push(line);
        walk(i + 1, end);
        i = end;
        continue;
      }
      out.push(line); // 保留时只吞掉这一行，子行交给后续轮次各自判断
      i += 1;
    }
  };
  walk(0, lines.length);
  return { text: out.join("\n"), dropped };
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
    // 脏备份：把它引用的缺失条目整块删掉再写回。不这么做，自愈在「唯一备份也脏」时等于没有
    // （2026-11-12 实机三份备份全部引用了已卸载的 dsh-super-code，一条都没恢复）。
    let body = "";
    try {
      body = fs.readFileSync(path.join(path.dirname(fp), stale.backup), "utf8");
    } catch {
      body = "";
    }
    const cleaned = sanitizePatchText(body, profileDir);
    if (cleaned.text && !missingPackages(cleaned.text, profileDir).length) {
      try {
        fs.copyFileSync(fp, `${fp}.reset-${Date.now()}`);
        fs.writeFileSync(fp, cleaned.text, "utf8");
        log("profile-patch-guard", { sanitized: stale.backup, dropped: cleaned.dropped.join(","), bytes: cleaned.text.length });
        return { action: "sanitized", backup: stale.backup, dropped: cleaned.dropped, bytes: cleaned.text.length };
      } catch (error) {
        log("profile-patch-guard", { error: String(error?.message || error) });
        return { action: "error", error: String(error?.message || error) };
      }
    }
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
      // **但两者同时存在时不能说「健康」**（审计 I2）：2026-11-12 12:55 连崩三次的正是这个形态——
      // shell 与 host 子进程来自不同根，首个 IPC 事件不合 schema。asar-toggle --status 对它 exit 5，
      // 这里却报 asar=ok / notes 空，两份判据互相打脸。
      if (fs.existsSync(appDir)) {
        extract = "hybrid(archive+dir)";
        notes.push("⚠ 混合态：app.asar 与 resources/app 同时存在 —— shell 与 host 子进程可能来自不同根，启动会报 invalid IPC event；先移走其中一个（node scripts/asar-toggle.mjs --status 会 exit 5）");
      } else {
        extract = "absent";
      }
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
/**
 * 读回上一份健康快照。**以前只有写、没有读**（审计 M4）：release-notes 承诺「状态页读它」，
 * 实际 grep 全仓库除写入处零读者，崩机时用户根本看不到这份记录。
 * 读不到就返回 null，不抛也不编。
 */
export function readHealthReport(dshHome) {
  if (!dshHome) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dshHome, "dsh-purge", "health.json"), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

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
