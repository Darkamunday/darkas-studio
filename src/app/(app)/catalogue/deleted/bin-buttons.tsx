"use client";

import { useState, useTransition } from "react";
import { btnSecondary } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { recoverLostAction, restoreTrackAction } from "../actions";

/** Restore a binned track, or (kind="lost") try to fetch a pre-bin deletion back from the provider. */
export function BinButton({ id, kind }: { id: number; kind: "restore" | "lost" }) {
  const { m } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      setError(null);
      const res = kind === "restore" ? await restoreTrackAction(id) : await recoverLostAction(id);
      // On success the page re-renders without this row.
      if (!res.ok) setError(res.error ?? m.bin.errors.notFound);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={run} disabled={pending} className={`${btnSecondary} whitespace-nowrap`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
        </svg>
        {pending ? (kind === "restore" ? m.bin.restoring : m.bin.recovering) : kind === "restore" ? m.bin.restore : m.bin.recover}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-danger">{error}</p>}
    </div>
  );
}
