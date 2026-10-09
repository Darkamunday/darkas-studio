"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { CHAT_TITLE_MAX } from "@/config/chat";
import { NavLinks } from "@/components/nav-links";
import { PaperclipIcon } from "./files-dialog";
import { SparkIcon } from "./skills-dialog";
import type { ClientProject } from "@/lib/chat/projects";

export type SidebarConversation = { id: number; title: string | null; updated_at: number; project_id: number | null };

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
  hasInstructions,
  onOpenInstructions,
  fileCount,
  onOpenFiles,
  skillCount,
  onOpenSkills,
  projects,
  project,
  onNewProject,
  onEditProject,
  onMoveChat,
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
  hasInstructions: boolean;
  onOpenInstructions: () => void;
  fileCount: number;
  onOpenFiles: () => void;
  skillCount: number;
  onOpenSkills: () => void;
  projects: (ClientProject & { count: number })[];
  /** The project being looked at (its chats are the ones listed), or null for the main list. */
  project: ClientProject | null;
  onNewProject: () => void;
  onEditProject: () => void;
  onMoveChat: (id: number) => void;
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

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {project ? (
          <div className="mb-3">
            <Link
              href="/chat"
              onClick={onNavigate}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-subtle transition hover:text-fg"
            >
              <span aria-hidden>←</span> {m.chat.allChats}
            </Link>
            <div className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5">
              <span aria-hidden className="text-lg">{project.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{project.name}</span>
                {!project.mine && (
                  <span className="block truncate text-xs text-subtle">{fmt(m.chat.sharedBy, { name: project.owner ?? "" })}</span>
                )}
              </span>
              <button
                type="button"
                onClick={onEditProject}
                aria-label={project.mine ? m.chat.projectSettings : m.chat.aboutProject}
                title={project.mine ? m.chat.projectSettings : m.chat.aboutProject}
                className="grid h-8 w-8 place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
                </svg>
              </button>
            </div>
            {(!project.mine || project.everyone || project.members.length > 0) && (
              <Link
                href={`/chat/projects/${project.id}`}
                onClick={onNavigate}
                className="mt-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" />
                </svg>
                {m.chat.openShared}
              </Link>
            )}
          </div>
        ) : (
          <div className="mb-3">
            <div className="flex items-center justify-between px-3 pb-1">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">{m.chat.projects}</p>
              <button
                type="button"
                onClick={onNewProject}
                aria-label={m.chat.newProject}
                title={m.chat.newProject}
                className="grid h-6 w-6 place-items-center rounded-md text-subtle transition hover:bg-surface-2 hover:text-fg"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </div>
            {projects.length === 0 ? (
              <button
                type="button"
                onClick={onNewProject}
                className="w-full rounded-xl border border-dashed border-line px-3 py-2 text-left text-sm text-subtle transition hover:border-line-strong hover:text-fg"
              >
                + {m.chat.newProject}
              </button>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/chat?project=${p.id}`}
                      onClick={onNavigate}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
                    >
                      <span aria-hidden className="text-base leading-none">{p.emoji}</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {(!p.mine || p.everyone || p.members.length > 0) && (
                        <span title={p.mine ? m.chat.youShared : fmt(m.chat.sharedBy, { name: p.owner ?? "" })} className="flex-none text-subtle">
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          <span className="sr-only">{p.mine ? m.chat.youShared : fmt(m.chat.sharedBy, { name: p.owner ?? "" })}</span>
                        </span>
                      )}
                      {p.count > 0 && <span className="text-xs tabular-nums text-subtle">{p.count}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!inBrowser && !project && <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-subtle">{m.chat.chats}</p>}
        {conversations.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted">{project ? m.chat.noProjectChats : m.chat.noChats}</p>
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
                        className={`block truncate rounded-xl py-2 pl-3 pr-24 text-sm transition ${
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
                        <IconButton label={m.chat.moveChat} onClick={() => onMoveChat(c.id)}>
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                        </IconButton>
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
      <div className="border-t border-line/70 p-2">
        <button
          type="button"
          onClick={onOpenSkills}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <SparkIcon className="h-4 w-4 flex-none" />
          <span className="flex-1 truncate text-left">{m.chat.skills}</span>
          {skillCount > 0 && <span className="rounded-full bg-pink/12 px-2 py-0.5 text-xs tabular-nums text-accent-fg">{skillCount}</span>}
        </button>
        <button
          type="button"
          onClick={onOpenFiles}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <PaperclipIcon className="h-4 w-4 flex-none" />
          <span className="flex-1 truncate text-left">{m.chat.files}</span>
          {fileCount > 0 && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs tabular-nums text-muted">{fileCount}</span>}
        </button>
        <button
          type="button"
          onClick={onOpenInstructions}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
          </svg>
          <span className="flex-1 truncate text-left">{m.chat.instructions}</span>
          {hasInstructions && (
            <span className="rounded-full bg-pink/12 px-2 py-0.5 text-xs font-medium text-accent-fg">{m.chat.instructionsOn}</span>
          )}
        </button>
      </div>
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
