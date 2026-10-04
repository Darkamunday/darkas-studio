import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { LOCALE_INFO } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { getTimedLyrics, getTimingTrack } from "@/lib/timed-lyrics";
import { toLines, toLrc } from "@/lib/timed-lyrics-format";
import { canViewTrack } from "@/lib/tracks";
import { card } from "@/components/ui";
import { FetchTimingsButton, TimedLyricsView } from "./timed-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.meta.timed };
}

export default async function TimedLyricsPage({ params }: PageProps<"/admin/lyrics/[trackId]">) {
  const admin = await requireAdmin();
  const { locale, m } = await getI18n();
  const track = getTimingTrack(Number((await params).trackId));
  if (!track || !canViewTrack(admin.id, track)) notFound();

  const title = track.title ?? m.common.untitled;
  const timed = getTimedLyrics(track.id);
  const lines = timed ? toLines(timed.words) : [];
  const dateFmt = new Intl.DateTimeFormat(LOCALE_INFO[locale].tag, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-subtle transition hover:text-fg">
          {m.timed.back}
        </Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-accent-fg">{m.timed.heading}</p>
        <h1 className="mt-1 text-4xl font-semibold sm:text-5xl">{title}</h1>
        <p className="mt-2 text-muted">{fmt(m.generate.by, { name: track.username })}</p>
      </div>

      {track.instrumental ? (
        <p className={`${card} p-6 text-muted`}>{m.timed.instrumental}</p>
      ) : timed ? (
        <TimedLyricsView
          trackId={track.id}
          lines={lines}
          words={timed.words}
          lrc={toLrc(lines, { title, artist: track.username, durationS: track.duration })}
          filename={title}
          summary={fmt(m.timed.summary, {
            lines: lines.filter((l) => l.kind === "line").length,
            words: timed.words.length,
            date: dateFmt.format(new Date(timed.fetched_at * 1000)),
          })}
        />
      ) : (
        <div className={`${card} flex flex-col items-start gap-4 p-6`}>
          <p className="text-muted">{m.timed.notFetched}</p>
          <FetchTimingsButton trackId={track.id} label={m.timed.fetch} />
        </div>
      )}
    </div>
  );
}
