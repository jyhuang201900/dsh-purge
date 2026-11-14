/**
 * 写库前的校验与规范化（零依赖）。
 *
 * 从 core.js 抽出来的模块：这些函数决定"什么值允许进库"，
 * 是安全边界所在（路径穿越、非法枚举），值得单独一处、单独读、单独测。
 */

import { resolve, sep, dirname } from 'node:path'
import { realpathSync } from 'node:fs'

export const WEBSHELL_TYPES = ['behinder', 'godzilla', 'antSword', 'antsword', 'custom']
export const WEBSHELL_STATUSES = ['online', 'offline', 'dead', 'unknown']

/**
 * 规范化马类型：大小写不敏感、允许中文别名（冰蝎/哥斯拉/蚁剑）。
 * 认不出就抛错而不是静默存原文 —— 面板的"用户连不上"红标、会话页的连接口令复制
 * 都按这个字段判断，存进去一个拼错的值不会报错，只会让这两处判定静默失效。
 * @param value - 原始值（可为空）。
 * @returns 规范化后的值或 null（空值合法 = 未声明）。
 */
export function normalizeShellType(value) {
  const raw = value === undefined || value === null ? '' : String(value).trim()
  if (raw === '') return null
  const lower = raw.toLowerCase()
  if (/behinder|冰蝎/.test(lower)) return 'behinder'
  if (/godzilla|哥斯拉/.test(lower)) return 'godzilla'
  if (/antsword|蚁剑/.test(lower)) return 'antSword'
  if (lower === 'custom' || lower === 'custom-shell' || /自定义|自研/.test(raw)) return 'custom'
  throw new Error("webshell shell_type 非法：" + JSON.stringify(value)
    + '。交付要求是**冰蝎马（behinder）/ 哥斯拉马（godzilla）**（用户要能自己连上）；'
    + '其它类型请填 custom（只作临时中转，面板会标"用户连不上"）。')
}

/** 规范化马状态（界面按 online/offline/unknown 三态显示）。 */
export function normalizeShellStatus(value) {
  const raw = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
  const aliases = { up: 'online', alive: 'online', down: 'offline', failed: 'offline', removed: 'dead' }
  const normalized = aliases[raw] || raw
  if (normalized === '') return 'online'
  if (!WEBSHELL_STATUSES.includes(normalized)) {
    throw new Error("webshell status 非法：" + JSON.stringify(value) + "。合法值只有 " + WEBSHELL_STATUSES.join(" / ") + "。")
  }
  return normalized
}


/**
 * 路径必须在允许的根目录内（防目录穿越）。
 *
 * 为什么需要：`readAttackFile` / `pocGet` 读的是**数据库里的 path 列**，
 * 而那个列是智能体自己经 `addAttackFile` / `savePoc` 写进去的 —— 也就是不可信输入。
 * 一旦填成 `/etc/passwd` 或 `~/.ssh/id_rsa`，面板点一下就把文件读到浏览器里了。
 * `deletePoc` 早有 startsWith 防护，读路径与写路径却漏了，这里补成一处共用实现。
 * @param target - 待校验的路径。
 * @param allowedRoots - 允许的根目录（数组）。
 * @returns 规范化后的绝对路径。
 * @throws 越界时抛错（调用方按"查不到"处理，不要静默返回内容）。
 */
export function assertPathWithin(target, allowedRoots) {
  const abs = resolve(String(target || ""))
  const roots = (allowedRoots || []).filter((r) => typeof r === "string" && r !== "").map((r) => resolve(r))
  /* 只做字符串前缀比对是不够的：根目录下放一个指向根外的符号链接/junction，
     字符串上"在根内"而实际读写的是根外文件。实测 `.cache/ptest/allowed/link -> ../secret`
     能通过纯字符串判断并读出 secret/key.txt —— 而本函数守的是截图/POC/攻击文件这些
     "记录里带的路径"，记录内容可被写库工具影响，所以必须实测解析。
     判据顺序很关键：**先看实路径，字符串只作为"实路径不可得时"的退化判据**。
     反过来（先字符串后实路径）会一命中就 break，等于 symlink 检查永远不执行——第一版就是这么错的。 */
  const realOf = (p) => {
    try { return realpathSync.native ? realpathSync.native(p) : realpathSync(p); }
    catch { return null; }
  }
  const isInside = (candidate, root) => candidate === root || candidate.startsWith(root + sep)

  const absReal = realOf(abs)
  const rootReals = roots.map((r) => ({ root: r, real: realOf(r) }))

  let okFlag = false
  for (const { root, real: rootReal } of rootReals) {
    if (absReal) {
      // 目标存在：唯一可信判据是「目标实路径在根实路径内」
      if (rootReal ? isInside(absReal, rootReal) : isInside(absReal, root)) { okFlag = true; break }
      continue
    }
    // 目标还不存在（如"新建文件"）：按父目录实路径判断，防"新建时逃逸"
    const dirReal = realOf(dirname(abs))
    if (dirReal) {
      if (rootReal ? isInside(dirReal, rootReal) : isInside(dirReal, root)) { okFlag = true; break }
      continue
    }
    // 父目录也解析不出来：只能退化为字符串判断（此时文件系统层面尚未存在任何实体，
    // 穿越只能靠字面路径，字符串比对足够）
    if (isInside(abs, root)) { okFlag = true; break }
  }
  if (!okFlag) {
    throw new Error("path outside allowed roots: " + abs
      + "（允许的根：" + roots.join(", ") + "）。这条记录的文件路径不在本靶标目录内，已拒绝读取。")
  }
  return abs
}
