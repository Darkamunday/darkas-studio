import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { addTrack, albumTracks, moveTrack, removeTrack } from "@/lib/albums";

export const dynamic = "force-dynamic";

const Track = z.object({ trackId: z.number().int().positive() });

async function setup(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/tracks">) {
  const user = await getCurrentUser();
  const body = await req.json().catch(() => null);
  return { user, albumId: Number((await ctx.params).id), body };
}

/** Add a song (anyone in the album, for songs they can see). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/tracks">) {
  const { user, albumId, body } = await setup(req, ctx);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Track.safeParse(body);
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const result = addTrack(user.id, albumId, parsed.data.trackId);
  if (result === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
  if (result === "full") return Response.json({ error: "album_full" }, { status: 400 });
  return Response.json({ ok: true, result, tracks: albumTracks(user.id, albumId) });
}

/** Take a song out (the owner, or whoever added it). */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/tracks">) {
  const { user, albumId, body } = await setup(req, ctx);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Track.safeParse(body);
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!removeTrack(user.id, albumId, parsed.data.trackId)) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, tracks: albumTracks(user.id, albumId) });
}

/** Move a song up or down (the owner). */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/albums/[id]/tracks">) {
  const { user, albumId, body } = await setup(req, ctx);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Track.extend({ direction: z.enum(["up", "down"]) }).safeParse(body);
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!moveTrack(user.id, albumId, parsed.data.trackId, parsed.data.direction)) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true, tracks: albumTracks(user.id, albumId) });
}
