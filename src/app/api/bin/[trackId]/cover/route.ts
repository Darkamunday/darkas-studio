import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBinnedForViewer } from "@/lib/bin";
import { serveFile } from "@/lib/media";

// Cover art for the "Recently deleted" lists. Only people who could restore the track can see it.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/bin/[trackId]/cover">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const track = getBinnedForViewer(user, Number((await ctx.params).trackId));
  if (!track) return new Response("Not found", { status: 404 });
  if (track.image_path) return serveFile(track.image_path, req);
  return track.source_image_url ? Response.redirect(track.source_image_url, 302) : new Response("No cover", { status: 404 });
}
