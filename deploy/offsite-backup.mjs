#!/usr/bin/env node
// Nightly off-site copy of everything in MEDIA_DIR (songs, covers, chat pictures and uploads, album
// pictures, and the database backups in backups/) to Google Drive, with rclone. Run by the
// music-app-backup systemd service right after deploy/backup.mjs, or by hand: node deploy/offsite-backup.mjs
//
// The remote (OFFSITE_REMOTE, default "gdrive:Darka's Studio backup") holds:
//   current/            a mirror of MEDIA_DIR — only new or changed files are uploaded each night
//   removed/YYYY-MM-DD/ files deleted or replaced that night, kept OFFSITE_KEEP_DAYS (default 30) days
// The rclone remote "gdrive" is set up once with Drive's narrow drive.file permission (it can only see
// files it made). Writes the outcome to <backups>/offsite-status.json for the Admin page.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));

const MEDIA = process.env.MEDIA_DIR;
const REMOTE = process.env.OFFSITE_REMOTE || "gdrive:Darka's Studio backup";
const KEEP_DAYS = Number(process.env.OFFSITE_KEEP_DAYS) || 30;
const backups = process.env.BACKUP_DIR || (MEDIA ? path.join(MEDIA, "backups") : path.join(root, "data", "backups"));
const STATUS = path.join(backups, "offsite-status.json");

const day = (d = new Date()) => d.toISOString().slice(0, 10);

function record(status) {
  mkdirSync(backups, { recursive: true });
  writeFileSync(STATUS, JSON.stringify({ at: Math.floor(Date.now() / 1000), remote: REMOTE, ...status }, null, 2));
}

function fail(message) {
  console.error(`[offsite] FAILED: ${message}`);
  record({ ok: false, error: message });
  process.exit(1);
}

const rclone = (args, opts = {}) => spawnSync("rclone", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

// ---- checks before touching the remote ----
if (rclone(["version"]).status !== 0) fail("rclone isn't installed");
const remoteName = REMOTE.split(":")[0];
if (!rclone(["listremotes"]).stdout.split("\n").includes(`${remoteName}:`)) fail(`rclone remote "${remoteName}" isn't set up`);
if (!MEDIA || !existsSync(MEDIA)) fail(`media folder ${MEDIA ?? "(MEDIA_DIR not set)"} is missing — is the drive mounted?`);
// A missing or empty drive mustn't be mirrored as "everything was deleted".
const audio = path.join(MEDIA, "audio");
if (!existsSync(audio) || readdirSync(audio).length === 0) fail(`${audio} is empty — refusing to mirror an empty media folder`);

// ---- mirror ----
const started = Date.now();
const sync = rclone(
  [
    "sync",
    MEDIA,
    `${REMOTE}/current`,
    "--backup-dir",
    `${REMOTE}/removed/${day()}`,
    "--exclude",
    "*.part",
    "--exclude",
    ".*.tmp*",
    "--exclude",
    "backups/offsite-status.json",
    // A sudden mass deletion is far more likely a mistake than real; stop and say so instead.
    "--max-delete",
    "500",
    "--transfers",
    "4",
    "--stats-one-line",
    "--stats-log-level",
    "NOTICE",
    "--log-level",
    "NOTICE",
  ],
  { stdio: ["ignore", "inherit", "pipe"] },
);
if (sync.stderr) process.stderr.write(sync.stderr);
if (sync.status !== 0) fail(`rclone sync exited ${sync.status}: ${(sync.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);

// ---- forget old removed/ folders (by their date name, not file times) ----
const cutoff = day(new Date(Date.now() - KEEP_DAYS * 86_400_000));
const removed = rclone(["lsf", "--dirs-only", `${REMOTE}/removed`]);
for (const dir of removed.status === 0 ? removed.stdout.split("\n") : []) {
  const name = dir.replace(/\/$/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoff) {
    const purge = rclone(["purge", `${REMOTE}/removed/${name}`]);
    console.log(`[offsite] ${purge.status === 0 ? "removed" : "couldn't remove"} old removed/${name}`);
  }
}

// ---- what's there now ----
let files = null;
let bytes = null;
try {
  const size = JSON.parse(execFileSync("rclone", ["size", "--json", `${REMOTE}/current`], { encoding: "utf8" }));
  files = size.count;
  bytes = size.bytes;
} catch {}
record({ ok: true, files, bytes, seconds: Math.round((Date.now() - started) / 1000) });
console.log(`[offsite] mirrored ${MEDIA} to ${REMOTE}/current (${files ?? "?"} files, ${bytes ? (bytes / 1e6).toFixed(0) : "?"} MB)`);
