import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getTrack, serveFile, withLocalFiles } from "@/lib/media";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[trackId]/cover">) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });

  const found = getTrack(Number((await ctx.params).trackId));
  if (!found) return new Response("Not found", { status: 404 });
  const track = await withLocalFiles(found);

  if (track.image_path) return serveFile(track.image_path, req);
  return track.source_image_url ? Response.redirect(track.source_image_url, 302) : new Response("No cover", { status: 404 });
}
