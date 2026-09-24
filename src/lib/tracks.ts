import "server-only";
import { db, transaction } from "./db";
import { AUDIO_DIR, COVER_DIR, downloadTo, removeMediaFile } from "./storage";
import { getRecord, type SunoClip, type SunoTaskStatus } from "./suno";

export const MOODS = ["Chill", "Happy", "Hype", "Dreamy", "Romantic", "Melancholy", "Dark", "Epic"] as const;

export const MAX_IN_FLIGHT_PER_USER = 2;
const POLL_INTERVAL_SECONDS = 4;
const TIMEOUT_SECONDS = 15 * 60;

export type GenerationStatus = "pending" | "text_ready" | "first_ready" | "complete" | "failed";
const TERMINAL: GenerationStatus[] = ["complete", "failed"];

export type GenerationRow = {
  id: number;
  user_id: number;
  suno_task_id: string;
  mode: "simple" | "advanced";
  prompt: string | null;
  lyrics: string | null;
  style: string | null;
  title: string | null;
  mood: string | null;
  instrumental: number;
  model: string;
  status: GenerationStatus;
  error: string | null;
  last_polled_at: number | null;
  created_at: number;
  completed_at: number | null;
  remix_of_track_id: number | null;
  remix_of_title: string | null;
  remix_of_username: string | null;
};

export type TrackRow = {
  id: number;
  generation_id: number;
  suno_audio_id: string;
  title: string | null;
  lyrics: string | null;
  style_tags: string | null;
  genre: string | null;
  mood: string | null;
  duration: number | null;
  image_path: string | null;
  audio_path: string | null;
  source_audio_url: string | null;
  source_stream_url: string | null;
  source_image_url: string | null;
  share_token: string | null;
  shared_at: number | null;
  allow_remix: number;
  created_at: number;
};

const now = () => Math.floor(Date.now() / 1000);

// ---- derived catalogue fields ------------------------------------------------

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** First style descriptor that isn't about vocals/tempo, e.g. "uk garage, female vocals" → "UK Garage". */
export function deriveGenre(tags: string | null): string | null {
  if (!tags) return null;
  const skip = /vocal|voice|bpm|singer|male|female|instrumental|tempo/i;
  const first = tags
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .find((t) => t && !skip.test(t));
  if (!first) return null;
  // "cheerful indie pop" → "indie pop": mood adjectives belong in the mood field.
  const words = first.toLowerCase().split(/\s+/);
  while (words.length > 1 && MOOD_ADJECTIVE.test(words[0])) words.shift();
  return titleCase(words.join(" ")).replace(/\bUk\b/g, "UK").replace(/\bRnb\b/g, "RnB").slice(0, 40);
}

// Exact words only: a loose match would eat genres like "funk" or "hard rock".
const MOOD_ADJECTIVE =
  /^(cheerful|upbeat|uplifting|happy|sunny|bright|joyful|chill|mellow|calm|relaxed|laid-back|dreamy|ethereal|hazy|moody|dark|sad|melancholic|melancholy|emotional|nostalgic|wistful|romantic|epic|energetic|aggressive|intense|soulful|gentle|soft|warm|groovy|catchy|playful|bittersweet|smooth|lush|atmospheric)$/;

const MOOD_KEYWORDS: Record<(typeof MOODS)[number], RegExp> = {
  Chill: /chill|lo-?fi|relax|mellow|calm|ambient|laid.?back/i,
  Happy: /happy|upbeat|joy|cheer|sunny|bright|fun/i,
  Hype: /hype|energetic|aggressive|intense|banger|party|drill|hard/i,
  Dreamy: /dream|ethereal|atmospheric|shoegaze|airy|hazy/i,
  Romantic: /romantic|love|sensual|tender/i,
  Melancholy: /sad|melanchol|emotional|heartbreak|somber|wistful|nostalgic/i,
  Dark: /dark|moody|sinister|brooding|gothic|ominous/i,
  Epic: /epic|cinematic|orchestral|anthem|triumphant/i,
};

export function deriveMood(chosen: string | null, ...texts: (string | null)[]): string | null {
  if (chosen) return chosen;
  const haystack = texts.filter(Boolean).join(" ");
  for (const [mood, re] of Object.entries(MOOD_KEYWORDS)) if (re.test(haystack)) return mood;
  return null;
}

// ---- generations -----------------------------------------------------------

export function inFlightCount(userId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND status NOT IN ('complete', 'failed')")
      .get(userId) as { n: number }
  ).n;
}

