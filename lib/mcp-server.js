/**
 * 用途：把模型工具契约表暴露成 MCP server（stdio 上的 JSON-RPC 2.0，一行一条消息）。
 * 用法：node bin/dsh-purge.js --mcp     # 供任何 MCP 客户端连接（宿主侧 dsh-mcp-client 亦是 stdio 起子进程）
 * 依赖：Node ≥18（node:readline）；工具定义取自 lib/model-tools.js，此处不另写一份。
 * 验证：2026-11-09 实跑通过 —— initialize / tools/list（8 个工具）/ tools/call purge_skills 三条消息均有正确响应。
 */
import readline from "node:readline";
import process from "node:process";

const PROTOCOL = "2024-11-05";

export async function runMcpServer(options = {}) {
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const name = options.name || "dsh-purge";
  const version = options.version || "0.0.0";
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;

  const send = (msg) => {
    output.write(`${JSON.stringify(msg)}\n`);
  };
  const rl = readline.createInterface({ input, terminal: false });

  for await (const raw of rl) {
    const text = String(raw || "").trim();
    if (!text) continue;
    let req = null;
    try {
      req = JSON.parse(text);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    const id = req.id;
    const hasId = id !== undefined && id !== null;
    try {
      if (req.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name, version },
          },
        });
      } else if (req.method === "ping") {
        if (hasId) send({ jsonrpc: "2.0", id, result: {} });
      } else if (req.method === "tools/list") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
          },
        });
      } else if (req.method === "tools/call") {
        const tool = tools.find((t) => t.name === req.params?.name);
        if (!tool) {
          send({ jsonrpc: "2.0", id, error: { code: -32602, message: `未知工具：${req.params?.name}` } });
          continue;
        }
        const result = await tool.execute(req.params?.arguments ?? {});
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: String(result?.text ?? "") }], isError: false },
        });
      } else if (!hasId) {
        // 通知（如 notifications/initialized）按协议不回复。
      } else {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${req.method}` } });
      }
    } catch (e) {
      if (hasId) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } });
    }
  }
}
