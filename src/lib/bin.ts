import "server-only";
import { db, transaction } from "./db";
import { removeMediaFile } from "./storage";
import { getRecord } from "./suno";
import {
  backfillFromSiblings,
  canDeleteTrack,
  ensureTrackFiles,
  getGeneration,
  tracksForGeneration,
  upsertClips,
  type TrackRow,
} from "./tracks";

// Deleted tracks sit in `deleted_tracks` for BIN_DAYS, files and all, then are purged for good.
// Songs people delete themselves land in their own bin; songs an admin removes from someone
// else skip the owner's bin and only an admin can restore them (from the Admin page).
export const BIN_DAYS = 30;
const BIN_SECONDS = BIN_DAYS * 24 * 60 * 60;

type User = { id: number; is_admin: number };

export type BinnedTrack = TrackRow & {
  deleted_at: number;
  deleted_by: number | null;
  owner_id: number;
  username: string;
  deleted_by_name: string | null;
  /** Whole days until it's purged, rounded up (1 = last day). */
  days_left: number;
};

/** Columns both tables share, so a column added to `tracks` (and to `deleted_tracks`) moves with the row. */
function sharedColumns(): string {
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const bin = new Set(cols("deleted_tracks"));
  return cols("tracks")
    .filter((c) => bin.has(c))
    .join(", ");
}

// ---- delete / restore --------------------------------------------------------

export type DeleteResult = "deleted" | "not_found" | "forbidden";

/**
 * Move a track to the bin. Its share link and remix link stop working at once (nothing that
 * reads `tracks` can see it). The generation row stays, so usage stats remain accurate.
 */
export function deleteTrack(user: User, trackId: number): DeleteResult {
  const row = db
    .prepare("SELECT g.user_id AS owner_id FROM tracks t JOIN generations g ON g.id = t.generation_id WHERE t.id = ?")
    .get(trackId) as { owner_id: number } | undefined;
  if (!row) return "not_found";
  if (!canDeleteTrack(user, row.owner_id)) return "forbidden";

  const cols = sharedColumns();
  transaction(() => {
    db.prepare(
      `INSERT INTO deleted_tracks (${cols}, deleted_at, deleted_by) SELECT ${cols}, unixepoch(), ? FROM tracks WHERE id = ?`,
    ).run(user.id, trackId);
    db.prepare("DELETE FROM tracks WHERE id = ?").run(trackId);
  });
  return "deleted";
}

function getBinned(trackId: number) {
  return db
    .prepare(
      `SELECT d.*, g.user_id AS owner_id
         FROM deleted_tracks d JOIN generations g ON g.id = d.generation_id WHERE d.id = ?`,
    )
    .get(trackId) as (TrackRow & { owner_id: number; deleted_by: number | null }) | undefined;
}

/** Owners restore what they deleted themselves; admins can restore anything (that's how admin removals come back). */
export function canRestore(user: User, t: { owner_id: number; deleted_by: number | null }) {
  return user.is_admin === 1 || (user.id === t.owner_id && t.deleted_by === t.owner_id);
}

export type RestoreResult = "restored" | "not_found" | "forbidden";

/** Put it back exactly as it was — same id, settings and share link. */
export function restoreTrack(user: User, trackId: number): RestoreResult {
  const t = getBinned(trackId);
  if (!t) return "not_found";
  if (!canRestore(user, t)) return "forbidden";

  const cols = sharedColumns();
  transaction(() => {
    db.prepare(`INSERT INTO tracks (${cols}) SELECT ${cols} FROM deleted_tracks WHERE id = ?`).run(trackId);
    db.prepare("DELETE FROM deleted_tracks WHERE id = ?").run(trackId);
  });
  return "restored";
}

// ---- listings ------------------------------------------------------------------

const BINNED_SELECT = `
  SELECT d.*, g.user_id AS owner_id, u.username, b.username AS deleted_by_name,
         (d.deleted_at + ${BIN_SECONDS} - unixepoch() + 86399) / 86400 AS days_left
    FROM deleted_tracks d
    JOIN generations g ON g.id = d.generation_id
    JOIN users u ON u.id = g.user_id
    LEFT JOIN users b ON b.id = d.deleted_by`;

/** What the user deleted themselves — their own "Recently deleted". */
export function listOwnBin(userId: number): BinnedTrack[] {
  return db
    .prepare(`${BINNED_SELECT} WHERE g.user_id = ? AND d.deleted_by = g.user_id ORDER BY d.deleted_at DESC`)
    .all(userId) as BinnedTrack[];
}

