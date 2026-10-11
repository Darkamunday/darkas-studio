import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteAlbum, updateAlbum } from "@/lib/albums";
import { AlbumFields } from "../schema";

export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

/** Change an album (its owner). */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/albums/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = AlbumFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  // Only admins share with everyone (anyone can stop it).
  if (parsed.data.everyone && !user.is_admin) return Response.json({ error: "forbidden" }, { status: 403 });
  // The kind is fixed once an album is made.
  const album = updateAlbum(user.id, Number((await ctx.params).id), { ...parsed.data, kind: undefined });
  return album ? Response.json({ album }) : notFound();
}

/** Delete an album (its owner). The songs themselves aren't touched. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/albums/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return (await deleteAlbum(user.id, Number((await ctx.params).id))) ? Response.json({ ok: true }) : notFound();
}
