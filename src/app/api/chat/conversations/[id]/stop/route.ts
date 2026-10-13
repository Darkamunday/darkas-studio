import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { stopLive } from "@/lib/chat/live";

export const dynamic = "force-dynamic";

/** Stop the reply running in one of your chats (what it has so far is kept). */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]/stop">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  return Response.json({ stopped: stopLive(auth.user.id, Number((await ctx.params).id)) });
}
