#!/usr/bin/env node
// Nightly database backup. Run by the music-app-backup systemd timer (deploy/music-app-backup.*),
// or by hand: node deploy/backup.mjs
//
// Takes a consistent copy of data/app.db with SQLite's online backup (safe while the app is running),
// checks it, gzips it into the backup folder and deletes copies older than the retention period.
// Folder: BACKUP_DIR, else $MEDIA_DIR/backups (a different disk from the database), else data/backups.

import { backup, DatabaseSync } from "node:sqlite";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));

const SOURCE = path.join(root, "data", "app.db");
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 14;
const dir =
  process.env.BACKUP_DIR || (process.env.MEDIA_DIR ? path.join(process.env.MEDIA_DIR, "backups") : path.join(root, "data", "backups"));

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

mkdirSync(dir, { recursive: true });
const name = `app-${stamp()}.db`;
const tmp = path.join(dir, `.${name}.tmp`);
const out = path.join(dir, `${name}.gz`);

try {
  const source = new DatabaseSync(SOURCE, { readOnly: true, timeout: 10_000 });
  await backup(source, tmp);
  source.close();

  // Make the copy a single self-contained file (the live database runs in WAL mode), then check it.
  const copy = new DatabaseSync(tmp);
  copy.exec("PRAGMA journal_mode = DELETE");
  const check = copy.prepare("PRAGMA integrity_check").get();
  const users = copy.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  copy.close();
  if (check.integrity_check !== "ok") throw new Error(`integrity check failed: ${JSON.stringify(check)}`);

  await pipeline(createReadStream(tmp), createGzip({ level: 9 }), createWriteStream(out));
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true });
  console.log(`[backup] wrote ${out} (${(statSync(out).size / 1024).toFixed(0)} KB, ${users} users, integrity ok)`);
} catch (err) {
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) rmSync(f, { force: true });
  console.error("[backup] FAILED:", err);
  process.exit(1);
}

// Retention: only ever touches our own app-*.db.gz files.
const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
for (const f of readdirSync(dir)) {
  if (!/^app-\d{4}-\d{2}-\d{2}-\d{4}\.db\.gz$/.test(f)) continue;
  const full = path.join(dir, f);
  if (statSync(full).mtimeMs < cutoff) {
    rmSync(full);
    console.log(`[backup] removed old ${f}`);
  }
}
