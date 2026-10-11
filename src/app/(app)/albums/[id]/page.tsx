import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { albumTracks, getAlbum } from "@/lib/albums";
import { albumPictures } from "@/lib/picture-albums";
import { getI18n } from "@/lib/i18n/server";
import { AlbumView } from "./album-view";
import { PictureAlbumView } from "./picture-album-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.albums.heading };
}

export default async function AlbumPage({ params }: PageProps<"/albums/[id]">) {
  const user = await requireUser();
  const id = Number((await params).id);
  const album = getAlbum(user.id, id);
  if (!album) redirect("/albums");
  if (album.kind === "pictures") {
    const pictures = albumPictures(user.id, id) ?? [];
    return <PictureAlbumView key={album.id} album={album} initialPictures={pictures} isAdmin={user.is_admin === 1} />;
  }
  const tracks = albumTracks(user.id, id) ?? [];
  return <AlbumView key={album.id} album={album} initialTracks={tracks} isAdmin={user.is_admin === 1} />;
}
