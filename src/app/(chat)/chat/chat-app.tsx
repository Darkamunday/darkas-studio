"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { fmt, plural } from "@/lib/i18n/format";
import { Sidebar, type SidebarConversation } from "./sidebar";
import { MessageList } from "./messages";
import { Composer } from "./composer";
import { ModelPicker } from "./model-picker";
import { InstructionsDialog } from "./instructions-dialog";
import { CHAT_MODEL_COOKIE, CHAT_THINK_COOKIE, findChatModel } from "@/config/chat";
import { useChatStream, type UiMessage } from "./use-chat-stream";

export function ChatApp({
  initialConversations,
  initialId,
  initialMessages,
  initialModel,
  initialUsage,
  initialInstructions,
  initialThink,
  isAdmin,
}: {
  initialConversations: SidebarConversation[];
  initialId: number | null;
  initialMessages: UiMessage[];
  initialModel: string;
  /** Sends today and the daily cap (null = no cap). */
  initialUsage: { sent: number; cap: number | null };
  initialInstructions: string;
  /** The Think toggle, as this browser last left it. */
  initialThink: boolean;
  isAdmin: boolean;
}) {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [model, setModel] = useState(initialModel);
  const [think, setThink] = useState(initialThink);
  const canThink = !!findChatModel(model)?.thinking;
  const [usage, setUsage] = useState(initialUsage);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  // Escape closes the phone drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function toggleThink() {
    const next = !think;
    setThink(next);
    document.cookie = `${CHAT_THINK_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  function pickModel(id: string) {
    setModel(id);
    // New chats start on the model this browser picked last (read by the page on the server).
    document.cookie = `${CHAT_MODEL_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
  }

  const touch = (id: number, patch: Partial<SidebarConversation> = {}) =>
    setConversations((list) => {
      const found = list.find((c) => c.id === id) ?? { id, title: null, updated_at: 0 };
      const updated = { ...found, updated_at: Math.floor(Date.now() / 1000), ...patch };
      return [updated, ...list.filter((c) => c.id !== id)];
    });

  const chat = useChatStream(initialMessages, activeId, {
    onConversation: (id, isNew) => {
      if (isNew) {
        setActiveId(id);
        // Give the new chat its own address without reloading the page mid-reply.
        window.history.replaceState(null, "", `/chat/${id}`);
      }
      touch(id);
    },
    onUsage: setUsage,
    onTitle: (title) => {
      if (activeIdRef.current !== null) touch(activeIdRef.current, { title });
    },
    onError: (reason, cap) => {
      // The note under the box already says the limit's been reached.
      if (reason === "daily_cap" && cap !== undefined) return setUsage({ sent: cap, cap });
      const text = (m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic;
      setError(fmt(text, { cap: cap ?? "" }));
    },
  });

  const activeIdRef = useRef(activeId);
  useLayoutEffect(() => {
    activeIdRef.current = activeId;
  });

  // ---- auto-scroll: follow the reply only while the reader is at the bottom ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Mirrors `stick` for rendering the "jump to latest" button; only set from event handlers.
  const [pinned, setPinned] = useState(true);
  const setStick = (value: boolean) => {
    stick.current = value;
    setPinned(value);
  };
  const lastTop = useRef(0);
  // Scrolling up lets go straight away (our own auto-scroll only ever moves down, so a move up
  // is the reader); getting back near the bottom picks the reply up again.
  const onScroll = () => {
    const el = scrollRef.current!;
    if (el.scrollTop < lastTop.current - 2) setStick(false);
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) setStick(true);
    lastTop.current = el.scrollTop;
  };
  // A wheel or swipe up shows intent before the scroll event lands, so a reply chunk arriving in
  // between can't yank the reader back down.
  const touchY = useRef(0);
  const letGo = {
    onWheel: (e: React.WheelEvent) => {
      if (e.deltaY < 0) setStick(false);
    },
    onTouchStart: (e: React.TouchEvent) => {
      touchY.current = e.touches[0].clientY;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (e.touches[0].clientY > touchY.current + 4) setStick(false); // finger down = content up
    },
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (stick.current && el) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }, [chat.messages]);

  async function send() {
    const content = draft.trim();
    if (!content) return;
    setError(null);
    setDraft("");
    setStick(true);
    const accepted = await chat.send(content, model, think);
    if (!accepted) setDraft((d) => d || content); // refused (e.g. daily limit): give their text back
  }

  function regenerate() {
    setError(null);
    setStick(true);
    void chat.regenerate(model, think);
  }

  // Stable, so the dialog's Escape listener isn't re-attached on every render.
  const closeInstructions = useCallback(() => setInstructionsOpen(false), []);

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    setStick(true);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function pickSuggestion(text: string) {
    setDraft(text);
    inputRef.current?.focus();
  }

  function startNew() {
    chat.stop();
    setDrawerOpen(false);
    setError(null);
    setDraft("");
    setStick(true);
    chat.setMessages([]);
    setActiveId(null);
    router.push("/chat");
  }

  async function rename(id: number, title: string) {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) setConversations((list) => list.map((c) => (c.id === id ? { ...c, title } : c)));
    else setError(m.chat.errors.generic);
  }

  async function remove(id: number) {
    const res = await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) return setError(m.chat.errors.generic);
    setConversations((list) => list.filter((c) => c.id !== id));
    if (id === activeId) startNew();
  }

  const left = usage.cap === null ? null : Math.max(0, usage.cap - usage.sent);
  const usageNote =
    left === null || left > 10
      ? null
      : left === 0
        ? fmt(m.chat.capReached, { cap: usage.cap ?? 0 })
        : plural(locale, m.chat.left, left);

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? m.chat.untitled;
  const sidebarProps = {
    conversations,
    activeId,
    onNew: startNew,
    onNavigate: () => setDrawerOpen(false),
    onRename: rename,
    onDelete: remove,
    isAdmin,
    hasInstructions: instructions.trim() !== "",
    onOpenInstructions: () => {
      setDrawerOpen(false);
      setInstructionsOpen(true);
    },
  };

  return (
    <div className="flex min-h-0 w-full flex-1">
      {/* Sidebar: fixed column on wider screens, a drawer on phones. */}
      <aside className="hidden w-72 flex-none border-r border-line/70 bg-surface/40 md:block">
        <Sidebar {...sidebarProps} />
      </aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={m.chat.chats}>
          <button
            type="button"
            aria-label={m.chat.closeChats}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-80 animate-drawer-in border-r border-line bg-bg shadow-card">
            <Sidebar {...sidebarProps} onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {instructionsOpen && (
        <InstructionsDialog initial={instructions} onClose={closeInstructions} onSaved={setInstructions} />
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line/70 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={m.chat.openChats}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg md:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-muted">{activeTitle}</h1>
          {canThink && (
            <button
              type="button"
              onClick={toggleThink}
              disabled={chat.streaming}
              role="switch"
              aria-checked={think}
              title={think ? m.chat.thinkOn : m.chat.thinkOff}
              className={`inline-flex h-[34px] items-center gap-1.5 rounded-xl border px-2.5 text-sm transition disabled:opacity-60 ${
                think
                  ? "border-pink/50 bg-pink/12 text-accent-fg"
                  : "border-line bg-surface text-subtle hover:border-line-strong hover:text-fg"
              }`}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
              </svg>
              <span className="max-sm:sr-only">{m.chat.think}</span>
            </button>
          )}
          <ModelPicker value={model} onChange={pickModel} disabled={chat.streaming} isAdmin={isAdmin} />
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} {...letGo} className="min-h-0 flex-1 overflow-y-auto">
            {chat.messages.length === 0 ? (
              <EmptyState onPick={pickSuggestion} />
            ) : (
              <MessageList
                messages={chat.messages}
                streaming={chat.streaming}
                onRegenerate={activeId !== null ? regenerate : undefined}
              />
            )}
          </div>
          {/* Soft edge where the conversation meets the input box. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-bg to-transparent" />
          {!pinned && chat.messages.length > 0 && (
            <button
              type="button"
              onClick={jumpToLatest}
              aria-label={m.chat.jumpToLatest}
              title={m.chat.jumpToLatest}
              className="absolute bottom-3 left-1/2 grid h-9 w-9 -translate-x-1/2 animate-pop place-items-center rounded-full border border-line bg-surface text-muted shadow-card transition hover:border-line-strong hover:text-fg"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mx-auto mb-2 w-full max-w-3xl px-4 text-sm text-danger">
            {error}
          </p>
        )}
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={send}
          onStop={chat.stop}
          streaming={chat.streaming}
          note={usageNote}
          inputRef={inputRef}
        />
      </section>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const { m } = useI18n();
  return (
    <div className="grid min-h-full place-items-center px-4 py-10 text-center">
      <div className="w-full max-w-xl">
        <div
          aria-hidden
          className="mx-auto mb-5 grid h-16 w-16 animate-pop place-items-center rounded-3xl bg-gradient-to-br from-peach/30 via-pink/25 to-violet/30 text-3xl shadow-glow"
        >
          ✦
        </div>
        <h2 className="font-display text-3xl font-semibold">{m.chat.emptyTitle}</h2>
        <p className="mx-auto mt-2 max-w-md text-muted">{m.chat.emptyText}</p>
        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          {m.chat.suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => onPick(text)}
              className="rounded-2xl border border-line bg-surface/70 px-4 py-3 text-left text-sm text-muted shadow-card transition hover:-translate-y-0.5 hover:border-pink/50 hover:text-fg active:translate-y-0"
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
