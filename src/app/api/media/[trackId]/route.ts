import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTrack, serveFile, withLocalFiles } from "@/lib/media";
import { canViewTrack } from "@/lib/tracks";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[trackId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const found = getTrack(Number((await ctx.params).trackId));
  // Someone else's private song looks the same as a missing one.
  if (!found || !canViewTrack(user.id, found)) return new Response("Not found", { status: 404 });
  const track = await withLocalFiles(found);

  if (track.audio_path) {
    return serveFile(track.audio_path, req, {
      download: req.nextUrl.searchParams.has("download"),
      title: track.title,
    });
  }
  const fallback = track.source_audio_url ?? track.source_stream_url;
  return fallback ? Response.redirect(fallback, 302) : new Response("Not ready yet", { status: 404 });
}
