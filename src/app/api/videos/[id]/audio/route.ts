import type { NextRequest } from "next/server";
import { requireVideoApi } from "@/lib/video/api";
import { uploadedAudioPath } from "@/lib/video/store";
import { serveFile } from "@/lib/media";

/** An uploaded track — its owner only. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/videos/[id]/audio">) {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  const rel = uploadedAudioPath(auth.user.id, Number((await ctx.params).id));
  return rel ? serveFile(rel, req) : new Response("Not found", { status: 404 });
}
