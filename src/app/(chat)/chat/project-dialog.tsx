"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { MAX_PROJECT_INSTRUCTIONS_CHARS, PROJECT_EMOJI, PROJECT_NAME_MAX, findChatModel, modelsFor } from "@/config/chat";
import type { ClientFile } from "@/lib/chat/files";
import type { ClientProject } from "@/lib/chat/projects";
import type { ClientSkill } from "@/lib/chat/skills";

type Person = { id: number; username: string };

/** Create a project, or edit (and delete) one of yours. A project shared with you opens read-only. */
export function ProjectDialog(props: {
  /** null to create a new one. */
  project: ClientProject | null;
  files: ClientFile[];
  skills: ClientSkill[];
  isAdmin: boolean;
  onSaved: (project: ClientProject) => void;
  onDeleted: (id: number) => void;
  /** You left a project shared with you. */
  onLeft: (id: number) => void;
  onClose: () => void;
}) {
  if (props.project && !props.project.mine) return <SharedProjectView project={props.project} onLeft={props.onLeft} onClose={props.onClose} />;
  return <OwnProjectDialog {...props} />;
}

function OwnProjectDialog({
  project,
  files,
  skills,
  isAdmin,
  onSaved,
  onDeleted,
  onClose,
}: {
  project: ClientProject | null;
  files: ClientFile[];
  skills: ClientSkill[];
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
  const [skillIds, setSkillIds] = useState(() => new Set(project?.skillIds ?? []));
  const [model, setModel] = useState(project?.model ?? "");
  const [think, setThink] = useState(project?.think === null || project?.think === undefined ? "" : project.think ? "on" : "off");
  const [memberIds, setMemberIds] = useState(() => new Set(project?.members.map((p) => p.id) ?? []));
  const [everyone, setEveryone] = useState(project?.everyone ?? false);
  // Everyone else with chat, loaded when the dialog opens (null while loading).
  const [people, setPeople] = useState<Person[] | null>(null);
  const [personFilter, setPersonFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    fetch("/api/chat/people")
      .then((res) => (res.ok ? (res.json() as Promise<{ people: Person[] }>) : { people: [] }))
      .catch(() => ({ people: [] as Person[] }))
      .then((body) => live && setPeople(body.people));
    return () => {
      live = false;
    };
  }, []);

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
        skillIds: [...skillIds],
        memberIds: [...memberIds],
        // Only admins can turn it on; anyone can leave it as it is or turn it off.
        ...(isAdmin || !everyone ? { everyone } : {}),
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

          {skills.length > 0 && (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">
                {m.chat.projectSkills} <span className="font-normal text-subtle">· {m.chat.projectSkillsHint}</span>
              </legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {skills.map((s) => {
                  const on = skillIds.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSkillIds((set) => {
                          const next = new Set(set);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                        on ? "border-pink bg-pink/12 text-accent-fg" : "border-line text-muted hover:border-line-strong hover:text-fg"
                      }`}
                    >
                      <span aria-hidden>{s.emoji}</span>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

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

          <fieldset className="mt-5 border-t border-line pt-4">
            <legend className="sr-only">{m.chat.projectSharing}</legend>
            <p className="text-sm font-medium" aria-hidden>
              {m.chat.projectSharing}
            </p>
            <p className="mt-0.5 text-xs text-subtle">{m.chat.projectSharingHint}</p>
            {(isAdmin || everyone) && (
              <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
                <input
                  type="checkbox"
                  role="switch"
                  checked={everyone}
                  disabled={!isAdmin && !everyone}
                  onChange={(e) => setEveryone(e.target.checked)}
                  className="h-4 w-4 flex-none accent-[var(--pink)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{m.chat.shareEveryone}</span>
                  <span className="block text-xs text-subtle">{m.chat.shareEveryoneHint}</span>
                </span>
              </label>
            )}
            {!everyone &&
              (people === null ? (
                <p className="mt-2 text-sm text-subtle">{m.chat.loadingPeople}</p>
              ) : people.length === 0 ? (
                <p className="mt-2 text-sm text-muted">{m.chat.noPeople}</p>
              ) : (
                <>
                  {people.length > 8 && (
                    <input
                      type="search"
                      value={personFilter}
                      onChange={(e) => setPersonFilter(e.target.value)}
                      placeholder={m.chat.findPerson}
                      aria-label={m.chat.findPerson}
                      className={`${field} mt-2 py-2 text-sm`}
                    />
                  )}
                  <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto rounded-2xl border border-line px-3">
                    {people
                      .filter((p) => memberIds.has(p.id) || p.username.toLowerCase().includes(personFilter.trim().toLowerCase()))
                      .map((p) => (
                        <li key={p.id}>
                          <label className="flex cursor-pointer items-center gap-3 py-2">
                            <input
                              type="checkbox"
                              checked={memberIds.has(p.id)}
                              onChange={() =>
                                setMemberIds((s) => {
                                  const next = new Set(s);
                                  if (next.has(p.id)) next.delete(p.id);
                                  else next.add(p.id);
                                  return next;
                                })
                              }
                              className="h-4 w-4 flex-none accent-[var(--pink)]"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm">{p.username}</span>
                          </label>
                        </li>
                      ))}
                  </ul>
                  {memberIds.size > 0 && (
                    <p className="mt-1 text-xs text-subtle">{fmt(m.chat.sharedWithCount, { n: num.format(memberIds.size) })}</p>
                  )}
                </>
              ))}
          </fieldset>

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

/** A project someone shared with you: what it brings to your chats, and a way to leave it. */
function SharedProjectView({ project, onLeft, onClose }: { project: ClientProject; onLeft: (id: number) => void; onClose: () => void }) {
  const { m } = useI18n();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function leave() {
    if (!window.confirm(fmt(m.chat.leaveProjectConfirm, { name: project.name }))) return;
    const res = await fetch(`/api/chat/projects/${project.id}/leave`, { method: "POST" }).catch(() => null);
    if (res?.ok || res?.status === 404) onLeft(project.id);
    else setError(m.chat.errors.generic);
  }

  const model = project.model ? (findChatModel(project.model)?.label ?? project.model) : null;
  const heading = "text-xs font-medium uppercase tracking-wide text-subtle";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="project-title">
      <button type="button" aria-label={m.chat.closeProject} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[92dvh] w-full max-w-xl animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl">
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25 text-lg">
              {project.emoji}
            </span>
            <div className="min-w-0">
              <h2 id="project-title" className="truncate text-lg font-semibold">{project.name}</h2>
              <p className="text-xs text-subtle">
                {fmt(project.everyone ? m.chat.sharedWithEveryoneBy : m.chat.sharedBy, { name: project.owner ?? "" })}
              </p>
            </div>
          </div>
          <p className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">{m.chat.sharedProjectBlurb}</p>

          <p className={`${heading} mt-5`}>{m.chat.projectInstructions}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{project.instructions || <span className="text-subtle">{m.chat.projectNone}</span>}</p>

          <p className={`${heading} mt-5`}>{m.chat.projectFiles}</p>
          {project.files.length === 0 ? (
            <p className="mt-1 text-sm text-subtle">{m.chat.projectNone}</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {project.files.map((f) => (
                <li key={f.id} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted">
                  {f.name}
                </li>
              ))}
            </ul>
          )}

          {project.skills.length > 0 && (
            <>
              <p className={`${heading} mt-5`}>{m.chat.projectSkills}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {project.skills.map((s) => (
                  <li key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-pink/30 bg-pink/8 px-2.5 py-1 text-xs text-accent-fg">
                    <span aria-hidden>{s.emoji}</span>
                    {s.name}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(model || project.think !== null) && (
            <p className="mt-5 text-sm text-muted">
              {model && (
                <>
                  {m.chat.projectModel}: <span className="text-fg">{model}</span>
                </>
              )}
              {model && project.think !== null && " · "}
              {project.think !== null && (
                <>
                  {m.chat.projectThink}: <span className="text-fg">{project.think ? m.chat.thinkOnShort : m.chat.thinkOffShort}</span>
                </>
              )}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {project.member && !project.everyone && (
            <button type="button" onClick={() => void leave()} className="rounded-xl px-3 py-2 text-sm text-muted transition hover:text-danger">
              {m.chat.leaveProject}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110"
          >
            {m.chat.closeProject}
          </button>
        </div>
      </div>
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
