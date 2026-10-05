import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { previewPath } from "@/lib/covers";
import { serveFile } from "@/lib/media";

// Preview of an AI cover its creator hasn't picked yet. Only they can see it.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/cover-jobs/[id]/image">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const path = previewPath(user.id, Number((await ctx.params).id));
  return path ? serveFile(path, req) : new Response("Not found", { status: 404 });
}
