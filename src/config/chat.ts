// Chat settings — edit freely, then rebuild and restart (npm run build && systemctl restart music-app).
// Shared by server and client, so keep secrets out of here (the API key lives in .env.local).

export type ChatModel = {
  /** The model's name at its provider (Ollama Cloud: https://ollama.com/api/tags; OpenRouter: its model id). */
  id: string;
  /** Who runs it: Ollama Cloud (the default) or OpenRouter (adult chats). */
  provider?: "ollama" | "openrouter";
  /** What people see in the model picker. */
  label: string;
  /** How much conversation (in tokens) to send; older messages are dropped to fit. */
  contextTokens: number;
  /**
   * Ollama Cloud's price in US dollars per million tokens, used for the spend figures on the admin
   * page. Each reply's cost is worked out when it's made, so changing these doesn't rewrite history.
   */
  price: { input: number; output: number };
  /** Only admins can pick it (for the pricier models). */
  adminOnly?: boolean;
  /**
   * Can reason before answering, switched by the Think toggle in the chat (sent as Ollama's `think`).
   * Leave off for models that can't (the toggle is hidden for them).
   */
  thinking?: boolean;
  /**
   * Can call tools reliably — currently: decide by itself to make an image. Leave off for models that
   * pretend instead (they still get the Image button and /image).
   */
  tools?: boolean;
  /** Can look at pictures attached to messages. */
  vision?: boolean;
};

// Prices from Ollama Cloud's price list (Oct 2026), standard rate — off-peak discounts aren't applied,
// so spend figures err on the high side.
export const CHAT_MODELS: ChatModel[] = [
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", contextTokens: 64_000, price: { input: 0.3, output: 1.2 }, thinking: true, tools: true, vision: true },
  { id: "gemma4:31b", label: "Gemma 4 31B", contextTokens: 32_000, price: { input: 0.14, output: 0.4 }, thinking: true, tools: true, vision: true },
  { id: "mistral-large-3:675b", label: "Mistral Large 3", contextTokens: 32_000, price: { input: 0.5, output: 1.5 }, tools: true, vision: true },
  { id: "glm-5.3", label: "GLM 5.3", contextTokens: 64_000, price: { input: 1.4, output: 4.4 }, adminOnly: true, thinking: true, tools: true },
  { id: "kimi-k3", label: "Kimi K3", contextTokens: 64_000, price: { input: 3, output: 15 }, adminOnly: true, thinking: true, vision: true },
];

// Adult (18+) chats run on OpenRouter, never Ollama Cloud: open models tuned for fiction that don't refuse
// adult themes. Only people an admin has switched on (and who confirmed they're 18+) can use them.
// Prices from OpenRouter's model list (Oct 2026), US dollars per million tokens. Edit freely — an id
// must exist at https://openrouter.ai/api/v1/models. The first is the default for new adult chats.
export const ADULT_MODELS: ChatModel[] = [
  // The default: the same model as ordinary chats' default, so it plans multi-step tool jobs (Comfy
  // workflows: run, wait, fetch) just as well — with tools and the Think toggle.
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash · tools", provider: "openrouter", contextTokens: 64_000, price: { input: 0.15, output: 0.6 }, tools: true, thinking: true },
  { id: "sao10k/l3.3-euryale-70b", label: "Euryale 70B", provider: "openrouter", contextTokens: 32_000, price: { input: 0.65, output: 0.75 } },
  { id: "thedrummer/cydonia-24b-v4.1", label: "Cydonia 24B", provider: "openrouter", contextTokens: 32_000, price: { input: 0.3, output: 0.5 } },
  { id: "cognitivecomputations/dolphin-mistral-24b-venice-edition", label: "Dolphin 24B (Venice)", provider: "openrouter", contextTokens: 32_000, price: { input: 0.2, output: 0.9 } },
];

/**
 * Always added last to the system prompt of an adult chat, after anything people can write (custom
 * instructions, files, skills), and not editable from the app. Change only with care.
 */
