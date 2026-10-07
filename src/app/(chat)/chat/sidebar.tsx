"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { CHAT_TITLE_MAX } from "@/config/chat";
import { NavLinks } from "@/components/nav-links";

export type SidebarConversation = { id: number; title: string | null; updated_at: number };

type Group = "today" | "yesterday" | "week" | "older";

/** Which date heading a chat goes under, by the viewer's own calendar. */
function groupOf(updatedAt: number, now: Date): Group {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  if (updatedAt >= startOfToday) return "today";
  if (updatedAt >= startOfToday - 86400) return "yesterday";
  if (updatedAt >= startOfToday - 7 * 86400) return "week";
  return "older";
}

// Date headings depend on the viewer's time zone, which the server can't know: render them
// only in the browser (false during server render and hydration, so the HTML matches).
const noop = () => () => {};
const useInBrowser = () => useSyncExternalStore(noop, () => true, () => false);

export function Sidebar({
  conversations,
  activeId,
  onNew,
  onNavigate,
  onRename,
  onDelete,
  onClose,
  isAdmin,
}: {
  conversations: SidebarConversation[];
  activeId: number | null;
  onNew: () => void;
  onNavigate: () => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  /** Set when shown as the phone drawer: adds a close button and the site's nav links. */
  onClose?: () => void;
  isAdmin: boolean;
}) {
  const { m } = useI18n();
  const [editing, setEditing] = useState<number | null>(null);
  const inBrowser = useInBrowser();
  const now = new Date();
  const groupLabels: Record<Group, string> = {
    today: m.chat.groupToday,
    yesterday: m.chat.groupYesterday,
    week: m.chat.groupWeek,
    older: m.chat.groupOlder,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-glow transition hover:brightness-110 active:scale-[0.98]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {m.chat.newChat}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={m.chat.closeChats}
            className="grid h-10 w-10 flex-none place-items-center rounded-2xl border border-line text-muted transition hover:text-fg"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>

      {!inBrowser && <p className="px-5 pb-1 text-xs font-medium uppercase tracking-wide text-subtle">{m.chat.chats}</p>}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted">{m.chat.noChats}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((c, i) => {
              const title = c.title ?? m.chat.untitled;
              const active = c.id === activeId;
              const group = inBrowser ? groupOf(c.updated_at, now) : null;
              const heading = group && (i === 0 || groupOf(conversations[i - 1].updated_at, now) !== group);
              return (
                <li key={c.id} className="group relative">
                  {heading && (
                    <p className={`px-3 pb-1 text-xs font-medium uppercase tracking-wide text-subtle ${i === 0 ? "" : "pt-4"}`}>
                      {groupLabels[group]}
                    </p>
                  )}
                  {editing === c.id ? (
                    <RenameField
                      initial={c.title ?? ""}
                      onDone={(value) => {
                        setEditing(null);
                        if (value && value !== c.title) onRename(c.id, value);
                      }}
                    />
                  ) : (
                    <>
                      <Link
                        href={`/chat/${c.id}`}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={title}
                        className={`block truncate rounded-xl py-2 pl-3 pr-16 text-sm transition ${
                          active ? "bg-surface-3 font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
                        }`}
                      >
                        {title}
                      </Link>
                      <div
                        className={`absolute bottom-0 right-1 flex h-9 items-center gap-0.5 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 ${
                          active ? "md:opacity-100" : ""
                        }`}
                      >
                        <IconButton label={m.chat.rename} onClick={() => setEditing(c.id)}>
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </IconButton>
                        <IconButton
                          label={m.chat.delete}
                          danger
                          onClick={() => {
                            if (window.confirm(fmt(m.chat.deleteConfirm, { title }))) onDelete(c.id);
                          }}
                        >
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                        </IconButton>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      {onClose && (
        <div className="border-t border-line/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden">
          <p className="sr-only">{m.chat.menu}</p>
          <NavLinks isAdmin={isAdmin} showChat className="flex-wrap justify-center gap-y-1" />
        </div>
      )}
    </div>
  );
}

function RenameField({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const { m } = useI18n();
  const [value, setValue] = useState(initial);
  // Escape closes the field, which can also fire blur; only report once.
  const finished = useRef(false);
  const finish = (v: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      aria-label={m.chat.rename}
      value={value}
      maxLength={CHAT_TITLE_MAX}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") finish(null);
      }}
      className="w-full rounded-xl border border-pink bg-surface px-3 py-1.5 text-sm text-fg outline-none ring-4 ring-pink/15"
    />
  );
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-lg text-subtle transition hover:bg-surface ${
        danger ? "hover:text-danger" : "hover:text-fg"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
