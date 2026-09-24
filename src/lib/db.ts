import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

// Each entry runs once, in order. Append new migrations; never edit old ones.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE invite_codes (
    code       TEXT PRIMARY KEY,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE generations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    suno_task_id   TEXT UNIQUE,
    mode           TEXT NOT NULL CHECK (mode IN ('simple', 'advanced')),
    prompt         TEXT,
    lyrics         TEXT,
    style          TEXT,
    title          TEXT,
    mood           TEXT,
    instrumental   INTEGER NOT NULL DEFAULT 0,
    model          TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'text_ready', 'first_ready', 'complete', 'failed')),
    error          TEXT,
    last_polled_at INTEGER,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    completed_at   INTEGER
  );
  CREATE INDEX generations_user ON generations(user_id);
  CREATE INDEX generations_status ON generations(status);

  CREATE TABLE tracks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_id     INTEGER NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    suno_audio_id     TEXT NOT NULL UNIQUE,
    title             TEXT,
    lyrics            TEXT,
    style_tags        TEXT,
    genre             TEXT,
    mood              TEXT,
    duration          REAL,
    image_path        TEXT,
    audio_path        TEXT,
    source_audio_url  TEXT,
    source_stream_url TEXT,
    source_image_url  TEXT,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX tracks_generation ON tracks(generation_id);
  CREATE INDEX tracks_genre ON tracks(genre);
  `,
  // 2: public share links. NULL = not shared; set = anyone with /s/<token> can listen.
  `
  ALTER TABLE tracks ADD COLUMN share_token TEXT;
  ALTER TABLE tracks ADD COLUMN shared_at INTEGER;
  CREATE UNIQUE INDEX tracks_share_token ON tracks(share_token);
  `,
  // 3: one-off repair for takes Suno returned with blank details — fill from the sibling take
  // (same logic as backfillFromSiblings in tracks.ts, which handles new songs).
  `
  UPDATE tracks SET
    title      = COALESCE(title,      (SELECT s.title      FROM tracks s WHERE s.generation_id = tracks.generation_id AND s.id <> tracks.id AND s.title      IS NOT NULL LIMIT 1)),
    lyrics     = COALESCE(lyrics,     (SELECT s.lyrics     FROM tracks s WHERE s.generation_id = tracks.generation_id AND s.id <> tracks.id AND s.lyrics     IS NOT NULL LIMIT 1)),
    style_tags = COALESCE(style_tags, (SELECT s.style_tags FROM tracks s WHERE s.generation_id = tracks.generation_id AND s.id <> tracks.id AND s.style_tags IS NOT NULL LIMIT 1)),
    genre      = COALESCE(genre,      (SELECT s.genre      FROM tracks s WHERE s.generation_id = tracks.generation_id AND s.id <> tracks.id AND s.genre      IS NOT NULL LIMIT 1)),
    mood       = COALESCE(mood,       (SELECT s.mood       FROM tracks s WHERE s.generation_id = tracks.generation_id AND s.id <> tracks.id AND s.mood       IS NOT NULL LIMIT 1));
  `,
  // 4: remixes. Creators can switch remixing off per track (on by default). A remix
  // generation points at its source track, plus a snapshot of its title/creator so
  // "Remix of X by Y" survives the original being deleted.
  `
  ALTER TABLE tracks ADD COLUMN allow_remix INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE generations ADD COLUMN remix_of_track_id INTEGER REFERENCES tracks(id) ON DELETE SET NULL;
  ALTER TABLE generations ADD COLUMN remix_of_title TEXT;
  ALTER TABLE generations ADD COLUMN remix_of_username TEXT;
  `,
];

function open(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  // `timeout` sets busy_timeout before any statement runs, so a lock held by
  // another connection (e.g. a dev-server restart overlapping) waits instead of failing.
  const db = new DatabaseSync(DB_PATH, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

/** Apply any migrations not yet run. Cheap when up to date. */
function migrate(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");

  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();

  for (; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

// Survive dev-mode hot reloads without opening a new handle each time. Migrations
// run on every module load (not just first open) so new ones apply without a restart.
const globalForDb = globalThis as unknown as { __musicDb?: DatabaseSync };
export const db = globalForDb.__musicDb ?? (globalForDb.__musicDb = open());
migrate(db);

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
