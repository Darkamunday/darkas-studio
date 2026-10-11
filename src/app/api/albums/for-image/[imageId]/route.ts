import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { albumsForImage } from "@/lib/picture-albums";

export const dynamic = "force-dynamic";

/** The picture albums you can put this chat picture in, and whether it's in each already. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/albums/for-image/[imageId]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ albums: albumsForImage(user.id, Number((await ctx.params).imageId)) });
}
