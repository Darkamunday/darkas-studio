import type { NextRequest } from "next/server";
import { getTrack, serveFile, withLocalFiles } from "@/lib/media";
import { verifyRemixSourceToken } from "@/lib/remix";

// Fetched by the music provider when making a remix. No session: the signed,
// expiring token is the permission (see remixSourceUrl).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/remix-source/[token]/song.mp3">) {
  const trackId = verifyRemixSourceToken((await ctx.params).token);
  const found = trackId === null ? undefined : getTrack(trackId);
  if (!found) return new Response("Not found", { status: 404 });
  const track = await withLocalFiles(found);
  if (!track.audio_path) return new Response("Not found", { status: 404 });
  return serveFile(track.audio_path, req);
}
