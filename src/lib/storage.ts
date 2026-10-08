import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "./db";

// Where audio and cover files live. Set MEDIA_DIR to keep them on a separate
// drive; the SQLite DB always stays in DATA_DIR. Paths stored in the DB are
// relative to this, so moving the folder only needs this setting changed.
export const MEDIA_DIR = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : DATA_DIR;
export const AUDIO_DIR = path.join(MEDIA_DIR, "audio");
export const COVER_DIR = path.join(MEDIA_DIR, "covers");

/**
 * MEDIA_DIR itself is never auto-created: if the drive isn't mounted, writing
 * into the bare mount point would silently fill the OS disk instead.
 */
async function assertMediaDirPresent() {
  const ok = await stat(MEDIA_DIR).then((s) => s.isDirectory(), () => false);
  if (!ok) throw new Error(`Media folder ${MEDIA_DIR} is missing — is the drive mounted?`);
}

const EXT_BY_TYPE: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
};

/**
 * Downloads `url` into `dir/<basename><ext>` and returns the path relative to
 * MEDIA_DIR (what we store in the DB). Writes to a temp file first so a crash
 * never leaves a half-written file under the final name.
 */
export async function downloadTo(url: string, dir: string, basename: string, fallbackExt: string): Promise<string> {
  await assertMediaDirPresent();
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);

  const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const ext = EXT_BY_TYPE[type] ?? (path.extname(new URL(url).pathname) || fallbackExt);
  await mkdir(dir, { recursive: true });

  const finalPath = path.join(dir, `${basename}${ext}`);
  const tmpPath = `${finalPath}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmpPath));
    await rename(tmpPath, finalPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    throw err;
  }
  return path.relative(MEDIA_DIR, finalPath);
}

/** Resolve a DB-stored relative path, refusing anything that escapes MEDIA_DIR. */
export function resolveMediaPath(rel: string): string {
  const abs = path.resolve(MEDIA_DIR, rel);
  if (!abs.startsWith(MEDIA_DIR + path.sep)) throw new Error("Bad media path");
  return abs;
}

export async function removeMediaFile(rel: string) {
  try {
    await rm(resolveMediaPath(rel), { force: true });
  } catch (err) {
    console.error(`[storage] failed to remove ${rel}:`, err);
  }
}
