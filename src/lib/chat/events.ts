// The stream POST /api/chat sends the browser: one JSON object per line (NDJSON).
// Shared by server and client. New kinds (e.g. tool calls) can be added without breaking old ones.

import type { ClientImage } from "./images";

export type ChatEvent =
  /** usage: sends today and the daily cap (null = no cap), counting this one. */
  | { type: "meta"; conversationId: number; userMessageId: number | null; usage: { sent: number; cap: number | null } }
  | { type: "thinking"; text: string }
  | { type: "delta"; text: string }
  /** thinkingMs: how long the model reasoned before answering (null if it didn't). */
  | { type: "done"; messageId: number | null; thinkingMs: number | null }
  | { type: "title"; title: string }
  /** An image for this reply: sent when it's started (pending) and again when it's ready or failed. */
  | { type: "image"; image: ClientImage }
  | { type: "error"; reason: string };
