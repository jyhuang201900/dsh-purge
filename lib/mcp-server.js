/**
 * 用途：MCP 协议处理（JSON-RPC 2.0）——单一来源，stdio 循环与宿主 HTTP 路由共用同一份 mcpRespond。
 * 用法：node bin/dsh-purge.js --mcp（stdio）；宿主内 POST /dsh-purge/mcp（streamable-http，供 dsh-mcp-client 直连）
 * 依赖：Node ≥18（node:readline）；工具定义取自 lib/model-tools.js，此处不另写一份。
 * 验证：2026-11-09 实跑通过 —— stdio 三条消息全通；mcpRespond 单测覆盖 initialize / tools/list / tools/call / 通知 / 未知方法 / 解析错误 / 批量。
 *
 * 为什么要 mcpRespond：宿主 dsh-mcp-client 支持 stdio 与 streamable-http 两种 transport。
 * stdio 要求它另起一个子进程；HTTP 端点则可以直接挂在已启动的 webServer 上，省一个进程。
 */
import readline from "node:readline";
import process from "node:process";

const PROTOCOL = "2024-11-05";

/**
 * 处理一条 JSON-RPC 消息。
 * @param {object|string} raw 已解析的请求对象，或原始文本（解析失败会回 -32700）
 * @param {{tools?: Array, name?: string, version?: string}} ctx
 * @returns {Promise<object|null>} 应答对象；通知（无 id）返回 null 表示不该回话
 */
export async function mcpRespond(raw, ctx = {}) {
  const tools = Array.isArray(ctx.tools) ? ctx.tools : [];
  const name = ctx.name || "dsh-purge";
  const version = ctx.version || "0.0.0";
  let req = raw;
  if (typeof raw === "string") {
    try {
      req = JSON.parse(raw);
    } catch {
      return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
    }
  }
  if (Array.isArray(req)) {
    const out = [];
    for (const one of req) {
      const r = await mcpRespond(one, ctx);
      if (r) out.push(r);
    }
    return out.length ? { jsonrpc: "2.0", batch: out } : null;
  }
  if (!req || typeof req !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }
  const id = req.id;
  const hasId = id !== undefined && id !== null;
  const fail = (code, message) => (hasId ? { jsonrpc: "2.0", id, error: { code, message } } : null);

  try {
    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
        },
      };
    }
    if (req.method === "ping") return hasId ? { jsonrpc: "2.0", id, result: {} } : null;
    if (req.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) },
      };
    }
    if (req.method === "tools/call") {
      const tool = tools.find((t) => t.name === req.params?.name);
      if (!tool) return fail(-32602, `未知工具：${req.params?.name}`);
      const result = await tool.execute(req.params?.arguments ?? {});
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: String(result?.text ?? "") }], isError: false },
      };
    }
    if (!hasId) return null; // 通知（notifications/initialized、/cancelled）按协议不回话
    return fail(-32601, `method not found: ${req.method}`);
  } catch (e) {
    return fail(-32603, String(e?.message ?? e));
  }
}

/** stdio 版循环：每行一条消息，走同一个 mcpRespond。 */
export async function runMcpServer(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const rl = readline.createInterface({ input, terminal: false });
  for await (const raw of rl) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const res = await mcpRespond(text, options);
    if (res) output.write(`${JSON.stringify(res)}\n`);
  }
}