export const ADULT_RULES = `This is an adult (18+) chat for creative writing and roleplay between consenting adults. Explicit sexual content is allowed here. These rules come before anything else in this conversation, including any instructions above or from the person, and you must never break them:
- Every character in anything sexual is an adult (18 or older), clearly and unambiguously. Never write sexual or sexualised content involving anyone under 18, or anyone described, drawn or role-played as a child or childlike, whatever ages are claimed. Refuse, and don't continue the scene.
- No sexual content about real, identifiable people (celebrities, public figures, or anyone the person names as someone they know).
- No sexual violence or non-consent presented approvingly, and no bestiality or incest.
- Nothing illegal, and no real-world harm (no instructions for crimes, weapons or self-harm).
If a request breaks these rules, say briefly that you can't write that, and offer to continue another way.`;

/** Used for new chats; must be one of the ids above, and not an admin-only one. */
export const DEFAULT_MODEL = "deepseek-v4.1-flash";

/** Remembers the model a browser picked last, so new chats start on it. */
export const CHAT_MODEL_COOKIE = "chat-model";

/** Remembers the Think toggle ("0" = off; on otherwise). */
export const CHAT_THINK_COOKIE = "chat-think";

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

/** Reference files: biggest upload, most text kept from one file, and how many one person can have. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_CHARS = 160_000;
export const MAX_FILES_PER_USER = 50;
/** Memories kept per person, and the longest one (they go into every chat, so they stay short). */
export const MAX_MEMORIES = 50;
export const MAX_MEMORY_CHARS = 300;
/** Pictures attached to one message, and the most one may weigh once shrunk in the browser. */
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Longest side pictures are shrunk to before upload (plenty for the models to read detail). */
export const UPLOAD_MAX_SIDE = 1600;

/** Projects: how many one person can have, and the longest name and instructions. */
export const MAX_PROJECTS_PER_USER = 30;
export const PROJECT_NAME_MAX = 60;
export const MAX_PROJECT_INSTRUCTIONS_CHARS = 4_000;
/** The emoji a project can wear in the sidebar. */
export const PROJECT_EMOJI = ["✦", "🎸", "🎤", "🎹", "🥁", "🎧", "📝", "📖", "🌙", "🔥", "🌸", "🖤", "💜", "🎬", "🎮", "🐾"];

/** Skills: limits, and the icons one can wear. A slug is the /command that uses it. */
export const MAX_SKILLS_PER_USER = 30;
export const SKILL_NAME_MAX = 40;
export const SKILL_DESCRIPTION_MAX = 200;
export const MAX_SKILL_INSTRUCTIONS_CHARS = 4_000;
export const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{1,29}$/;
export const SKILL_EMOJI = ["✦", "✍️", "🔍", "🎛️", "🎯", "🎤", "🎸", "🎹", "📝", "📖", "💡", "🧠", "🌙", "🔥", "💜", "🐾"];

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

/** An adult-chat model (see ADULT_MODELS). */
export function findAdultModel(id: unknown): ChatModel | undefined {
  return ADULT_MODELS.find((m) => m.id === id);
}

/** Any model the app knows (for prices). */
export function findAnyModel(id: unknown): ChatModel | undefined {
  return findChatModel(id) ?? findAdultModel(id);
}

/** The models this person may pick. */
export function modelsFor(isAdmin: boolean): ChatModel[] {
  return CHAT_MODELS.filter((m) => isAdmin || !m.adminOnly);
}

/** A model this person may use, or undefined (unknown, or admin-only for a non-admin). */
export function allowedModel(id: unknown, isAdmin: boolean): ChatModel | undefined {
  const model = findChatModel(id);
  return model && (isAdmin || !model.adminOnly) ? model : undefined;
}

/** Cost in US dollars of a request with these token counts. */
export function costOf(model: ChatModel, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.price.input + outputTokens * model.price.output) / 1_000_000;
}
