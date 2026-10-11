import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { pictureFile } from "@/lib/picture-albums";
import { serveFile } from "@/lib/media";

/** A picture in an album — for anyone who can open the album. ?download=1 saves it. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/albums/pictures/[pictureId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const file = pictureFile(user.id, Number((await ctx.params).pictureId));
  if (!file?.file_path) return new Response("Not found", { status: 404 });
  return serveFile(file.file_path, req, { download: req.nextUrl.searchParams.get("download") === "1", title: file.prompt.slice(0, 60) });
}