export function insertGeneration(g: {
  userId: number;
  taskId: string;
  mode: "simple" | "advanced";
  prompt?: string | null;
  lyrics?: string | null;
  style?: string | null;
  title?: string | null;
  mood?: string | null;
  instrumental: boolean;
  model: string;
  remixOf?: { trackId: number; title: string | null; username: string } | null;
}): number {
  const r = db
    .prepare(
      `INSERT INTO generations (user_id, suno_task_id, mode, prompt, lyrics, style, title, mood, instrumental, model,
                                remix_of_track_id, remix_of_title, remix_of_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      g.userId,
      g.taskId,
      g.mode,
      g.prompt ?? null,
      g.lyrics ?? null,
      g.style ?? null,
      g.title ?? null,
      g.mood ?? null,
      g.instrumental ? 1 : 0,
      g.model,
      g.remixOf?.trackId ?? null,
      g.remixOf?.title ?? null,
      g.remixOf?.username ?? null,
    );
  return Number(r.lastInsertRowid);
}

export function getGeneration(id: number) {
  return db.prepare("SELECT * FROM generations WHERE id = ?").get(id) as GenerationRow | undefined;
}

export function getGenerationByTask(taskId: string) {
  return db.prepare("SELECT * FROM generations WHERE suno_task_id = ?").get(taskId) as GenerationRow | undefined;
}

export function tracksForGeneration(generationId: number) {
  return db.prepare("SELECT * FROM tracks WHERE generation_id = ? ORDER BY id").all(generationId) as TrackRow[];
}

export function pendingGenerationsForUser(userId: number) {
  return db
    .prepare(
      "SELECT * FROM generations WHERE user_id = ? AND status NOT IN ('complete', 'failed') ORDER BY created_at DESC",
    )
    .all(userId) as GenerationRow[];
}

const STATUS_MAP: Record<SunoTaskStatus, GenerationStatus> = {
  PENDING: "pending",
  TEXT_SUCCESS: "text_ready",
  FIRST_SUCCESS: "first_ready",
  SUCCESS: "complete",
  CREATE_TASK_FAILED: "failed",
  GENERATE_AUDIO_FAILED: "failed",
  CALLBACK_EXCEPTION: "failed",
  SENSITIVE_WORD_ERROR: "failed",
};

const FAILURE_MESSAGES: Partial<Record<SunoTaskStatus, string>> = {
  SENSITIVE_WORD_ERROR: "Something in the prompt or lyrics got flagged — try rephrasing.",
  CREATE_TASK_FAILED: "The studio couldn't start this one — give it another go.",
  GENERATE_AUDIO_FAILED: "The studio couldn't finish the audio — give it another go.",
};

function upsertClips(gen: GenerationRow, clips: SunoClip[]) {
  const stmt = db.prepare(
    `INSERT INTO tracks (generation_id, suno_audio_id, title, lyrics, style_tags, genre, mood, duration,
                         source_audio_url, source_stream_url, source_image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (suno_audio_id) DO UPDATE SET
       title = COALESCE(excluded.title, tracks.title),
       lyrics = COALESCE(excluded.lyrics, tracks.lyrics),
       style_tags = COALESCE(excluded.style_tags, tracks.style_tags),
       genre = COALESCE(excluded.genre, tracks.genre),
       mood = COALESCE(excluded.mood, tracks.mood),
       duration = COALESCE(excluded.duration, tracks.duration),
       source_audio_url = COALESCE(excluded.source_audio_url, tracks.source_audio_url),
       source_stream_url = COALESCE(excluded.source_stream_url, tracks.source_stream_url),
       source_image_url = COALESCE(excluded.source_image_url, tracks.source_image_url)`,
  );
  for (const c of clips) {
    const tags = c.tags ?? gen.style;
    // In simple mode Suno writes the lyrics; for instrumentals `prompt` just echoes our description.
    const lyrics = gen.instrumental ? null : (c.prompt ?? gen.lyrics);
    stmt.run(
      gen.id,
      c.id,
      c.title ?? gen.title,
      lyrics,
      tags,
      deriveGenre(tags),
      deriveMood(gen.mood, tags, gen.prompt),
      c.duration,
      c.audioUrl,
      c.streamAudioUrl,
      c.imageUrl,
    );
  }
}

const downloading = ((globalThis as unknown as { __trackDownloads?: Map<number, Promise<void>> }).__trackDownloads ??=
  new Map());

/**
 * Suno sometimes returns one take with an empty title/tags/lyrics (audio only).
 * Both takes come from the same request, so borrow the missing details from
 * the sibling take. Keep in sync with migration 3 in db.ts.
 */
function backfillFromSiblings(generationId: number) {
  const sibling = (col: string) =>
    `COALESCE(${col}, (SELECT s.${col} FROM tracks s WHERE s.generation_id = tracks.generation_id AND s.id <> tracks.id AND s.${col} IS NOT NULL LIMIT 1))`;
  db.prepare(
    `UPDATE tracks SET title = ${sibling("title")}, lyrics = ${sibling("lyrics")}, style_tags = ${sibling("style_tags")},
            genre = ${sibling("genre")}, mood = ${sibling("mood")}
      WHERE generation_id = ?`,
  ).run(generationId);
}

/** Download audio + cover for any track that doesn't have them locally yet. Returns true if all audio is local. */
export async function ensureTrackFiles(tracks: TrackRow[]): Promise<boolean> {
  let allAudio = true;
  for (const t of tracks) {
    let p = downloading.get(t.id);
    if (!p) {
      p = downloadTrackFiles(t).finally(() => downloading.delete(t.id));
      downloading.set(t.id, p);
    }
    await p;
    // Another caller may have done the work on its own copy of the row.
    const fresh = db.prepare("SELECT audio_path, image_path FROM tracks WHERE id = ?").get(t.id) as
      | Pick<TrackRow, "audio_path" | "image_path">
      | undefined;
    t.audio_path = fresh?.audio_path ?? null;
    t.image_path = fresh?.image_path ?? null;
    if (!t.audio_path) allAudio = false;
  }
  return allAudio;
}

async function downloadTrackFiles(t: TrackRow) {
  if (!t.audio_path && t.source_audio_url) {
    try {
      const p = await downloadTo(t.source_audio_url, AUDIO_DIR, String(t.id), ".mp3");
      db.prepare("UPDATE tracks SET audio_path = ? WHERE id = ?").run(p, t.id);
      t.audio_path = p;
    } catch (err) {
      console.error(`[tracks] audio download failed for track ${t.id}:`, err);
    }
  }
  if (!t.image_path && t.source_image_url) {
    try {
      const p = await downloadTo(t.source_image_url, COVER_DIR, String(t.id), ".jpg");
      db.prepare("UPDATE tracks SET image_path = ? WHERE id = ?").run(p, t.id);
      t.image_path = p;
    } catch (err) {
      console.error(`[tracks] cover download failed for track ${t.id}:`, err);
    }
  }
}

// One refresh per generation at a time, shared by polling, the callback, and page loads.
const inFlight = ((globalThis as unknown as { __genRefresh?: Map<number, Promise<void>> }).__genRefresh ??= new Map());

/**
 * Pull the latest state from Suno and persist it. Idempotent and safe to call
 * from anywhere; `force` skips the poll-interval throttle (used by the callback).
 */
export function refreshGeneration(id: number, { force = false } = {}): Promise<void> {
  const existing = inFlight.get(id);
  if (existing) return existing;
  const p = doRefresh(id, force).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

async function doRefresh(id: number, force: boolean) {
  const gen = getGeneration(id);
  if (!gen || TERMINAL.includes(gen.status)) return;
  if (!force && gen.last_polled_at && now() - gen.last_polled_at < POLL_INTERVAL_SECONDS) return;

  db.prepare("UPDATE generations SET last_polled_at = unixepoch() WHERE id = ?").run(id);

  if (now() - gen.created_at > TIMEOUT_SECONDS) {
    db.prepare("UPDATE generations SET status = 'failed', error = ? WHERE id = ?").run(
      "Timed out waiting for the studio — give it another go.",
      id,
    );
    return;
  }

  let record;
  try {
    record = await getRecord(gen.suno_task_id);
  } catch (err) {
    console.error(`[tracks] poll failed for generation ${id}:`, err);
    return; // transient; try again next poll
  }
  if (!record) return;

  const status = STATUS_MAP[record.status] ?? "pending";

  if (status === "failed") {
    // The provider's own message may name it or be technical; log it, show ours.
    console.error(`[tracks] generation ${id} failed: ${record.status} ${record.errorMessage ?? ""}`);
    db.prepare("UPDATE generations SET status = 'failed', error = ? WHERE id = ?").run(
      FAILURE_MESSAGES[record.status] ?? "The studio couldn't make this one — give it another go.",
      id,
    );
    return;
  }

  transaction(() => {
    if (record.clips.length) {
      upsertClips(gen, record.clips);
      backfillFromSiblings(gen.id);
    }
    // Hold 'complete' until the files are downloaded below.
    if (status !== "complete") db.prepare("UPDATE generations SET status = ? WHERE id = ?").run(status, id);
    else db.prepare("UPDATE generations SET status = 'first_ready' WHERE id = ?").run(id);
  });

  if (status === "complete") {
    await ensureTrackFiles(tracksForGeneration(id));
    // Mark complete even if a download failed: the media route retries/falls back to the source URL.
    db.prepare("UPDATE generations SET status = 'complete', completed_at = unixepoch() WHERE id = ?").run(id);
  }
}

/** Kick stale pending generations (e.g. the tab that started them was closed). Fire-and-forget. */
export function refreshStalePending() {
  const rows = db
    .prepare("SELECT id FROM generations WHERE status NOT IN ('complete', 'failed')")
    .all() as { id: number }[];
  for (const { id } of rows) void refreshGeneration(id);
}

// ---- catalogue ---------------------------------------------------------------

export type CatalogueTrack = TrackRow & {
  owner_id: number;
  remix_of_title: string | null;
  remix_of_username: string | null;
  username: string;
  prompt: string | null;
  style: string | null;
  mode: "simple" | "advanced";
  instrumental: number;
  model: string;
};

export type CatalogueFilters = { genre?: string; creator?: string };

export function listCatalogue(filters: CatalogueFilters, limit = 200): CatalogueTrack[] {
  const where = ["g.status = 'complete'"];
  const args: string[] = [];
  if (filters.genre) {
    where.push("t.genre = ? COLLATE NOCASE");
    args.push(filters.genre);
  }
  if (filters.creator) {
    where.push("u.username = ?");
    args.push(filters.creator);
  }
  return db
    .prepare(
      `SELECT t.*, g.user_id AS owner_id, g.remix_of_title, g.remix_of_username, u.username, g.prompt, g.style, g.mode, g.instrumental, g.model
         FROM tracks t
         JOIN generations g ON g.id = t.generation_id
         JOIN users u ON u.id = g.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${Number(limit)}`,
    )
    .all(...args) as CatalogueTrack[];
}

export function catalogueFacets() {
  const genres = db
    .prepare(
      `SELECT t.genre AS value, COUNT(*) AS n FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE g.status = 'complete' AND t.genre IS NOT NULL GROUP BY t.genre COLLATE NOCASE ORDER BY n DESC, value`,
    )
    .all() as { value: string; n: number }[];
  const creators = db
    .prepare(
      `SELECT u.username AS value, COUNT(*) AS n FROM tracks t
         JOIN generations g ON g.id = t.generation_id JOIN users u ON u.id = g.user_id
        WHERE g.status = 'complete' GROUP BY u.id ORDER BY u.username COLLATE NOCASE`,
    )
    .all() as { value: string; n: number }[];
  // node:sqlite rows have a null prototype, which React won't pass to client components.
  const plain = (rows: { value: string; n: number }[]) => rows.map(({ value, n }) => ({ value, n }));
  return { genres: plain(genres), creators: plain(creators) };
}

export function pendingGenerationsAll() {
  return db
    .prepare(
      `SELECT g.id, g.prompt, g.title, g.style, g.status, u.username
         FROM generations g JOIN users u ON u.id = g.user_id
        WHERE g.status NOT IN ('complete', 'failed') ORDER BY g.created_at DESC`,
    )
    .all() as { id: number; prompt: string | null; title: string | null; style: string | null; status: GenerationStatus; username: string }[];
}

// ---- deletion ----------------------------------------------------------------

/** Authors can delete their own tracks; admins can delete anyone's. */
export function canDeleteTrack(user: { id: number; is_admin: number }, ownerId: number) {
  return user.is_admin === 1 || user.id === ownerId;
}

export type DeleteResult = "deleted" | "not_found" | "forbidden";

/**
 * Remove a track and its files. The generation row is kept so usage stats
 * (and credits spent) stay accurate even after songs are deleted.
 */
export async function deleteTrack(user: { id: number; is_admin: number }, trackId: number): Promise<DeleteResult> {
  const row = db
    .prepare(
      `SELECT t.audio_path, t.image_path, g.user_id AS owner_id
         FROM tracks t JOIN generations g ON g.id = t.generation_id WHERE t.id = ?`,
    )
    .get(trackId) as { audio_path: string | null; image_path: string | null; owner_id: number } | undefined;
  if (!row) return "not_found";
  if (!canDeleteTrack(user, row.owner_id)) return "forbidden";

  db.prepare("DELETE FROM tracks WHERE id = ?").run(trackId);
  // Files go after the row, so a failure here only leaves an orphan file, never a broken track.
  for (const p of [row.audio_path, row.image_path]) if (p) await removeMediaFile(p);
  return "deleted";
}
