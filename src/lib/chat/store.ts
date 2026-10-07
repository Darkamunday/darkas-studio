import "server-only";
import { db } from "../db";
import type { ChatRole } from "./ollama";

// Every query here is scoped to the owner: nothing loads a conversation by id alone, so one
// person can never read or change another's chats.

export type Conversation = {
  id: number;
  title: string | null;
  model: string;
  created_at: number;
  updated_at: number;
};

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  /** The model's reasoning before this reply, if it thought. */
  thinking: string | null;
  thinking_ms: number | null;
  created_at: number;
};

export function listConversations(userId: number): Conversation[] {
  return db
    .prepare(
      `SELECT id, title, model, created_at, updated_at FROM conversations
        WHERE user_id = ? ORDER BY updated_at DESC, id DESC`,
    )
    .all(userId) as Conversation[];
}

export function getConversation(userId: number, id: number): Conversation | undefined {
  return db
    .prepare("SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?")
    .get(id, userId) as Conversation | undefined;
}

export function createConversation(userId: number, model: string): number {
  const res = db.prepare("INSERT INTO conversations (user_id, model) VALUES (?, ?)").run(userId, model);
  return Number(res.lastInsertRowid);
}

export function renameConversation(userId: number, id: number, title: string): boolean {
  return db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?").run(title, id, userId).changes > 0;
}

export function setConversationModel(userId: number, id: number, model: string) {
  db.prepare("UPDATE conversations SET model = ? WHERE id = ? AND user_id = ?").run(model, id, userId);
}

export function deleteConversation(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function listMessages(userId: number, conversationId: number): ChatMessage[] {
  return db
    .prepare(
      `SELECT m.id, m.role, m.content, m.thinking, m.thinking_ms, m.created_at
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.conversation_id = ? AND c.user_id = ?
        ORDER BY m.id`,
    )
    .all(conversationId, userId) as ChatMessage[];
}

/** Append a message to a conversation the caller has already checked belongs to the user. */
export function addMessage(
  conversationId: number,
  role: ChatRole,
  content: string,
  thinking: { text: string; ms: number | null } | null = null,
): number {
  const res = db
    .prepare("INSERT INTO messages (conversation_id, role, content, thinking, thinking_ms) VALUES (?, ?, ?, ?, ?)")
    .run(conversationId, role, content, thinking?.text || null, thinking?.ms ?? null);
  db.prepare("UPDATE conversations SET updated_at = unixepoch() WHERE id = ?").run(conversationId);
  return Number(res.lastInsertRowid);
}

/** Remove the trailing assistant reply (for regenerate). Returns whether one was removed. */
export function dropLastAssistant(conversationId: number): boolean {
  const last = db
    .prepare("SELECT id, role FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1")
    .get(conversationId) as { id: number; role: ChatRole } | undefined;
  if (last?.role !== "assistant") return false;
  db.prepare("DELETE FROM messages WHERE id = ?").run(last.id);
  return true;
}

// ---- custom instructions ------------------------------------------------------

export function getInstructions(userId: number): string | null {
  const row = db.prepare("SELECT chat_instructions FROM users WHERE id = ?").get(userId) as
    | { chat_instructions: string | null }
    | undefined;
  return row?.chat_instructions ?? null;
}

/** Empty clears them. */
export function setInstructions(userId: number, text: string) {
  db.prepare("UPDATE users SET chat_instructions = ? WHERE id = ?").run(text.trim() || null, userId);
}
