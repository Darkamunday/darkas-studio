import "server-only";
import { McpError, callTool as call, type McpEndpoint, type ToolResult } from "./mcp/client";

// Comfy Cloud's MCP server (https://docs.comfy.org/agent-tools/cloud), used for images in chat with the
// same COMFY_CLOUD_API_KEY the cover feature uses. COMFY_MCP_URL overrides the endpoint (tests).

export const COMFY_MCP_URL = process.env.COMFY_MCP_URL || "https://cloud.comfy.org/mcp";
const KEY = process.env.COMFY_CLOUD_API_KEY;

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

export type { ToolResult };

const endpoint = (): McpEndpoint => ({ key: "comfy-builtin", url: COMFY_MCP_URL, headers: { "X-API-Key": KEY ?? "" } });

/** Call one of Comfy's MCP tools. Throws ComfyMcpError if the call itself fails; tool-level errors come back as isError. */
export async function callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<ToolResult> {
  if (!KEY) throw new ComfyMcpError("not_configured");
  try {
    return await call(endpoint(), name, args, timeoutMs);
  } catch (err) {
    if (err instanceof McpError) {
      throw new ComfyMcpError(err.reason === "unauthorized" ? "not_configured" : err.reason, err.message);
    }
    throw err;
  }
}
