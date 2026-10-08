import "server-only";

// A small client for remote MCP servers over Streamable HTTP (https://modelcontextprotocol.io):
// initialize once, then tools/list and tools/call. One session per server is kept and reused; if the
// server drops it, the next call opens a new one.

const PROTOCOL = "2025-06-18";

/** How to reach a server: its endpoint and (optionally) one auth header. */
export type McpEndpoint = { key: string; url: string; headers: Record<string, string> };

/** Keys into the chat's tool error messages. */
export type McpErrorReason = "not_configured" | "unauthorized" | "busy" | "no_credits" | "rejected" | "generic";

export class McpError extends Error {
  constructor(
    public reason: McpErrorReason,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

export type McpTool = { name: string; description: string; inputSchema: Record<string, unknown> };
export type ToolResult = { text: string; structured: Record<string, unknown> | null; isError: boolean };

const sessions = ((globalThis as unknown as { __mcpSessions?: Map<string, string> }).__mcpSessions ??= new Map());
let nextId = 1;

/** Responses come back as JSON or as an SSE stream of `data:` lines. */
async function parse(res: Response): Promise<{ result?: unknown; error?: { message?: string } } | null> {
  const body = await res.text();
  const json = body.trim().startsWith("{")
    ? body
    : body
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5))
        .join("");
  return json ? JSON.parse(json) : null;
}

function headers(ep: McpEndpoint, session?: string): Record<string, string> {
  return {
    ...ep.headers,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(session ? { "Mcp-Session-Id": session, "MCP-Protocol-Version": PROTOCOL } : {}),
  };
}

async function openSession(ep: McpEndpoint): Promise<string> {
  const res = await fetch(ep.url, {
    method: "POST",
    headers: headers(ep),
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "darkas-studio", version: "1" } },
    }),
  }).catch((err) => {
    console.error(`[mcp] ${ep.url} unreachable`, err);
    throw new McpError("generic", "unreachable");
  });
  const session = res.headers.get("mcp-session-id") ?? "";
  await parse(res).catch(() => null);
  if (!res.ok) {
    console.error(`[mcp] ${ep.url} initialize → ${res.status}`);
    throw new McpError(res.status === 401 || res.status === 403 ? "unauthorized" : "generic", `initialize ${res.status}`);
  }
  await fetch(ep.url, {
    method: "POST",
    headers: headers(ep, session || undefined),
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});
  sessions.set(ep.key, session);
  return session;
}

/** One JSON-RPC request, opening (or re-opening) the session as needed. */
async function request(ep: McpEndpoint, method: string, params: object, timeoutMs: number): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = sessions.get(ep.key) ?? (await openSession(ep));
    const res = await fetch(ep.url, {
      method: "POST",
      headers: headers(ep, session || undefined),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    // An expired or unknown session: start a fresh one and try once more.
    if ((res.status === 404 || res.status === 400) && attempt === 0) {
      sessions.delete(ep.key);
      continue;
    }
    const body = await parse(res).catch(() => null);
    if (!res.ok || !body || body.error) {
      console.error(`[mcp] ${ep.url} ${method} → ${res.status} ${body?.error?.message ?? ""}`);
      if (res.status === 401 || res.status === 403) throw new McpError("unauthorized");
      if (res.status === 429) throw new McpError("busy");
      if (res.status === 402) throw new McpError("no_credits");
      throw new McpError("generic", `${method} ${res.status}`);
    }
    return body.result;
  }
  throw new McpError("generic", "session retry failed");
}

/** The server's tools (all pages). */
export async function listTools(ep: McpEndpoint): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = (await request(ep, "tools/list", cursor ? { cursor } : {}, 30_000)) as {
      tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      nextCursor?: string;
    };
    for (const t of result.tools ?? []) {
      tools.push({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema ?? { type: "object" } });
    }
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return tools;
}

/** Call a tool. Throws McpError if the call itself fails; a tool-level failure comes back as isError. */
export async function callTool(ep: McpEndpoint, name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<ToolResult> {
  const result = (await request(ep, "tools/call", { name, arguments: args }, timeoutMs)) as {
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  return {
    text: (result.content ?? []).map((c) => c.text ?? "").join("\n"),
    structured: result.structuredContent ?? null,
    isError: !!result.isError,
  };
}
