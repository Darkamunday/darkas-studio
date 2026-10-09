"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import {
  MAX_SKILL_INSTRUCTIONS_CHARS,
  SKILL_DESCRIPTION_MAX,
  SKILL_EMOJI,
  SKILL_NAME_MAX,
  SKILL_SLUG,
} from "@/config/chat";
import type { ClientSkill } from "@/lib/chat/skills";

/** "Lyric Critic!" → "lyric-critic" */
const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

/**
 * Skills: tick which ones this chat uses, and (in the same window) create, edit or delete them.
 * Admins can also make shared skills and edit the shared ones.
 */
export function SkillsDialog({
  skills,
  pinned,
  projectSkills,
  projectOnly,
  isAdmin,
  onSkillsChange,
  onTogglePin,
  onClose,
}: {
  skills: ClientSkill[];
  pinned: Set<number>;
  /** Skills the chat's project brings in (always used; managed in the project's settings). */
  projectSkills: Set<number>;
  /** Skills a project shared with you brings in that aren't in your list (shown, but can't be changed). */
  projectOnly: { id: number; name: string; emoji: string }[];
  isAdmin: boolean;
  onSkillsChange: (skills: ClientSkill[]) => void;
  onTogglePin: (id: number) => void;
  onClose: () => void;
}) {
  const { m } = useI18n();
  // null: the list; "new" or a skill: the editor.
  const [editing, setEditing] = useState<"new" | ClientSkill | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (editing ? setEditing(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const shared = skills.filter((s) => s.shared);
  const own = skills.filter((s) => !s.shared);
  const canEdit = (s: ClientSkill) => !s.shared || isAdmin;

  const row = (s: ClientSkill) => (
    <li key={s.id} className="flex items-start gap-3 py-2.5">
      <input
        type="checkbox"
        checked={pinned.has(s.id) || projectSkills.has(s.id)}
        disabled={projectSkills.has(s.id)}
        onChange={() => onTogglePin(s.id)}
        aria-label={`${m.chat.useSkillInChat}: ${s.name}`}
        title={m.chat.useSkillInChat}
        className="mt-1 h-4 w-4 flex-none accent-[var(--pink)]"
      />
      <span aria-hidden className="text-lg leading-6">{s.emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{s.name}</span>
          <code className="text-xs text-accent-fg">/{s.slug}</code>
          {projectSkills.has(s.id) && (
            <span className="rounded-full bg-pink/12 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent-fg">{m.chat.projectTag}</span>
          )}
        </span>
        {s.description && <span className="block text-xs text-subtle">{s.description}</span>}
      </span>
      {canEdit(s) && (
        <button
          type="button"
          onClick={() => setEditing(s)}
          aria-label={`${m.chat.editSkill}: ${s.name}`}
          title={m.chat.editSkill}
          className="grid h-7 w-7 flex-none place-items-center rounded-lg text-subtle transition hover:bg-surface-2 hover:text-fg"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="skills-title">
      <button type="button" aria-label={m.chat.skillsDone} onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" />
      <div className="relative flex max-h-[92dvh] w-full max-w-xl animate-pop flex-col rounded-t-3xl border border-line bg-surface shadow-card sm:rounded-3xl">
        {editing ? (
          <SkillEditor
            skill={editing === "new" ? null : editing}
            isAdmin={isAdmin}
            onBack={() => setEditing(null)}
            onSaved={(saved) => {
              const exists = skills.some((s) => s.id === saved.id);
              onSkillsChange(exists ? skills.map((s) => (s.id === saved.id ? saved : s)) : [...skills, saved]);
              setEditing(null);
            }}
            onDeleted={(id) => {
              onSkillsChange(skills.filter((s) => s.id !== id));
              setEditing(null);
            }}
          />
        ) : (
          <>
            <div className="p-5 pb-2 sm:p-6 sm:pb-2">
              <div className="flex items-center gap-3">
                <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25">
                  <SparkIcon className="h-4 w-4" />
                </span>
                <h2 id="skills-title" className="flex-1 text-lg font-semibold">{m.chat.skills}</h2>
                <button
                  type="button"
                  onClick={() => setEditing("new")}
                  className="rounded-xl border border-line px-3 py-1.5 text-sm text-muted transition hover:border-line-strong hover:text-fg"
                >
                  + {m.chat.newSkill}
                </button>
              </div>
              <p className="mt-3 text-sm text-muted">{m.chat.skillsBlurb}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-6">
              {projectOnly.length > 0 && (
                <>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-subtle">{m.chat.fromProject}</p>
                  <ul className="divide-y divide-line">
                    {projectOnly.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 py-2.5">
                        <input type="checkbox" checked disabled aria-label={s.name} className="h-4 w-4 flex-none accent-[var(--pink)]" />
                        <span aria-hidden className="text-lg leading-6">{s.emoji}</span>
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="rounded-full bg-pink/12 px-1.5 py-0.5 text-[10px] font-medium uppercase text-accent-fg">{m.chat.projectTag}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {shared.length > 0 && (
                <>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-subtle">{m.chat.sharedSkills}</p>
                  <ul className="divide-y divide-line">{shared.map(row)}</ul>
                </>
              )}
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-subtle">{m.chat.yourSkills}</p>
              {own.length === 0 ? (
                <p className="py-3 text-sm text-muted">{m.chat.noOwnSkills}</p>
              ) : (
                <ul className="divide-y divide-line">{own.map(row)}</ul>
              )}
            </div>
            <div className="flex justify-end border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110"
              >
                {m.chat.skillsDone}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SkillEditor({
  skill,
  isAdmin,
  onBack,
  onSaved,
  onDeleted,
}: {
  skill: ClientSkill | null;
  isAdmin: boolean;
  onBack: () => void;
  onSaved: (skill: ClientSkill) => void;
  onDeleted: (id: number) => void;
}) {
  const { m } = useI18n();
  const [name, setName] = useState(skill?.name ?? "");
  const [slug, setSlug] = useState(skill?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(!!skill);
  const [emoji, setEmoji] = useState(skill?.emoji ?? SKILL_EMOJI[0]);
  const [description, setDescription] = useState(skill?.description ?? "");
  const [instructions, setInstructions] = useState(skill?.instructions ?? "");
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = slugEdited ? slug : slugify(name);
  const valid = name.trim() && SKILL_SLUG.test(command) && instructions.trim();

  const errorText = (reason: string) => (m.chat.errors as Record<string, string>)[reason] ?? m.chat.errors.generic;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(skill ? `/api/chat/skills/${skill.id}` : "/api/chat/skills", {
      method: skill ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug: command, emoji, description, instructions, ...(skill ? {} : { shared }) }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { skill?: ClientSkill; error?: string } | null;
    setSaving(false);
    if (res?.ok && body?.skill) onSaved(body.skill);
    else setError(errorText(body?.error ?? "generic"));
  }

  async function remove() {
    if (!skill || !window.confirm(fmt(m.chat.deleteSkillConfirm, { name: skill.name }))) return;
    const res = await fetch(`/api/chat/skills/${skill.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok || res?.status === 404) onDeleted(skill.id);
    else setError(errorText("generic"));
  }

  const field =
    "w-full rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-base text-fg outline-none transition placeholder:text-subtle focus:border-pink focus:bg-surface focus:ring-4 focus:ring-pink/15";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        <button type="button" onClick={onBack} className="text-xs text-subtle transition hover:text-fg">
          ← {m.chat.backToSkills}
        </button>
        <h2 id="skills-title" className="mt-2 text-lg font-semibold">{skill ? m.chat.editSkill : m.chat.newSkill}</h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem]">
          <label className="block text-sm font-medium">
            {m.chat.skillName}
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={SKILL_NAME_MAX} className={`${field} mt-1.5`} />
          </label>
          <label className="block text-sm font-medium">
            {m.chat.skillCommand}
            <span className="relative mt-1.5 block">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-subtle">/</span>
              <input
                value={command}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30));
                }}
                className={`${field} pl-7 font-mono`}
              />
            </span>
          </label>
        </div>
        {command && <p className="mt-1 text-xs text-subtle">{fmt(m.chat.skillCommandHint, { slug: command })}</p>}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">{m.chat.skillIcon}</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SKILL_EMOJI.map((e) => (
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
          {m.chat.skillDescription} <span className="font-normal text-subtle">· {m.chat.skillDescriptionHint}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={SKILL_DESCRIPTION_MAX} className={`${field} mt-1.5`} />
        </label>

        <label className="mt-4 block text-sm font-medium">
          {m.chat.skillInstructions}
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={MAX_SKILL_INSTRUCTIONS_CHARS}
            rows={7}
            placeholder={m.chat.skillInstructionsPlaceholder}
            className={`${field} mt-1.5 resize-y`}
          />
        </label>

        {!skill && isAdmin && (
          <label className="mt-3 flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--violet)]" />
            <span>
              {m.chat.shareSkill}
              <span className="block text-xs text-subtle">{m.chat.shareSkillHint}</span>
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        {skill && (
          <button type="button" onClick={() => void remove()} className="rounded-xl px-3 py-2 text-sm text-muted transition hover:text-danger">
            {m.chat.deleteSkill}
          </button>
        )}
        <button
          type="submit"
          disabled={!valid || saving}
          className="ml-auto rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
        >
          {m.chat.saveSkill}
        </button>
      </div>
    </form>
  );
}

export function SparkIcon({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M6.3 17.7l2.4-2.4M15.3 8.7l2.4-2.4" />
    </svg>
  );
}
