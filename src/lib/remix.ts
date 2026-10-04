import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { PUBLIC_ORIGIN } from "./suno";
import type { TrackRow } from "./tracks";

// Remix sources are handed to the provider as a temporary, signed link to our
// copy of the audio: /api/remix-source/<trackId>.<expiry>.<sig>/song.mp3
const LINK_TTL_SECONDS = 24 * 60 * 60;

// Derived from the API key so there's no extra secret to manage; rotating the key rotates this too.
const signingKey = () => createHash("sha256").update(`remix-source:${process.env.SUNO_API_KEY ?? ""}`).digest();
const sign = (payload: string) => createHmac("sha256", signingKey()).update(payload).digest("base64url");

export function remixSourceUrl(trackId: number): string {
  const payload = `${trackId}.${Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS}`;
  return `${PUBLIC_ORIGIN}/api/remix-source/${payload}.${sign(payload)}/song.mp3`;
}

/** Returns the track id if the token is authentic and unexpired, else null. */
export function verifyRemixSourceToken(token: string): number | null {
  const m = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  const [, id, exp, sig] = m;
  if (Number(exp) < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(id);
}

export type RemixSource = Pick<TrackRow, "id" | "title" | "lyrics" | "style_tags" | "genre" | "duration" | "allow_remix" | "is_private"> & {
  owner_id: number;
  username: string;
  instrumental: number;
  has_cover: number;
};

export function getRemixSource(trackId: number): RemixSource | undefined {
  return db
    .prepare(
      `SELECT t.id, t.title, t.lyrics, t.style_tags, t.genre, t.duration, t.allow_remix, t.is_private,
              g.user_id AS owner_id, u.username, g.instrumental,
              (t.image_path IS NOT NULL OR t.source_image_url IS NOT NULL) AS has_cover
         FROM tracks t JOIN generations g ON g.id = t.generation_id JOIN users u ON u.id = g.user_id
        WHERE t.id = ? AND g.status = 'complete' AND (t.audio_path IS NOT NULL OR t.source_audio_url IS NOT NULL)`,
    )
    .get(trackId) as RemixSource | undefined;
}

/**
 * Anyone may remix a track unless its creator has switched remixing off or made it private;
 * creators can always remix their own.
 */
export function canRemix(user: { id: number }, src: { owner_id: number; allow_remix: number; is_private: number }) {
  return src.owner_id === user.id || (src.allow_remix === 1 && src.is_private === 0);
}

/** Creator-only toggle. Returns false if the user doesn't own the track. */
export function setAllowRemix(userId: number, trackId: number, allow: boolean): boolean {
  const r = db
    .prepare(
      `UPDATE tracks SET allow_remix = ?
        WHERE id = ? AND generation_id IN (SELECT id FROM generations WHERE user_id = ?)`,
    )
    .run(allow ? 1 : 0, trackId, userId);
  return r.changes > 0;
}
