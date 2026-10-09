import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { pinReply, unpinReply } from "@/lib/chat/shared";

export const dynamic = "force-dynamic";

const Body = z.object({ messageId: z.number().int().positive() });

async function handle(req: NextRequest, action: (userId: number, messageId: number) => boolean) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!action(auth.user.id, parsed.data.messageId)) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}

/** Pin one of your replies to its project's Shared tab. */
export const POST = (req: NextRequest) => handle(req, pinReply);

/** Unpin it. */
export const DELETE = (req: NextRequest) => handle(req, unpinReply);
