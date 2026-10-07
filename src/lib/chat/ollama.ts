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

type Chunk = { message?: { content?: string }; done?: boolean; error?: string };

/** Stream a reply, yielding text as it arrives. Aborting `signal` stops the upstream request. */
export async function* streamChat(opts: {
  model: string;
  messages: ChatTurn[];
  numCtx: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const res = await post(
    { model: opts.model, messages: opts.messages, stream: true, options: { num_ctx: opts.numCtx } },
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
      // Reasoning models also send message.thinking; it isn't shown, so it's skipped.
      if (chunk.message?.content) yield chunk.message.content;
      if (chunk.done) return;
    }
  }
}

/** A short, non-streamed reply (used for conversation titles). */
export async function completeChat(model: string, messages: ChatTurn[], timeoutMs = 20_000): Promise<string> {
  const res = await post({ model, messages, stream: false }, AbortSignal.timeout(timeoutMs));
  const body = (await res.json()) as Chunk;
  return body.message?.content ?? "";
}
