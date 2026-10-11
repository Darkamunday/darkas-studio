"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt, plural } from "@/lib/i18n/format";
import { btnPrimary, card } from "@/components/ui";
import type { ClientAlbum } from "@/lib/albums";
import { AlbumDialog } from "./album-dialog";

/** Your albums and the ones shared with you, with a button to start one. */
export function AlbumsIndex({ albums, isAdmin }: { albums: ClientAlbum[]; isAdmin: boolean }) {
  const { locale, m } = useI18n();
  const a = m.albums;
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const own = albums.filter((x) => x.mine);
  const shared = albums.filter((x) => !x.mine);

  const grid = (list: ClientAlbum[]) => (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {list.map((x) => (
        <li key={x.id}>
          <Link href={`/albums/${x.id}`} className={`${card} group block overflow-hidden transition hover:-translate-y-0.5 hover:border-line-strong`}>
            <div className="relative aspect-square bg-surface-2">
              {x.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={x.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
              ) : (
                <div className="grid h-full w-full place-items-center bg-brand/40 text-4xl" aria-hidden>
                  💿
                </div>
              )}
              <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur">
                {x.everyone || x.members.length > 0 || !x.mine ? `👥 ${a.shared}` : `🔒 ${a.private}`}
              </span>
            </div>
            <div className="p-4">
              <p className="truncate font-semibold">{x.name}</p>
              <p className="truncate text-sm text-subtle">
                {plural(locale, a.songs, x.trackCount)}
                {x.owner ? ` · ${fmt(a.by, { name: x.owner })}` : ""}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-4xl font-semibold sm:text-5xl">{a.heading}</h1>
          <p className="mt-3 text-muted">{a.blurb}</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
          + {a.newAlbum}
        </button>
      </div>

      {albums.length === 0 ? (
        <div className={`${card} flex flex-col items-center px-6 py-16 text-center`}>
          <span className="text-5xl" aria-hidden>
            💿
          </span>
          <h2 className="mt-6 text-2xl font-semibold">{a.emptyHeading}</h2>
          <p className="mt-2 max-w-sm text-muted">{a.emptyText}</p>
        </div>
      ) : (
        <>
          {own.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-subtle">{a.yours}</h2>
              {grid(own)}
            </section>
          )}
          {shared.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-subtle">{a.sharedWithYou}</h2>
              {grid(shared)}
            </section>
          )}
        </>
      )}

      {creating && (
        <AlbumDialog album={null} isAdmin={isAdmin} onSaved={(album) => router.push(`/albums/${album.id}`)} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
