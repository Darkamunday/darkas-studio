// Test fixtures. Everything is invented (test_… users, "Test Song" titles) — never real people's data.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { resolveMediaPath } from "@/lib/storage";

let seq = 0;
const next = () => ++seq;

export function makeUser(name = `test_user_${next()}`, opts: { admin?: boolean; chat?: boolean } = {}): number {
  return Number(
    db
      .prepare("INSERT INTO users (username, password_hash, is_admin, chat_enabled) VALUES (?, 'x', ?, ?)")
      .run(name, opts.admin ? 1 : 0, opts.chat === false ? 0 : 1).lastInsertRowid,
  );
}

export function makeConversation(userId: number, projectId: number | null = null): number {
  return Number(db.prepare("INSERT INTO conversations (user_id, model, project_id) VALUES (?, 'm', ?)").run(userId, projectId).lastInsertRowid);
}

export function makeMessage(conversationId: number, role: "user" | "assistant", content = "Test text"): number {
  return Number(db.prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)").run(conversationId, role, content).lastInsertRowid);
}

/** A finished song (one take) by this person. */
export function makeSong(userId: number, opts: { private?: boolean; cover?: boolean; projectId?: number | null } = {}): { generationId: number; trackId: number } {
  const generationId = Number(
    db
      .prepare("INSERT INTO generations (user_id, mode, title, model, status, project_id) VALUES (?, 'advanced', 'Test Song', 'V5', 'complete', ?)")
      .run(userId, opts.projectId ?? null).lastInsertRowid,
  );
  const trackId = Number(
    db
      .prepare("INSERT INTO tracks (generation_id, suno_audio_id, title, is_private, image_path) VALUES (?, ?, 'Test Song', ?, ?)")
      .run(generationId, `test-audio-${next()}`, opts.private ? 1 : 0, opts.cover ? "covers/test.jpg" : null).lastInsertRowid,
  );
  return { generationId, trackId };
}

/** A finished chat picture (or video/audio), with a small file on disk. */
export function makeChatImage(userId: number, conversationId: number, kind: "image" | "video" | "audio" = "image", status = "ready"): number {
  const rel = `chat-images/test-${next()}.${kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png"}`;
  writeFileSync(resolveMediaPath(rel), "test");
  return Number(
    db
      .prepare(
        `INSERT INTO chat_images (user_id, conversation_id, prompt, model, aspect, status, file_path, kind, project_id)
         VALUES (?, ?, 'a test picture', 'x', 'square', ?, ?, ?, (SELECT project_id FROM conversations WHERE id = ?))`,
      )
      .run(userId, conversationId, status, rel, kind, conversationId).lastInsertRowid,
  );
}

export function makeFile(userId: number, name = "Test Character A.md", text = "Test notes"): number {
  return Number(db.prepare("INSERT INTO chat_files (user_id, name, size_bytes, text) VALUES (?, ?, ?, ?)").run(userId, name, text.length, text).lastInsertRowid);
}

export const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Fails unless every object in `value` is a plain object or array. Client components can't take
 * SQLite rows (null prototype), and passing one crashes the page — this has happened before.
 */
export function assertPlain(value: unknown, where = "$"): void {
  if (value === null || typeof value !== "object") return;
  const proto = Object.getPrototypeOf(value);
  assert.ok(proto === Object.prototype || proto === Array.prototype, `${where} is not a plain object (SQLite row?)`);
  for (const [k, v] of Object.entries(value)) assertPlain(v, `${where}.${k}`);
}
