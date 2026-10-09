"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import type { SharedItem } from "@/lib/chat/shared";

/** The Shared tab's items: pictures, video and sound from chats, and songs, newest first. */
export function SharedGrid({ projectId, initialItems }: { projectId: number; initialItems: SharedItem[] }) {
  const { locale, m } = useI18n();
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });

  async function remove(item: SharedItem) {
    if (!window.confirm(m.chat.removeSharedConfirm)) return;
    setError(null);
    const res = await fetch(`/api/chat/projects/${projectId}/shared`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: item.kind, id: item.id }),
    }).catch(() => null);
    if (res?.ok || res?.status === 404) setItems((list) => list.filter((x) => !(x.kind === item.kind && x.id === item.id)));
    else setError(m.chat.errors.generic);
  }

  if (items.length === 0) {
    return <p className="mt-8 rounded-3xl border border-dashed border-line px-6 py-12 text-center text-muted">{m.chat.sharedEmpty}</p>;
  }

  const byline = (item: SharedItem) => (
    <div className="flex items-center gap-2 text-xs text-subtle">
      <span className="min-w-0 flex-1 truncate">
        {fmt(m.chat.madeBy, { name: item.by })} · {date.format(new Date(item.at * 1000))}
      </span>
      {item.canRemove && (
        <button type="button" onClick={() => void remove(item)} className="flex-none rounded-lg px-1.5 py-0.5 transition hover:text-danger">
          {m.chat.removeShared}
        </button>
      )}
    </div>
  );

  return (
    <>
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) =>
          item.kind === "media" ? (
            <li key={`media-${item.id}`} className="flex flex-col gap-2 rounded-3xl border border-line bg-surface p-3 shadow-card">
              {item.media === "video" ? (
                <video src={item.url} controls playsInline preload="metadata" className="w-full rounded-2xl bg-black" />
              ) : item.media === "audio" ? (
                <audio src={item.url} controls preload="none" className="w-full" />
              ) : (
                <a href={item.url} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded-2xl bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file */}
                  <img src={item.url} alt={item.prompt} className="h-full w-full object-cover" loading="lazy" />
                </a>
              )}
              <p className="line-clamp-2 text-sm text-muted" title={item.prompt}>
                {item.prompt}
              </p>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">{byline(item)}</div>
                <a href={`${item.url}?download=1`} className="flex-none rounded-lg px-1.5 py-0.5 text-xs text-subtle transition hover:text-fg">
                  {m.common.download}
                </a>
              </div>
            </li>
          ) : (
            <li key={`song-${item.id}`} className="flex flex-col gap-2 rounded-3xl border border-line bg-surface p-3 shadow-card">
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 flex-none place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-pink/25 to-violet/25 text-2xl">
                  {item.takes[0]?.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- auth-checked file
                    <img src={item.takes[0].coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span aria-hidden>🎵</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.title ?? item.takes[0]?.title ?? m.common.untitled}</p>
                  {item.style && <p className="line-clamp-2 text-xs text-subtle">{item.style}</p>}
                </div>
              </div>
              {item.takes.map((t, i) => (
                <div key={t.id} className="flex items-center gap-2">
                  {item.takes.length > 1 && <span className="w-12 flex-none text-xs text-subtle">{fmt(m.chat.takeN, { n: String(i + 1) })}</span>}
                  <audio src={t.audioUrl} controls preload="none" className="h-9 min-w-0 flex-1" />
                </div>
              ))}
              {byline(item)}
            </li>
          ),
        )}
      </ul>
    </>
  );
}
