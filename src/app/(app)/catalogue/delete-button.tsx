"use client";

import { useState, useTransition } from "react";
import { btnDanger, btnGhost } from "@/components/ui";
import { rich } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import { deleteTrackAction } from "./actions";

/** Two-step delete: first click asks, second click moves it to the bin. */
export function DeleteTrackButton({
  trackId,
  title,
  ownerName,
  isOwner,
  binDays,
}: {
  trackId: number;
  title: string;
  ownerName: string;
  /** An admin removing someone else's song gets a different warning: it skips the owner's bin. */
  isOwner: boolean;
  binDays: number;
}) {
  const { m } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={btnDanger}>
        {m.catalogue.delete}
      </button>
    );
  }

  return (
    <div className="flex w-full animate-pop flex-wrap items-center gap-2 rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm">
      <span className="w-full">
        {rich(isOwner ? m.catalogue.deleteConfirm : m.catalogue.deleteConfirmAdmin, {
          title: <span className="font-semibold">“{title}”</span>,
          owner: <span className="font-semibold">{ownerName}</span>,
          days: binDays,
        })}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteTrackAction(trackId);
            if (!res.ok) setError(res.error ?? m.catalogue.deleteFailed);
          })
        }
        className="rounded-xl bg-danger px-3 py-1.5 font-medium text-white transition hover:brightness-110 disabled:opacity-60"
      >
        {pending ? m.catalogue.deleting : m.catalogue.yesDelete}
      </button>
      <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btnGhost}>
        {m.catalogue.keepIt}
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}
