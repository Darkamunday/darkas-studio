"use client";

import { useState, useTransition } from "react";
import { btnDanger, btnGhost } from "@/components/ui";
import { deleteTrackAction } from "./actions";

/** Two-step delete: first click asks, second click deletes. */
export function DeleteTrackButton({ trackId, title }: { trackId: number; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={btnDanger}>
        Delete
      </button>
    );
  }

  return (
    <div className="flex w-full animate-pop flex-wrap items-center gap-2 rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm">
      <span className="w-full">
        Delete <span className="font-semibold">“{title}”</span> for everyone? This can&apos;t be undone.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteTrackAction(trackId);
            if (!res.ok) setError(res.error ?? "Couldn't delete that.");
          })
        }
        className="rounded-xl bg-danger px-3 py-1.5 font-medium text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btnGhost}>
        Keep it
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}
