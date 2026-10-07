"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { copyText } from "@/components/copy-button";

/** A small copy button that confirms with a tick. */
export function CopyAction({ getText, label, withText }: { getText: () => string; label: string; withText?: boolean }) {
  const { m } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const shown = state === "copied" ? m.common.copied : state === "failed" ? m.common.copyFailed : label;

  return (
    <button
      type="button"
      aria-label={shown}
      title={shown}
      onClick={async () => {
        try {
          await copyText(getText());
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1800);
      }}
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-xs transition hover:bg-surface-3 ${
        state === "copied" ? "text-success" : state === "failed" ? "text-danger" : "text-subtle hover:text-fg"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {state === "copied" ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2.5" />
            <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
          </>
        )}
      </svg>
      {withText && <span>{state === "idle" ? m.common.copy : shown}</span>}
    </button>
  );
}
