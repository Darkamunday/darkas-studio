import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { deleteFile, getFile, toClientFile, updateFile } from "@/lib/chat/files";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

/** One of your files, with its extracted text (to check what the model will read). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/chat/files/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const file = getFile(auth.user.id, Number((await ctx.params).id));
  if (!file) return notFound();
  return Response.json({ file: toClientFile(file), text: file.text });
}

const Patch = z.object({ name: z.string().trim().min(1).max(200).optional(), always: z.boolean().optional() });

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/chat/files/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const id = Number((await ctx.params).id);
  if (!updateFile(auth.user.id, id, parsed.data)) return notFound();
  return Response.json({ file: toClientFile(getFile(auth.user.id, id)!) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/files/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  if (!deleteFile(auth.user.id, Number((await ctx.params).id))) return notFound();
  return Response.json({ ok: true });
}
