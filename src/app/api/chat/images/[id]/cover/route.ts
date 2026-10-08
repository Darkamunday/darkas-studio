import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireChatApi } from "@/lib/chat/access";
import { setImageAsCover } from "@/lib/chat/images";

export const dynamic = "force-dynamic";

const Body = z.object({ trackId: z.number().int().positive() });

/** Make one of your images the cover of one of your songs. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/chat/images/[id]/cover">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const ok = await setImageAsCover(auth.user.id, Number((await ctx.params).id), parsed.data.trackId);
  if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
  revalidatePath("/catalogue");
  return Response.json({ ok: true });
}
