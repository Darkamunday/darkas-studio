"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { btnGhost, btnPrimary, btnSecondary, card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { lrcTime, type TimedLine, type TimedWord } from "@/lib/timed-lyrics-format";
import { fetchTimedLyricsAction } from "../../actions";

/** Spends credits, so it only ever runs on a click. The page re-renders with the result. */
export function FetchTimingsButton({ trackId, label, subtle }: { trackId: number; label: string; subtle?: boolean }) {
  const { m } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      setError(null);
      const res = await fetchTimedLyricsAction(trackId);
      if (!res.ok) setError(res.error ?? m.timed.none);
    });
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={run} disabled={pending} className={subtle ? btnGhost : btnPrimary}>
        {pending ? m.timed.fetching : label}
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "lyrics";

export function TimedLyricsView({
  trackId,
  lines,
  words,
  lrc,
  filename,
  summary,
}: {
  trackId: number;
  lines: TimedLine[];
  words: TimedWord[];
  lrc: string;
  filename: string;
  summary: string;
}) {
  const { m } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [time, setTime] = useState(0);

  // Follow playback smoothly (timeupdate alone only fires ~4 times a second).
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let raf = 0;
    const tick = () => {
      setTime(a.currentTime);
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const start = () => (raf = requestAnimationFrame(tick));
    a.addEventListener("play", start);
    a.addEventListener("seeked", tick);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener("play", start);
      a.removeEventListener("seeked", tick);
    };
  }, []);

  // The current line is the last one that has started.
  let active = -1;
  lines.forEach((l, i) => {
    if (l.kind === "line" && l.startS <= time + 0.05) active = i;
  });

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const seek = (s: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = s;
    void a.play();
  };

  return (
    <>
      <div className={`${card} flex flex-col gap-4 p-5`}>
        <audio ref={audioRef} src={`/api/media/${trackId}`} controls preload="metadata" className="w-full" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => download(`${safeName(filename)}.lrc`, lrc, "text/plain")} className={btnSecondary}>
            {m.timed.downloadLrc}
          </button>
          <CopyButton text={lrc} label={m.timed.copyLrc} className={btnSecondary} />
          <button
            type="button"
            onClick={() => download(`${safeName(filename)}.json`, JSON.stringify(words, null, 2), "application/json")}
            className={btnSecondary}
          >
            {m.timed.downloadJson}
          </button>
        </div>
        <p className="text-xs text-subtle">
          {summary} · {m.timed.follow}
        </p>
      </div>

      <ol ref={listRef} className={`${card} flex flex-col p-3 sm:p-5`}>
        {lines.map((l, i) =>
          l.kind === "gap" ? (
            <li key={i} aria-hidden className="h-3" />
          ) : l.kind === "section" ? (
            <li key={i} className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-accent-fg">
              {l.label}
            </li>
          ) : (
            <li key={i} data-i={i}>
              <button
                type="button"
                onClick={() => seek(l.startS)}
                className={`flex w-full items-baseline gap-4 rounded-xl px-3 py-1.5 text-left transition ${
                  i === active ? "bg-pink/12 text-fg" : i < active ? "text-subtle hover:bg-surface-2" : "text-muted hover:bg-surface-2"
                }`}
              >
                <span className="w-16 flex-none font-mono text-xs tabular-nums text-subtle">{lrcTime(l.startS)}</span>
                <span className={i === active ? "font-semibold" : ""}>{l.text}</span>
              </button>
            </li>
          ),
        )}
      </ol>

      <div className="self-start">
        <FetchTimingsButton trackId={trackId} label={m.timed.refetch} subtle />
      </div>
    </>
  );
}
