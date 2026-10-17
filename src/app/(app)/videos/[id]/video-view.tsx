"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { btnSecondary, card } from "@/components/ui";
import { TrackPlayer } from "@/components/player";
import type { ClientVideo } from "@/lib/video/store";
import type { Section } from "@/config/video";

const SECTION_COLOURS: Record<Section, string> = {
  intro: "bg-violet/40",
  build: "bg-peach/50",
  drop: "bg-pink",
  breakdown: "bg-violet/70",
  outro: "bg-violet/30",
};

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** One music video: the track's analysis and cast now; the plan, stills, clips and edit come next. */
export function VideoView({ initial }: { initial: ClientVideo }) {
  const { m } = useI18n();
  const v = m.videos;
  const router = useRouter();
  const [video, setVideo] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const working = video.status === "analysing" || video.status === "draft";

  // While the server is working on it, check back every couple of seconds.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/videos/${video.id}`, { cache: "no-store" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { video?: ClientVideo } | null;
      if (body?.video) setVideo(body.video);
    }, 2000);
    return () => clearInterval(timer);
  }, [working, video.id]);

  async function reanalyse() {
    setError(null);
    const res = await fetch(`/api/videos/${video.id}/analyse`, { method: "POST" }).catch(() => null);
    if (res?.ok) setVideo({ ...video, status: "analysing", error: null });
    else setError(v.errors.generic);
  }

  async function remove() {
    if (!window.confirm(fmt(v.deleteConfirm, { title: video.title }))) return;
    const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) router.push("/videos");
    else setError(v.errors.generic);
  }

  const a = video.analysis;
  return (
    <div className="flex flex-col gap-6">
      <Link href="/videos" className="text-sm text-subtle hover:text-fg">
        ← {v.heading}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words text-4xl font-semibold">{video.title}</h1>
          <p className="mt-1 text-sm text-subtle">
            {video.song.title} · {(v.status as Record<string, string>)[video.status] ?? video.status}
          </p>
        </div>
        <button type="button" onClick={() => void remove()} className={btnSecondary}>
          {v.delete}
        </button>
      </header>

      <div className={`${card} p-4`}>
        <TrackPlayer
          track={{ id: video.song.trackId ?? -video.id, title: video.title, artist: video.song.title, audioUrl: video.song.audioUrl, coverUrl: null, duration: a?.duration ?? null, href: `/videos/${video.id}` }}
        />
      </div>

      <section className={`${card} p-6`}>
        <h2 className="text-lg font-semibold">{v.stepAnalysis}</h2>
        {working ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-pink" />
            {v.analysing}
          </p>
        ) : video.status === "failed" && !a ? (
          <div className="mt-3">
            <p role="alert" className="text-sm text-danger">
              {(v.errors as Record<string, string>)[video.error ?? ""] ?? v.errors.generic}
            </p>
            <button type="button" onClick={() => void reanalyse()} className={`${btnSecondary} mt-3`}>
              {v.tryAgain}
            </button>
          </div>
        ) : a ? (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
              {[
                [v.bpm, a.bpm.toFixed(1)],
                [v.bar, `${a.barSeconds.toFixed(3)} s`],
                [v.length, time(a.duration)],
              ].map(([k, val]) => (
                <div key={k} className="rounded-2xl bg-surface-2 px-3 py-2">
                  <dt className="text-xs text-subtle">{k}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{val}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4">
              <div className="flex h-8 overflow-hidden rounded-xl" role="img" aria-label={v.sections}>
                {a.sections.map((s, i) => (
                  <div
                    key={i}
                    title={`${(v.section as Record<string, string>)[s.label]} ${time(s.start)}–${time(s.end)}`}
                    className={`${SECTION_COLOURS[s.label]} border-r border-bg/40 last:border-0`}
                    style={{ width: `${((s.end - s.start) / a.duration) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {(Object.keys(SECTION_COLOURS) as Section[])
                  .filter((k) => a.sections.some((s) => s.label === k))
                  .map((k) => (
                    <li key={k} className="flex items-center gap-1.5">
                      <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${SECTION_COLOURS[k]}`} />
                      {(v.section as Record<string, string>)[k]}
                    </li>
                  ))}
              </ul>
            </div>
            <p className="mt-4 text-sm text-subtle">{v.nextPlanSoon}</p>
          </>
        ) : null}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>

      <section className={`${card} p-6`}>
        <h2 className="text-lg font-semibold">{v.cast}</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {video.cast.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-2xl border border-line p-3">
              <div className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-xl bg-surface-2 text-lg font-semibold text-subtle">
                {c.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, owner-only file
                  <img src={c.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  c.code
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="mr-1.5 rounded bg-surface-3 px-1.5 text-xs font-semibold">{c.code}</span>
                  {c.name}
                </p>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{c.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
