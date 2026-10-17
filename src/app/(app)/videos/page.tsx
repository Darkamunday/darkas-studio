import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { hasVideoAccess, listVideos } from "@/lib/video/store";
import { getI18n } from "@/lib/i18n/server";
import { btnPrimary, card } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.videos.heading };
}

export default async function VideosPage() {
  const user = await requireUser();
  const { locale, m } = await getI18n();
  const v = m.videos;
  if (!hasVideoAccess(user.id)) {
    return (
      <div className={`${card} mx-auto max-w-lg p-8 text-center`}>
        <h1 className="text-2xl font-semibold">{v.offHeading}</h1>
        <p className="mt-3 text-muted">{v.offText}</p>
      </div>
    );
  }
  const videos = listVideos(user.id);
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-semibold sm:text-5xl">{v.heading}</h1>
          <p className="mt-3 max-w-2xl text-muted">{v.blurb}</p>
        </div>
        <Link href="/videos/new" className={btnPrimary}>
          + {v.newVideo}
        </Link>
      </div>
      {videos.length === 0 ? (
        <div className={`${card} flex flex-col items-center px-6 py-16 text-center`}>
          <span className="text-5xl" aria-hidden>
            🎬
          </span>
          <h2 className="mt-6 text-2xl font-semibold">{v.emptyHeading}</h2>
          <p className="mt-2 max-w-sm text-muted">{v.emptyText}</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((x) => (
            <li key={x.id}>
              <Link href={`/videos/${x.id}`} className={`${card} block p-5 transition hover:-translate-y-0.5 hover:border-line-strong`}>
                <p className="truncate text-lg font-semibold">{x.title}</p>
                <p className="mt-1 truncate text-sm text-subtle">{x.song.title}</p>
                <p className="mt-3 flex items-center justify-between text-xs text-subtle">
                  <span className={`rounded-full px-2.5 py-0.5 font-medium ${x.status === "failed" ? "bg-danger/12 text-danger" : x.status === "done" ? "bg-success/12 text-success" : "bg-surface-3 text-muted"}`}>
                    {(v.status as Record<string, string>)[x.status] ?? x.status}
                  </span>
                  {date.format(new Date(x.updatedAt * 1000))}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
