import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { deleteMemory, updateMemory } from "@/lib/chat/memory";
import { MAX_MEMORY_CHARS } from "@/config/chat";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chat/memories/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = z.object({ content: z.string().trim().min(1).max(MAX_MEMORY_CHARS) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const memory = updateMemory(auth.user.id, Number((await ctx.params).id), parsed.data.content);
  return memory ? Response.json({ memory }) : notFound();
}

/** Forget one (also Undo on a "Memory saved" note). */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/memories/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return deleteMemory(auth.user.id, Number((await ctx.params).id)) ? Response.json({ ok: true }) : notFound();
}
