import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { albumTracks, getAlbum } from "@/lib/albums";
import { getI18n } from "@/lib/i18n/server";
import { AlbumView } from "./album-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.albums.heading };
}

export default async function AlbumPage({ params }: PageProps<"/albums/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  const album = getAlbum(user.id, id);
  const tracks = album ? albumTracks(user.id, id) : undefined;
  if (!album || !tracks) redirect("/albums");
  return <AlbumView key={album.id} album={album} initialTracks={tracks} isAdmin={user.is_admin === 1} />;
}
