import "server-only";
import { getCurrentUser, type User } from "../auth";
import { hasVideoAccess } from "./store";

/** For route handlers: the signed-in user who can make videos, or the error Response to return. */
export async function requireVideoApi(): Promise<{ user: User; error?: never } | { user?: never; error: Response }> {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (!hasVideoAccess(user.id)) return { error: Response.json({ error: "videos_disabled" }, { status: 403 }) };
  return { user };
}

/** A picture's type from its first bytes (JPEG, PNG or WebP). */
export function pictureExt(buf: Buffer): ".jpg" | ".png" | ".webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
  return null;
}

const AUDIO_EXTS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"];

/** An uploaded track's extension, if it's an audio type we take (ffmpeg checks the contents). */
export function audioExt(name: string): string | null {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  return AUDIO_EXTS.includes(ext) ? ext : null;
}
