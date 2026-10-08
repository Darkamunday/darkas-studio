"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { MAX_PROJECT_INSTRUCTIONS_CHARS, PROJECT_EMOJI, PROJECT_NAME_MAX, modelsFor } from "@/config/chat";
import type { ClientFile } from "@/lib/chat/files";
import type { ClientProject } from "@/lib/chat/projects";

/** Create a project, or edit (and delete) an existing one. */
export function ProjectDialog({
  project,
  files,
  isAdmin,
  onSaved,
  onDeleted,
  onClose,
}: {
  /** null to create a new one. */
  project: ClientProject | null;
  files: ClientFile[];
  isAdmin: boolean;
  onSaved: (project: ClientProject) => void;
  onDeleted: (id: number) => void;
  onClose: () => void;
}) {
  const { locale, m } = useI18n();
  const num = new Intl.NumberFormat(locale);
  const [name, setName] = useState(project?.name ?? "");
  const [emoji, setEmoji] = useState(project?.emoji ?? PROJECT_EMOJI[0]);
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [fileIds, setFileIds] = useState(() => new Set(project?.fileIds ?? []));
  const [model, setModel] = useState(project?.model ?? "");
  const [think, setThink] = useState(project?.think === null || project?.think === undefined ? "" : project.think ? "on" : "off");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const errorText = (reason: string) => (m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(project ? `/api/chat/projects/${project.id}` : "/api/chat/projects", {
      method: project ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        emoji,
        instructions: instructions.trim() || null,
        model: model || null,
        think: think === "" ? null : think === "on",
        fileIds: [...fileIds],
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { project?: ClientProject; error?: string } | null;
    setSaving(false);
    if (res?.ok && body?.project) onSaved(body.project);
    else setError(errorText(body?.error ?? "generic"));
  }

  async function remove() {
    if (!project || !window.confirm(fmt(m.chat.deleteProjectConfirm, { name: project.name }))) return;
    const res = await fetch(`/api/chat/projects/${project.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) onDeleted(project.id);
    else setError(errorText("generic"));
  }

  const picked = files.filter((f) => fileIds.has(f.id)).reduce((n, f) => n + f.tokens, 0);
  const field = "w-full rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-base text-fg outline-none transition placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="project-title">
      <button type="button" aria-label={m.chat.cancelProject} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void save();
        }}
        className="relative flex max-h-[92dvh] w-full max-w-xl animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25 text-lg">
              {emoji}
            </span>
            <h2 id="project-title" className="text-lg font-semibold">
              {project ? m.chat.projectSettings : m.chat.newProject}
            </h2>
          </div>

          <label className="mt-5 block text-sm font-medium">
            {m.chat.projectName}
            <input
              autoFocus={!project}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={PROJECT_NAME_MAX}
              placeholder={m.chat.projectNamePlaceholder}
              className={`${field} mt-1.5`}
            />
          </label>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium">{m.chat.projectIcon}</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PROJECT_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-pressed={emoji === e}
                  className={`grid h-9 w-9 place-items-center rounded-xl border text-lg transition ${
                    emoji === e ? "border-pink bg-pink/12" : "border-line hover:border-line-strong"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="mt-4 block text-sm font-medium">
            {m.chat.projectInstructions} <span className="font-normal text-subtle">· {m.chat.projectInstructionsHint}</span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={MAX_PROJECT_INSTRUCTIONS_CHARS}
              rows={4}
              placeholder={m.chat.projectInstructionsPlaceholder}
              className={`${field} mt-1.5 resize-y`}
            />
          </label>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium">
              {m.chat.projectFiles} <span className="font-normal text-subtle">· {m.chat.projectFilesHint}</span>
            </legend>
            {files.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted">{m.chat.projectNoFiles}</p>
            ) : (
              <ul className="mt-1.5 max-h-48 divide-y divide-line overflow-y-auto rounded-2xl border border-line px-3">
                {files.map((f) => (
                  <li key={f.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={fileIds.has(f.id)}
                        onChange={() =>
                          setFileIds((s) => {
                            const next = new Set(s);
                            if (next.has(f.id)) next.delete(f.id);
                            else next.add(f.id);
                            return next;
                          })
                        }
                        className="h-4 w-4 flex-none accent-[var(--pink)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                      <span className="text-xs text-subtle">{fmt(m.chat.fileTokens, { n: num.format(f.tokens) })}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {picked > 0 && <p className="mt-1 text-xs text-subtle">{fmt(m.chat.fileTokens, { n: num.format(picked) })}</p>}
          </fieldset>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              {m.chat.projectModel}
              <select value={model} onChange={(e) => setModel(e.target.value)} className={`${field} mt-1.5`}>
                <option value="">{m.chat.noPreference}</option>
                {modelsFor(isAdmin).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              {m.chat.projectThink}
              <select value={think} onChange={(e) => setThink(e.target.value)} className={`${field} mt-1.5`}>
                <option value="">{m.chat.thinkDefault}</option>
                <option value="on">{m.chat.thinkOnShort}</option>
                <option value="off">{m.chat.thinkOffShort}</option>
              </select>
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {project && (
            <button type="button" onClick={() => void remove()} className="rounded-xl px-3 py-2 text-sm text-muted transition hover:text-danger">
              {m.chat.deleteProject}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:border-line-strong hover:text-fg">
              {m.chat.cancelProject}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
            >
              {project ? m.chat.saveProject : m.chat.createProject}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Pick which project a chat belongs to. */
export function MoveDialog({
  title,
  projects,
  current,
  onMove,
  onClose,
}: {
  title: string;
  projects: ClientProject[];
  current: number | null;
  onMove: (projectId: number | null) => void;
  onClose: () => void;
}) {
  const { m } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options: { id: number | null; label: string; emoji: string }[] = [
    ...projects.map((p) => ({ id: p.id, label: p.name, emoji: p.emoji })),
    { id: null, label: m.chat.noProject, emoji: "💬" },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="move-title">
      <button type="button" aria-label={m.chat.cancelProject} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm animate-pop rounded-t-3xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card sm:rounded-3xl">
        <h2 id="move-title" className="truncate font-semibold">
          {fmt(m.chat.moveTitle, { title })}
        </h2>
        <ul className="mt-3 flex flex-col gap-1">
          {options.map((o) => (
            <li key={o.id ?? "none"}>
              <button
                type="button"
                onClick={() => onMove(o.id)}
                disabled={o.id === current}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-surface-2 disabled:bg-surface-3 disabled:font-medium"
              >
                <span aria-hidden className="text-base">{o.emoji}</span>
                <span className="truncate">{o.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
