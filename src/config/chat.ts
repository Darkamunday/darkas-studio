// Chat settings — edit freely, then rebuild and restart (npm run build && systemctl restart music-app).
// Shared by server and client, so keep secrets out of here (the API key lives in .env.local).

export type ChatModel = {
  /** Ollama Cloud model name, as listed at https://ollama.com/api/tags */
  id: string;
  /** What people see in the model picker. */
  label: string;
  /** How much conversation (in tokens) to send; older messages are dropped to fit. */
  contextTokens: number;
};

export const CHAT_MODELS: ChatModel[] = [
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", contextTokens: 64_000 },
  { id: "glm-5.3", label: "GLM 5.3", contextTokens: 64_000 },
  { id: "kimi-k3", label: "Kimi K3", contextTokens: 64_000 },
  { id: "gemma4:31b", label: "Gemma 4 31B", contextTokens: 32_000 },
  { id: "mistral-large-3:675b", label: "Mistral Large 3", contextTokens: 32_000 },
];

/** Used for new chats; must be one of the ids above. */
export const DEFAULT_MODEL = "deepseek-v4.1-flash";

/** Remembers the model a browser picked last, so new chats start on it. */
export const CHAT_MODEL_COOKIE = "chat-model";

/** Room kept free in the context window for the reply. */
export const MAX_REPLY_TOKENS = 4_000;

/** Messages a person can send per day (Europe/London), unless the admin page sets their own cap. Admins have no cap. */
export const DEFAULT_DAILY_CAP = 50;

/** Longest conversation title, in characters. */
export const CHAT_TITLE_MAX = 80;

/** Longest master prompt an admin can save, in characters. */
export const MAX_MASTER_PROMPT_CHARS = 8_000;

/** Longest custom instructions a person can save, in characters. */
export const MAX_INSTRUCTIONS_CHARS = 1_500;

/** Longest message someone can send, in characters. */
export const MAX_MESSAGE_CHARS = 20_000;

/**
 * The default master prompt, sent first with every message. Admins can replace it from the Admin page
 * (stored in the database); this is used whenever that's empty.
 */
export const SYSTEM_PROMPT = `You are a friendly, helpful general assistant inside Darka's Studio.
Be warm and clear. Keep answers as short as the question allows, and go into detail when asked.
Use Markdown where it helps (lists, tables, code blocks with a language tag).
If you're not sure about something, say so rather than guessing.`;

export function findChatModel(id: unknown): ChatModel | undefined {
  return CHAT_MODELS.find((m) => m.id === id);
}
