"use client";

import { useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { btnGhost, btnSecondary } from "@/components/ui";
import { shareTrackAction, unshareTrackAction } from "./actions";

const linkIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
);

/** Creator-only: make a public link for this song, copy it, or stop sharing. */
export function ShareButton({ trackId, initialUrl }: { trackId: number; initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const share = () =>
    startTransition(async () => {
      setError(null);
      const res = await shareTrackAction(trackId);
      if (res.ok) {
        setUrl(res.url);
        setOpen(true);
      } else setError(res.error);
    });

  const stop = () =>
    startTransition(async () => {
      setError(null);
      const res = await unshareTrackAction(trackId);
      if (res.ok) {
        setUrl(null);
        setOpen(false);
      } else setError(res.error ?? "Couldn't stop sharing.");
    });

  return (
    <>
      {url ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-xl border border-pink/50 bg-pink/10 px-3 py-1.5 text-sm font-medium text-accent-fg transition hover:bg-pink/15"
        >
          {linkIcon} Shared
        </button>
      ) : (
        <button type="button" onClick={share} disabled={pending} className={btnSecondary}>
          {linkIcon} {pending ? "Making link…" : "Share"}
        </button>
      )}

      {url && open && (
        <div className="flex w-full animate-pop flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-3 text-sm">
          <p className="text-muted">Anyone with this link can listen and download — no account needed.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg outline-none"
            />
            <CopyButton
              text={url}
              label="Copy"
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
            />
          </div>
          <div className="flex items-center gap-1">
            <a href={url} target="_blank" rel="noreferrer" className={btnGhost}>
              Open ↗
            </a>
            <button type="button" onClick={stop} disabled={pending} className={`${btnGhost} ml-auto hover:text-danger`}>
              {pending ? "Stopping…" : "Stop sharing"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </>
  );
}
