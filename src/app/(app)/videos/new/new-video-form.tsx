"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { btnPrimary, btnSecondary, card, input, label } from "@/components/ui";
import { CAST_DESCRIPTION_MAX, MAX_CAST, VIDEO_CONCEPT_MAX, VIDEO_TITLE_MAX } from "@/config/video";

type Song = { id: number; title: string | null; duration: number | null; username: string; mine: boolean };
type CastRow = { key: number; code: string; name: string; description: string; photo: File | null; preview: string | null };

let rowSeq = 0;
const emptyRow = (code: string): CastRow => ({ key: ++rowSeq, code, name: "", description: "", photo: null, preview: null });

/** Start a video: the song (from the catalogue or uploaded), a title and concept, and the cast. */
export function NewVideoForm({ initialTrackId }: { initialTrackId: number | null }) {
  const { m } = useI18n();
  const v = m.videos;
  const router = useRouter();
  const [source, setSource] = useState<"catalogue" | "upload">("catalogue");
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [trackId, setTrackId] = useState<number | null>(initialTrackId);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [concept, setConcept] = useState("");
  const [cast, setCast] = useState<CastRow[]>(() => [emptyRow("A")]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/videos/songs")
      .then((r) => (r.ok ? (r.json() as Promise<{ songs: Song[] }>) : { songs: [] }))
      .catch(() => ({ songs: [] as Song[] }))
      .then((b) => live && setSongs(b.songs));
    return () => {
      live = false;
    };
  }, []);

  const song = songs?.find((s) => s.id === trackId);
  const update = (key: number, patch: Partial<CastRow>) => setCast((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const nextCode = () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((c) => !cast.some((r) => r.code === c)) ?? "Z";
  const ready =
    (source === "catalogue" ? !!trackId : !!file) &&
    (title.trim() || song?.title) &&
    cast.every((r) => /^[A-Z]{1,3}$/.test(r.code) && r.name.trim() && r.description.trim());

  async function submit() {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.append("title", title.trim() || song?.title || "");
    form.append("concept", concept.trim());
    if (source === "catalogue" && trackId) form.append("trackId", String(trackId));
    if (source === "upload" && file) form.append("track", file);
    form.append("cast", JSON.stringify(cast.map(({ code, name, description }) => ({ code, name: name.trim(), description: description.trim() }))));
    cast.forEach((r, i) => r.photo && form.append(`photo-${i}`, r.photo));
    const res = await fetch("/api/videos", { method: "POST", body: form }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { video?: { id: number }; error?: string } | null;
    if (res?.ok && body?.video) return router.push(`/videos/${body.video.id}`);
    setSaving(false);
    setError((v.errors as Record<string, string>)[body?.error ?? (res?.status === 413 ? "track_too_big" : "generic")] ?? v.errors.generic);
  }

  const tab = (on: boolean) => `flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${on ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/videos" className="text-sm text-subtle hover:text-fg">
          ← {v.heading}
        </Link>
        <h1 className="mt-2 text-4xl font-semibold">{v.newVideo}</h1>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !saving) void submit();
        }}
        className={`${card} flex flex-col gap-5 p-6`}
      >
        <fieldset>
          <legend className={label}>{v.song}</legend>
          <div className="mt-2 flex gap-1 rounded-2xl border border-line p-1">
            <button type="button" onClick={() => setSource("catalogue")} aria-pressed={source === "catalogue"} className={tab(source === "catalogue")}>
              {v.fromCatalogue}
            </button>
            <button type="button" onClick={() => setSource("upload")} aria-pressed={source === "upload"} className={tab(source === "upload")}>
              {v.uploadTrack}
            </button>
          </div>
          {source === "catalogue" ? (
            <select
              value={trackId ?? ""}
              onChange={(e) => setTrackId(Number(e.target.value) || null)}
              aria-label={v.song}
              className={`${input} mt-3`}
            >
              <option value="">{songs === null ? v.loading : v.pickSong}</option>
              {[true, false].map((mine) => {
                const list = (songs ?? []).filter((s) => s.mine === mine);
                return list.length ? (
                  <optgroup key={String(mine)} label={mine ? v.yourSongs : v.otherSongs}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {(s.title ?? m.common.untitled) + (mine ? "" : ` — ${s.username}`)}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          ) : (
            <label className="mt-3 block">
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-fg"
              />
              <span className="mt-1 block text-xs text-subtle">{v.uploadHint}</span>
            </label>
          )}
        </fieldset>

        <label className="block">
          <span className={label}>{v.title}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={VIDEO_TITLE_MAX} placeholder={song?.title ?? ""} className={`${input} mt-2`} />
        </label>

        <label className="block">
          <span className={label}>{v.concept}</span>
          <textarea
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            maxLength={VIDEO_CONCEPT_MAX}
            rows={3}
            placeholder={v.conceptPlaceholder}
            className={`${input} mt-2 resize-y`}
          />
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className={label}>{v.cast}</legend>
          <p className="-mt-1 text-xs text-subtle">{v.castHint}</p>
          {cast.map((r) => (
            <div key={r.key} className="flex gap-3 rounded-2xl border border-line p-3">
              <label className="grid h-20 w-20 flex-none cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-surface-2 text-center text-[11px] text-subtle hover:border-line-strong">
                {r.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview
                  <img src={r.preview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="px-1">{v.addPhoto}</span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-label={`${v.addPhoto}: ${r.name || r.code}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (r.preview) URL.revokeObjectURL(r.preview);
                    update(r.key, { photo: f, preview: f ? URL.createObjectURL(f) : null });
                  }}
                />
              </label>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    value={r.code}
                    onChange={(e) => update(r.key, { code: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) })}
                    aria-label={v.castCode}
                    title={v.castCode}
                    className="w-14 rounded-xl border border-line bg-surface-2 px-2 py-1.5 text-center text-sm font-semibold uppercase outline-none focus:border-pink"
                  />
                  <input
                    value={r.name}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    maxLength={40}
                    placeholder={v.castNamePlaceholder}
                    aria-label={v.castName}
                    className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-pink"
                  />
                  {cast.length > 1 && (
                    <button type="button" onClick={() => setCast((rows) => rows.filter((x) => x.key !== r.key))} aria-label={v.removeCast} className="px-2 text-subtle hover:text-danger">
                      ×
                    </button>
                  )}
                </div>
                <textarea
                  value={r.description}
                  onChange={(e) => update(r.key, { description: e.target.value })}
                  maxLength={CAST_DESCRIPTION_MAX}
                  rows={2}
                  placeholder={v.castDescriptionPlaceholder}
                  aria-label={v.castDescription}
                  className="resize-y rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-pink"
                />
              </div>
            </div>
          ))}
          {cast.length < MAX_CAST && (
            <button type="button" onClick={() => setCast((rows) => [...rows, emptyRow(nextCode())])} className={`${btnSecondary} self-start`}>
              + {v.addCast}
            </button>
          )}
          <p className="text-xs text-subtle">{v.photoConsent}</p>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={!ready || saving} className={`${btnPrimary} self-start`}>
          {saving ? v.creating : v.create}
        </button>
      </form>
    </div>
  );
}
