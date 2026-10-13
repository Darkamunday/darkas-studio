import "server-only";
import { OllamaError, type ChatTurn, type StreamPiece, type TokenUsage, type ToolCall, type ToolDef } from "./ollama";

// Client for OpenRouter's chat API (OpenAI-compatible), used only for adult chats. Needs
// OPENROUTER_API_KEY in .env.local (from openrouter.ai/keys); the key never leaves the server.
// Every request asks OpenRouter to route only to providers that don't store or train on prompts.

// OPENROUTER_BASE_URL is only for testing against a stand-in server.
const BASE = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const key = () => process.env.OPENROUTER_API_KEY;

export const openRouterConfigured = () => !!key();

type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; content: string; tool_call_id: string };

/**
 * Our turns in OpenAI's format. Tool calls need ids that tool results point back to; ours have none, so
 * each call gets one here and the results that follow (always in the same order) are matched to them.
 * Ids are exactly 9 letters and digits: some providers (Mistral's, via Venice) reject anything else.
 */
export function toMessages(turns: ChatTurn[]): OpenAIMessage[] {
  const waiting: string[] = [];
  let n = 0;
  return turns.flatMap((t): OpenAIMessage[] => {
    if (t.role === "tool") {
      const id = waiting.shift();
      // A result with no call before it can't be sent; skip it rather than fail the request.
      return id ? [{ role: "tool", content: t.content, tool_call_id: id }] : [];
    }
    if (t.role === "assistant" && t.tool_calls?.length) {
      const calls = t.tool_calls.map((c) => {
        const id = `c${String(++n).padStart(8, "0")}`;
        waiting.push(id);
        return { id, type: "function" as const, function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) } };
      });
      return [{ role: "assistant", content: t.content, tool_calls: calls }];
    }
    return [{ role: t.role as "system" | "user" | "assistant", content: t.content }];
  });
}

async function post(body: object, signal?: AbortSignal): Promise<Response> {
  const apiKey = key();
  if (!apiKey) throw new OllamaError("not_configured");
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Darka's Studio",
    },
    body: JSON.stringify({
      ...body,
      // Only providers that don't keep or learn from what's sent.
      provider: { data_collection: "deny" },
      // Ask for token counts (and cost) with the reply.
      usage: { include: true },
    }),
  });
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  // Details go to the log (never the prompt); people see a short message in their own language.
  console.error(`[openrouter] POST /chat/completions → ${res.status} ${detail.slice(0, 300)}`);
  if (res.status === 401 || res.status === 403) throw new OllamaError("bad_key");
  if (res.status === 402) throw new OllamaError("no_credit");
  if (res.status === 429 || res.status === 502 || res.status === 503) throw new OllamaError("busy");
  if (res.status === 404) throw new OllamaError("model", detail);
  throw new OllamaError("generic", `HTTP ${res.status}`);
}

type StreamedToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: string } };

type Chunk = {
  choices?: {
    delta?: { content?: string | null; reasoning?: string | null; tool_calls?: StreamedToolCall[] };
    message?: { content?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number };
};

const usageOf = (c: Chunk): TokenUsage | null =>
  c.usage ? { input: c.usage.prompt_tokens ?? 0, output: c.usage.completion_tokens ?? 0 } : null;

/**
 * Stream a reply (Server-Sent Events), yielding reasoning and answer text as they arrive, and any tool
 * calls once the reply is complete (their arguments arrive in pieces).
 */
export async function* streamOpenRouter(opts: {
  model: string;
  messages: ChatTurn[];
  maxTokens: number;
  /** Tools the model may call (same shape as Ollama's, which is OpenAI's). */
  tools?: ToolDef[];
  /** The Think toggle, for models that can reason (left out: the model's own default). */
  think?: boolean;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}): AsyncGenerator<StreamPiece> {
  const res = await post(
    {
      model: opts.model,
      messages: toMessages(opts.messages),
      stream: true,
      max_tokens: opts.maxTokens,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      ...(opts.think === undefined ? {} : { reasoning: { enabled: opts.think } }),
    },
    opts.signal,
  );
  if (!res.body) throw new OllamaError("generic", "empty body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  // Tool calls, put together from their pieces (by position in the reply).
  const calls = new Map<number, { name: string; args: string }>();
  const finishedCalls = function* (): Generator<StreamPiece> {
    for (const [, c] of [...calls].sort(([a], [b]) => a - b)) {
      if (!c.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = c.args.trim() ? (JSON.parse(c.args) as Record<string, unknown>) : {};
      } catch {
        console.error(`[openrouter] couldn't read the arguments for ${c.name}`);
      }
      const call: ToolCall = { function: { name: c.name, arguments: args } };
      yield { kind: "tool_call", call };
    }
    calls.clear();
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return yield* finishedCalls();
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      // Blank lines separate events; lines starting ":" are keep-alive comments.
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return yield* finishedCalls();
      const chunk = JSON.parse(data) as Chunk;
      if (chunk.error) {
        console.error(`[openrouter] stream error: ${chunk.error.code ?? ""} ${chunk.error.message ?? ""}`);
        throw new OllamaError(chunk.error.code === 402 ? "no_credit" : "generic", chunk.error.message);
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning) yield { kind: "thinking", text: delta.reasoning };
      if (delta?.content) yield { kind: "text", text: delta.content };
      for (const piece of delta?.tool_calls ?? []) {
        const at = piece.index ?? 0;
        const call = calls.get(at) ?? { name: "", args: "" };
        if (piece.function?.name) call.name += piece.function.name;
        if (piece.function?.arguments) call.args += piece.function.arguments;
        calls.set(at, call);
      }
      const usage = usageOf(chunk);
      if (usage) opts.onUsage?.(usage);
    }
  }
}

/** A non-streamed reply (e.g. improving an image description in an adult chat). */
export async function completeOpenRouter(
  model: string,
  messages: ChatTurn[],
  { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
): Promise<{ text: string; usage: TokenUsage | null }> {
  const res = await post({ model, messages: toMessages(messages), stream: false, max_tokens: 1_000 }, AbortSignal.timeout(timeoutMs));
  const body = (await res.json()) as Chunk;
  if (body.error) throw new OllamaError("generic", body.error.message);
  return { text: body.choices?.[0]?.message?.content ?? "", usage: usageOf(body) };
}
