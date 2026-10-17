import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getVideo, hasVideoAccess } from "@/lib/video/store";
import { getI18n } from "@/lib/i18n/server";
import { VideoView } from "./video-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.videos.heading };
}

export default async function VideoPage({ params }: PageProps<"/videos/[id]">) {
  const user = await requireUser();
  if (!hasVideoAccess(user.id)) redirect("/videos");
  const video = getVideo(user.id, Number((await params).id));
  if (!video) redirect("/videos");
  return <VideoView key={video.id} initial={video} />;
}
