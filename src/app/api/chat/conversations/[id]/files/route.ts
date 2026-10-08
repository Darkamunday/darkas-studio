import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { getConversation } from "@/lib/chat/store";
import { attachedFileIds, setAttachedFiles } from "@/lib/chat/files";
import { MAX_FILES_PER_USER } from "@/config/chat";

export const dynamic = "force-dynamic";

const Body = z.object({ fileIds: z.array(z.number().int().positive()).max(MAX_FILES_PER_USER) });

/** Set which of your files this chat uses. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]/files">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!getConversation(auth.user.id, id)) return Response.json({ error: "not_found" }, { status: 404 });
  setAttachedFiles(auth.user.id, id, parsed.data.fileIds);
  return Response.json({ fileIds: attachedFileIds(auth.user.id, id) });
}
