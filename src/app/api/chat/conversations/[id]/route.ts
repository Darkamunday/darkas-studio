import type { NextRequest } from "next/server";
import { z } from "zod";
import { CHAT_TITLE_MAX } from "@/config/chat";
import { requireChatApi } from "@/lib/chat/access";
import { deleteConversation, getConversation, listMessages, renameConversation } from "@/lib/chat/store";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const id = Number((await ctx.params).id);
  const conversation = getConversation(auth.user.id, id);
  if (!conversation) return notFound();
  return Response.json({ conversation, messages: listMessages(auth.user.id, id) });
}

const Rename = z.object({ title: z.string().trim().min(1).max(CHAT_TITLE_MAX) });

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Rename.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!renameConversation(auth.user.id, id, parsed.data.title)) return notFound();
  return Response.json({ ok: true, title: parsed.data.title });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  if (!deleteConversation(auth.user.id, Number((await ctx.params).id))) return notFound();
  return Response.json({ ok: true });
}
