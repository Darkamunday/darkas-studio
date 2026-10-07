"use client";

// Phase 1: a bare-bones box to prove the streaming route end to end. Replaced by the full UI next.

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { btnPrimary, btnSecondary, card, input } from "@/components/ui";
import type { ChatEvent } from "@/lib/chat/events";

type Line = { role: "user" | "assistant"; content: string };

export function ChatBox() {
  const { m } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const conversationId = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const errorText = (reason: string, cap?: number) =>
    fmt((m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic, { cap: cap ?? "" });

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
    setDraft("");
    setError(null);
    setBusy(true);
    setLines((l) => [...l, { role: "user", content }, { role: "assistant", content: "" }]);
    const appendReply = (text: string) =>
      setLines((l) => [...l.slice(0, -1), { role: "assistant", content: l[l.length - 1].content + text }]);

    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId.current ?? undefined, content }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; cap?: number };
        setError(errorText(body.error ?? "generic", body.cap));
        setLines((l) => l.slice(0, -1));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, nl)) as ChatEvent;
          buffer = buffer.slice(nl + 1);
          if (event.type === "meta") conversationId.current = event.conversationId;
          else if (event.type === "delta") appendReply(event.text);
          else if (event.type === "title") setTitle(event.title);
          else if (event.type === "error") setError(errorText(event.reason));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(errorText("generic"));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  return (
    <div className={`${card} flex flex-col gap-4 p-6`}>
      {title && <p className="text-sm font-medium text-subtle">{title}</p>}
      <div className="flex flex-col gap-3">
        {lines.map((l, i) => (
          <div key={i} className={l.role === "user" ? "self-end rounded-2xl bg-pink/12 px-4 py-2" : "whitespace-pre-wrap"}>
            <span className="mb-1 block text-xs text-subtle">{l.role === "user" ? m.chat.you : m.chat.assistant}</span>
            {l.content || (busy && i === lines.length - 1 ? "…" : "")}
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={m.chat.placeholder}
          className={`${input} resize-none`}
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} className={btnSecondary}>
            {m.chat.stop}
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()} className={btnPrimary}>
            {m.chat.send}
          </button>
        )}
      </form>
    </div>
  );
}
