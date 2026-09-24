import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import type { TrackRow } from "./tracks";

export type SharedTrack = TrackRow & {
  username: string;
  prompt: string | null;
  style: string | null;
  mode: "simple" | "advanced";
  instrumental: number;
  remix_of_title: string | null;
  remix_of_username: string | null;
};

// 128 bits, URL-safe: unguessable, so an unshared song can't be found by trying links.
const newToken = () => randomBytes(16).toString("base64url");

/** Only the person who made the song may share it — admins deliberately can't share others' work. */
function ownedTrack(userId: number, trackId: number) {
  return db
    .prepare(
      `SELECT t.id, t.share_token FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE t.id = ? AND g.user_id = ? AND g.status = 'complete'`,
    )
    .get(trackId, userId) as { id: number; share_token: string | null } | undefined;
}

/** Turn sharing on (idempotent: an already-shared track keeps its link). Returns the token, or null if not allowed. */
export function enableShare(userId: number, trackId: number): string | null {
  const track = ownedTrack(userId, trackId);
  if (!track) return null;
  if (track.share_token) return track.share_token;
  const token = newToken();
  db.prepare("UPDATE tracks SET share_token = ?, shared_at = unixepoch() WHERE id = ?").run(token, trackId);
  return token;
}

/** Turn sharing off. The old link stops working immediately; re-sharing makes a new one. */
export function disableShare(userId: number, trackId: number): boolean {
  if (!ownedTrack(userId, trackId)) return false;
  db.prepare("UPDATE tracks SET share_token = NULL, shared_at = NULL WHERE id = ?").run(trackId);
  return true;
}

export function getSharedTrack(token: string): SharedTrack | undefined {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return undefined;
  return db
    .prepare(
      `SELECT t.*, u.username, g.prompt, g.style, g.mode, g.instrumental, g.remix_of_title, g.remix_of_username
         FROM tracks t
         JOIN generations g ON g.id = t.generation_id
         JOIN users u ON u.id = g.user_id
        WHERE t.share_token = ?`,
    )
    .get(token) as SharedTrack | undefined;
}
