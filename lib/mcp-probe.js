/**
 * 用途：MCP HTTP 端点探测器——对宿主内的 POST /dsh-purge/mcp 跑一遍协议矩阵，给可执行结论而不是抛错。
 * 用法：node bin/dsh-purge.js --mcp-probe [baseUrl]
 *      （baseUrl 缺省取 DSH_WEB_URL；都没有时打印用法并退出码 1，不瞎猜端口）
 * 依赖：Node ≥18 全局 fetch；协议侧与 lib/mcp-server.js 同一份实现（不重复定义方法集）。
 * 验证：2026-11-09 实跑通过 —— 对本地 stub（同样调 mcpRespond）得到 live/9 个工具/文本回显；对未重启的运行中宿主得到 not-live（405）解释。
 */
const MATRIX = [
  { label: "initialize", msg: (sid) => ({ jsonrpc: "2.0", id: sid, method: "initialize", params: { protocolVersion: "2025-06-18" } }) },
  { label: "tools/list", msg: (sid) => ({ jsonrpc: "2.0", id: sid, method: "tools/list" }) },
  { label: "tools/call purge_align", msg: (sid) => ({ jsonrpc: "2.0", id: sid, method: "tools/call", params: { name: "purge_align", arguments: {} } }) },
];

async function post(url, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON：交给上层按原样报 */ }
    return { status: res.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 * @returns {Promise<{state: "live"|"not-live"|"unreachable"|"error", lines: string[], detail?: object}>}
 */
export async function probeMcpEndpoint(options = {}) {
  const base = String(options.baseUrl || "").replace(/\/+$/, "");
  if (!base) {
    return { state: "error", lines: ["没给 baseUrl：用 --mcp-probe http://127.0.0.1:<端口>，或设 DSH_WEB_URL。"] };
  }
  const url = `${base}/dsh-purge/mcp`;
  const lines = [`端点 ${url}`];
  const timed = async (msg) => {
    const t0 = Date.now();
    const r = await post(url, msg, options.timeoutMs);
    return { ...r, ms: Date.now() - t0 };
  };
  let first = null;
  try {
    first = await timed(MATRIX[0].msg(1));
  } catch (e) {
    return { state: "unreachable", lines: [...lines, `连不上：${String(e?.message ?? e).slice(0, 90)}｜dsh 在跑吗？`] };
  }
  if (first.status === 404 || first.status === 405) {
    return {
      state: "not-live",
      lines: [
        ...lines,
        `HTTP ${first.status}：路由还没生效。`,
        "解释：purge 的 HTTP MCP 端点是插件内注册的 POST 路由，宿主进程要重启才会加载带这条路由的代码。",
        "下一步：重启 dsh 再跑一次本命令，应转为 live。",
      ],
      detail: { status: first.status },
    };
  }
  if (!first.json) {
    return { state: "error", lines: [...lines, `HTTP ${first.status} 但不是 JSON：${first.text.slice(0, 100).replace(/\s+/g, " ")}`] };
  }
  if (first.json.error) {
    return { state: "error", lines: [...lines, `initialize 返回错误：${first.json.error.code} ${first.json.error.message}`] };
  }
  const info = first.json.result?.serverInfo || {};
  lines.push(`initialize ✓ server=${info.name || "?"} v${info.version || "?"} proto=${first.json.result?.protocolVersion || "?"}（${first.ms}ms）`);

  let list = null;
  try {
    list = await timed(MATRIX[1].msg(2));
  } catch (e) {
    return { state: "error", lines: [...lines, `tools/list 失败：${String(e?.message ?? e).slice(0, 90)}`] };
  }
  const toolNames = (list.json?.result?.tools || []).map((t) => t.name);
  if (!toolNames.length) {
    return { state: "error", lines: [...lines, `tools/list 没返回工具（HTTP ${list.status}）`] };
  }
  lines.push(`tools/list ✓ ${toolNames.length} 个：${toolNames.join(", ")}（${list.ms}ms）`);

  let call = null;
  try {
    call = await timed(MATRIX[2].msg(3));
  } catch (e) {
    return { state: "error", lines: [...lines, `tools/call 失败：${String(e?.message ?? e).slice(0, 90)}`] };
  }
  const text = call.json?.result?.content?.[0]?.text;
  if (!text) {
    return { state: "error", lines: [...lines, `tools/call 没有文本内容（HTTP ${call.status}）`] };
  }
  lines.push(`tools/call ✓ 首行：${text.split("\n")[0]}（${call.ms}ms，冷启动读宿主目录会慢）`);
  return { state: "live", lines, detail: { tools: toolNames, serverInfo: info } };
}
