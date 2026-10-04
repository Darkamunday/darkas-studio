"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";

function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Colour for bar at position x (0..1) along the brand gradient peach → pink → violet. */
function brandAt(x: number) {
  return x < 0.45
    ? `color-mix(in oklab, var(--peach), var(--pink) ${Math.round((x / 0.45) * 100)}%)`
    : `color-mix(in oklab, var(--pink), var(--violet) ${Math.round(((x - 0.45) / 0.55) * 100)}%)`;
}

/** Deterministic pseudo-waveform so each track has its own recognisable shape. */
function waveform(seed: number, count: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const x = i / (count - 1);
    // Gentle intro/outro envelope plus a couple of "sections".
    const envelope = 0.35 + 0.65 * Math.sin(Math.PI * x) ** 0.6;
    const sections = 0.75 + 0.25 * Math.sin(x * Math.PI * 5 + seed);
    return Math.max(0.12, Math.min(1, envelope * sections * (0.55 + rand() * 0.45)));
  });
}

type Props = {
  src: string;
  seed: number;
  duration?: number | null;
  /** Fewer, chunkier bars for small spaces. */
  compact?: boolean;
};

export function Player({ src, seed, duration: knownDuration, compact = false }: Props) {
  const { m } = useI18n();
  const audioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
  const [error, setError] = useState(false);
  const bars = useMemo(() => waveform(seed, compact ? 36 : 56), [seed, compact]);
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const on = (ev: string, fn: () => void) => {
      a.addEventListener(ev, fn);
      return () => a.removeEventListener(ev, fn);
    };
    const offs = [
      on("play", () => setPlaying(true)),
      on("pause", () => setPlaying(false)),
      on("ended", () => setPlaying(false)),
      on("waiting", () => setLoading(true)),
      on("playing", () => setLoading(false)),
      on("canplay", () => setLoading(false)),
      on("timeupdate", () => setTime(a.currentTime)),
      on("loadedmetadata", () => Number.isFinite(a.duration) && setDuration(a.duration)),
      on("error", () => {
        setError(true);
        setLoading(false);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      setError(false);
      setLoading(a.readyState < 3);
      try {
        await a.play();
      } catch {
        setLoading(false);
      }
    } else {
      a.pause();
    }
  };

  const seekTo = (fraction: number) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = Math.max(0, Math.min(1, fraction)) * duration;
    setTime(a.currentTime);
  };

  const seekFromPointer = (clientX: number) => {
    const el = barsRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    seekTo((clientX - r.left) / r.width);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!duration) return void toggle();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      seekTo((a.currentTime + (e.key === "ArrowRight" ? 5 : -5)) / duration);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <div className="flex items-center gap-3">
      <audio ref={audioRef} src={src} preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? m.common.pause : m.common.play}
        className={`grid flex-none place-items-center rounded-full bg-brand text-white shadow-glow transition hover:brightness-110 active:scale-95 ${
          compact ? "h-9 w-9" : "h-11 w-11"
        }`}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor">
            <path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.7-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={barsRef}
          role="slider"
          tabIndex={0}
          aria-label={m.common.seek}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={fmt(m.common.timeOf, { time: formatTime(time), total: formatTime(duration) })}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && seekFromPointer(e.clientX)}
          onKeyDown={onKeyDown}
          className={`flex cursor-pointer touch-none items-center gap-[2px] rounded-md ${compact ? "h-8" : "h-10"}`}
        >
          {bars.map((h, i) => {
            const played = (i + 0.5) / bars.length <= progress;
            return (
              <span
                key={i}
                className={`flex-1 rounded-full transition-colors duration-150 ${played ? "" : "bg-line-strong"}`}
                style={{ height: `${(h * 100).toFixed(1)}%`, background: played ? brandAt(i / (bars.length - 1)) : undefined }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[11px] tabular-nums text-subtle">
          <span>{error ? m.common.audioError : formatTime(time)}</span>
          <span>{duration ? formatTime(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  );
}
