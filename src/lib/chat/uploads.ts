import "server-only";
import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { db } from "../db";
import { MEDIA_DIR, removeMediaFile, resolveMediaPath } from "../storage";
import { MAX_UPLOAD_BYTES } from "@/config/chat";

// Pictures people attach to their own messages, for models that can see images. Uploaded first
// (not yet in any message), then claimed by the message they're sent with. Only their owner sees them.

const UPLOAD_DIR = path.join(MEDIA_DIR, "chat-uploads");
/** Images sent to the model with each request: the ones on the latest few messages that have any. */
const MESSAGES_WITH_IMAGES_SENT = 3;

/** An attached picture as the browser sees it. Shared by server and client code. */
export type ClientUpload = { id: number; messageId: number | null; url: string };

type UploadRow = { id: number; user_id: number; conversation_id: number | null; message_id: number | null; file_path: string; bytes: number; created_at: number };

const toClient = (r: UploadRow): ClientUpload => ({ id: r.id, messageId: r.message_id, url: `/api/chat/uploads/${r.id}` });

export class UploadError extends Error {
  constructor(public reason: "upload_type" | "file_too_big") {
    super(reason);
  }
}

/**
 * The picture type from its first bytes (never trusting the name or the browser's word). The browser
 * re-encodes pictures as JPEG before upload; PNG is allowed too. Both are what the models accept.
 */
function sniff(buf: Buffer): ".jpg" | ".png" | null {
  if (buf.length < 8) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  return null;
}

/** Keep an uploaded picture until it's sent. */
export async function saveUpload(userId: number, buf: Buffer): Promise<ClientUpload> {
  if (buf.length > MAX_UPLOAD_BYTES) throw new UploadError("file_too_big");
  const ext = sniff(buf);
  if (!ext) throw new UploadError("upload_type");
  // Never write into a bare mount point if the media drive is missing.
  if (!(await stat(MEDIA_DIR).then((s) => s.isDirectory(), () => false))) throw new Error(`Media folder ${MEDIA_DIR} is missing`);
  await pruneUnsent(userId);
  await mkdir(UPLOAD_DIR, { recursive: true });
  const id = Number(
    db.prepare("INSERT INTO chat_uploads (user_id, file_path, bytes) VALUES (?, '', ?)").run(userId, buf.length).lastInsertRowid,
  );
  const rel = path.relative(MEDIA_DIR, path.join(UPLOAD_DIR, `${id}${ext}`));
  try {
    await writeFile(resolveMediaPath(rel), buf);
  } catch (err) {
    db.prepare("DELETE FROM chat_uploads WHERE id = ?").run(id);
    throw err;
  }
  db.prepare("UPDATE chat_uploads SET file_path = ? WHERE id = ?").run(rel, id);
  return toClient(getUpload(userId, id)!);
}

/** One of this person's pictures. */
export function getUpload(userId: number, id: number): UploadRow | undefined {
  return db.prepare("SELECT * FROM chat_uploads WHERE id = ? AND user_id = ? AND file_path <> ''").get(id, userId) as
    | UploadRow
    | undefined;
}

/** Whether these are all this person's pictures, uploaded and not yet sent. */
export function unsentUploads(userId: number, ids: number[]): boolean {
  if (!ids.length) return true;
  const n = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_uploads
          WHERE user_id = ? AND message_id IS NULL AND file_path <> '' AND id IN (${ids.map(() => "?").join(",")})`,
      )
      .get(userId, ...ids) as { n: number }
  ).n;
  return n === new Set(ids).size;
}

/** Tie pictures to the message they were sent with (checked with unsentUploads first). */
export function claimUploads(userId: number, ids: number[], conversationId: number, messageId: number) {
  const claim = db.prepare(
    "UPDATE chat_uploads SET conversation_id = ?, message_id = ? WHERE id = ? AND user_id = ? AND message_id IS NULL",
  );
  for (const id of new Set(ids)) claim.run(conversationId, messageId, id, userId);
}

/** Pictures on the messages in one of this person's chats. */
export function listUploads(userId: number, conversationId: number): ClientUpload[] {
  return (
    db
      .prepare("SELECT * FROM chat_uploads WHERE user_id = ? AND conversation_id = ? AND message_id IS NOT NULL ORDER BY id")
      .all(userId, conversationId) as UploadRow[]
  ).map(toClient);
}

/**
 * The pictures to send the model, as base64 by message id: those on the latest few messages that
 * have any (older ones would cost a lot on every reply, and the model has usually said what it saw).
 */
export async function imagesForPrompt(userId: number, conversationId: number): Promise<Map<number, string[]>> {
  const rows = db
    .prepare(
      `SELECT message_id, file_path FROM chat_uploads
        WHERE user_id = ? AND conversation_id = ? AND message_id IN (
          SELECT DISTINCT message_id FROM chat_uploads
           WHERE user_id = ? AND conversation_id = ? AND message_id IS NOT NULL
           ORDER BY message_id DESC LIMIT ?)
        ORDER BY id`,
    )
    .all(userId, conversationId, userId, conversationId, MESSAGES_WITH_IMAGES_SENT) as { message_id: number; file_path: string }[];
  const out = new Map<number, string[]>();
  for (const r of rows) {
    const data = await readFile(resolveMediaPath(r.file_path)).catch(() => null);
    if (data) out.set(r.message_id, [...(out.get(r.message_id) ?? []), data.toString("base64")]);
  }
  return out;
}

/** How many pictures each message in a chat has (for a note to models that can't see them). */
export function uploadCounts(userId: number, conversationId: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT message_id, COUNT(*) AS n FROM chat_uploads
        WHERE user_id = ? AND conversation_id = ? AND message_id IS NOT NULL GROUP BY message_id`,
    )
    .all(userId, conversationId) as { message_id: number; n: number }[];
  return new Map(rows.map((r) => [r.message_id, r.n]));
}

/** Delete an unsent picture (taken off before sending). */
export async function deleteUnsent(userId: number, id: number): Promise<boolean> {
  const row = db.prepare("SELECT * FROM chat_uploads WHERE id = ? AND user_id = ? AND message_id IS NULL").get(id, userId) as
    | UploadRow
    | undefined;
  if (!row) return false;
  if (row.file_path) await removeMediaFile(row.file_path);
  db.prepare("DELETE FROM chat_uploads WHERE id = ?").run(id);
  return true;
}

/** Before a chat is deleted: remove its pictures' files (the rows go with the chat). */
export async function removeConversationUploads(userId: number, conversationId: number) {
  const rows = db
    .prepare("SELECT file_path FROM chat_uploads WHERE user_id = ? AND conversation_id = ? AND file_path <> ''")
    .all(userId, conversationId) as { file_path: string }[];
  for (const r of rows) await removeMediaFile(r.file_path);
}

/** Pictures uploaded but never sent (the tab was closed, say) are cleared out after a day. */
async function pruneUnsent(userId: number) {
  const rows = db
    .prepare("SELECT id, file_path FROM chat_uploads WHERE user_id = ? AND message_id IS NULL AND created_at < unixepoch() - 86400")
    .all(userId) as { id: number; file_path: string }[];
  for (const r of rows) {
    if (r.file_path) await rm(resolveMediaPath(r.file_path), { force: true });
    db.prepare("DELETE FROM chat_uploads WHERE id = ?").run(r.id);
  }
}
