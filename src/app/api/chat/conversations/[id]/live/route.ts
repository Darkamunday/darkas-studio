import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { NDJSON_HEADERS, watchLive } from "@/lib/chat/live";

export const dynamic = "force-dynamic";

/**
 * Follow the reply running (or just finished) in one of your chats: everything so far, then live.
 * 204 when there isn't one — the saved chat is all there is.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]/live">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const stream = watchLive(auth.user.id, Number((await ctx.params).id));
  if (!stream) return new Response(null, { status: 204 });
  return new Response(stream, { headers: NDJSON_HEADERS });
}
