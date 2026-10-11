import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listAlbums } from "@/lib/albums";
import { getI18n } from "@/lib/i18n/server";
import { AlbumsIndex } from "./albums-index";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.albums.heading };
}

// /albums: music albums; /albums?kind=pictures: picture albums.
export default async function AlbumsPage({ searchParams }: PageProps<"/albums">) {
  const user = await requireUser();
  const kind = (await searchParams).kind === "pictures" ? "pictures" : "music";
  return <AlbumsIndex key={kind} kind={kind} albums={listAlbums(user.id, kind)} isAdmin={user.is_admin === 1} />;
}
