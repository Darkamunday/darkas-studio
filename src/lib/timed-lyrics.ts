import "server-only";
import { db } from "./db";
import { getTimestampedLyrics } from "./suno";
import type { TimedWord } from "./timed-lyrics-format";

export type TimedLyrics = { words: TimedWord[]; fetched_at: number };

export function getTimedLyrics(trackId: number): TimedLyrics | null {
  const row = db.prepare("SELECT words, fetched_at FROM timed_lyrics WHERE track_id = ?").get(trackId) as
    | { words: string; fetched_at: number }
    | undefined;
  return row ? { words: JSON.parse(row.words) as TimedWord[], fetched_at: row.fetched_at } : null;
}

/** Ask the provider (spends credits) and keep the result. Returns the number of timed words. */
export async function fetchTimedLyrics(
  track: { id: number; suno_audio_id: string; suno_task_id: string },
  byUserId: number,
): Promise<number> {
  const words = (await getTimestampedLyrics(track.suno_task_id, track.suno_audio_id)).map(({ word, startS, endS }) => ({
    word,
    startS,
    endS,
  }));
  if (!words.length) return 0;
  db.prepare(
    `INSERT INTO timed_lyrics (track_id, words, fetched_by) VALUES (?, ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET words = excluded.words, fetched_at = unixepoch(), fetched_by = excluded.fetched_by`,
  ).run(track.id, JSON.stringify(words), byUserId);
  return words.length;
}

export type TimedCandidate = { id: number; title: string | null; username: string; created_at: number; has_timings: number };

/** Recent takes with lyrics that this admin can see (private songs stay their owner's only). */
export function timedLyricsCandidates(viewerId: number, limit = 30): TimedCandidate[] {
  return db
    .prepare(
      `SELECT t.id, t.title, u.username, t.created_at,
              EXISTS (SELECT 1 FROM timed_lyrics l WHERE l.track_id = t.id) AS has_timings
         FROM tracks t JOIN generations g ON g.id = t.generation_id JOIN users u ON u.id = g.user_id
        WHERE g.status = 'complete' AND g.instrumental = 0 AND t.lyrics IS NOT NULL
          AND (t.is_private = 0 OR g.user_id = ?)
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${Number(limit)}`,
    )
    .all(viewerId) as TimedCandidate[];
}

export type TimingTrack = {
  id: number;
  title: string | null;
  suno_audio_id: string;
  suno_task_id: string;
  owner_id: number;
  is_private: number;
  instrumental: number;
  username: string;
  duration: number | null;
};

export function getTimingTrack(trackId: number): TimingTrack | undefined {
  return db
    .prepare(
      `SELECT t.id, t.title, t.suno_audio_id, g.suno_task_id, g.user_id AS owner_id, t.is_private, g.instrumental,
              u.username, t.duration
         FROM tracks t JOIN generations g ON g.id = t.generation_id JOIN users u ON u.id = g.user_id
        WHERE t.id = ? AND g.status = 'complete'`,
    )
    .get(trackId) as TimingTrack | undefined;
}
