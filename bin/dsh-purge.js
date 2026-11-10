#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { resolveResources, scanSwapBackups, scanSnapshotPairs, scanRouteMatrix } from "../lib/hygiene.js";

import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";

const args = process.argv.slice(2);

function printStatus(state, update) {
  const out = [];
  out.push("dsh-purge 状态 / Status");
  out.push("  宿主 / surface " + (state.surface || "web"));
  out.push("  DSH_HOME      " + state.dsh_home);
  if (state.desktop_install) out.push("  桌面安装       " + state.desktop_install);
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  " + core.missingAiBaseMessage());
  }
  out.push(`  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  out.push("");
  const tally = core.patchTally(state);
  out.push(`  宿主枚举       ${core.hostEnumerationLine(state).replace(/^宿主枚举 /, "")}`);
  out.push(`  补丁 ${tally.applied}/${tally.total} 已清洗, ${tally.pending} 待清洗, ${tally.skipped.length} 锚点未命中, ${tally.na} 不适用, ${tally.missing} 缺文件`);
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : "·";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  const upd = update || {};
  out.push("");
  const hostVer = upd.app || upd.runtime || "";
  if (hostVer) {
    const mark = upd.aligned === false ? "⚠ 不一致：需按新宿主核对锚点" : upd.aligned === true ? "一致" : "未知";
    out.push(`  宿主版本     ${hostVer}${upd.cordis ? `（cordis ${upd.cordis}）` : ""}`);
    out.push(`  适配声明     dshTarget=${upd.target || "?"} → ${mark}`);
    if (upd.aligned === false) out.push(`  锚点核对     跑 npm run check-anchors 对 ${hostVer} 复核（skipped≠已清洗）`);
  }
  out.push(`  更新框架 渠道=${upd.channelLabel || upd.channel || "?"}${upd.pin ? ` 钉选=${upd.pin}` : " 钉选=无"}`);
  out.push(`  上次升级 ${upd.lastLabel || "无记录"}`);
  out.push(`  升级守卫 ${upd.guardLabel || "无"}`);
  return out.join("\n");
}

/** CLI 可用旗标（唯一来源）：未知参数校验与 help 文案都以它为准，避免两份列表各自腐烂。 */
const MODES = ["--apply", "--revert", "--uninstall", "--status", "--align", "--tools", "--drill", "--mcp", "--mcp-probe", "--verify-live", "--edit", "--help"];

async function main() {
  const mode = args.find((a) => MODES.includes(a));
  // 未知参数必须当场报错：以前 `--nonsense` 会静默落到默认分支、打印一份 status 并 exit 0，
  // 于是手滑打错（--stauts）等于拿到一份假装成功的输出。用法错误用 exit=2，和内部失败(1)分开。
  const stray = args.filter((a) => String(a).startsWith("--") && !MODES.includes(a) && a !== "-h");
  if (stray.length) {
    console.log(`dsh-purge: 未知参数 ${stray.join(" ")}｜可用：${MODES.join(" ")}（或 -h 看用法）`);
    process.exit(2);
  }

  if (mode === "--help" || args.includes("-h")) {
    console.log(`dsh-purge 用法:
  dsh-purge --status     显示状态
  dsh-purge --align      对齐体检（宿主版本 / 适配声明 / 未命中清单）
  dsh-purge --apply      应用全部清洗（提示词+代码+shim+override）
  dsh-purge --revert     回滚还原
  dsh-purge --uninstall  卸载插件（已应用则先还原）
  dsh-purge --edit       编辑注入文件 prompt-inject.md
  dsh-purge --tools      列出模型可见工具（契约表）
  dsh-purge --drill [op] 演练台聚合查询/写入（不切预设；op 如 chain_add）
  dsh-purge --mcp        以 MCP server 方式跑（stdio JSON-RPC）
  dsh-purge --mcp-probe [url]  探测宿主内 POST /dsh-purge/mcp 是否已生效（缺省读 DSH_WEB_URL）
  dsh-purge --verify-live [url]  重启后一条命令验收（契约表 / 补丁分桶 / 注入状态 / 路由是否 live；只读）
  dsh-purge --help       帮助`);
    return;
  }

  // MCP / 工具清单：只读契约，不进状态打印，避免污染 stdio 上的 JSON-RPC。
  // MCP HTTP 探测：不依赖清洗状态，也不进 printStatus，直接给结论。
  if (mode === "--mcp-probe") {
    const { probeMcpEndpoint } = await import("../lib/mcp-probe.js");
    const at = args.indexOf("--mcp-probe");
    const next = at >= 0 ? args[at + 1] : undefined;
    const baseUrl = next && !String(next).startsWith("--") ? String(next) : (process.env.DSH_WEB_URL || "");
    const r = await probeMcpEndpoint({ baseUrl });
    for (const l of r.lines) console.log(`  ${l}`);
    console.log(`  结论：${r.state === "live" ? "HTTP MCP 通路已生效 ✓" : r.state === "not-live" ? "待重启（路由未加载）" : r.state === "unreachable" ? "宿主不可达" : "异常"}`);
    process.exit(r.state === "live" || r.state === "not-live" ? 0 : 1);
  }

  if (mode === "--verify-live") {
    // 重启后的"一条命令验收"：只做只读探测，不写宿主、不猜端口（端口靠参数或 DSH_WEB_URL）。
    const at = args.indexOf("--verify-live");
    const nextArg = at >= 0 ? args[at + 1] : undefined;
    const baseUrl = nextArg && !String(nextArg).startsWith("--") ? String(nextArg) : (process.env.DSH_WEB_URL || "");
    const { buildModelTools } = await import("../lib/model-tools.js");
    const updMod = await import("../lib/update.js");
    const hostM = await import("../lib/host.js");
    const rows = [];
    const push = (level, label, detail) => rows.push({ level, label, detail: detail || "" });
    // 1) 契约表（宿主 ctx.tools 与 MCP 共用这一张）
    const tools = buildModelTools({ core, rules, hostctl: hostM, updater: updMod, rejectIfNeedPrompt: () => null });
    push("ok", `契约表 ${tools.length} 个工具`, tools.map((x) => x.name.replace("purge_", "")).join(" / "));
    // 2) 宿主定位与补丁分桶
    const st = await core.gatherState();
    const tally = core.patchTally(st, core.ALL_PATCHES);
    const pending = tally.pending ?? 0;
    const skipped = (tally.skipped || []).length;
    push(st.surface ? "ok" : "warn", `宿主 surface=${st.surface || "未定位"}`, `补丁 ${tally.applied}/${tally.total} 已清洗｜待清洗 ${pending}｜未命中 ${skipped}`);
    if (pending > 0) push("bad", `还有 ${pending} 条待清洗`, "跑 dsh-purge --apply");
    if (skipped > 0) push("ok", `未命中 ${skipped} 条为设计内 skipped`, (tally.skipped || []).map((x) => `#${x.id ?? x}`).join(" "));
    // 3) 注入正文状态：⚠ 只给"需要动手"的情形，"用户自己选的稿"降级为信息。
    //    判据全部来自实测：state.customized/explicitSave 表示有意自改；hash 对不上表示记录与磁盘脱节（本轮本机就是这种）。
    const defLen = String(core.defaultOverrideText() || "").length;
    let liveTxt = "";
    try { if (st.override_path && fs.existsSync(String(st.override_path))) liveTxt = fs.readFileSync(String(st.override_path), "utf8"); } catch { }
    let ovs = null;
    try { ovs = core.readOverrideStateSync ? core.readOverrideStateSync(core.findDshHome()) : null; } catch { ovs = null; }
    const stamp = liveTxt ? core.hashOverride(liveTxt) : "";
    const deliberate = Boolean(ovs && (ovs.customized === true || ovs.explicitSave === true));
    const bookkeepingGap = Boolean(liveTxt && ovs && ovs.hash && stamp !== ovs.hash);
    const detail3 = `默认 ${defLen} 字｜生效 ${liveTxt.length || "—"} 字`;
    if (!liveTxt) push("warn", "注入文件读不到", `状态 ${st.override_status || "?"}`);
    else if (stamp === core.defaultOverrideHash()) push("ok", "注入正文 = 当前内置默认", detail3);
    else if (deliberate && !bookkeepingGap) push("ok", "注入正文是你自己保存的稿（不算待办）", `${detail3}｜插件判为 ${st.override_status}，sync 不会覆盖它`);
    else if (bookkeepingGap) push("warn", `注入状态 ${st.override_status}：磁盘内容与插件记录不一致`, `${detail3}｜对齐办法三选一：purge_override mode=adopt（只对齐记录、不动文件）/ 面板「保存」/ purge_override reset（换成当前默认）`);
    else push("warn", `注入状态 ${st.override_status}：是我们的旧默认没跟上`, `${detail3}｜重启会自动升级到 ${defLen} 字，或 purge_override reset`);
    // 4) 路由是否 live：三态要分开说，「宿主没在跑」和「等你重启」是完全不同的两件事。
    if (!baseUrl) {
      push("warn", "HTTP MCP 未探测", "给 --verify-live <url> 或设 DSH_WEB_URL");
    } else {
      const { probeMcpEndpoint } = await import("../lib/mcp-probe.js");
      const r = await probeMcpEndpoint({ baseUrl });
      const tail = (r.lines || []).slice(-1)[0] || "";
      if (r.state === "live") push("ok", `路由 ${baseUrl} → live`, tail);
      else if (r.state === "not-live") push("warn", `路由 ${baseUrl} → 未加载（待重启）`, `${tail}｜下一步：重启 dsh 再跑本命令`);
      else if (r.state === "unreachable") push("warn", `路由 ${baseUrl} 连不上`, "这是「宿主没在跑 / 端口不对」，不是待重启——先确认 dsh 已启动或换个 URL");
      else push("bad", `路由 ${baseUrl} 探测异常`, tail || "见 --mcp-probe 分步输出");
    }
    // 4b) 面板路由存活矩阵：把「重启后要人工点一遍」的清单变成一条命令的判定（只探 GET 安全的 9 条）。
    if (baseUrl) {
      try {
        const rm = await scanRouteMatrix(baseUrl);
        push(rm.level, rm.label, rm.detail);
      } catch (e) { push("warn", "面板路由：探测异常", String((e && e.message) || e).slice(0, 70)); }
    }
    // 5 / 5b) 磁盘卫生：第 70 轮抽成 lib/hygiene.js —— bin 只负责打印，扫描是纯函数、可夹具测。
    try {
      const sw = scanSwapBackups(resolveResources(st));
      push(sw.level, sw.label, sw.detail);
      const sn = scanSnapshotPairs(String(st.dsh_home || core.findDshHome()));
      if (sn) push(sn.level, sn.label, sn.detail);
    } catch (e) { push("换装遗留：读目录失败", "不据此判失败"); }
    console.log("dsh-purge 实时验收（只读探测）：");
    for (const x of rows) console.log(`  ${x.level === "ok" ? "✓" : x.level === "warn" ? "⚠" : "✗"} ${x.label}${x.detail ? `｜${x.detail}` : ""}`);
    const bad = rows.filter((x) => x.level === "bad").length;
    const warnRows = rows.filter((x) => x.level === "warn");
    const warn = warnRows.length;
    // 只有 bad 判失败。warn 最典型的是「注入正文等你三选一」——那是用户的选择，不是缺陷；
    // 判成 exit 1 会让 --verify-live 永远非 0、report 里也就永远挂一眼红，
    // 与 check-upstream（越界才红）和 sweep:market（交集>0 才红）的口径也不一致。
    // 第 96 轮实测触发点：路由转 live 之后唯一剩下的就是注入那条 ⚠，而旧文案还写着「通常是还没重启」。
    const warnWhat = warnRows.map((x) => String(x.label).split("：")[0]).join("、");
    if (bad) console.log(`  → ${bad} 项不通过${warn ? `｜另有 ${warn} 项待你处理：${warnWhat}` : ""}`);
    else if (warn) console.log(`  → 探测全部通过 ✓｜${warn} 项待你处理：${warnWhat}`);
    else console.log("  → 全部通过 ✓");
    process.exit(bad ? 1 : 0);
  }

  if (mode === "--mcp" || mode === "--tools" || mode === "--drill") {
    const [updMod, hostMod, rulesMod, mt, mcp] = await Promise.all([
      import("../lib/update.js"),
      import("../lib/host.js"),
      import("../lib/rules.js"),
      import("../lib/model-tools.js"),
      import("../lib/mcp-server.js"),
    ]);
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const tools = mt.buildModelTools({
      core,
      rules: rulesMod,
      hostctl: hostMod,
      updater: updMod,
      renderStatus: mt.defaultRenderStatus,
      rejectIfNeedPrompt: () => null,
    });
    if (mode === "--drill") {
      const t9 = tools.find((x) => x.name === "purge_drill");
      const at = args.indexOf("--drill");
      const op = at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : "summary";
      console.log((await t9.execute({ op })).text);
      return;
    }
    if (mode === "--tools") {
      for (const t2 of tools) {
        const params = Object.keys(t2.parameters.properties || {}).join(",") || "-";
        console.log(`${t2.name.padEnd(14)} 参数=${params.padEnd(12)} ${t2.description.split("。")[0]}。`);
      }
      console.log(`共 ${tools.length} 个工具（宿主 ctx.tools 与 MCP 共用这张表）`);
      return;
    }
    await mcp.runMcpServer({ tools, name: "dsh-purge", version: pkg.version });
    return;
  }

  const state = await core.gatherState();
  // 更新框架的台账原本只被面板读；CLI 也读一份，不开面板也能看到渠道与升级史。
  const updMod = await import("../lib/update.js");
  const hostMod = await import("../lib/host.js");
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const host = hostMod.dshHostVersion();
  const align = hostMod.hostAlignment(pkg.dshTarget, host.app || host.runtime);
  const ledger = updMod.updateLedger(3);
  const last = ledger.last;
  const updateInfo = {
    ...updMod.channelPublic(),
    ...host,
    target: pkg.dshTarget,
    aligned: align.aligned,
    lastLabel: last
      ? `${last.version || last.ref} · ${last.ref}${last.sha ? ` · ${last.sha}` : ""} · ${String(last.at || "").slice(0, 10)}`
      : "无记录（面板从未执行更新）",
    guardLabel: ledger.guard
      ? `${ledger.guard.ref} · ${ledger.guard.sha || "-"} · ${String(ledger.guard.at || "").slice(0, 10)}`
      : "无（auto-update-guard.json 未生成）",
  };
  if (mode !== "--align") console.log(printStatus(state, updateInfo));
  console.log("");

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      console.log("  fix: 把 DSH_BASE 指到含 dsh-agent-instructions/lib 的 @deepseek-ai 目录");
      process.exit(1);
    }
    const inject = rules.resolveInjectText(state.dsh_home);
    if (!inject.text) {
      console.log("[ERROR] 提示词和规则集都是空的，必须先添加提示词");
      process.exit(1);
    }
    const { hosts, report } = await core.applyPatchesAllHosts(core.ALL_PATCHES, {
      preserveClientBundles: false,
      forApply: true,
    });
    for (const h of hosts) console.log(`  宿主 / host → ${h.aiBase}`);
    for (const r of report) {
      const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    const flashHost = hosts[0]?.aiBase || state.ai_base;
    const flash = core.silenceCmdFlash(flashHost);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    console.log(`  触及宿主 / hosts touched ${hosts.length} 个${hosts.length > 1 ? "（多宿主：一次 apply 全部触及）" : ""}`);
    console.log(inject.source === "rule"
      ? "  - 使用当前规则集，不改写提示词文件"
      : "  - 使用已有提示词文件");
    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else {
      console.log("  ⚠ 未定位 shim 目录，跳过注入");
    }
    console.log("");
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
  } else if (mode === "--revert") {
    if (state.ai_base || core.enumeratePatchAiBases().length) {
      const { reverted, errors, hosts } = await core.revertAllHosts();
      console.log(`  触及宿主 / hosts touched ${(hosts || []).length} 个`);
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
      if (reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--uninstall") {
    const { uninstallPurge } = await import("../lib/uninstall.js");
    const result = await uninstallPurge();
    if (result.applied) console.log("  已检测到补丁，已还原回原版。");
    else console.log("  未检测到已应用补丁，仍会清除插件文件。");
    if (result.override?.removed) console.log(`  已删除 ${result.override.path}`);
    if (result.stripped?.length) console.log(`  已从 profile 移除: ${result.stripped.join(", ")}`);
    for (const e of result.errors || []) console.log(`  ⚠ ${e}`);
    if (!result.ok) {
      console.log("  卸载中止：还原失败，插件文件未删除。");
      process.exit(1);
    }
    console.log("");
    console.log("卸载完成。请重启 dsh。");
  } else if (mode === "--align") {
    console.log(core.alignSummary(state, {
      host: hostMod.dshHostVersion(),
      target: updMod.targetVersion(),
      ledger: updMod.updateLedger(3),
      withNames: true,
    }));
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件：${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件：${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。");
  } else {
    console.log("默认不清洗，使用 --apply 应用清洗。");
  }
}

main().catch((e) => {
  console.error("[dsh-purge] error:", e);
  process.exit(1);
});
