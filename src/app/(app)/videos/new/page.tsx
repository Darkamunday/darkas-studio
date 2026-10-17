import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasVideoAccess } from "@/lib/video/store";
import { getI18n } from "@/lib/i18n/server";
import { NewVideoForm } from "./new-video-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.videos.newVideo };
}

export default async function NewVideoPage({ searchParams }: PageProps<"/videos/new">) {
  const user = await requireUser();
  if (!hasVideoAccess(user.id)) redirect("/videos");
  const raw = (await searchParams).track;
  const trackId = Number(Array.isArray(raw) ? raw[0] : raw) || null;
  return <NewVideoForm initialTrackId={trackId} />;
}
