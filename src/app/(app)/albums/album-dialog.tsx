"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import type { ClientAlbum } from "@/lib/albums";

type Person = { id: number; username: string };

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

/** Create an album, or change (and delete) one of yours: name, description and who it's shared with. */
export function AlbumDialog({
  album,
  isAdmin,
  onSaved,
  onDeleted,
  onClose,
}: {
  /** null to create one. */
  album: ClientAlbum | null;
  isAdmin: boolean;
  onSaved: (album: ClientAlbum) => void;
  onDeleted?: (id: number) => void;
  onClose: () => void;
}) {
  const { locale, m } = useI18n();
  const a = m.albums;
  const num = new Intl.NumberFormat(locale);
  const [name, setName] = useState(album?.name ?? "");
  const [description, setDescription] = useState(album?.description ?? "");
  const [shared, setShared] = useState(!!album && (album.everyone || album.members.length > 0));
  const [everyone, setEveryone] = useState(album?.everyone ?? false);
  const [memberIds, setMemberIds] = useState(() => new Set(album?.members.map((p) => p.id) ?? []));
  const [people, setPeople] = useState<Person[] | null>(null);
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    fetch("/api/albums/people")
      .then((res) => (res.ok ? (res.json() as Promise<{ people: Person[] }>) : { people: [] }))
      .catch(() => ({ people: [] as Person[] }))
      .then((body) => live && setPeople(body.people));
    return () => {
      live = false;
    };
  }, []);

  const errorText = (reason: string) => (a.errors as Record<string, string>)[reason] ?? a.errors.generic;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(album ? `/api/albums/${album.id}` : "/api/albums", {
      method: album ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        memberIds: shared && !everyone ? [...memberIds] : [],
        // Only admins can turn "everyone" on; anyone can leave it as it is or turn it off.
        ...(isAdmin || !(shared && everyone) ? { everyone: shared && everyone } : {}),
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { album?: ClientAlbum; error?: string } | null;
    setSaving(false);
    if (res?.ok && body?.album) onSaved(body.album);
    else setError(errorText(body?.error ?? "generic"));
  }

  async function remove() {
    if (!album || !window.confirm(fmt(a.deleteConfirm, { name: album.name }))) return;
    const res = await fetch(`/api/albums/${album.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) onDeleted?.(album.id);
    else setError(errorText("generic"));
  }

  const field =
    "w-full rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-base text-fg outline-none transition placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15";
  const choice = (on: boolean) =>
    `flex-1 rounded-2xl border px-3 py-2.5 text-left text-sm transition ${on ? "border-pink bg-pink/10" : "border-line hover:border-line-strong"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="album-title">
      <button type="button" aria-label={a.cancel} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
        className="relative flex max-h-[92dvh] w-full max-w-xl animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <h2 id="album-title" className="text-lg font-semibold">
            {album ? a.settings : a.newAlbum}
          </h2>

          <label className="mt-5 block text-sm font-medium">
            {a.name}
            <input
              autoFocus={!album}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              placeholder={a.namePlaceholder}
              className={`${field} mt-1.5`}
            />
          </label>

          <label className="mt-4 block text-sm font-medium">
            {a.description} <span className="font-normal text-subtle">· {a.optional}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX}
              rows={2}
              className={`${field} mt-1.5 resize-y`}
            />
          </label>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">{a.whoCanSee}</legend>
            <div className="mt-1.5 flex gap-2">
              <button type="button" aria-pressed={!shared} onClick={() => setShared(false)} className={choice(!shared)}>
                <span className="block font-medium">🔒 {a.private}</span>
                <span className="block text-xs text-subtle">{a.privateHint}</span>
              </button>
              <button type="button" aria-pressed={shared} onClick={() => setShared(true)} className={choice(shared)}>
                <span className="block font-medium">👥 {a.shared}</span>
                <span className="block text-xs text-subtle">{a.sharedHint}</span>
              </button>
            </div>

            {shared && (
              <div className="mt-3">
                {(isAdmin || everyone) && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={everyone}
                      disabled={!isAdmin && !everyone}
                      onChange={(e) => setEveryone(e.target.checked)}
                      className="h-4 w-4 flex-none accent-[var(--pink)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{a.everyone}</span>
                      <span className="block text-xs text-subtle">{a.everyoneHint}</span>
                    </span>
                  </label>
                )}
                {!everyone &&
                  (people === null ? (
                    <p className="mt-2 text-sm text-subtle">{a.loadingPeople}</p>
                  ) : people.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">{a.noPeople}</p>
                  ) : (
                    <>
                      {people.length > 8 && (
                        <input
                          type="search"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                          placeholder={a.findPerson}
                          aria-label={a.findPerson}
                          className={`${field} mt-2 py-2 text-sm`}
                        />
                      )}
                      <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto rounded-2xl border border-line px-3">
                        {people
                          .filter((p) => memberIds.has(p.id) || p.username.toLowerCase().includes(filter.trim().toLowerCase()))
                          .map((p) => (
                            <li key={p.id}>
                              <label className="flex cursor-pointer items-center gap-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={memberIds.has(p.id)}
                                  onChange={() =>
                                    setMemberIds((s) => {
                                      const next = new Set(s);
                                      if (next.has(p.id)) next.delete(p.id);
                                      else next.add(p.id);
                                      return next;
                                    })
                                  }
                                  className="h-4 w-4 flex-none accent-[var(--pink)]"
                                />
                                <span className="min-w-0 flex-1 truncate text-sm">{p.username}</span>
                              </label>
                            </li>
                          ))}
                      </ul>
                      <p className="mt-1 text-xs text-subtle">
                        {memberIds.size > 0 ? fmt(a.sharedWithCount, { n: num.format(memberIds.size) }) : a.pickPeople}
                      </p>
                    </>
                  ))}
                <p className="mt-3 text-xs text-subtle">{a.collaborativeHint}</p>
              </div>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {album && onDeleted && (
            <button type="button" onClick={() => void remove()} className="rounded-xl px-3 py-2 text-sm text-muted transition hover:text-danger">
              {a.delete}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:border-line-strong hover:text-fg">
              {a.cancel}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving || (shared && !everyone && memberIds.size === 0)}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              {album ? a.save : a.create}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
