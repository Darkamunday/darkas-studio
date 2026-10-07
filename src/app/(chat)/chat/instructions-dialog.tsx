"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { MAX_INSTRUCTIONS_CHARS } from "@/config/chat";

/** Edit the person's custom instructions (applied to all their chats). */
export function InstructionsDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { m } = useI18n();
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setState("saving");
    const res = await fetch("/api/chat/instructions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: text }),
    }).catch(() => null);
    if (!res?.ok) return setState("failed");
    const body = (await res.json()) as { instructions: string };
    onSaved(body.instructions);
    setState("saved");
    setTimeout(onClose, 900);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="instructions-title">
      <button type="button" aria-label={m.chat.instructionsCancel} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="relative w-full max-w-lg animate-pop rounded-t-3xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card sm:rounded-3xl sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25">
            ✦
          </span>
          <h2 id="instructions-title" className="text-lg font-semibold">
            {m.chat.instructions}
          </h2>
        </div>
        <p className="mt-3 text-sm text-muted">{m.chat.instructionsBlurb}</p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (state !== "saving") setState("idle");
          }}
          maxLength={MAX_INSTRUCTIONS_CHARS}
          rows={7}
          placeholder={m.chat.instructionsPlaceholder}
          aria-label={m.chat.instructions}
          className="mt-4 w-full resize-y rounded-2xl border border-line bg-surface-2 px-4 py-3 text-base text-fg outline-none transition placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15"
        />
        <div className="mt-1 flex justify-between gap-3 text-xs">
          <span className={state === "failed" ? "text-danger" : "text-success"} role="status">
            {state === "saved" ? m.chat.instructionsSaved : state === "failed" ? m.chat.instructionsFailed : ""}
          </span>
          <span className="tabular-nums text-subtle">{fmt(m.chat.instructionsCount, { n: text.length, max: MAX_INSTRUCTIONS_CHARS })}</span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setText("")}
            disabled={!text}
            className="rounded-xl px-3 py-2 text-sm text-muted transition hover:text-danger disabled:opacity-40 disabled:hover:text-muted"
          >
            {m.chat.instructionsClear}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:border-line-strong hover:text-fg">
              {m.chat.instructionsCancel}
            </button>
            <button
              type="submit"
              disabled={state === "saving" || state === "saved" || text.trim() === initial.trim()}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              {m.chat.instructionsSave}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
