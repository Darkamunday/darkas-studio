"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { findImageModel } from "@/config/images";
import type { ClientImage } from "@/lib/chat/images";

/**
 * An image in a reply: a soft placeholder while it's painting (checking back if the page was
 * reloaded mid-job), then the picture with Download, Again and Use as song cover.
 */
export function ImageCard({ image: initial, onAgain }: { image: ClientImage; onAgain?: (image: ClientImage) => void }) {
  const { m } = useI18n();
  const [image, setImage] = useState(initial);
  const [picking, setPicking] = useState(false);

  // A newer copy from the stream wins.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setImage(initial);
  }

  // Still painting with nobody streaming it (e.g. after a reload): check back every few seconds.
  useEffect(() => {
    if (image.status !== "pending") return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/chat/images/${image.id}`).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { image?: ClientImage } | null;
      if (body?.image && body.image.status !== "pending") setImage(body.image);
    }, 4000);
    return () => clearInterval(timer);
  }, [image.id, image.status]);

  const ratio = image.aspect === "portrait" ? "aspect-[3/4]" : image.aspect === "landscape" ? "aspect-video" : "aspect-square";
  // Media from connected tools is labelled "mcp:<server name>" rather than one of our image models.
  const fromTool = !findImageModel(image.model);
  const modelLabel = findImageModel(image.model)?.label ?? image.model.replace(/^mcp:/, "");

  return (
    <figure className="my-2 w-full max-w-md">
      {image.status === "ready" && image.url && image.kind === "video" ? (
        <video src={image.url} controls playsInline className="w-full rounded-2xl border border-line bg-black" />
      ) : image.status === "ready" && image.url && image.kind === "audio" ? (
        <audio src={image.url} controls className="w-full" />
      ) : image.status === "ready" && image.url ? (
        <a href={image.url} target="_blank" rel="noopener" className={`block overflow-hidden rounded-2xl border border-line bg-surface-2 ${ratio}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file */}
          <img src={image.url} alt={image.prompt} className="h-full w-full object-cover" loading="lazy" />
        </a>
      ) : image.status === "pending" ? (
        <div role="status" className={`grid place-items-center rounded-2xl border border-line skeleton ${ratio}`}>
          <span className="flex items-center gap-2 rounded-full bg-surface/80 px-3 py-1.5 text-sm text-muted backdrop-blur">
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-pink" />
            {m.chat.painting}
          </span>
        </div>
      ) : (
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger/8 px-4 py-3 text-sm text-danger">
          {(m.chat.imageErrors as Record<string, string>)[image.error ?? "generic"] ?? m.chat.imageErrors.generic}
        </div>
      )}
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
        <span className="line-clamp-2 min-w-0 flex-1" title={image.prompt}>
          {image.prompt}
        </span>
        <span className="rounded-full bg-surface-3 px-2 py-0.5">{modelLabel}</span>
      </figcaption>
      {image.status !== "pending" && (
        <div className="-ml-1.5 mt-1 flex flex-wrap items-center gap-0.5">
          {image.status === "ready" && image.url && (
            <a href={`${image.url}?download=1`} className="inline-flex h-7 items-center rounded-lg px-2 text-xs text-subtle transition hover:bg-surface-3 hover:text-fg">
              {m.chat.imageDownload}
            </a>
          )}
          {onAgain && !fromTool && (
            <button type="button" onClick={() => onAgain(image)} className="inline-flex h-7 items-center rounded-lg px-2 text-xs text-subtle transition hover:bg-surface-3 hover:text-fg">
              {m.chat.imageAgain}
            </button>
          )}
          {image.status === "ready" && image.kind === "image" && (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="inline-flex h-7 items-center rounded-lg px-2 text-xs text-subtle transition hover:bg-surface-3 hover:text-fg"
            >
              {m.chat.useAsCover}
            </button>
          )}
        </div>
      )}
      {picking && <CoverPicker imageId={image.id} onClose={() => setPicking(false)} />}
    </figure>
  );
}

/** Pick one of your songs to get this image as its cover. */
function CoverPicker({ imageId, onClose }: { imageId: number; onClose: () => void }) {
  const { m } = useI18n();
  const [tracks, setTracks] = useState<{ id: number; title: string | null }[] | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    void fetch("/api/chat/images/tracks")
      .then((r) => r.json())
      .then((b: { tracks?: { id: number; title: string | null }[] }) => setTracks(b.tracks ?? []))
      .catch(() => setError(true));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pick(trackId: number) {
    const res = await fetch(`/api/chat/images/${imageId}/cover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId }),
    }).catch(() => null);
    if (res?.ok) {
      setDone(true);
      setTimeout(onClose, 1200);
    } else setError(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={m.chat.pickSong}>
      <button type="button" aria-label={m.chat.imageCancel} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[80dvh] w-full max-w-sm animate-pop flex-col rounded-t-3xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card sm:rounded-3xl">
        <h2 className="font-semibold">{m.chat.pickSong}</h2>
        {done ? (
          <p className="mt-3 text-sm text-success">{m.chat.coverSet}</p>
        ) : error ? (
          <p className="mt-3 text-sm text-danger">{m.chat.imageErrors.generic}</p>
        ) : tracks === null ? (
          <p className="mt-3 text-sm text-subtle">…</p>
        ) : tracks.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{m.chat.noSongs}</p>
        ) : (
          <ul className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {tracks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => void pick(t.id)} className="w-full truncate rounded-xl px-3 py-2 text-left text-sm transition hover:bg-surface-2">
                  {t.title ?? m.common.untitled}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
