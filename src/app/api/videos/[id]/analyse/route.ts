import type { NextRequest } from "next/server";
import { requireVideoApi } from "@/lib/video/api";
import { getVideo } from "@/lib/video/store";
import { analyseVideo } from "@/lib/video/jobs";

export const dynamic = "force-dynamic";

/** Analyse the track again (e.g. after it failed). Only before the plan exists. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/videos/[id]/analyse">) {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  const id = Number((await ctx.params).id);
  const video = getVideo(auth.user.id, id);
  if (!video) return Response.json({ error: "not_found" }, { status: 404 });
  if (!["draft", "analysed", "failed"].includes(video.status)) return Response.json({ error: "busy" }, { status: 409 });
  void analyseVideo(auth.user.id, id);
  return Response.json({ ok: true });
}
