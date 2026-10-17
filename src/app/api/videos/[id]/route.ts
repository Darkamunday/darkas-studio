import type { NextRequest } from "next/server";
import { requireVideoApi } from "@/lib/video/api";
import { deleteVideo, getVideo } from "@/lib/video/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/videos/[id]">) {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  const video = getVideo(auth.user.id, Number((await ctx.params).id));
  return video ? Response.json({ video }) : Response.json({ error: "not_found" }, { status: 404 });
}

/** Delete a video and all its files. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/videos/[id]">) {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  return (await deleteVideo(auth.user.id, Number((await ctx.params).id))) ? Response.json({ ok: true }) : Response.json({ error: "not_found" }, { status: 404 });
}
