import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { deleteUnsent, getUpload } from "@/lib/chat/uploads";
import { serveFile } from "@/lib/media";

export const dynamic = "force-dynamic";

/** A picture you attached — yours only. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/chat/uploads/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const upload = getUpload(auth.user.id, Number((await ctx.params).id));
  if (!upload) return new Response("Not found", { status: 404 });
  return serveFile(upload.file_path, req, { immutable: true });
}

/** Take a picture off before sending it. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/chat/uploads/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  if (!(await deleteUnsent(auth.user.id, Number((await ctx.params).id)))) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
