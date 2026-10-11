import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { addPicture, albumPictures, movePicture, pictureFromImage, removePicture } from "@/lib/picture-albums";

export const dynamic = "force-dynamic";

const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
const notFound = () => Response.json({ error: "not_found" }, { status: 404 });
const bad = () => Response.json({ error: "bad_request" }, { status: 400 });
const id = z.number().int().positive();

/** Add one of your chat pictures or videos (anyone in the album). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/pictures">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = z.object({ imageId: id }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  const albumId = Number((await ctx.params).id);
  const result = await addPicture(user.id, albumId, parsed.data.imageId);
  if (result === "not_found") return notFound();
  if (result === "full") return Response.json({ error: "album_full" }, { status: 400 });
  return Response.json({ ok: true, result });
}

/** Take a picture out (the owner, or whoever added it) — by its id, or by the chat picture it came from. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/pictures">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = z.union([z.object({ pictureId: id }), z.object({ imageId: id })]).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  const albumId = Number((await ctx.params).id);
  const pictureId = "pictureId" in parsed.data ? parsed.data.pictureId : pictureFromImage(albumId, parsed.data.imageId);
  if (!pictureId || !(await removePicture(user.id, albumId, pictureId))) return notFound();
  return Response.json({ ok: true, pictures: albumPictures(user.id, albumId) });
}

/** Move a picture earlier or later (the owner). */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/pictures">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = z.object({ pictureId: id, direction: z.enum(["up", "down"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad();
  const albumId = Number((await ctx.params).id);
  if (!movePicture(user.id, albumId, parsed.data.pictureId, parsed.data.direction)) return notFound();
  return Response.json({ ok: true, pictures: albumPictures(user.id, albumId) });
}
