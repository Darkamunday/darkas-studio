import type { NextRequest } from "next/server";
import { z } from "zod";
import { CHAT_TITLE_MAX } from "@/config/chat";
import { requireChatApi } from "@/lib/chat/access";
import { moveConversation } from "@/lib/chat/projects";
import { removeConversationImages } from "@/lib/chat/images";
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

// Rename it, and/or move it into one of your projects (or out, with null).
const Patch = z
  .object({
    title: z.string().trim().min(1).max(CHAT_TITLE_MAX).optional(),
    projectId: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => b.title !== undefined || b.projectId !== undefined);

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!getConversation(auth.user.id, id)) return notFound();
  if (parsed.data.title !== undefined) renameConversation(auth.user.id, id, parsed.data.title);
  if (parsed.data.projectId !== undefined && !moveConversation(auth.user.id, id, parsed.data.projectId)) return notFound();
  return Response.json({ ok: true, ...parsed.data });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/conversations/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const id = Number((await ctx.params).id);
  if (!getConversation(auth.user.id, id)) return notFound();
  // Image files live on disk; the rows go with the chat.
  await removeConversationImages(auth.user.id, id);
  if (!deleteConversation(auth.user.id, id)) return notFound();
  return Response.json({ ok: true });
}
