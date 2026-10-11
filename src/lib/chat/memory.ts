import "server-only";
import { db } from "../db";
import { MAX_MEMORIES, MAX_MEMORY_CHARS } from "@/config/chat";

// Chat memory: short facts the assistant keeps about a person across all their chats. After each
// message a quick extra model call notices what to save or forget (shown under the reply, with Undo);
// the person sees and edits them all in the Memory window. Only the person sees their memories' text; admins only see how many.

const SETTING = "chat_memory";

/** A memory as the browser sees it. Shared by server and client code. */
export type ClientMemory = { id: number; content: string; source: "model" | "person"; messageId: number | null; updatedAt: number };

type Row = { id: number; content: string; source: "model" | "person"; message_id: number | null; updated_at: number };
const toClient = (r: Row): ClientMemory => ({ id: r.id, content: r.content, source: r.source, messageId: r.message_id, updatedAt: r.updated_at });

// ---- switches ---------------------------------------------------------------------------

/** The app-wide switch (admins). On unless turned off. */
export function memoryOnForApp(): boolean {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTING) as { value: string } | undefined;
  return row?.value !== "off";
}

export function setMemoryForApp(on: boolean, adminId: number) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = unixepoch(), updated_by = excluded.updated_by`,
  ).run(SETTING, on ? "on" : "off", adminId);
}

/** The person's own "Use memory" switch. */
export function memoryOnForUser(userId: number): boolean {
  const row = db.prepare("SELECT memory_enabled FROM users WHERE id = ?").get(userId) as { memory_enabled: number } | undefined;
  return !!row?.memory_enabled;
}

export function setMemoryForUser(userId: number, on: boolean) {
  db.prepare("UPDATE users SET memory_enabled = ? WHERE id = ?").run(on ? 1 : 0, userId);
}

/** Whether chats use (and the model may save) this person's memories. */
export const memoryActive = (userId: number) => memoryOnForApp() && memoryOnForUser(userId);

// ---- the memories -----------------------------------------------------------------------

export function listMemories(userId: number): ClientMemory[] {
  return (
    db.prepare("SELECT id, content, source, message_id, updated_at FROM chat_memories WHERE user_id = ? ORDER BY id").all(userId) as Row[]
  ).map(toClient);
}

/** Memories saved by replies in one of this person's chats (for the notes under those replies). */
export function memoriesSavedIn(userId: number, conversationId: number): ClientMemory[] {
  return (
    db
      .prepare(
        `SELECT k.id, k.content, k.source, k.message_id, k.updated_at FROM chat_memories k JOIN messages m ON m.id = k.message_id
          WHERE k.user_id = ? AND m.conversation_id = ? ORDER BY k.id`,
      )
      .all(userId, conversationId) as Row[]
  ).map(toClient);
}

export type MemoryResult = { ok: true; memory: ClientMemory } | { ok: false; reason: "too_many_memories" | "empty" | "duplicate" };

const clean = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_CHARS);

export function addMemory(userId: number, text: string, source: "model" | "person"): MemoryResult {
  const content = clean(text);
  if (!content) return { ok: false, reason: "empty" };
  if (db.prepare("SELECT 1 FROM chat_memories WHERE user_id = ? AND lower(content) = lower(?)").get(userId, content)) {
    return { ok: false, reason: "duplicate" };
  }
  const count = (db.prepare("SELECT COUNT(*) AS n FROM chat_memories WHERE user_id = ?").get(userId) as { n: number }).n;
  if (count >= MAX_MEMORIES) return { ok: false, reason: "too_many_memories" };
  const id = Number(db.prepare("INSERT INTO chat_memories (user_id, content, source) VALUES (?, ?, ?)").run(userId, content, source).lastInsertRowid);
  return { ok: true, memory: getMemory(userId, id)! };
}

export function getMemory(userId: number, id: number): ClientMemory | undefined {
  const row = db.prepare("SELECT id, content, source, message_id, updated_at FROM chat_memories WHERE id = ? AND user_id = ?").get(id, userId) as
    | Row
    | undefined;
  return row && toClient(row);
}

export function updateMemory(userId: number, id: number, text: string): ClientMemory | undefined {
  const content = clean(text);
  if (!content) return undefined;
  db.prepare("UPDATE chat_memories SET content = ?, updated_at = unixepoch() WHERE id = ? AND user_id = ?").run(content, id, userId);
  return getMemory(userId, id);
}

export function deleteMemory(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM chat_memories WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function deleteAllMemories(userId: number) {
  db.prepare("DELETE FROM chat_memories WHERE user_id = ?").run(userId);
}

/** Tie memories the model saved to the reply that saved them, once it's written. */
export function attachMemoriesToMessage(ids: number[], messageId: number) {
  for (const id of ids) db.prepare("UPDATE chat_memories SET message_id = ? WHERE id = ?").run(messageId, id);
}

/** How many memories each person has (for admins — never the text). */
export function memoryCounts(): Map<number, number> {
  const rows = db.prepare("SELECT user_id, COUNT(*) AS n FROM chat_memories GROUP BY user_id").all() as { user_id: number; n: number }[];
  return new Map(rows.map((r) => [r.user_id, r.n]));
}

// ---- noticing what to remember ----------------------------------------------------------

/** Most memories one message can add. */
const MAX_SAVES_PER_MESSAGE = 3;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    save: { type: "array", items: { type: "string" } },
    forget: { type: "array", items: { type: "integer" } },
  },
  required: ["save", "forget"],
};

const EXTRACT_INSTRUCTIONS = `You keep a music-making assistant's long-term memory about one person: short facts that will help in their future chats. You're given what's already remembered (with ids) and the person's latest message (with the assistant's previous reply for context).

Return JSON {"save": [...], "forget": [...]}:
- "save": new lasting facts about the person from THEIR message — their projects, songs, characters, band, genres and style, tastes, how they like replies, or anything they ask to be remembered. Each one short, self-contained and in the third person (e.g. "Is writing a concept album about a lighthouse keeper."). At most ${MAX_SAVES_PER_MESSAGE}.
- "forget": ids of remembered facts their message shows are wrong or out of date (save the new version too), or that they ask to forget.

Don't save: one-off requests or task details ("write a verse about rain"), questions, things only the assistant said, anything already remembered (even reworded), or sensitive personal data (health, finances, passwords, exact addresses) unless they explicitly ask. Most messages need nothing: then return {"save": [], "forget": []}.`;

/**
 * After a reply: decide from the person's message what to remember or forget, and do it. Returns the
 * changes for the notes in the chat. Never throws — memory is a nice-to-have.
 */
export async function noticeMemories(
  userId: number,
  message: string,
  previousReply: string | null,
  complete: (system: string, user: string, format: object) => Promise<string>,
): Promise<{ action: "saved" | "forgotten"; memory: ClientMemory }[]> {
  if (!message.trim()) return [];
  const known = listMemories(userId);
  let parsed: { save?: unknown; forget?: unknown };
  try {
    const raw = await complete(
      EXTRACT_INSTRUCTIONS,
      `Already remembered:\n${known.length ? known.map((x) => `[#${x.id}] ${x.content}`).join("\n") : "(nothing yet)"}\n\n` +
        (previousReply ? `The assistant's previous reply (context only):\n${previousReply.slice(0, 1500)}\n\n` : "") +
        `The person's latest message:\n${message.slice(0, 4000)}`,
      EXTRACT_SCHEMA,
    );
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[memory] noticing failed", err);
    return [];
  }
  const changes: { action: "saved" | "forgotten"; memory: ClientMemory }[] = [];
  for (const id of Array.isArray(parsed.forget) ? parsed.forget : []) {
    const found = Number.isInteger(id) ? getMemory(userId, id as number) : undefined;
    if (found && deleteMemory(userId, found.id)) changes.push({ action: "forgotten", memory: found });
  }
  for (const text of (Array.isArray(parsed.save) ? parsed.save : []).slice(0, MAX_SAVES_PER_MESSAGE)) {
    if (typeof text !== "string") continue;
    const saved = addMemory(userId, text, "model");
    if (saved.ok) changes.push({ action: "saved", memory: saved.memory });
  }
  return changes;
}
