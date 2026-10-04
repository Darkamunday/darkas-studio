"use client";

import { useState, useTransition } from "react";
import { setTrackPrivateAction } from "./actions";

/** Creator-only switch: hide this track from everyone else in the catalogue. */
export function PrivateToggle({ trackId, initial }: { trackId: number; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setOn(next); // optimistic
    startTransition(async () => {
      const res = await setTrackPrivateAction(trackId, next);
      if (!res.ok) {
        setOn(!next);
        setError(res.error ?? "Couldn't change that.");
      } else setError(null);
    });
  };

  return (
    <label className="flex w-full cursor-pointer select-none items-center gap-2.5 text-xs text-muted">
      <input type="checkbox" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} className="peer sr-only" />
      <span className="relative h-4 w-7 flex-none rounded-full bg-surface-3 transition after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:transition peer-checked:bg-violet peer-checked:after:translate-x-3 peer-focus-visible:ring-2 peer-focus-visible:ring-pink" />
      Private · only you can see it
      {error && <span className="text-danger">{error}</span>}
    </label>
  );
}
