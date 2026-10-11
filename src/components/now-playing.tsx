"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

// One audio player for the whole app. It lives in the root layout, so it keeps playing while you move
// between pages; when a song ends, the next one in the queue starts. Pages hand it a queue (the songs on
// the page, in order) through <QueueScope>; the bar along the bottom (<NowPlayingBar>) is placed by each
// layout so it sits in the page's flow instead of covering anything.

/** A song the player can play. */
export type QueueTrack = {
  id: number;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl: string | null;
  duration: number | null;
  /** Where it was started from (the bar's title links back there). */
  href?: string;
};

type PlayerState = {
  queue: QueueTrack[];
  index: number;
  current: QueueTrack | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  error: boolean;
  /** Play `queue` from the song with this id (or the first). */
  playFrom: (queue: QueueTrack[], trackId?: number) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  stop: () => void;
};

const Ctx = createContext<PlayerState | null>(null);

export function useNowPlaying(): PlayerState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNowPlaying needs <NowPlayingProvider>");
  return ctx;
}

export function NowPlayingProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [queue, setQueue] = useState<QueueTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);
  const current = queue[index] ?? null;

  const start = useCallback((list: QueueTrack[], at: number) => {
    const el = audioRef.current;
    const track = list[at];
    if (!el || !track) return;
    setQueue(list);
    setIndex(at);
    setTime(0);
    setDuration(track.duration ?? 0);
    setError(false);
    setLoading(true);
    el.src = track.audioUrl;
    el.play().catch(() => setLoading(false));
  }, []);

  const playFrom = useCallback(
    (list: QueueTrack[], trackId?: number) => {
      const at = Math.max(0, trackId === undefined ? 0 : list.findIndex((t) => t.id === trackId));
      start(list, at);
    },
    [start],
  );

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !el.src) return;
    if (el.paused) {
      setError(false);
      el.play().catch(() => {});
    } else el.pause();
  }, []);

  const next = useCallback(() => {
    if (index + 1 < queue.length) start(queue, index + 1);
    else {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
    }
  }, [index, queue, start]);

  const previous = useCallback(() => {
    const el = audioRef.current;
    // A few seconds in, "previous" goes back to the start of this song, as on most players.
    if (el && el.currentTime > 3) el.currentTime = 0;
    else if (index > 0) start(queue, index - 1);
    else if (el) el.currentTime = 0;
  }, [index, queue, start]);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (el && Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
  }, []);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setTime(0);
  }, []);

  // Keep the newest next/previous for the audio element's and the system's handlers.
  const nextRef = useRef(next);
  const previousRef = useRef(previous);
  useEffect(() => {
    nextRef.current = next;
    previousRef.current = previous;
  });

  // Lock screen, headphones and media keys (Media Session).
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: "Darka's Studio",
      artwork: current.coverUrl ? [{ src: current.coverUrl, sizes: "512x512" }] : [],
    });
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    };
    set("play", () => void audioRef.current?.play().catch(() => {}));
    set("pause", () => audioRef.current?.pause());
    set("nexttrack", () => nextRef.current());
    set("previoustrack", () => previousRef.current());
    set("seekto", (d) => d.seekTime !== undefined && audioRef.current && (audioRef.current.currentTime = d.seekTime));
  }, [current]);

  const value = useMemo<PlayerState>(
    () => ({ queue, index, current, playing, loading, time, duration, error, playFrom, toggle, next, previous, seek, stop }),
    [queue, index, current, playing, loading, time, duration, error, playFrom, toggle, next, previous, seek, stop],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onEnded={() => nextRef.current()}
        onError={() => {
          if (!audioRef.current?.getAttribute("src")) return; // stopped on purpose
          // A song that won't load (e.g. deleted meanwhile) is shown as an error, then skipped.
          setError(true);
          setLoading(false);
          setTimeout(() => nextRef.current(), 1500);
        }}
      />
    </Ctx.Provider>
  );
}

// ---- the queue a page offers ----------------------------------------------------------------

const QueueCtx = createContext<QueueTrack[] | null>(null);

/** The songs on this page, in order: pressing play on one of them plays on through the rest. */
export function QueueScope({ tracks, children }: { tracks: QueueTrack[]; children: React.ReactNode }) {
  return <QueueCtx.Provider value={tracks}>{children}</QueueCtx.Provider>;
}

export const usePageQueue = () => useContext(QueueCtx);

// ---- the bar ----------------------------------------------------------------------------------

export function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** The player bar: shown while something is playing (or paused). Each layout places it at its bottom. */
export function NowPlayingBar({ className = "" }: { className?: string }) {
  const { m } = useI18n();
  const p = useNowPlaying();
  if (!p.current) return null;
  const c = p.current;
  const button = "grid h-9 w-9 flex-none place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-30";
  return (
    <div role="region" aria-label={m.player.label} className={`z-40 border-t border-line bg-surface/95 backdrop-blur ${className}`}>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2 sm:px-4">
        <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-xl bg-brand/40">
          {c.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden>🎵</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {c.href ? (
              <Link href={c.href} className="hover:underline">
                {c.title}
              </Link>
            ) : (
              c.title
            )}
            <span className="text-subtle"> · {c.artist}</span>
          </p>
          <div className="flex items-center gap-2">
            <span className="w-9 flex-none text-[11px] tabular-nums text-subtle">{p.error ? "!" : formatTime(p.time)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.round(p.duration))}
              step={1}
              value={Math.min(Math.round(p.time), Math.round(p.duration) || 0)}
              onChange={(e) => p.seek(Number(e.target.value))}
              aria-label={m.common.seek}
              aria-valuetext={`${formatTime(p.time)} / ${formatTime(p.duration)}`}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--pink)]"
            />
            <span className="w-9 flex-none text-right text-[11px] tabular-nums text-subtle">{p.duration ? formatTime(p.duration) : "--:--"}</span>
          </div>
          {p.error && <p className="text-[11px] text-danger">{m.common.audioError}</p>}
        </div>
        <button type="button" onClick={p.previous} aria-label={m.player.previous} title={m.player.previous} className={`${button} max-sm:hidden`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M6 5h2v14H6zM20 5.5v13a.5.5 0 0 1-.77.42L9.5 12.42a.5.5 0 0 1 0-.84l9.73-6.5a.5.5 0 0 1 .77.42Z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={p.toggle}
          aria-label={p.playing ? m.common.pause : m.common.play}
          className="grid h-10 w-10 flex-none place-items-center rounded-full bg-brand text-white shadow-glow transition hover:brightness-110 active:scale-95"
        >
          {p.loading && p.playing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : p.playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1.2" />
              <rect x="14" y="5" width="4" height="14" rx="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.7-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" />
            </svg>
          )}
        </button>
        <button type="button" onClick={p.next} disabled={p.index + 1 >= p.queue.length} aria-label={m.player.next} title={m.player.next} className={button}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M16 5h2v14h-2zM4 5.5v13a.5.5 0 0 0 .77.42l9.73-6.5a.5.5 0 0 0 0-.84L4.77 5.08A.5.5 0 0 0 4 5.5Z" />
          </svg>
        </button>
        <span className="hidden flex-none text-xs tabular-nums text-subtle sm:block">
          {p.index + 1}/{p.queue.length}
        </span>
        <button type="button" onClick={p.stop} aria-label={m.player.close} title={m.player.close} className={button}>
          ×
        </button>
      </div>
    </div>
  );
}
