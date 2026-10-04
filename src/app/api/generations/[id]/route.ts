import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGeneration, refreshGeneration, tracksForGeneration } from "@/lib/tracks";
import { toClientGeneration } from "@/lib/serialize";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/generations/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number((await ctx.params).id);
  const found = getGeneration(id);
  if (!found || (found.is_private && found.user_id !== user.id)) return Response.json({ error: "Not found" }, { status: 404 });

  await refreshGeneration(id);
  const gen = getGeneration(id)!;
  return Response.json(toClientGeneration(gen, tracksForGeneration(id)));
}
