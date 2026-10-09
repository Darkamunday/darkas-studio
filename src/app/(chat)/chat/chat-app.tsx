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
import { FilesDialog, PaperclipIcon } from "./files-dialog";
import { MoveDialog, ProjectDialog } from "./project-dialog";
import { SkillsDialog, SparkIcon } from "./skills-dialog";
import { ImagePanel } from "./image-panel";
import type { ImagePrefs } from "./use-chat-stream";
import type { ClientImage } from "@/lib/chat/images";
import type { ClientSkill } from "@/lib/chat/skills";
import type { ClientProject } from "@/lib/chat/projects";
import type { ClientFile } from "@/lib/chat/files";
import { CHAT_MODEL_COOKIE, CHAT_THINK_COOKIE, MAX_REPLY_TOKENS, findChatModel } from "@/config/chat";
import { useChatStream, type UiMessage } from "./use-chat-stream";

export function ChatApp({
  initialConversations,
  initialId,
  initialMessages,
  initialModel,
  initialUsage,
  initialInstructions,
  initialThink,
  initialFiles,
  initialAttached,
  initialProjects,
  projectId,
  initialSkills,
  initialPinnedSkills,
  imageAccess,
  initialImagePrefs,
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
  /** The person's reference files, and which ones this chat has attached. */
  initialFiles: ClientFile[];
  initialAttached: number[];
  initialProjects: ClientProject[];
  /** The project this chat is in (or a new chat is being started in); null for the main list. */
  projectId: number | null;
  /** Skills this person can use, and the ones pinned to this chat. */
  initialSkills: ClientSkill[];
  initialPinnedSkills: number[];
  /** Can make images (admins, or switched on for them). */
  imageAccess: boolean;
  initialImagePrefs: ImagePrefs;
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
  const [makingSong, setMakingSong] = useState<number | null>(null);
  const [files, setFiles] = useState(initialFiles);
  const [attached, setAttached] = useState(() => new Set(initialAttached));
  const [filesOpen, setFilesOpen] = useState(false);
  const [projects, setProjects] = useState(initialProjects);
  // null: closed; "new": creating one; a number: editing that project.
  const [projectDialog, setProjectDialog] = useState<"new" | number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const project = projects.find((p) => p.id === projectId) ?? null;
  const [skills, setSkills] = useState(initialSkills);
  const [pinnedSkills, setPinnedSkills] = useState(() => new Set(initialPinnedSkills));
  const [skillsOpen, setSkillsOpen] = useState(false);
  const pinnedRef = useRef(pinnedSkills);
  const [imagePrefs, setImagePrefs] = useState(initialImagePrefs);
  const [imageOpen, setImageOpen] = useState(false);
  const attachedRef = useRef(attached);

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
      const found = list.find((c) => c.id === id) ?? { id, title: null, updated_at: 0, project_id: projectId };
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
    onError: (reason, info) => {
      // The note under the box already says the limit's been reached.
      if (reason === "daily_cap" && info?.cap !== undefined) return setUsage({ sent: info.cap, cap: info.cap });
      const text = (m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic;
      setError(fmt(text, { cap: info?.cap ?? "", model: info?.model ?? "" }));
    },
  });

  const activeIdRef = useRef(activeId);
  useLayoutEffect(() => {
    activeIdRef.current = activeId;
    attachedRef.current = attached;
    pinnedRef.current = pinnedSkills;
  });

  /** Pin or unpin a skill for this chat (saved straight away once the chat exists). */
  function togglePin(id: number) {
    const next = new Set(pinnedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    pinnedRef.current = next;
    setPinnedSkills(next);
    const chatId = activeIdRef.current;
    if (chatId !== null) queueSave(`/api/chat/conversations/${chatId}/skills`, { skillIds: [...next] });
  }

  // Saves for attachments and pins run one after another; sending waits for them, so a message sent
  // right after ticking a file or skill always goes with it.
  const pendingSaves = useRef<Promise<unknown>>(Promise.resolve());
  const queueSave = (url: string, body: object) => {
    pendingSaves.current = pendingSaves.current.then(() =>
      fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then((res) => !res.ok && setError(m.chat.errors.generic))
        .catch(() => setError(m.chat.errors.generic)),
    );
  };

  /** Attach or detach a file for this chat (saved straight away once the chat exists). */
  function toggleAttach(id: number) {
    const next = new Set(attachedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    attachedRef.current = next;
    setAttached(next);
    const chatId = activeIdRef.current;
    if (chatId !== null) queueSave(`/api/chat/conversations/${chatId}/files`, { fileIds: [...next] });
  }
  // Stable, so the dialogs' Escape listeners aren't re-attached on every render.
  const closeFiles = useCallback(() => setFilesOpen(false), []);
  const closeProjectDialog = useCallback(() => setProjectDialog(null), []);
  const closeMove = useCallback(() => setMoving(null), []);
  // The setter is listed only because the React Compiler lint loses track of it in this component.
  const closeSkills = useCallback(() => setSkillsOpen(false), [setSkillsOpen]);

  /** A project you deleted or left: its chats move back to the main list. */
  const dropProject = (id: number) => {
    setProjectDialog(null);
    setProjects((list) => list.filter((p) => p.id !== id));
    setConversations((list) => list.map((c) => (c.project_id === id ? { ...c, project_id: null } : c)));
    if (id === projectId) router.push(activeId ? `/chat/${activeId}` : "/chat");
  };

  /** Move a chat into a project (or out). If it's the open chat, follow it to its new place. */
  async function move(id: number, target: number | null) {
    setMoving(null);
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: target }),
    }).catch(() => null);
    if (!res?.ok) return setError(m.chat.errors.generic);
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, project_id: target } : c)));
    if (id === activeId) router.push(`/chat/${id}`);
  }

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
    await pendingSaves.current;
    const accepted = await chat.send(content, {
      model,
      think,
      fileIds: [...attachedRef.current],
      projectId,
      skillIds: [...pinnedRef.current],
      image: imagePrefs,
    });
    if (!accepted) setDraft((d) => d || content); // refused (e.g. daily limit): give their text back
  }

  /** "Make an image" (and "Again" on an image): sent as "/image <description>" with its settings. */
  async function sendImage(description: string, prefs: ImagePrefs) {
    setImageOpen(false);
    setImagePrefs(prefs);
    setError(null);
    setStick(true);
    await pendingSaves.current;
    await chat.send(`/image ${description}`, {
      model,
      think,
      fileIds: [...attachedRef.current],
      projectId,
      skillIds: [...pinnedRef.current],
      image: prefs,
    });
  }
  /** Approve or skip a tool waiting in the chat; the assistant carries on in a new reply. */
  async function decide(toolCallId: number, decision: "approve" | "decline") {
    setError(null);
    setStick(true);
    await chat.resume(toolCallId, decision, model, think, imagePrefs);
  }

  const imageAgain = (img: ClientImage) =>
    void sendImage(img.prompt, { model: img.model, aspect: img.aspect as ImagePrefs["aspect"], improve: false });

  async function makeSong(messageId: number) {
    setError(null);
    setMakingSong(messageId);
    const res = await fetch("/api/chat/song-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId }),
    }).catch(() => null);
    if (res?.ok) return router.push(`/generate?fromChat=${messageId}`);
    setMakingSong(null);
    const reason = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "song_failed";
    setError((m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.song_failed);
  }

  async function regenerate() {
    setError(null);
    setStick(true);
    await pendingSaves.current;
    void chat.regenerate(model, think, imagePrefs);
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
    attachedRef.current = new Set();
    setAttached(attachedRef.current);
    pinnedRef.current = new Set();
    setPinnedSkills(pinnedRef.current);
    chat.setMessages([]);
    setActiveId(null);
    router.push(projectId ? `/chat?project=${projectId}` : "/chat");
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

  const activeModel = findChatModel(model);
  // File tokens that fit alongside a short conversation (matches the server's check).
  const fileWindow = (activeModel?.contextTokens ?? 32_000) - MAX_REPLY_TOKENS - 2_500;
  const projectFiles = new Set(project?.fileIds ?? []);
  const projectSkills = new Set(project?.skillIds ?? []);
  // A project shared with you brings files and skills of its owner's that aren't in your own lists.
  const projectOnlyFiles: ClientFile[] = notIn(project?.files ?? [], files).map((f) => ({ ...f, always: false }));
  const projectOnlySkills = notIn(project?.skills ?? [], skills);
  const activeSkills = [...skills.filter((s) => pinnedSkills.has(s.id) || projectSkills.has(s.id)), ...projectOnlySkills];
  const inChat = [...files.filter((f) => f.always || attached.has(f.id) || projectFiles.has(f.id)), ...projectOnlyFiles];
  // The sidebar lists the chats in the project being looked at, or those in no project.
  const listed = conversations.filter((c) => (c.project_id ?? null) === projectId);
  const projectsWithCounts = projects.map((p) => ({ ...p, count: conversations.filter((c) => c.project_id === p.id).length }));

  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? m.chat.untitled;
  const sidebarProps = {
    conversations: listed,
    projects: projectsWithCounts,
    project,
    onNewProject: () => {
      setDrawerOpen(false);
      setProjectDialog("new");
    },
    onEditProject: () => {
      setDrawerOpen(false);
      if (project) setProjectDialog(project.id);
    },
    onMoveChat: (id: number) => {
      setDrawerOpen(false);
      setMoving(id);
    },
    activeId,
    onNew: startNew,
    onNavigate: () => setDrawerOpen(false),
    onRename: rename,
    onDelete: remove,
    isAdmin,
    hasInstructions: instructions.trim() !== "",
    fileCount: files.length,
    skillCount: activeSkills.length,
    onOpenSkills: () => {
      setDrawerOpen(false);
      setSkillsOpen(true);
    },
    onOpenFiles: () => {
      setDrawerOpen(false);
      setFilesOpen(true);
    },
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

      {projectDialog !== null && (
        <ProjectDialog
          project={projectDialog === "new" ? null : (projects.find((p) => p.id === projectDialog) ?? null)}
          files={files}
          skills={skills}
          isAdmin={isAdmin}
          onSaved={(saved) => {
            setProjectDialog(null);
            const exists = projects.some((p) => p.id === saved.id);
            setProjects((list) => (exists ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved]));
            if (!exists) router.push(`/chat?project=${saved.id}`); // straight into the new project
          }}
          onDeleted={dropProject}
          onLeft={dropProject}
          onClose={closeProjectDialog}
        />
      )}
      {moving !== null && (
        <MoveDialog
          title={conversations.find((c) => c.id === moving)?.title ?? m.chat.untitled}
          projects={projects}
          current={conversations.find((c) => c.id === moving)?.project_id ?? null}
          onMove={(target) => void move(moving, target)}
          onClose={closeMove}
        />
      )}
      {imageOpen && <ImagePanel prefs={imagePrefs} isAdmin={isAdmin} onMake={(d, p) => void sendImage(d, p)} onClose={() => setImageOpen(false)} />}
      {skillsOpen && (
        <SkillsDialog
          skills={skills}
          pinned={pinnedSkills}
          projectSkills={projectSkills}
          projectOnly={projectOnlySkills}
          isAdmin={isAdmin}
          onSkillsChange={setSkills}
          onTogglePin={togglePin}
          onClose={closeSkills}
        />
      )}
      {filesOpen && (
        <FilesDialog
          files={files}
          attached={attached}
          projectFiles={projectFiles}
          projectOnly={projectOnlyFiles}
          modelLabel={activeModel?.label ?? model}
          windowTokens={fileWindow}
          onFilesChange={setFiles}
          onToggleAttach={toggleAttach}
          onClose={closeFiles}
        />
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
          <h1 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-muted">
            {project && (
              <button
                type="button"
                onClick={() => setProjectDialog(project.id)}
                title={m.chat.projectSettings}
                className="inline-flex max-w-[45%] flex-none items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs text-fg transition hover:bg-surface-3"
              >
                <span aria-hidden>{project.emoji}</span>
                <span className="truncate">{project.name}</span>
              </button>
            )}
            <span className="truncate">{activeTitle}</span>
          </h1>
          <button
            type="button"
            onClick={() => setSkillsOpen(true)}
            title={m.chat.skills}
            aria-label={`${m.chat.skills}${activeSkills.length ? ` (${activeSkills.length})` : ""}`}
            className={`inline-flex h-[34px] items-center gap-1.5 rounded-xl border px-2.5 text-sm transition ${
              activeSkills.length ? "border-pink/50 bg-pink/12 text-accent-fg" : "border-line bg-surface text-subtle hover:border-line-strong hover:text-fg"
            }`}
          >
            <SparkIcon className="h-4 w-4" />
            {activeSkills.length > 0 && <span className="tabular-nums">{activeSkills.length}</span>}
          </button>
          <button
            type="button"
            onClick={() => setFilesOpen(true)}
            title={m.chat.files}
            aria-label={`${m.chat.files}${inChat.length ? ` (${inChat.length})` : ""}`}
            className={`inline-flex h-[34px] items-center gap-1.5 rounded-xl border px-2.5 text-sm transition ${
              inChat.length ? "border-violet/50 bg-violet/12 text-violet" : "border-line bg-surface text-subtle hover:border-line-strong hover:text-fg"
            }`}
          >
            <PaperclipIcon className="h-4 w-4" />
            {inChat.length > 0 && <span className="tabular-nums">{inChat.length}</span>}
          </button>
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
                onMakeSong={chat.streaming ? undefined : makeSong}
                makingSong={makingSong}
                onImageAgain={imageAccess ? imageAgain : undefined}
                onDecide={(id, d) => void decide(id, d)}
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

        {(inChat.length > 0 || activeSkills.length > 0) && (
          <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-1.5 px-4 pb-2">
            {activeSkills.map((s) => (
              <span
                key={`skill-${s.id}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-pink/30 bg-pink/8 py-1 pl-2.5 pr-1 text-xs text-accent-fg"
              >
                <span aria-hidden>{s.emoji}</span>
                <span className="truncate">{s.name}</span>
                {projectSkills.has(s.id) ? (
                  <span className="rounded-full bg-pink/12 px-1.5 py-0.5 text-[10px] font-medium uppercase">{m.chat.projectTag}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => togglePin(s.id)}
                    aria-label={`${m.chat.detachFile}: ${s.name}`}
                    title={m.chat.detachFile}
                    className="grid h-5 w-5 place-items-center rounded-full transition hover:bg-pink/20"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {inChat.map((f) => (
              <span
                key={f.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-2.5 pr-1 text-xs text-muted"
              >
                <PaperclipIcon className="h-3 w-3 flex-none" />
                <span className="truncate">{f.name}</span>
                {projectFiles.has(f.id) ? (
                  <span className="rounded-full bg-pink/12 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent-fg">{m.chat.projectTag}</span>
                ) : f.always ? (
                  <span className="rounded-full bg-violet/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-violet">{m.chat.alwaysOn}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleAttach(f.id)}
                    aria-label={`${m.chat.detachFile}: ${f.name}`}
                    title={m.chat.detachFile}
                    className="grid h-5 w-5 place-items-center rounded-full text-subtle transition hover:bg-surface-3 hover:text-fg"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
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
          skills={
            imageAccess
              ? [{ slug: "image", name: m.chat.image, emoji: "🎨", description: m.chat.imageCommandHint }, ...skills]
              : skills
          }
          onImage={imageAccess ? () => setImageOpen(true) : undefined}
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

/** The items whose ids aren't among `own`. */
function notIn<T extends { id: number }>(items: T[], own: { id: number }[]): T[] {
  const ids = new Set(own.map((o) => o.id));
  return items.filter((x) => !ids.has(x.id));
}
