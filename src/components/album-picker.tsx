"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

type Choice = { id: number; name: string; mine: boolean; shared: boolean; has: boolean };

/**
 * "Add to album": tick the albums a song (or a chat picture) is in, or start a new album with it.
 * `kind` picks which albums and how the thing is added: songs go in music albums, pictures in picture albums.
 */
export function AlbumPicker({
  kind,
  itemId,
  title,
  onClose,
}: {
  kind: "music" | "pictures";
  /** The song's id, or the chat picture's id. */
  itemId: number;
  title: string;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const a = m.albums;
  const [albums, setAlbums] = useState<Choice[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listUrl = kind === "music" ? `/api/albums/for-track/${itemId}` : `/api/albums/for-image/${itemId}`;
  const itemUrl = (albumId: number) => `/api/albums/${albumId}/${kind === "music" ? "tracks" : "pictures"}`;
  const itemBody = JSON.stringify(kind === "music" ? { trackId: itemId } : { imageId: itemId });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Loaded once (kept apart from the Escape listener, so a parent re-rendering doesn't fetch again).
  useEffect(() => {
    let live = true;
    fetch(listUrl)
      .then((res) => (res.ok ? (res.json() as Promise<{ albums: Choice[] }>) : null))
      .catch(() => null)
      .then((body) => live && (body ? setAlbums(body.albums) : setError(a.errors.generic)));
    return () => {
      live = false;
    };
  }, [listUrl, a]);

  async function toggle(album: Choice) {
    setBusy(album.id);
    setError(null);
    const res = await fetch(itemUrl(album.id), {
      method: album.has ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: itemBody,
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(null);
    if (res?.ok) setAlbums((list) => list?.map((x) => (x.id === album.id ? { ...x, has: !x.has } : x)) ?? null);
    // Taking something out of someone else's album only works for things you added.
    else setError(album.has ? a.errors.cantRemove : ((a.errors as Record<string, string>)[body?.error ?? ""] ?? a.errors.generic));
  }

  async function createWithItem() {
    const name = newName.trim();
    if (!name) return;
    setBusy("new");
    setError(null);
    const res = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { album?: { id: number; name: string }; error?: string } | null;
    if (!res?.ok || !body?.album) {
      setBusy(null);
      return setError((a.errors as Record<string, string>)[body?.error ?? ""] ?? a.errors.generic);
    }
    const created = body.album;
    const added = await fetch(itemUrl(created.id), { method: "POST", headers: { "Content-Type": "application/json" }, body: itemBody }).catch(
      () => null,
    );
    setBusy(null);
    setNewName("");
    setAlbums((list) => [{ id: created.id, name: created.name, mine: true, shared: false, has: !!added?.ok }, ...(list ?? [])]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={`add-album-${kind}-${itemId}`}>
      <button type="button" aria-label={a.done} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[85dvh] w-full max-w-sm animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl">
        <div className="p-5 pb-3">
          <h2 id={`add-album-${kind}-${itemId}`} className="font-semibold">
            {a.addToAlbum}
          </h2>
          <p className="truncate text-sm text-subtle">{title}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          {albums === null ? (
            <p className="px-2 py-4 text-sm text-subtle">{a.loading}</p>
          ) : albums.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted">{a.noAlbumsYet}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {albums.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => void toggle(x)}
                    disabled={busy !== null}
                    aria-pressed={x.has}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-surface-2 disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className={`grid h-5 w-5 flex-none place-items-center rounded-md border text-xs ${x.has ? "border-pink bg-pink text-white" : "border-line"}`}
                    >
                      {x.has ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className="flex-none text-xs text-subtle">{x.shared ? "👥" : "🔒"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createWithItem();
          }}
          className="flex gap-2 border-t border-line px-5 pt-3"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
            placeholder={kind === "music" ? a.newAlbumName : a.newPictureAlbumName}
            aria-label={kind === "music" ? a.newAlbumName : a.newPictureAlbumName}
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-pink"
          />
          <button type="submit" disabled={!newName.trim() || busy !== null} className="flex-none rounded-xl bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {a.create}
          </button>
        </form>
        {error && (
          <p role="alert" className="px-5 pt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 p-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <Link href={kind === "music" ? "/albums" : "/albums?kind=pictures"} className="text-sm text-subtle hover:text-fg">
            {a.heading} →
          </Link>
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted hover:text-fg">
            {a.done}
          </button>
        </div>
      </div>
    </div>
  );
}
