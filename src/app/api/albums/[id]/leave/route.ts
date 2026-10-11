import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { leaveAlbum } from "@/lib/albums";

export const dynamic = "force-dynamic";

/** Leave an album shared with you. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/albums/[id]/leave">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return leaveAlbum(user.id, Number((await ctx.params).id)) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 });
}
