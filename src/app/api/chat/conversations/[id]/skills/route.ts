import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { getConversation } from "@/lib/chat/store";
import { conversationSkillIds, setPinnedSkills } from "@/lib/chat/skills";

export const dynamic = "force-dynamic";

const Body = z.object({ skillIds: z.array(z.number().int().positive()).max(50) });

/** Set which skills are pinned to this chat. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]/skills">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!getConversation(auth.user.id, id)) return Response.json({ error: "not_found" }, { status: 404 });
  setPinnedSkills(auth.user.id, { conversationId: id }, parsed.data.skillIds);
  return Response.json({ skillIds: conversationSkillIds(auth.user.id, id) });
}
