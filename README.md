# Darka's Studio

A private, invite-only web app for making AI music with friends. Songs are generated through a
[sunoapi.org](https://sunoapi.org) account and collected in a shared catalogue.

**Features:** simple & advanced generation (own lyrics + style), two takes per song, a shared
catalogue with filters and a waveform player, remixes (re-record a song in a new style), public
share links, invite-code sign-up, per-user usage tracking, and an admin page.

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

## Data

Nothing below is in git — **back these up together**, since catalogue rows point at the files:

- `data/app.db` — SQLite database (users, invite codes, sessions, songs, usage). Schema migrations
  in `src/lib/db.ts` run automatically on startup.
- `$MEDIA_DIR/audio`, `$MEDIA_DIR/covers` — downloaded MP3s and cover art.

Deleting a song moves it to the `deleted_tracks` table (files kept) for 30 days, then it's purged
with its files. People restore their own deletions from **Recently deleted** (linked from the
catalogue); songs an admin removes skip the owner's bin and are restored from the Admin page. Songs
deleted before the bin existed can be re-fetched from the provider while it still has them.

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
