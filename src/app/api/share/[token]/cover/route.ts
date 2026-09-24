import type { NextRequest } from "next/server";
import { serveFile, withLocalFiles } from "@/lib/media";
import { getSharedTrack } from "@/lib/sharing";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/share/[token]/cover">) {
  const found = getSharedTrack((await ctx.params).token);
  if (!found) return new Response("Not found", { status: 404 });
  const track = await withLocalFiles(found);

  if (track.image_path) return serveFile(track.image_path, req);
  return track.source_image_url ? Response.redirect(track.source_image_url, 302) : new Response("No cover", { status: 404 });
}
