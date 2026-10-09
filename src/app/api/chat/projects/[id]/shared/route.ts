import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { hideShared } from "@/lib/chat/shared";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(["media", "song", "reply"]), id: z.number().int().positive() });

/** Take something off the project's Shared tab (its maker or the project's owner). */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/chat/projects/[id]/shared">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const projectId = Number((await ctx.params).id);
  if (!hideShared(auth.user.id, projectId, parsed.data.kind, parsed.data.id)) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
