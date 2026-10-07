"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { useI18n } from "@/lib/i18n/client";
import { MAX_MESSAGE_CHARS } from "@/config/chat";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  note,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  /** Shown under the box instead of the keyboard hint (e.g. messages left today). */
  note?: string | null;
  /** Lets the page focus the box (e.g. after picking a suggestion). */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { m } = useI18n();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const canSend = value.trim().length > 0 && !streaming;

  // Grow with the text, up to a limit, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value, ref]);

  // Ready to type straight away, and again after each reply — but not on touch screens, where
  // focusing would pop the keyboard up over the reply.
  useLayoutEffect(() => {
    if (!streaming && !isTouch()) ref.current?.focus({ preventScroll: true });
  }, [streaming, ref]);

  return (
    <form
      className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface p-2 shadow-card transition focus-within:border-pink focus-within:ring-4 focus-within:ring-pink/15">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={m.chat.placeholder}
          aria-label={m.chat.placeholder}
          enterKeyHint="enter"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Phone keyboards have no Shift+Enter, so there Enter makes a new line and the button sends.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          className="max-h-60 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-base text-fg outline-none placeholder:text-subtle"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={m.chat.stop}
            title={m.chat.stop}
            className="grid h-10 w-10 flex-none place-items-center rounded-2xl border border-line bg-surface-2 text-fg transition hover:border-line-strong active:scale-95"
          >
            <span className="h-3.5 w-3.5 rounded-[4px] bg-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label={m.chat.send}
            title={m.chat.send}
            className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-brand text-white shadow-glow transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
      {note ? (
        <p className="mt-2 text-center text-xs font-medium text-accent-fg">{note}</p>
      ) : (
        <p className="mt-2 hidden text-center text-xs text-subtle sm:block">{m.chat.hint}</p>
      )}
    </form>
  );
}

/** A touch-first device (phone or tablet), where there's no physical keyboard to expect. */
function isTouch() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}
