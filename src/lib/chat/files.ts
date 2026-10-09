import "server-only";
import { db, transaction } from "../db";

// Each person's chat reference files. Every query is scoped to the owner.

export type FileMeta = { id: number; name: string; size_bytes: number; chars: number; always: number; created_at: number };
export type FileWithText = FileMeta & { text: string };

/** Rough token count of a file's text (same rule of thumb as context trimming). */
export const fileTokens = (chars: number) => Math.ceil(chars / 4);

/** A file as the browser sees it (never its text). Shared by server and client code. */
export type ClientFile = { id: number; name: string; tokens: number; always: boolean };
export const toClientFile = (f: FileMeta): ClientFile => ({ id: f.id, name: f.name, tokens: fileTokens(f.chars), always: !!f.always });

const META = "id, name, size_bytes, length(text) AS chars, always, created_at";

export function listFiles(userId: number): FileMeta[] {
  return db
    .prepare(`SELECT ${META} FROM chat_files WHERE user_id = ? ORDER BY name COLLATE NOCASE, id`)
    .all(userId) as FileMeta[];
}

export function countFiles(userId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM chat_files WHERE user_id = ?").get(userId) as { n: number }).n;
}

export function getFile(userId: number, id: number): FileWithText | undefined {
  return db.prepare(`SELECT ${META}, text FROM chat_files WHERE id = ? AND user_id = ?`).get(id, userId) as
    | FileWithText
    | undefined;
}

export function addFile(userId: number, name: string, sizeBytes: number, text: string): FileMeta {
  const id = Number(
    db.prepare("INSERT INTO chat_files (user_id, name, size_bytes, text) VALUES (?, ?, ?, ?)").run(userId, name, sizeBytes, text)
      .lastInsertRowid,
  );
  return getFile(userId, id)!;
}

export function updateFile(userId: number, id: number, patch: { name?: string; always?: boolean }): boolean {
  const file = getFile(userId, id);
  if (!file) return false;
  db.prepare("UPDATE chat_files SET name = ?, always = ? WHERE id = ? AND user_id = ?").run(
    patch.name ?? file.name,
    patch.always === undefined ? file.always : patch.always ? 1 : 0,
    id,
    userId,
  );
  return true;
}

export function deleteFile(userId: number, id: number): boolean {
  return db.prepare("DELETE FROM chat_files WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

/** Ids of the files attached to one of this person's chats. */
export function attachedFileIds(userId: number, conversationId: number): number[] {
  return (
    db
      .prepare(
        `SELECT cf.file_id FROM conversation_files cf
           JOIN conversations c ON c.id = cf.conversation_id
          WHERE cf.conversation_id = ? AND c.user_id = ?`,
      )
      .all(conversationId, userId) as { file_id: number }[]
  ).map((r) => r.file_id);
}

/** Replace a chat's attachments. Ids that aren't this person's files are ignored. */
export function setAttachedFiles(userId: number, conversationId: number, fileIds: number[]) {
  transaction(() => {
    db.prepare("DELETE FROM conversation_files WHERE conversation_id = ?").run(conversationId);
    const add = db.prepare(
      `INSERT OR IGNORE INTO conversation_files (conversation_id, file_id)
       SELECT ?, id FROM chat_files WHERE id = ? AND user_id = ?`,
    );
    for (const id of new Set(fileIds)) add.run(conversationId, id, userId);
  });
}

/**
 * What a chat should know: its attached files, its project's files and the person's always-on ones,
 * by name. `extraIds` are files picked for a chat that doesn't exist yet. A project's files are its
 * owner's, so they're read by project (`projectId` must already be checked as one this person can use).
 */
export function filesForChat(
  userId: number,
  conversationId: number | null,
  extraIds: number[] = [],
  projectId: number | null = null,
): FileWithText[] {
  const ids = new Set([...(conversationId ? attachedFileIds(userId, conversationId) : []), ...extraIds]);
  const own = (
    db
      .prepare(`SELECT ${META}, text FROM chat_files WHERE user_id = ?`)
      .all(userId) as FileWithText[]
  ).filter((f) => f.always || ids.has(f.id));
  const fromProject = projectId
    ? (db
        .prepare(`SELECT ${META}, text FROM chat_files WHERE id IN (SELECT file_id FROM project_files WHERE project_id = ?)`)
        .all(projectId) as FileWithText[])
    : [];
  const all = [...own, ...fromProject.filter((f) => !own.some((o) => o.id === f.id))];
  return all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id - b.id);
}
