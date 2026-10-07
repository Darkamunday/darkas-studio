import type { ChatTurn } from "./ollama";
import type { ChatModel } from "@/config/chat";
import { MAX_REPLY_TOKENS } from "@/config/chat";

// Rough token estimate (~4 characters each, plus a little per message). Good enough to keep
// long chats under the model's window without shipping a tokenizer.
const estimate = (t: ChatTurn) => Math.ceil(t.content.length / 4) + 4;

/** Rough token count for some text or turns (for when the provider doesn't report one). */
export const estimateTokens = (turns: ChatTurn[]) => turns.reduce((n, t) => n + estimate(t), 0);

/** The master prompt (admin-set, or the config default), followed by the person's own instructions if they've set any. */
export function systemPrompt(base: string, instructions: string | null): string {
  if (!instructions) return base;
  return `${base}

The person you're talking with has given these custom instructions for how you should respond. Follow them unless they conflict with the guidance above:
<custom_instructions>
${instructions}
</custom_instructions>`;
}

/**
 * The system prompt plus as much recent history as fits in the model's window, newest kept first.
 * The latest message is always sent, even if it alone is over budget.
 */
export function buildPrompt(system: string, history: ChatTurn[], model: ChatModel): ChatTurn[] {
  const sys: ChatTurn = { role: "system", content: system };
  let budget = model.contextTokens - MAX_REPLY_TOKENS - estimate(sys);
  const kept: ChatTurn[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimate(history[i]);
    if (kept.length > 0 && cost > budget) break;
    kept.unshift(history[i]);
    budget -= cost;
  }
  // Don't open on a dangling assistant turn whose question was trimmed away.
  while (kept.length > 1 && kept[0].role === "assistant") kept.shift();
  return [sys, ...kept];
}
