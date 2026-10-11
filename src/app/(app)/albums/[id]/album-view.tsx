"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt, plural } from "@/lib/i18n/format";
import { btnPrimary, btnSecondary, card } from "@/components/ui";
import type { AlbumTrack, ClientAlbum } from "@/lib/albums";
import { setTrackPrivateAction } from "../../catalogue/actions";
import { AlbumDialog } from "../album-dialog";

const time = (s: number | null) =>
  s !== null && Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "--:--";

/** One album: its songs in order, played one after another, with the owner's and members' controls. */
export function AlbumView({ album: initial, initialTracks, isAdmin }: { album: ClientAlbum; initialTracks: AlbumTrack[]; isAdmin: boolean }) {
  const { locale, m } = useI18n();
  const a = m.albums;
  const router = useRouter();
  const [album, setAlbum] = useState(initial);
  const [tracks, setTracks] = useState(initialTracks);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = album.everyone || album.members.length > 0 || !album.mine;

  // ---- playback: one <audio>, moving down the list ----
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);
  const playingTrack = tracks.find((t) => t.id === current) ?? null;

  function play(trackId: number) {
    const el = audioRef.current;
    if (!el) return;
    if (current === trackId) {
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
      return;
    }
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    setCurrent(trackId);
    setPosition(0);
    setLength(track.duration ?? 0);
    el.src = track.audioUrl;
    void el.play().catch(() => {});
  }

  function step(by: 1 | -1) {
    const at = tracks.findIndex((t) => t.id === current);
    const next = tracks[at + by];
    if (next) play(next.id);
    else if (by === 1) {
      audioRef.current?.pause();
      setCurrent(null);
    }
  }

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setPosition(el.currentTime);
    const onMeta = () => Number.isFinite(el.duration) && setLength(el.duration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  // ---- changes ----
  async function tracksCall(method: "DELETE" | "PATCH", body: object) {
    setError(null);
    const res = await fetch(`/api/albums/${album.id}/tracks`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { tracks?: AlbumTrack[] } | null;
    if (res?.ok && json?.tracks) setTracks(json.tracks);
    else setError(a.errors.generic);
  }

  async function remove(track: AlbumTrack) {
    if (!window.confirm(fmt(a.removeConfirm, { title: track.title ?? m.common.untitled }))) return;
    if (current === track.id) step(1);
    await tracksCall("DELETE", { trackId: track.id });
  }

  async function makePublic(track: AlbumTrack) {
    const res = await setTrackPrivateAction(track.id, false);
    if (res.ok) setTracks((list) => list.map((t) => (t.id === track.id ? { ...t, isPrivate: false } : t)));
    else setError(res.error ?? a.errors.generic);
  }

  async function setCover(trackId: number) {
    const res = await fetch(`/api/albums/${album.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverTrackId: trackId }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { album?: ClientAlbum } | null;
    if (json?.album) setAlbum(json.album);
    else setError(a.errors.generic);
  }

  async function leave() {
    if (!window.confirm(fmt(a.leaveConfirm, { name: album.name }))) return;
    const res = await fetch(`/api/albums/${album.id}/leave`, { method: "POST" }).catch(() => null);
    if (res?.ok || res?.status === 404) router.push("/albums");
    else setError(a.errors.generic);
  }

  const total = tracks.reduce((n, t) => n + (t.duration ?? 0), 0);
  const people = album.mine
    ? album.everyone
      ? a.sharedWithEveryone
      : album.members.length
        ? fmt(a.sharedWith, { names: album.members.map((p) => p.username).join(", ") })
        : a.privateHint
    : fmt(album.everyone ? a.sharedWithEveryoneBy : a.sharedBy, { name: album.owner ?? "" });
  const iconButton = "grid h-8 w-8 flex-none place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-fg disabled:opacity-30";

  return (
    <div className="flex flex-col gap-6">
      <audio ref={audioRef} preload="none" onEnded={() => step(1)} />
      <Link href="/albums" className="inline-flex w-fit items-center gap-1.5 text-sm text-subtle transition hover:text-fg">
        <span aria-hidden>←</span> {a.heading}
      </Link>

      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="aspect-square w-48 flex-none overflow-hidden rounded-3xl border border-line bg-surface-2 shadow-card sm:w-56">
          {album.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={album.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center bg-brand/40 text-6xl" aria-hidden>
              💿
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{shared ? `👥 ${a.sharedAlbum}` : `🔒 ${a.privateAlbum}`}</p>
          <h1 className="mt-1 break-words text-4xl font-semibold sm:text-5xl">{album.name}</h1>
          {album.description && <p className="mt-2 whitespace-pre-wrap text-muted">{album.description}</p>}
          <p className="mt-2 text-sm text-subtle">
            {plural(locale, a.songs, tracks.length)}
            {total > 0 ? ` · ${time(total)}` : ""} · {people}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => tracks[0] && play(current ?? tracks[0].id)} disabled={!tracks.length} className={btnPrimary}>
              {playing ? `❚❚ ${m.common.pause}` : `▶ ${a.playAll}`}
            </button>
            {album.mine && (
              <button type="button" onClick={() => setEditing(true)} className={btnSecondary}>
                {a.settings}
              </button>
            )}
            {album.member && !album.everyone && (
              <button type="button" onClick={() => void leave()} className={btnSecondary}>
                {a.leave}
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {tracks.length === 0 ? (
        <div className={`${card} px-6 py-12 text-center text-muted`}>
          {a.noSongs}{" "}
          <Link href="/catalogue" className="text-accent-fg hover:underline">
            {a.goToCatalogue}
          </Link>
        </div>
      ) : (
        <ol className={`${card} divide-y divide-line overflow-hidden`}>
          {tracks.map((t, i) => {
            const isCurrent = t.id === current;
            return (
              <li key={t.id} className={`flex items-center gap-3 px-3 py-2.5 sm:px-4 ${isCurrent ? "bg-pink/8" : ""}`}>
                <button
                  type="button"
                  onClick={() => play(t.id)}
                  aria-label={isCurrent && playing ? m.common.pause : `${m.common.play}: ${t.title ?? m.common.untitled}`}
                  className="relative grid h-12 w-12 flex-none place-items-center overflow-hidden rounded-xl bg-surface-2"
                >
                  {t.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.coverUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 bg-brand/40" />
                  )}
                  <span className="relative grid h-7 w-7 place-items-center rounded-full bg-black/50 text-xs text-white">
                    {isCurrent && playing ? "❚❚" : "▶"}
                  </span>
                </button>
                <span className="w-5 flex-none text-right text-xs tabular-nums text-subtle">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${isCurrent ? "text-accent-fg" : ""}`}>{t.title ?? m.common.untitled}</p>
                  <p className="truncate text-xs text-subtle">
                    {t.username}
                    {shared && t.addedBy && t.addedBy !== t.username ? ` · ${fmt(a.addedBy, { name: t.addedBy })}` : ""}
                  </p>
                  {t.isPrivate && shared && (
                    <p className="mt-0.5 text-xs text-violet">
                      🔒 {a.onlyYouSee}{" "}
                      <button type="button" onClick={() => void makePublic(t)} className="font-medium underline">
                        {a.makePublic}
                      </button>
                    </p>
                  )}
                </div>
                <span className="hidden flex-none text-xs tabular-nums text-subtle sm:block">{t.duration ? time(t.duration) : ""}</span>
                {album.mine && (
                  <>
                    <button type="button" onClick={() => void tracksCall("PATCH", { trackId: t.id, direction: "up" })} disabled={i === 0} aria-label={a.moveUp} title={a.moveUp} className={iconButton}>
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => void tracksCall("PATCH", { trackId: t.id, direction: "down" })}
                      disabled={i === tracks.length - 1}
                      aria-label={a.moveDown}
                      title={a.moveDown}
                      className={iconButton}
                    >
                      ↓
                    </button>
                    {t.coverUrl && album.coverTrackId !== t.id && (
                      <button type="button" onClick={() => void setCover(t.id)} aria-label={a.useAsCover} title={a.useAsCover} className={`${iconButton} max-sm:hidden`}>
                        🖼
                      </button>
                    )}
                  </>
                )}
                {t.canRemove && (
                  <button type="button" onClick={() => void remove(t)} aria-label={a.remove} title={a.remove} className={`${iconButton} hover:text-danger`}>
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {playingTrack && (
        <div className={`${card} sticky bottom-4 flex items-center gap-3 p-3`}>
          <button type="button" onClick={() => step(-1)} aria-label={a.previous} className={iconButton}>
            ⏮
          </button>
          <button
            type="button"
            onClick={() => play(playingTrack.id)}
            aria-label={playing ? m.common.pause : m.common.play}
            className="grid h-10 w-10 flex-none place-items-center rounded-full bg-brand text-sm text-white shadow-glow"
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button type="button" onClick={() => step(1)} aria-label={a.next} className={iconButton}>
            ⏭
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {playingTrack.title ?? m.common.untitled} <span className="text-subtle">· {playingTrack.username}</span>
            </p>
            <input
              type="range"
              min={0}
              max={length || 0}
              step={1}
              value={Math.min(position, length || 0)}
              onChange={(e) => {
                if (audioRef.current) audioRef.current.currentTime = Number(e.target.value);
              }}
              aria-label={m.common.seek}
              className="w-full accent-[var(--pink)]"
            />
          </div>
          <span className="flex-none text-xs tabular-nums text-subtle">
            {time(position)} / {length ? time(length) : "--:--"}
          </span>
        </div>
      )}

      {editing && (
        <AlbumDialog
          album={album}
          isAdmin={isAdmin}
          onSaved={(saved) => {
            setAlbum(saved);
            setEditing(false);
          }}
          onDeleted={() => router.push("/albums")}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
