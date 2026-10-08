import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { imageStatus } from "@/lib/chat/images";

export const dynamic = "force-dynamic";

/** How one of your images is getting on (the browser checks back on pending ones). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/chat/images/[id]">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const image = imageStatus(auth.user.id, Number((await ctx.params).id));
  return image ? Response.json({ image }) : Response.json({ error: "not_found" }, { status: 404 });
}
