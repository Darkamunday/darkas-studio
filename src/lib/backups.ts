import "server-only";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

// Read-only view of the nightly database backups written by deploy/backup.mjs (same folder rules).
const dir = () =>
  process.env.BACKUP_DIR || (process.env.MEDIA_DIR ? path.join(process.env.MEDIA_DIR, "backups") : path.join(DATA_DIR, "backups"));

/** `stale`: none in ~36 hours, i.e. the nightly timer has stopped working. */
export function backupStatus(): { latest: number | null; count: number; stale: boolean } {
  try {
    const files = readdirSync(dir()).filter((f) => /^app-\d{4}-\d{2}-\d{2}-\d{4}\.db\.gz$/.test(f));
    const latestMs = files.reduce((max, f) => Math.max(max, statSync(path.join(dir(), f)).mtimeMs), 0);
    return {
      latest: latestMs ? Math.floor(latestMs / 1000) : null,
      count: files.length,
      stale: !latestMs || Date.now() - latestMs > 36 * 3600_000,
    };
  } catch {
    return { latest: null, count: 0, stale: true };
  }
}

/**
 * The last off-site copy to Google Drive (deploy/offsite-backup.mjs). `stale`: none in ~36 hours, or the
 * last one failed. Null when it has never run (not set up).
 */
export function offsiteStatus(): { at: number; ok: boolean; files: number | null; bytes: number | null; error: string | null; stale: boolean } | null {
  try {
    const s = JSON.parse(readFileSync(path.join(dir(), "offsite-status.json"), "utf8")) as {
      at: number;
      ok: boolean;
      files?: number | null;
      bytes?: number | null;
      error?: string;
    };
    return {
      at: s.at,
      ok: s.ok,
      files: s.files ?? null,
      bytes: s.bytes ?? null,
      error: s.error ?? null,
      stale: !s.ok || Date.now() / 1000 - s.at > 36 * 3600,
    };
  } catch {
    return null;
  }
}
