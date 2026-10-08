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
  // 5: private songs. Chosen per generation when it's made, copied onto each take, and
  // switchable per track afterwards. Private tracks are only visible to their creator.
  `
  ALTER TABLE generations ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tracks ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
  `,
  // 6: the bin. Deleting a track moves its row here (files stay on disk) so it can be restored
  // for a while; nothing that reads `tracks` can see it. Keep the columns in step with `tracks`:
  // a migration that adds a column there should add it here too (see bin.ts).
  // generations.lost_takes marks songs whose takes were deleted before the bin existed — those
  // can only be fetched back from the provider, while it still has them.
  `
  CREATE TABLE deleted_tracks (
    id                INTEGER PRIMARY KEY,
    generation_id     INTEGER NOT NULL REFERENCES generations(id),
    suno_audio_id     TEXT NOT NULL,
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
    created_at        INTEGER NOT NULL,
    share_token       TEXT,
    shared_at         INTEGER,
    allow_remix       INTEGER NOT NULL DEFAULT 1,
    is_private        INTEGER NOT NULL DEFAULT 0,
    deleted_at        INTEGER NOT NULL,
    deleted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX deleted_tracks_generation ON deleted_tracks(generation_id);
  CREATE INDEX deleted_tracks_deleted_at ON deleted_tracks(deleted_at);

  ALTER TABLE generations ADD COLUMN lost_takes INTEGER NOT NULL DEFAULT 0;
  UPDATE generations SET lost_takes = 1
   WHERE status = 'complete' AND (SELECT COUNT(*) FROM tracks t WHERE t.generation_id = generations.id) < 2;
  `,
  // 7: word-level lyric timings from the provider. Fetching costs credits, so each take's result
  // is kept. No foreign key: the row should survive the track's trip through the bin (bin.ts
  // deletes it when the track is purged).
  `
  CREATE TABLE timed_lyrics (
    track_id   INTEGER PRIMARY KEY,
    words      TEXT NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
    fetched_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  // 8: AI cover art (Comfy Cloud). One row per attempt; the image is downloaded into covers/
  // when ready and becomes the track's cover only when its creator picks it.
  `
  CREATE TABLE cover_jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id     INTEGER NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comfy_job_id TEXT NOT NULL,
    prompt       TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed', 'applied', 'discarded')),
    image_path   TEXT,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX cover_jobs_track ON cover_jobs(track_id);
  `,
  // 9: AI chat (Ollama Cloud). Off per user until an admin enables it; chat_daily_cap NULL means
  // the default in src/config/chat.ts. chat_usage counts sends per Europe/London day, kept apart
  // from messages so deleting a chat doesn't hand back allowance.
  `
  ALTER TABLE users ADD COLUMN chat_enabled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN chat_daily_cap INTEGER;

  CREATE TABLE conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT,
    model      TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX conversations_user ON conversations(user_id, updated_at);

  CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX messages_conversation ON messages(conversation_id, id);

  CREATE TABLE chat_usage (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );
  `,
  // 10: each person's custom instructions for the chat assistant (NULL = none), added after the
  // base system prompt on every message in all their chats.
  `
  ALTER TABLE users ADD COLUMN chat_instructions TEXT;
  `,
  // 11: app-wide settings an admin can change without a rebuild (first: the chat master prompt).
  // A missing row means "use the default from the code".
  `
  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  `,
  // 12: what chat costs. One row per person, Europe/London day and model, adding up tokens and dollars
  // (priced when each reply is made). Kept apart from messages so deleting chats doesn't erase spend.
  // `estimated` counts requests whose tokens were guessed because the reply was stopped or failed.
  `
  CREATE TABLE chat_spend (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day           TEXT NOT NULL,
    model         TEXT NOT NULL,
    requests      INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL NOT NULL DEFAULT 0,
    estimated     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, model)
  );
  CREATE INDEX chat_spend_day ON chat_spend(day);
  `,
  // 13: a reply's reasoning, for models that think before answering (shown folded above the reply,
  // never sent back to the model), and how long the thinking took.
  `
  ALTER TABLE messages ADD COLUMN thinking TEXT;
  ALTER TABLE messages ADD COLUMN thinking_ms INTEGER;
  `,
  // 14: "Make it a song" — a reply turned into {title, style, lyrics} for the Create page, kept so
  // opening it again is instant (and isn't paid for twice).
  `
  ALTER TABLE messages ADD COLUMN song_draft TEXT;
  `,
  // 15: reference files for chat (character bibles, notes…). Each person's own: the extracted text
  // is kept, not the upload. A file goes into a chat when attached to it, or into all their chats
  // when `always` is on.
  `
  CREATE TABLE chat_files (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    text       TEXT NOT NULL,
    always     INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX chat_files_user ON chat_files(user_id);

  CREATE TABLE conversation_files (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    file_id         INTEGER NOT NULL REFERENCES chat_files(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, file_id)
  );
  CREATE INDEX conversation_files_file ON conversation_files(file_id);
  `,
  // 16: chat projects — each person's own. A project groups chats and gives them shared instructions
  // and reference files, and can set the model and Think setting new chats in it start with
  // (NULL = no preference). Deleting a project keeps its chats: they move back to the main list.
  `
  CREATE TABLE projects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    emoji        TEXT NOT NULL DEFAULT '✦',
    instructions TEXT,
    model        TEXT,
    think        INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX projects_user ON projects(user_id);

  CREATE TABLE project_files (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_id    INTEGER NOT NULL REFERENCES chat_files(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, file_id)
  );
  CREATE INDEX project_files_file ON project_files(file_id);

  ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
  CREATE INDEX conversations_project ON conversations(project_id);
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
