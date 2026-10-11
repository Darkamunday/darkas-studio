import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listAlbums } from "@/lib/albums";
import { getI18n } from "@/lib/i18n/server";
import { AlbumsIndex } from "./albums-index";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.albums.heading };
}

export default async function AlbumsPage() {
  const user = await requireUser();
  return <AlbumsIndex albums={listAlbums(user.id)} isAdmin={user.is_admin === 1} />;
}
