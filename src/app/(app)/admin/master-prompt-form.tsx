"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { MAX_MASTER_PROMPT_CHARS } from "@/config/chat";
import { saveMasterPrompt } from "./actions";

/** Edit the chat master prompt. Remount with a new `key` after saving to pick up the stored text. */
export function MasterPromptForm({ initial, custom, status }: { initial: string; custom: boolean; status: string }) {
  const { m } = useI18n();
  const c = m.chatAdmin;
  const [text, setText] = useState(initial);
  const dirty = text.trim() !== initial.trim();

  return (
    <form action={saveMasterPrompt} className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{c.masterHeading}</h3>
        <span className={`text-xs ${custom ? "text-accent-fg" : "text-subtle"}`}>{status}</span>
      </div>
      <p className="mt-1 text-sm text-muted">{c.masterBlurb}</p>
      <textarea
        name="prompt"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_MASTER_PROMPT_CHARS}
        rows={7}
        aria-label={c.masterHeading}
        className="mt-3 w-full resize-y rounded-2xl border border-line bg-surface-2 px-4 py-3 font-mono text-sm leading-relaxed text-fg outline-none transition focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-subtle">{fmt(c.masterCount, { n: text.length, max: MAX_MASTER_PROMPT_CHARS })}</span>
        <div className="ml-auto flex gap-2">
          {custom && (
            <button
              name="reset"
              value="1"
              onClick={(e) => {
                if (!window.confirm(c.masterResetConfirm)) e.preventDefault();
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-danger hover:text-danger"
            >
              {c.masterReset}
            </button>
          )}
          <button
            disabled={!dirty}
            className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
          >
            {c.masterSave}
          </button>
        </div>
      </div>
    </form>
  );
}
