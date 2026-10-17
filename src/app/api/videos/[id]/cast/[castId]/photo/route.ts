import type { NextRequest } from "next/server";
import { requireVideoApi } from "@/lib/video/api";
import { castPhoto } from "@/lib/video/store";
import { serveFile } from "@/lib/media";

/** A cast member's reference photo — the video's owner only. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/videos/[id]/cast/[castId]/photo">) {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  const { id, castId } = await ctx.params;
  const rel = castPhoto(auth.user.id, Number(id), Number(castId));
  return rel ? serveFile(rel, req, { immutable: true }) : new Response("Not found", { status: 404 });
}
