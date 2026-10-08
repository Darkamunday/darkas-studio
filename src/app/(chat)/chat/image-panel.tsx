"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_PREFS_COOKIE, MAX_IMAGE_PROMPT_CHARS, imageModelsFor, type ImageAspect } from "@/config/images";
import type { ImagePrefs } from "./use-chat-stream";

/** Remember the image settings in a cookie (read by the chat page on the server). */
export function saveImagePrefs(prefs: ImagePrefs) {
  document.cookie = `${IMAGE_PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}; path=/; max-age=31536000; samesite=lax`;
}

/** "Make an image": a description, the model and shape, and whether to improve the description first. */
export function ImagePanel({
  prefs,
  isAdmin,
  onMake,
  onClose,
}: {
  prefs: ImagePrefs;
  isAdmin: boolean;
  onMake: (description: string, prefs: ImagePrefs) => void;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const [description, setDescription] = useState("");
  const [model, setModel] = useState(prefs.model);
  const [aspect, setAspect] = useState<ImageAspect>(prefs.aspect);
  const [improve, setImprove] = useState(prefs.improve);

  // Escape closes it; the latest onClose is kept in a ref so the listener is set up once.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shapes: { id: ImageAspect; label: string; box: string }[] = [
    { id: "square", label: m.chat.shapeSquare, box: "h-4 w-4" },
    { id: "portrait", label: m.chat.shapePortrait, box: "h-5 w-3.5" },
    { id: "landscape", label: m.chat.shapeLandscape, box: "h-3 w-5" },
  ];
  const field =
    "w-full rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-base text-fg outline-none transition placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="image-title">
      <button type="button" aria-label={m.chat.imageCancel} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!description.trim()) return;
          const next = { model, aspect, improve };
          saveImagePrefs(next);
          onMake(description.trim(), next);
        }}
        className="relative w-full max-w-lg animate-pop rounded-t-3xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card sm:rounded-3xl sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-peach/30 to-pink/25 text-lg">
            🎨
          </span>
          <h2 id="image-title" className="text-lg font-semibold">{m.chat.imageTitle}</h2>
        </div>
        <label className="mt-4 block text-sm font-medium">
          {m.chat.imageDescribe}
          <textarea
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_IMAGE_PROMPT_CHARS}
            rows={3}
            placeholder={m.chat.imagePlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
            className={`${field} mt-1.5 resize-y`}
          />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {m.chat.imageModel}
            <select value={model} onChange={(e) => setModel(e.target.value)} className={`${field} mt-1.5`}>
              {imageModelsFor(isAdmin).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.adminOnly ? `${x.label} · ${m.chat.adminOnlyModel}` : x.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium">{m.chat.imageShape}</legend>
            <div className="mt-1.5 flex gap-1.5">
              {shapes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={aspect === s.id}
                  onClick={() => setAspect(s.id)}
                  title={s.label}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs transition ${
                    aspect === s.id ? "border-pink bg-pink/12 text-accent-fg" : "border-line text-muted hover:border-line-strong"
                  }`}
                >
                  <span aria-hidden className={`rounded-sm border-2 border-current ${s.box}`} />
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="mt-3 flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={improve} onChange={(e) => setImprove(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--pink)]" />
          <span>
            {m.chat.improvePrompt}
            <span className="block text-xs text-subtle">{m.chat.improveHint}</span>
          </span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:border-line-strong hover:text-fg">
            {m.chat.imageCancel}
          </button>
          <button
            type="submit"
            disabled={!description.trim()}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
          >
            {m.chat.makeImage}
          </button>
        </div>
      </form>
    </div>
  );
}
