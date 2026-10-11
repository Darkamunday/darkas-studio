"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt, plural } from "@/lib/i18n/format";
import { btnSecondary, card } from "@/components/ui";
import type { ClientAlbum } from "@/lib/albums";
import type { AlbumPicture } from "@/lib/picture-albums";
import { AlbumDialog } from "../album-dialog";

/** A picture album: a grid of pictures and videos, opened full screen one at a time. */
export function PictureAlbumView({ album: initial, initialPictures, isAdmin }: { album: ClientAlbum; initialPictures: AlbumPicture[]; isAdmin: boolean }) {
  const { locale, m } = useI18n();
  const a = m.albums;
  const router = useRouter();
  const [album, setAlbum] = useState(initial);
  const [pictures, setPictures] = useState(initialPictures);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = album.everyone || album.members.length > 0 || !album.mine;
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const shown = open === null ? null : pictures[open];

  const go = (by: 1 | -1) => setOpen((i) => (i === null ? i : Math.min(pictures.length - 1, Math.max(0, i + by))));

  // Keys in the viewer: arrows move, Escape closes.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Swipe left or right on a phone.
  const touchX = useRef<number | null>(null);

  async function picturesCall(method: "DELETE" | "PATCH", body: object) {
    setError(null);
    const res = await fetch(`/api/albums/${album.id}/pictures`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { pictures?: AlbumPicture[] } | null;
    if (res?.ok && json?.pictures) {
      setPictures(json.pictures);
      return json.pictures;
    }
    setError(a.errors.generic);
    return null;
  }

  async function remove(p: AlbumPicture) {
    if (!window.confirm(a.removePictureConfirm)) return;
    const list = await picturesCall("DELETE", { pictureId: p.id });
    if (list) setOpen((i) => (i === null || !list.length ? null : Math.min(i, list.length - 1)));
  }

  async function move(p: AlbumPicture, direction: "up" | "down") {
    const list = await picturesCall("PATCH", { pictureId: p.id, direction });
    if (list) setOpen(list.findIndex((x) => x.id === p.id));
  }

  async function setCover(pictureId: number) {
    const res = await fetch(`/api/albums/${album.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverPictureId: pictureId }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { album?: ClientAlbum } | null;
    if (json?.album) setAlbum(json.album);
    else setError(a.errors.generic);
  }

  async function leave() {
    if (!window.confirm(fmt(a.leaveConfirmPictures, { name: album.name }))) return;
    const res = await fetch(`/api/albums/${album.id}/leave`, { method: "POST" }).catch(() => null);
    if (res?.ok || res?.status === 404) router.push("/albums?kind=pictures");
    else setError(a.errors.generic);
  }

  const people = album.mine
    ? album.everyone
      ? a.sharedWithEveryone
      : album.members.length
        ? fmt(a.sharedWith, { names: album.members.map((p) => p.username).join(", ") })
        : a.privateHint
    : fmt(album.everyone ? a.sharedWithEveryoneBy : a.sharedBy, { name: album.owner ?? "" });
  const viewerButton = "rounded-xl border border-white/20 px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-6">
      <Link href="/albums?kind=pictures" className="inline-flex w-fit items-center gap-1.5 text-sm text-subtle transition hover:text-fg">
        <span aria-hidden>←</span> {a.heading}
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">{shared ? `👥 ${a.sharedAlbum}` : `🔒 ${a.privateAlbum}`}</p>
        <h1 className="mt-1 break-words text-4xl font-semibold sm:text-5xl">{album.name}</h1>
        {album.description && <p className="mt-2 whitespace-pre-wrap text-muted">{album.description}</p>}
        <p className="mt-2 text-sm text-subtle">
          {plural(locale, a.pictures, pictures.length)} · {people}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
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
      </header>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {pictures.length === 0 ? (
        <div className={`${card} px-6 py-12 text-center text-muted`}>
          {a.noPictures}{" "}
          <Link href="/chat" className="text-accent-fg hover:underline">
            {a.goToChat}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {pictures.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                aria-label={p.prompt}
                className="group relative block aspect-square w-full overflow-hidden rounded-2xl border border-line bg-surface-2"
              >
                {p.kind === "video" ? (
                  <>
                    <video src={`${p.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white">▶</span>
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                )}
                {album.coverPictureId === p.id && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">{a.cover}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {shown && open !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          role="dialog"
          aria-modal="true"
          aria-label={shown.prompt}
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            touchX.current = null;
            if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          }}
        >
          <div className="flex items-center gap-2 p-3 text-white">
            <span className="flex-1 text-sm tabular-nums text-white/70">
              {open + 1} / {pictures.length}
            </span>
            <button type="button" onClick={() => setOpen(null)} aria-label={a.close} className="grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-white/10">
              ×
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
            {shown.kind === "video" ? (
              <video key={shown.id} src={shown.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-xl" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={shown.id} src={shown.url} alt={shown.prompt} className="max-h-full max-w-full rounded-xl object-contain" />
            )}
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={open === 0}
              aria-label={a.previous}
              className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-2xl text-white hover:bg-black/60 disabled:opacity-0 max-sm:hidden"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              disabled={open === pictures.length - 1}
              aria-label={a.next}
              className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-2xl text-white hover:bg-black/60 disabled:opacity-0 max-sm:hidden"
            >
              ›
            </button>
          </div>
          <div className="flex flex-col gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
            <p className="line-clamp-3 text-sm text-white/85">{shown.prompt}</p>
            <p className="text-xs text-white/60">
              {shown.addedBy ? `${fmt(a.addedBy, { name: shown.addedBy })} · ` : ""}
              {date.format(new Date(shown.addedAt * 1000))}
            </p>
            <div className="flex flex-wrap gap-2">
              <a href={`${shown.url}?download=1`} className={viewerButton}>
                {m.common.download}
              </a>
              {album.mine && shown.kind === "image" && album.coverPictureId !== shown.id && (
                <button type="button" onClick={() => void setCover(shown.id)} className={viewerButton}>
                  {a.useAsCover}
                </button>
              )}
              {album.mine && (
                <>
                  <button type="button" onClick={() => void move(shown, "up")} disabled={open === 0} className={viewerButton}>
                    ← {a.moveEarlier}
                  </button>
                  <button type="button" onClick={() => void move(shown, "down")} disabled={open === pictures.length - 1} className={viewerButton}>
                    {a.moveLater} →
                  </button>
                </>
              )}
              {shown.canRemove && (
                <button type="button" onClick={() => void remove(shown)} className={`${viewerButton} hover:border-red-400 hover:text-red-300`}>
                  {a.remove}
                </button>
              )}
            </div>
          </div>
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
          onDeleted={() => router.push("/albums?kind=pictures")}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
