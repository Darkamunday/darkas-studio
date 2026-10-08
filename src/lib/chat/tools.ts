import "server-only";
import { db } from "../db";
import { McpError, callTool } from "../mcp/client";
import { catalogueLine, loadedTools, markLoaded, serverEndpoint, toolsFor, type AvailableTool } from "../mcp/registry";
import { canMakeImage, saveToolMedia, type ClientImage } from "./images";
import type { ToolDef } from "./ollama";

// Connected (MCP) tools in chat. The model sees a short catalogue of what it may use and loads full
// definitions on demand with `load_tools` (Comfy's alone would otherwise add ~18k tokens to every
// message). Each call is logged in chat_tool_calls — that drives the cards in the chat and approvals.

/** Result text sent back to the model is cut to this (some tools return a lot). */
const MAX_RESULT_CHARS = 4_000;
/** At most this many files are kept from one result. */
const MAX_MEDIA_PER_CALL = 4;

export const LOAD_TOOLS: ToolDef = {
  type: "function",
  function: {
    name: "load_tools",
    description:
      "Load connected tools from the catalogue in your instructions so you can call them. Pass the exact names you need; after this call they're available to call directly for the rest of the chat.",
    parameters: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" }, description: "Tool names from the catalogue" } },
      required: ["names"],
    },
  },
};

export type ToolCallStatus = "awaiting_approval" | "running" | "done" | "failed" | "declined";

/** A tool call as the browser sees it. Shared by server and client code. */
export type ClientToolCall = {
  id: number;
  messageId: number | null;
  server: string;
  tool: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  /** A line or two of what came back, for the card. */
  summary: string | null;
};

type CallRow = {
  id: number;
  user_id: number;
  conversation_id: number;
  message_id: number | null;
  server_id: number | null;
  tool: string;
  args: string;
  status: ToolCallStatus;
  result: string | null;
};

