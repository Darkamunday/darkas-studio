"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fmt } from "@/lib/i18n/format";
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
  skills = [],
  onImage,
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
  /** Skills offered when the message starts with "/". */
  skills?: { slug: string; name: string; emoji: string; description: string }[];
  /** Open "Make an image" (shown when the person can make images). */
  onImage?: () => void;
}) {
  const { m } = useI18n();
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const canSend = value.trim().length > 0 && !streaming;

  // ---- "/" skill picker: open while the message is just "/" plus part of a command ----
  const [picked, setPicked] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const query = /^\/([a-z0-9-]*)$/i.exec(value)?.[1]?.toLowerCase() ?? null;
  const matches =
    query === null
      ? []
      : skills.filter((s) => s.slug.includes(query) || s.name.toLowerCase().includes(query)).slice(0, 8);
  const pickerOpen = query !== null && dismissed !== value && skills.length > 0;
  const choose = (slug: string) => {
    onChange(`/${slug} `);
    setPicked(0);
    ref.current?.focus();
  };

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
      {pickerOpen && (
        <div className="relative">
          <div
            role="listbox"
            aria-label={m.chat.skills}
            className="absolute inset-x-0 bottom-2 z-20 max-h-72 overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-card"
          >
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-subtle">{fmt(m.chat.noSkillsMatch, { q: query ?? "" })}</p>
            ) : (
              matches.map((s, i) => (
                <button
                  key={s.slug}
                  type="button"
                  role="option"
                  aria-selected={i === picked}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(s.slug)}
                  onMouseEnter={() => setPicked(i)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition ${i === picked ? "bg-surface-3" : ""}`}
                >
                  <span aria-hidden className="text-base leading-6">{s.emoji}</span>
                  <span className="min-w-0">
                    <span className="text-sm font-medium">{s.name}</span> <code className="text-xs text-accent-fg">/{s.slug}</code>
                    {s.description && <span className="block truncate text-xs text-subtle">{s.description}</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface p-2 shadow-card transition focus-within:border-pink focus-within:ring-4 focus-within:ring-pink/15">
        {onImage && (
          <button
            type="button"
            onClick={onImage}
            disabled={streaming}
            aria-label={m.chat.imageTitle}
            title={m.chat.imageTitle}
            className="grid h-10 w-10 flex-none place-items-center rounded-2xl text-lg transition hover:bg-surface-2 disabled:opacity-50"
          >
            <span aria-hidden>🎨</span>
          </button>
        )}
        <textarea
          ref={ref}
          value={value}
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={m.chat.placeholder}
          aria-label={m.chat.placeholder}
          enterKeyHint="enter"
          onChange={(e) => {
            onChange(e.target.value);
            setPicked(0);
          }}
          onKeyDown={(e) => {
            if (pickerOpen && matches.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPicked((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault();
                choose(matches[Math.min(picked, matches.length - 1)].slug);
                return;
              }
            }
            if (pickerOpen && e.key === "Escape") {
              e.preventDefault();
              setDismissed(value);
              return;
            }
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
