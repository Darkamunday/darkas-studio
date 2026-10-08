import "server-only";

// Client for Comfy Cloud's MCP server (https://docs.comfy.org/agent-tools/cloud), used for images in
// chat. Speaks MCP over Streamable HTTP with the same COMFY_CLOUD_API_KEY the cover feature uses.
// One session is kept and reused; if Comfy drops it, the next call opens a new one.

const URL_ = process.env.COMFY_MCP_URL || "https://cloud.comfy.org/mcp";
const KEY = process.env.COMFY_CLOUD_API_KEY;
const PROTOCOL = "2025-06-18";

export const comfyMcpEnabled = () => Boolean(KEY);

/** Keys into the `chat.imageErrors` messages. */
export type ComfyMcpErrorReason = "not_configured" | "busy" | "no_credits" | "rejected" | "generic";

export class ComfyMcpError extends Error {
  constructor(
    public reason: ComfyMcpErrorReason,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

export type ToolResult = { text: string; structured: Record<string, unknown> | null; isError: boolean };

const globalForMcp = globalThis as unknown as { __comfyMcpSession?: string | null };

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

function headers(session?: string | null): Record<string, string> {
  return {
    "X-API-Key": KEY ?? "",
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(session ? { "Mcp-Session-Id": session, "MCP-Protocol-Version": PROTOCOL } : {}),
  };
}

async function openSession(): Promise<string> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "darkas-studio", version: "1" } },
    }),
  });
  const session = res.headers.get("mcp-session-id");
  await parse(res);
  if (!res.ok || !session) {
    console.error(`[comfy-mcp] initialize → ${res.status}`);
    throw new ComfyMcpError(res.status === 401 || res.status === 403 ? "not_configured" : "generic", `initialize ${res.status}`);
  }
  await fetch(URL_, {
    method: "POST",
    headers: headers(session),
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  globalForMcp.__comfyMcpSession = session;
  return session;
}

/** Call one of Comfy's MCP tools. Throws ComfyMcpError if the call itself fails; tool-level errors come back as isError. */
export async function callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<ToolResult> {
  if (!KEY) throw new ComfyMcpError("not_configured");
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = globalForMcp.__comfyMcpSession ?? (await openSession());
    const res = await fetch(URL_, {
      method: "POST",
      headers: headers(session),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    });
    // An expired or unknown session: start a fresh one and try once more.
    if ((res.status === 404 || res.status === 400) && attempt === 0) {
      globalForMcp.__comfyMcpSession = null;
      continue;
    }
    const body = await parse(res).catch(() => null);
    if (!res.ok || !body || body.error) {
      console.error(`[comfy-mcp] ${name} → ${res.status} ${body?.error?.message ?? ""}`);
      if (res.status === 429) throw new ComfyMcpError("busy");
      if (res.status === 402) throw new ComfyMcpError("no_credits");
      throw new ComfyMcpError("generic", `${name} ${res.status}`);
    }
    const result = body.result as { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
    return {
      text: (result.content ?? []).map((c) => c.text ?? "").join("\n"),
      structured: result.structuredContent ?? null,
      isError: !!result.isError,
    };
  }
  throw new ComfyMcpError("generic", "session retry failed");
}