const serverName = (id: number | null) =>
  id === null ? "?" : ((db.prepare("SELECT name FROM mcp_servers WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "?");

function toClient(r: CallRow): ClientToolCall {
  return {
    id: r.id,
    messageId: r.message_id,
    server: serverName(r.server_id),
    tool: r.tool,
    args: JSON.parse(r.args) as Record<string, unknown>,
    status: r.status,
    summary: r.result ? r.result.replace(/\s+/g, " ").slice(0, 240) : null,
  };
}

const getCall = (id: number) => db.prepare("SELECT * FROM chat_tool_calls WHERE id = ?").get(id) as CallRow | undefined;

export function listToolCalls(userId: number, conversationId: number): ClientToolCall[] {
  return (
    db.prepare("SELECT * FROM chat_tool_calls WHERE user_id = ? AND conversation_id = ? ORDER BY id").all(userId, conversationId) as CallRow[]
  ).map(toClient);
}

export function attachToolCallsToMessage(ids: number[], messageId: number) {
  for (const id of ids) db.prepare("UPDATE chat_tool_calls SET message_id = ? WHERE id = ?").run(messageId, id);
}

/** A call waiting for this person's approval in one of their chats. */
export function pendingApproval(userId: number, callId: number): (CallRow & { qualified: string }) | undefined {
  const row = getCall(callId);
  if (!row || row.user_id !== userId || row.status !== "awaiting_approval" || row.server_id === null) return undefined;
  const slug = (db.prepare("SELECT slug FROM mcp_servers WHERE id = ?").get(row.server_id) as { slug: string } | undefined)?.slug;
  return slug ? { ...row, qualified: `${slug}__${row.tool}` } : undefined;
}

// ---- what the model gets -------------------------------------------------------------------

/** JSON Schema keys some models' tool parsers choke on. */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = schema;
  void _drop;
  return rest;
}

const toDef = (t: AvailableTool): ToolDef => ({
  type: "function",
  function: { name: t.qualified, description: t.description.slice(0, 2_000), parameters: cleanSchema(t.inputSchema) },
});

export type Toolset = {
  available: AvailableTool[];
  /** Full definitions for tools this chat has loaded. */
  loaded: ToolDef[];
  /** The catalogue for the system prompt (empty when nothing's available). */
  catalogue: string;
};

export function toolsetFor(isAdmin: boolean, conversationId: number | null): Toolset {
  const available = toolsFor(isAdmin);
  const loadedNames = conversationId ? loadedTools(conversationId) : new Set<string>();
  return {
    available,
    loaded: available.filter((t) => loadedNames.has(t.qualified)).map(toDef),
    catalogue: available.length
      ? `You can use connected tools. Load the ones you need with load_tools (by exact name), then call them. Tools marked "asks the person first" show them an approval card and pause — say briefly what you want to run and why, then stop. Use tools only when they genuinely help.\n${available.map(catalogueLine).join("\n")}`
      : "",
  };
}

/** Handle load_tools: mark the named tools as loaded for this chat; returns what to tell the model. */
export function loadTools(conversationId: number, available: AvailableTool[], names: unknown): { result: string; defs: ToolDef[] } {
  const wanted = Array.isArray(names) ? names.map(String) : [];
  const found = available.filter((t) => wanted.includes(t.qualified) || wanted.includes(t.name));
  for (const t of found) markLoaded(conversationId, t);
  const missing = wanted.filter((w) => !found.some((t) => t.qualified === w || t.name === w));
  return {
    defs: found.map(toDef),
    result:
      (found.length ? `Loaded: ${found.map((t) => t.qualified).join(", ")}. You can call them now.` : "Nothing loaded.") +
      (missing.length ? ` Not available: ${missing.join(", ")}.` : ""),
  };
}

// ---- running a call --------------------------------------------------------------------------

export type CallOutcome = {
  call: ClientToolCall;
  /** What to tell the model. */
  result: string;
  media: ClientImage[];
  /** True when it's waiting for the person's approval — the turn should stop there. */
  paused: boolean;
};

const MEDIA_LINK = /https?:\/\/[^\s"'<>)\]]+\.(?:png|jpe?g|webp|gif|mp4|webm|mp3|wav|ogg|flac)(?:\?[^\s"'<>)\]]*)?/gi;

/**
 * Files worth keeping from a result: the result's own `url` fields (one per output — Comfy, for
 * instance, also lists a second link to the same file), else media links in its text.
 */
function mediaUrls(structured: unknown, text: string, allowedOrigin: string): string[] {
  const fromFields: string[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "url" && typeof v === "string") fromFields.push(v);
      else walk(v);
    }
  };
  walk(structured);
  const urls = fromFields.length ? fromFields : [...text.matchAll(MEDIA_LINK)].map((m) => m[0]);
  // Only fetch over https, or from the tool's own server (e.g. a local test server).
  return [...new Set(urls)].filter((u) => u.startsWith("https://") || u.startsWith(allowedOrigin)).slice(0, MAX_MEDIA_PER_CALL);
}

/**
 * A tool call the model made. Approval-gated tools are logged and paused; others run now. Tools that
 * spend (the approval-gated ones) also need image access and allowance left, since they make media.
 */
export async function runToolCall(input: {
  userId: number;
  conversationId: number;
  tool: AvailableTool;
  args: Record<string, unknown>;
  /** Set when the person has just approved it (or it never needed approval). */
  approved?: number;
  /** Run without asking even if the tool normally asks (a retry the person's approval already covers). */
  preApproved?: boolean;
  onUpdate: (call: ClientToolCall) => void;
}): Promise<CallOutcome> {
  const { tool } = input;
  let id = input.approved;
  if (id === undefined) {
    id = Number(
      db
        .prepare("INSERT INTO chat_tool_calls (user_id, conversation_id, server_id, tool, args, status) VALUES (?, ?, ?, ?, ?, ?)")
        .run(input.userId, input.conversationId, tool.serverId, tool.name, JSON.stringify(input.args), tool.approval && !input.preApproved ? "awaiting_approval" : "running")
        .lastInsertRowid,
    );
    if (tool.approval && !input.preApproved) {
      const call = toClient(getCall(id)!);
      input.onUpdate(call);
      return {
        call,
        paused: true,
        media: [],
        result: "Waiting for the person to approve this in the chat. Don't call it again — tell them briefly what it will do, then stop.",
      };
    }
  } else {
    db.prepare("UPDATE chat_tool_calls SET status = 'running' WHERE id = ?").run(id);
  }
  input.onUpdate(toClient(getCall(id)!));

  const finish = (status: ToolCallStatus, result: string, media: ClientImage[] = []): CallOutcome => {
    db.prepare("UPDATE chat_tool_calls SET status = ?, result = ? WHERE id = ?").run(status, result.slice(0, MAX_RESULT_CHARS), id);
    const call = toClient(getCall(id)!);
    input.onUpdate(call);
    return { call, result: result.slice(0, MAX_RESULT_CHARS), media, paused: false };
  };

  if (tool.approval && !canMakeImage(input.userId)) {
    return finish("failed", "Not run: the person can't make more images or media today (not switched on, or today's limit is reached). Tell them kindly.");
  }
  const endpoint = serverEndpoint(tool.serverId);
  if (!endpoint) return finish("failed", "Not run: that connection is switched off.");

  // Our approval is the go-ahead tools like Comfy's ask for with a `confirm` argument.
  const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  const args = { ...input.args, ...("confirm" in props ? { confirm: true } : {}), ...("client_os" in props && !input.args.client_os ? { client_os: "linux" } : {}) };

  try {
    const r = await callTool(endpoint, tool.name, args, 180_000);
    const media: ClientImage[] = [];
    if (!r.isError) {
      // A fetch step (e.g. get_output) doesn't repeat the prompt: use the latest one in this chat.
      const description = String(input.args.prompt ?? input.args.description ?? latestPrompt(input.conversationId) ?? tool.name);
      for (const url of mediaUrls(r.structured, r.text, new URL(endpoint.url).origin)) {
        const saved = await saveToolMedia({
          userId: input.userId,
          conversationId: input.conversationId,
          url,
          description,
          source: `mcp:${tool.serverName}`,
        });
        if (saved) media.push(saved);
      }
    }
    const shown = media.filter((m) => m.status === "ready").length;
    let text = (r.isError ? "Tool error: " : "") + (r.text || JSON.stringify(r.structured ?? {}));
    // The files are shown in the chat already; their links expire, so the model needn't pass them on.
    if (shown) text = text.replace(MEDIA_LINK, "[shown to the person]").replace(/https:\/\/\S+\/api\/s\/\S+/g, "[shown to the person]");
    return finish(r.isError ? "failed" : "done", shown ? `${text}\n\n(${shown} file(s) from this result are now shown to the person.)` : text, media);
  } catch (err) {
    const reason = err instanceof McpError ? err.reason : "generic";
    if (!(err instanceof McpError)) console.error(`[tools] ${tool.qualified} failed`, err);
    return finish("failed", `The tool call failed (${reason}). Tell the person briefly; don't retry more than once.`);
  }
}

/** The most recent prompt a tool in this chat was given (to caption media a later step fetched). */
function latestPrompt(conversationId: number): string | undefined {
  const rows = db
    .prepare("SELECT args FROM chat_tool_calls WHERE conversation_id = ? ORDER BY id DESC LIMIT 10")
    .all(conversationId) as { args: string }[];
  for (const r of rows) {
    const a = JSON.parse(r.args) as Record<string, unknown>;
    if (typeof a.prompt === "string" && a.prompt.trim()) return a.prompt.trim();
  }
  return undefined;
}

/** The person said no: log it and give the model something to respond to. */
export function declineToolCall(callId: number, onUpdate: (call: ClientToolCall) => void): string {
  const result = "The person declined to run this. Acknowledge it briefly and offer another way if there is one.";
  db.prepare("UPDATE chat_tool_calls SET status = 'declined', result = ? WHERE id = ?").run(result, callId);
  onUpdate(toClient(getCall(callId)!));
  return result;
}
