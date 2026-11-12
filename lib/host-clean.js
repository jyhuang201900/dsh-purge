/**
 * 重启前看系统提示词文件：这一份到底算不算「洗过」。
 *
 * 第 150 轮修正（0.2.2-rc.1 实机暴露）：旧判据要求文件里出现
 * `[dsh-purge] complete prompt keeps waterfall inject` 或 `... keeps inject`，
 * 但全仓库没有任何补丁写这两条标记 —— 于是 `hostCleanMarkersPresent()` 在 0.2.2-rc.1 上恒为 false，
 * reapply 每次都报「清洗没有完成」（实测 reverted=42 applied=59 failed=0 仍判失败），
 * 而 lib/desktop.js 内嵌的同名判据会在换装后拒绝拉起宿主（`clean === false` → WScript.Quit(1)）。
 *
 * 现在的判据只认「文件确实被洗过」的证据：
 *   · #25 写上的 `[dsh-purge] identity stripped`，或
 *   · 旧形态的 keeps 标记（保留兼容），或
 *   · 官方身份行已不在且这确实是 system-prompt 模块（老版本补丁形态）。
 * 删掉的判据：`transformed.sections : [completeSection]` —— 这行是 0.2.2-rc.1 原厂就有，
 * 拿原厂特征当「没洗过」的证据必然恒 false（这正是本条缺陷的成因）。
 */
export const HOST_CLEAN_IDENTITY_MARK = "[dsh-purge] identity stripped";
export const HOST_CLEAN_KEEPS_MARK = "[dsh-purge] complete prompt keeps waterfall inject";
export const HOST_CLEAN_KEEPS_LEGACY = "[dsh-purge] complete prompt keeps inject";
export const HOST_OFFICIAL_IDENTITY = "You are an AI agent powered by DeepSeek Harness.";

/** 空文件、非本模块、官方身份还在 → 都不算洗过。 */
export function hostPromptKeepsInject(text) {
  const body = String(text || "");
  if (!body) return false;
  if (body.includes(HOST_CLEAN_IDENTITY_MARK)) return true;
  if (body.includes(HOST_CLEAN_KEEPS_MARK) || body.includes(HOST_CLEAN_KEEPS_LEGACY)) return true;
  return body.includes("system-prompt/assemble") && !body.includes(HOST_OFFICIAL_IDENTITY);
}

/**
 * lib/desktop.js 的看门脚本内嵌同一份判据；单一来源在这里生成，别再手抄第二份。
 * 返回纯 ES3/JScript 兼容的一行函数源码（只用 indexOf，无箭头函数、无模板串）。
 */
export function hostCleanFnSource() {
  const q = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  return (
    "function hostClean(body) { if (!body) return null; " +
    "var ident = body.indexOf(" + q(HOST_CLEAN_IDENTITY_MARK) + ") >= 0; " +
    "var kept = body.indexOf(" + q(HOST_CLEAN_KEEPS_MARK) + ") >= 0 || body.indexOf(" + q(HOST_CLEAN_KEEPS_LEGACY) + ") >= 0; " +
    "if (ident || kept) return true; " +
    "if (body.indexOf('system-prompt/assemble') < 0) return false; " +
    "return body.indexOf(" + q(HOST_OFFICIAL_IDENTITY) + ") < 0; }"
  );
}