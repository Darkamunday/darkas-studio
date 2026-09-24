import type { NextRequest } from "next/server";
import { serveFile, withLocalFiles } from "@/lib/media";
import { getSharedTrack } from "@/lib/sharing";

// Public: the unguessable token is the permission. Revoked or unknown → 404.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/share/[token]">) {
  const found = getSharedTrack((await ctx.params).token);
  if (!found) return new Response("Not found", { status: 404 });
  const track = await withLocalFiles(found);

  if (track.audio_path) {
    return serveFile(track.audio_path, req, { download: req.nextUrl.searchParams.has("download"), title: track.title });
  }
  return track.source_audio_url ? Response.redirect(track.source_audio_url, 302) : new Response("Not found", { status: 404 });
}
