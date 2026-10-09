import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { leaveProject } from "@/lib/chat/projects";

export const dynamic = "force-dynamic";

/** Leave a project shared with you; your chats in it move back to your main list. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/chat/projects/[id]/leave">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  if (!leaveProject(auth.user.id, Number((await ctx.params).id))) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
