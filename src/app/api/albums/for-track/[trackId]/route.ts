import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { albumsForTrack } from "@/lib/albums";

export const dynamic = "force-dynamic";

/** The albums you can put this song in, and whether it's in each already. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/albums/for-track/[trackId]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ albums: albumsForTrack(user.id, Number((await ctx.params).trackId)) });
}