/** Songs an admin removed from someone else — only restorable from the Admin page. */
export function listAdminRemoved(): BinnedTrack[] {
  return db
    .prepare(`${BINNED_SELECT} WHERE d.deleted_by IS NULL OR d.deleted_by <> g.user_id ORDER BY d.deleted_at DESC`)
    .all() as BinnedTrack[];
}

export type LostSong = {
  id: number;
  title: string | null;
  prompt: string | null;
  style: string | null;
  created_at: number;
  missing: number;
};

/** The user's songs deleted before the bin existed: recoverable only from the provider, if it still has them. */
export function listLostSongs(userId: number): LostSong[] {
  return db
    .prepare(
      `SELECT g.id, g.title, g.prompt, g.style, g.created_at,
              2 - (SELECT COUNT(*) FROM tracks t WHERE t.generation_id = g.id)
                - (SELECT COUNT(*) FROM deleted_tracks d WHERE d.generation_id = g.id) AS missing
         FROM generations g
        WHERE g.user_id = ? AND g.lost_takes = 1
        ORDER BY g.created_at DESC`,
    )
    .all(userId) as LostSong[];
}

export function ownBinCount(userId: number): number {
  return listOwnBin(userId).length + listLostSongs(userId).length;
}

// ---- recovering pre-bin deletions from the provider ------------------------------

export type RecoverResult = "recovered" | "gone" | "not_found" | "forbidden" | "error";

/**
 * Ask the provider for the song again and re-download any takes we no longer have. Works only
 * while the provider still keeps the files (how long isn't documented — weeks, not forever).
 */
export async function recoverLostTakes(user: User, generationId: number): Promise<RecoverResult> {
  const gen = getGeneration(generationId);
  if (!gen || !gen.lost_takes) return "not_found";
  if (gen.user_id !== user.id && !user.is_admin) return "forbidden";

  let record;
  try {
    record = await getRecord(gen.suno_task_id);
  } catch (err) {
    console.error(`[bin] recover lookup failed for generation ${generationId}:`, err);
    return "error";
  }

  const known = new Set(
    (
      db
        .prepare("SELECT suno_audio_id FROM tracks WHERE generation_id = ? UNION SELECT suno_audio_id FROM deleted_tracks WHERE generation_id = ?")
        .all(generationId, generationId) as { suno_audio_id: string }[]
    ).map((r) => r.suno_audio_id),
  );
  const missing = (record?.clips ?? []).filter((c) => c.audioUrl && !known.has(c.id));
  if (!missing.length) {
    db.prepare("UPDATE generations SET lost_takes = 0 WHERE id = ?").run(generationId);
    return "gone";
  }

  transaction(() => {
    upsertClips(gen, missing);
    backfillFromSiblings(gen.id);
  });
  const fresh = tracksForGeneration(generationId).filter((t) => missing.some((c) => c.id === t.suno_audio_id));
  await ensureTrackFiles(fresh);

  // Only keep takes whose audio actually came back; the provider's links may have expired.
  const failed = fresh.filter((t) => !t.audio_path);
  for (const t of failed) {
    db.prepare("DELETE FROM tracks WHERE id = ?").run(t.id);
    if (t.image_path) await removeMediaFile(t.image_path);
  }
  db.prepare("UPDATE generations SET lost_takes = 0 WHERE id = ?").run(generationId);
  return failed.length === fresh.length ? "gone" : "recovered";
}

// ---- purge -----------------------------------------------------------------------

let lastPurge = 0;

/** Permanently remove bin entries older than BIN_DAYS. Cheap to call often; runs at most hourly. */
export async function purgeExpiredBin() {
  if (Date.now() - lastPurge < 60 * 60 * 1000) return;
  lastPurge = Date.now();
  const expired = db
    .prepare(`SELECT id, audio_path, image_path FROM deleted_tracks WHERE deleted_at < unixepoch() - ${BIN_SECONDS}`)
    .all() as { id: number; audio_path: string | null; image_path: string | null }[];
  for (const t of expired) {
    db.prepare("DELETE FROM deleted_tracks WHERE id = ?").run(t.id);
    db.prepare("DELETE FROM timed_lyrics WHERE track_id = ?").run(t.id);
    // Files go after the row, so a failure here only leaves an orphan file, never a broken entry.
    for (const p of [t.audio_path, t.image_path]) if (p) await removeMediaFile(p);
  }
  if (expired.length) console.log(`[bin] purged ${expired.length} track(s) older than ${BIN_DAYS} days`);
}

/** For the bin's cover thumbnails: the binned track, if this user may see it there. */
export function getBinnedForViewer(user: User, trackId: number) {
  const t = getBinned(trackId);
  return t && canRestore(user, t) ? t : undefined;
}
