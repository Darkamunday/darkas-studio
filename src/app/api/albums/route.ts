import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MAX_ALBUMS_PER_USER, countOwnAlbums, createAlbum, listAlbums } from "@/lib/albums";
import { AlbumFields } from "./schema";

export const dynamic = "force-dynamic";

const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return Response.json({ albums: listAlbums(user.id, req.nextUrl.searchParams.get("kind") === "pictures" ? "pictures" : "music") });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = AlbumFields.required({ name: true }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  if (parsed.data.everyone && !user.is_admin) return Response.json({ error: "forbidden" }, { status: 403 });
  if (countOwnAlbums(user.id) >= MAX_ALBUMS_PER_USER) return Response.json({ error: "too_many_albums" }, { status: 400 });
  return Response.json({ album: createAlbum(user.id, { ...parsed.data, coverTrackId: undefined, coverPictureId: undefined }) });
}
