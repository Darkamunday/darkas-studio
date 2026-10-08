import type { NextRequest } from "next/server";
import { requireChatApi } from "@/lib/chat/access";
import { getImage } from "@/lib/chat/images";
import { serveFile } from "@/lib/media";

/** The image file — its owner only. ?download=1 saves it instead of showing it. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/chat/images/[id]/file">) {
  const auth = await requireChatApi();
  if (auth.error) return auth.error;
  const image = getImage(auth.user.id, Number((await ctx.params).id));
  if (!image?.file_path || image.status !== "ready") return new Response("Not found", { status: 404 });
  const download = req.nextUrl.searchParams.get("download") === "1";
  return serveFile(image.file_path, req, { download, title: image.prompt.slice(0, 60) });
}
