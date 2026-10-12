# Darka's Studio

A private, invite-only web app for making AI music with friends. Songs are generated through a
[sunoapi.org](https://sunoapi.org) account and collected in a shared catalogue.

**Features:** simple & advanced generation (own lyrics + style), two takes per song, a shared
catalogue with filters and a waveform player, remixes (re-record a song in a new style), public
share links, invite-code sign-up, per-user usage tracking, an AI chat (Ollama Cloud; admins switch it
on per person and set daily limits), and an admin page.

## Stack

- Next.js 16 (App Router, Server Actions) · React 19 · Tailwind CSS 4 · TypeScript
- SQLite via Node's built-in `node:sqlite` (no native modules) — requires **Node 24+**
- Self-contained auth: scrypt password hashes, server-side sessions in SQLite

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in SUNO_API_KEY
npm run dev                   # http://localhost:3000 (development)
```

The first account to sign up becomes the admin (no invite code needed). After that, sign-up requires
an invite code — create them on the Admin page and share the link.

## Production

Runs as the systemd service `music-app` (`next start` on port 3000, behind Nginx Proxy Manager with
Websockets Support on). The unit file lives in `deploy/music-app.service`.

**To ship a change:** commit it, then run

```bash
/opt/music-app/deploy/deploy.sh
```

It installs dependencies, type-checks, lints and builds *before* restarting, so a broken build never
takes the site down. Downtime is a couple of seconds. Logs: `journalctl -u music-app -f`.

**To roll back:** `git checkout <previous-commit>` then run `deploy/deploy.sh` again. Database
migrations only ever add things, so older code keeps working with a newer database.

## Configuration (`.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `SUNO_API_KEY` | yes | sunoapi.org API key |
| `MEDIA_DIR` | no | Where audio/cover files are stored. Default: `./data`. Must already exist — the app won't create it, so an unmounted drive can't silently fill the OS disk. |
| `APP_URL` | no | Public base URL used in invite/share links, e.g. `https://music.darka-ai.co.uk`. Default: worked out from the request. |
| `SUNO_CALLBACK_URL` | no | Where the provider posts progress updates. Default: `https://music.darka-ai.co.uk/api/suno/callback` |
| `SUNO_DEFAULT_MODEL` | no | Default model, e.g. `V6` (the default) or `V5_5` |
| `SUNO_CREDITS_PER_GENERATION` | no | Used for the admin page's credit estimates. Default: `12` |
| `SUNO_API_BASE` | no | Default: `https://api.sunoapi.org/api/v1` |
| `SUNO_MOCK` | no | `1` fakes the provider locally (no credits spent) — for development only |
| `COMFY_CLOUD_API_KEY` | no | Comfy Cloud API key (from platform.comfy.org; needs a plan with API access). Turns on **Change cover**: creators describe a cover and it's generated with Z-Image Turbo. Hidden when unset. |
| `COMFY_MOCK` | no | `1` fakes Comfy Cloud with placeholder images — for development only |
| `OLLAMA_API_KEY` | no | Ollama Cloud API key (from ollama.com/settings/keys). Powers **Chat** (`/chat`), which admins switch on per user. Models, system prompt and the default daily cap are in `src/config/chat.ts`. |
| `OLLAMA_BASE_URL` | no | Default: `https://ollama.com` |
| `OPENROUTER_API_KEY` | no | OpenRouter API key (from openrouter.ai/keys). Turns on **adult (18+) chats**, which admins switch on per person and each person confirms once. They run only on OpenRouter (never Ollama Cloud), asking for providers that don't keep prompts; models and the fixed rules are `ADULT_MODELS` and `ADULT_RULES` in `src/config/chat.ts`. Hidden when unset. |
| `OPENROUTER_BASE_URL` | no | Default: `https://openrouter.ai/api/v1` — only for testing against a stand-in server |
| `OFFSITE_REMOTE`, `OFFSITE_KEEP_DAYS` | no | Off-site backup target and how long removed files are kept (see Data). Defaults: `gdrive:Darka's Studio backup`, `30` |

## Data

Nothing below is in git — **back these up together**, since catalogue rows point at the files:

- `data/app.db` — SQLite database (users, invite codes, sessions, songs, usage). Schema migrations
  in `src/lib/db.ts` run automatically on startup.
- `$MEDIA_DIR/audio`, `$MEDIA_DIR/covers` — downloaded MP3s and cover art.

**Chat connections (MCP).** The chat assistant can use tools from MCP servers listed under Admin →
Connections. Comfy Cloud is built in (it uses `COMFY_CLOUD_API_KEY`; `COMFY_MCP_URL` overrides its
address); other servers are added there with an address and an optional auth header — those keys are
stored in the database. Each tool is Off, Admins or Everyone, and "Ask first" tools pause the chat
with an approval card before they run. The model sees a short catalogue and loads a tool's full
definition only when it needs it. Media a tool returns is copied into `$MEDIA_DIR/chat-images`.

**Backups.** A systemd timer (`deploy/music-app-backup.timer`, installed in `/etc/systemd/system/`) runs
`deploy/backup.mjs` every night at about 03:30. It takes a consistent copy of `app.db` while the app
runs, checks it, and writes `app-YYYY-MM-DD-HHMM.db.gz` to `$MEDIA_DIR/backups` (a different disk from
the database), keeping 14 days (`BACKUP_DIR` and `BACKUP_KEEP_DAYS` override). The Admin overview shows
when the last one ran. Run one now with `systemctl start music-app-backup`; logs:
`journalctl -u music-app-backup`. To restore: `systemctl stop music-app`, then
`gunzip -c $MEDIA_DIR/backups/app-….db.gz > data/app.db`, remove `data/app.db-wal` and `data/app.db-shm`,
and `systemctl start music-app`.

**Off-site copy (Google Drive).** Straight after that, the same service runs `deploy/offsite-backup.mjs`,
which mirrors all of `$MEDIA_DIR` — songs, covers, chat pictures and uploads, album pictures, and the
database backups above — to Google Drive with rclone. On Drive, `Darka's Studio backup/current/` is the
mirror (only changes are uploaded each night) and `removed/YYYY-MM-DD/` holds files deleted or replaced
that night, kept 30 days (`OFFSITE_REMOTE` and `OFFSITE_KEEP_DAYS` override). It refuses to run if the
media folder is missing or empty, and stops if more than 500 files would be deleted at once. The Admin
overview shows the last run, in red if it failed or is over 36h old. The rclone remote `gdrive` (in
`/root/.config/rclone/rclone.conf`) uses Drive's `drive.file` permission, so it only sees files it made;
to reconnect it, run `rclone config reconnect gdrive:` (or `rclone authorize drive` on a machine with a
browser). To restore the media: `rclone copy "gdrive:Darka's Studio backup/current" $MEDIA_DIR`, then
restore the newest database backup from `$MEDIA_DIR/backups` as above. To get back something deleted
recently, look in `removed/` for the night it went.

Deleting a song moves it to the `deleted_tracks` table (files kept) for 30 days, then it's purged
with its files. People restore their own deletions from **Recently deleted** (linked from the
catalogue); songs an admin removes skip the owner's bin and are restored from the Admin page. Songs
deleted before the bin existed can be re-fetched from the provider while it still has them.

## Tests

`npm test` runs the tests in `tests/` with Node's test runner. They cover who can see and change what:
shared projects and their Shared tab, pinned replies, chat picture uploads, memory, and music and picture
albums (private songs never shown to others). Each test file gets a fresh, empty database and media folder
in a temp directory (`tests/setup.mjs`), so they never touch live data; fixtures are invented
(`tests/helpers.ts`). `deploy/deploy.sh` runs them before building and stops if any fail.

Code that imports Next's request helpers (`@/lib/auth`, `@/lib/chat/access`) can't load outside Next,
so tests call the library functions underneath the routes rather than the routes themselves.

## Languages

The interface is in English, French, Indonesian, Brazilian Portuguese and Malay. Visitors get their
browser's language; the globe button switches it and remembers the choice in a `lang` cookie.

All text lives in `src/lib/i18n/messages/` — `en.ts` is the source, and the other four must have exactly
the same keys (the type check fails otherwise). To add or change text, edit `en.ts` and then the same
key in `fr.ts`, `id.ts`, `pt.ts` and `ms.ts`. Song titles, prompts, lyrics and genres are shown as written.

## Layout

```
src/app/(auth)/        login & sign-up
src/app/(app)/         signed-in pages: generate, catalogue, admin
src/app/s/[token]/     public song pages (share links)
src/app/api/           status polling, media streaming, provider callback, share & remix sources
src/lib/               db, auth, provider client, tracks, sharing, remix, storage
src/lib/i18n/          languages, translations, helpers for server and client components
src/components/        player, logo, theme toggle, language picker, shared UI classes
src/proxy.ts           redirects signed-out visitors to /login (Next 16's replacement for middleware)
```
