import "server-only";

// Client for Ollama Cloud's chat API (https://docs.ollama.com/cloud). Needs OLLAMA_API_KEY
// (from ollama.com/settings/keys); without it chat answers "not configured". The key never
// leaves the server.

const BASE = (process.env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
const KEY = process.env.OLLAMA_API_KEY;

export type ChatRole = "user" | "assistant" | "system";
export type ChatTurn = { role: ChatRole; content: string };

/** Keys into the `chat.errors` messages. */
export type OllamaErrorReason = "not_configured" | "bad_key" | "busy" | "model" | "generic";

export class OllamaError extends Error {
  constructor(
    public reason: OllamaErrorReason,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

async function post(body: object, signal?: AbortSignal): Promise<Response> {
  if (!KEY) throw new OllamaError("not_configured");
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  // Details go to the log; people see a short message in their own language.
  console.error(`[ollama] POST /api/chat → ${res.status} ${detail.slice(0, 500)}`);
  if (res.status === 401 || res.status === 403) throw new OllamaError("bad_key");
  if (res.status === 429 || res.status === 503) throw new OllamaError("busy");
  if (res.status === 404) throw new OllamaError("model", detail);
  throw new OllamaError("generic", `HTTP ${res.status}`);
}

type Chunk = {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  error?: string;
  /** Tokens read and written, reported on the final chunk (written includes any reasoning). */
  prompt_eval_count?: number;
  eval_count?: number;
};

export type TokenUsage = { input: number; output: number };

const usageOf = (c: Chunk): TokenUsage | null =>
  c.prompt_eval_count !== undefined || c.eval_count !== undefined
    ? { input: c.prompt_eval_count ?? 0, output: c.eval_count ?? 0 }
    : null;

/** A piece of a streamed reply: its reasoning (for thinking models) or the answer itself. */
export type StreamPiece = { kind: "thinking" | "text"; text: string };

/**
 * Stream a reply, yielding reasoning and answer text as they arrive. Aborting `signal` stops the
 * upstream request. `think` switches reasoning on or off (left out: the model's own default).
 * `onUsage` gets the token counts when the reply finishes (not called if it's cut short).
 */
export async function* streamChat(opts: {
  model: string;
  messages: ChatTurn[];
  numCtx: number;
  think?: boolean;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}): AsyncGenerator<StreamPiece> {
  const res = await post(
    {
      model: opts.model,
      messages: opts.messages,
      stream: true,
      ...(opts.think === undefined ? {} : { think: opts.think }),
      options: { num_ctx: opts.numCtx },
    },
    opts.signal,
  );
  if (!res.body) throw new OllamaError("generic", "empty body");

  // NDJSON: one JSON object per line; a line can be split across network chunks.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const chunk = JSON.parse(line) as Chunk;
      if (chunk.error) {
        console.error(`[ollama] stream error: ${chunk.error}`);
        throw new OllamaError("generic", chunk.error);
      }
      if (chunk.message?.thinking) yield { kind: "thinking", text: chunk.message.thinking };
      if (chunk.message?.content) yield { kind: "text", text: chunk.message.content };
      if (chunk.done) {
        const usage = usageOf(chunk);
        if (usage) opts.onUsage?.(usage);
        return;
      }
    }
  }
}

/**
 * A non-streamed reply, for behind-the-scenes jobs (titles, song drafts). No reasoning: it keeps them
 * quick and cheap. `format` is a JSON schema the reply must follow.
 */
export async function completeChat(
  model: string,
  messages: ChatTurn[],
  { timeoutMs = 20_000, format }: { timeoutMs?: number; format?: object } = {},
): Promise<{ text: string; usage: TokenUsage | null }> {
  const res = await post(
    { model, messages, stream: false, think: false, ...(format ? { format } : {}) },
    AbortSignal.timeout(timeoutMs),
  );
  const body = (await res.json()) as Chunk;
  return { text: body.message?.content ?? "", usage: usageOf(body) };
}
