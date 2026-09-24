import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { db } from "./db";
import { resolveMediaPath } from "./storage";
import { ensureTrackFiles, type TrackRow } from "./tracks";

const TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function getTrack(id: number) {
  return db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow | undefined;
}

/** Make sure the track's files are local, retrying a download that failed earlier. */
export async function withLocalFiles(track: TrackRow): Promise<TrackRow> {
  if ((!track.audio_path && track.source_audio_url) || (!track.image_path && track.source_image_url)) {
    await ensureTrackFiles([track]);
  }
  return track;
}

function safeFilename(title: string | null, ext: string) {
  const base = (title ?? "track").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 80) || "track";
  return `${base}${ext}`;
}

/** Serve a file from MEDIA_DIR with HTTP Range support (needed for seeking in <audio>). */
export async function serveFile(
  rel: string,
  req: Request,
  opts: { download?: boolean; title?: string | null; immutable?: boolean } = {},
): Promise<Response> {
  const abs = resolveMediaPath(rel);
  const { size } = await stat(abs);
  const ext = path.extname(abs).toLowerCase();
  const headers = new Headers({
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  if (opts.download) {
    const name = safeFilename(opts.title ?? null, ext);
    headers.set("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  }

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { status: 200, headers });
}
