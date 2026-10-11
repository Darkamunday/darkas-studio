"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { MAX_MEMORIES, MAX_MEMORY_CHARS } from "@/config/chat";
import type { ClientMemory } from "@/lib/chat/memory";

type State = { memories: ClientMemory[]; enabled: boolean; available: boolean };

/** What the assistant remembers about you: see, add, edit and delete memories, or switch memory off. */
export function MemoryDialog({ onClose }: { onClose: () => void }) {
  const { m } = useI18n();
  const [state, setState] = useState<State | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (editing ? setEditing(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  useEffect(() => {
    let live = true;
    fetch("/api/chat/memories")
      .then((res) => (res.ok ? (res.json() as Promise<State>) : null))
      .catch(() => null)
      .then((body) => {
        if (!live) return;
        if (body) setState(body);
        else setError(m.chat.errors.generic);
      });
    return () => {
      live = false;
    };
  }, [m]);

  const errorText = (reason: string) => (m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic;

  async function call(url: string, method: string, body?: object) {
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as (Partial<State> & { memory?: ClientMemory; error?: string }) | null;
    if (!res?.ok) {
      setError(errorText(json?.error ?? "generic"));
      return null;
    }
    return json;
  }

  async function add() {
    const content = draft.trim();
    if (!content || !state) return;
    const body = await call("/api/chat/memories", "POST", { content });
    if (body?.memory) {
      setState({ ...state, memories: [...state.memories, body.memory] });
      setDraft("");
    }
  }

  async function save() {
    if (!editing || !state) return;
    const body = await call(`/api/chat/memories/${editing.id}`, "PATCH", { content: editing.text });
    if (body?.memory) {
      const updated = body.memory;
      setState({ ...state, memories: state.memories.map((x) => (x.id === updated.id ? updated : x)) });
      setEditing(null);
    }
  }

  async function remove(id: number) {
    if (!state) return;
    if (await call(`/api/chat/memories/${id}`, "DELETE")) setState({ ...state, memories: state.memories.filter((x) => x.id !== id) });
  }

  async function forgetAll() {
    if (!window.confirm(m.chat.memoryForgetAllConfirm)) return;
    const body = await call("/api/chat/memories", "DELETE");
    if (body && state) setState({ ...state, memories: [] });
  }

  async function toggle(enabled: boolean) {
    const body = await call("/api/chat/memories", "PUT", { enabled });
    if (body && state) setState({ ...state, enabled });
  }

  const field =
    "w-full rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-sm text-fg outline-none transition placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15";
  const full = !!state && state.memories.length >= MAX_MEMORIES;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="memory-title">
      <button type="button" aria-label={m.chat.memoryDone} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[90dvh] w-full max-w-xl animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl">
        <div className="p-5 pb-3 sm:p-6 sm:pb-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25">
              🧠
            </span>
            <h2 id="memory-title" className="flex-1 text-lg font-semibold">{m.chat.memory}</h2>
            {state?.available && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  role="switch"
                  checked={state.enabled}
                  onChange={(e) => void toggle(e.target.checked)}
                  className="h-4 w-4 accent-[var(--pink)]"
                />
                {m.chat.memoryUse}
              </label>
            )}
          </div>
          <p className="mt-3 text-sm text-muted">{m.chat.memoryBlurb}</p>
          {state && !state.available && <p className="mt-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">{m.chat.memoryOffForApp}</p>}
          {state?.available && !state.enabled && <p className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{m.chat.memoryOffForYou}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="mt-4 flex gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_MEMORY_CHARS}
              placeholder={m.chat.memoryAddPlaceholder}
              aria-label={m.chat.memoryAdd}
              disabled={!state || full}
              className={field}
            />
            <button
              type="submit"
              disabled={!draft.trim() || !state || full}
              className="flex-none rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              {m.chat.memoryAdd}
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-4">
          {state === null ? (
            <p className="px-2 py-6 text-center text-sm text-subtle">{m.chat.loadingMemory}</p>
          ) : state.memories.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">{m.chat.noMemories}</p>
          ) : (
            <ul className="divide-y divide-line">
              {state.memories.map((x) => (
                <li key={x.id} className="flex items-start gap-2 px-2 py-2.5">
                  {editing?.id === x.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save();
                      }}
                      className="flex flex-1 gap-2"
                    >
                      <input
                        autoFocus
                        value={editing.text}
                        onChange={(e) => setEditing({ id: x.id, text: e.target.value })}
                        maxLength={MAX_MEMORY_CHARS}
                        aria-label={m.chat.editMemory}
                        className={field}
                      />
                      <button type="submit" disabled={!editing.text.trim()} className="flex-none rounded-lg px-2 text-sm text-accent-fg disabled:opacity-50">
                        {m.chat.saveProject}
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-sm">
                        {x.content}
                        {x.source === "model" && <span className="ml-1.5 text-xs text-subtle">· {m.chat.memoryByAssistant}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditing({ id: x.id, text: x.content })}
                        className="flex-none rounded-lg px-1.5 py-0.5 text-xs text-subtle transition hover:text-fg"
                      >
                        {m.chat.editMemory}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(x.id)}
                        className="flex-none rounded-lg px-1.5 py-0.5 text-xs text-subtle transition hover:text-danger"
                      >
                        {m.chat.deleteMemory}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {!!state?.memories.length && (
            <button type="button" onClick={() => void forgetAll()} className="rounded-xl px-3 py-2 text-sm text-muted transition hover:text-danger">
              {m.chat.memoryForgetAll}
            </button>
          )}
          <span className="ml-auto text-xs text-subtle">{state && fmt(m.chat.memoryCount, { n: String(state.memories.length), max: String(MAX_MEMORIES) })}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110"
          >
            {m.chat.memoryDone}
          </button>
        </div>
      </div>
    </div>
  );
}
