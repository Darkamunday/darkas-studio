"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ClientGeneration } from "@/lib/serialize";
import { MODELS, MODEL_LABELS, SIMPLE_PROMPT_MAX, TITLE_MAX, limitsFor, type SunoModel } from "@/lib/models";
import { Equalizer } from "@/components/equalizer";
import { Player } from "@/components/player";
import { btnGhost, btnPrimary, card, chip, input, label } from "@/components/ui";
import { fmt, lookup } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import { generateAdvanced, generateRemix, generateSimple, type GenerateState } from "./actions";

type Mode = "simple" | "advanced";

export type RemixSourceInfo = {
  id: number;
  title: string;
  username: string;
  lyrics: string | null;
  style: string | null;
  instrumental: boolean;
  coverUrl: string | null;
};
type FormProps = { moods: string[]; onCreated: (id: number) => void };

/** Starting values for the advanced form (e.g. a chat reply turned into a song). */
/** A song drafted from a chat reply ("Make it a song"); `messageId` is the reply it came from. */
export type AdvancedDraft = { title: string; style: string; lyrics: string; messageId?: number };

const pick = <T,>(list: T[], not?: T) => {
  const options = list.length > 1 ? list.filter((x) => x !== not) : list;
  return options[Math.floor(Math.random() * options.length)];
};

// ---- studio ------------------------------------------------------------------

export function GenerateStudio({
  moods,
  defaultModel,
  initialPending,
  remix,
  draft = null,
}: {
  moods: string[];
  defaultModel: SunoModel;
  initialPending: number[];
  remix: RemixSourceInfo | null;
  draft?: AdvancedDraft | null;
}) {
  const { m } = useI18n();
  const [mode, setMode] = useState<Mode>(draft ? "advanced" : "simple");
  const [watching, setWatching] = useState<number[]>(initialPending);

  const onCreated = (id: number) => setWatching((w) => (w.includes(id) ? w : [id, ...w]));

  const inStudio = watching.length > 0 && (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-subtle">{m.generate.inStudio}</h2>
      {watching.map((id) => (
        <GenerationProgress key={id} id={id} />
      ))}
    </section>
  );

  if (remix) {
    return (
      <div className="flex flex-col gap-8">
        <RemixForm key={remix.id} source={remix} moods={moods} onCreated={onCreated} />
        {inStudio}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="relative inline-grid grid-cols-2 self-start rounded-2xl border border-line bg-surface p-1 text-sm shadow-card" role="tablist">
        <span
          aria-hidden
          className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xl bg-brand shadow-glow transition-transform duration-300 ${
            mode === "advanced" ? "translate-x-full" : ""
          }`}
        />
        {(["simple", "advanced"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mode === tab}
            onClick={() => setMode(tab)}
            className={`relative z-10 rounded-xl px-6 py-2 font-medium transition-colors ${
              mode === tab ? "text-white" : "text-muted hover:text-fg"
            }`}
          >
            {m.generate[tab]}
          </button>
        ))}
      </div>

      {/* Both stay mounted so switching tabs doesn't throw away a half-written song. */}
      <div hidden={mode !== "simple"}>
        <SimpleForm moods={moods} onCreated={onCreated} />
      </div>
      <div hidden={mode !== "advanced"}>
        <AdvancedForm moods={moods} onCreated={onCreated} defaultModel={defaultModel} draft={draft} />
      </div>

      {inStudio}
    </div>
  );
}

// ---- simple ------------------------------------------------------------------

function SimpleForm({ moods, onCreated }: FormProps) {
  const { m } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [instrumental, setInstrumental] = useState(false);
  const [state, formAction, pending] = useActionState<GenerateState, FormData>(async (prev, formData) => {
    const result = await generateSimple(prev, formData);
    if (result?.ok) {
      onCreated(result.generationId);
      setPrompt("");
      setMood(null);
    }
    return result;
  }, undefined);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className={`${card} flex flex-col gap-6 p-6 sm:p-8`}>
      <Field
        label={m.generate.describe}
        count={prompt.length}
        max={SIMPLE_PROMPT_MAX}
        errors={errors?.prompt}
        action={
          <button type="button" onClick={() => setPrompt((p) => pick(m.generate.simpleIdeas, p))} className={`${btnGhost} whitespace-nowrap text-accent-fg`}>
            <Sparkle /> {m.generate.surprise}
          </button>
        }
      >
        <textarea
          name="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          maxLength={SIMPLE_PROMPT_MAX}
          required
          placeholder={m.generate.promptPlaceholder}
          className={`${input} resize-y text-lg leading-relaxed`}
        />
      </Field>
      <MoodPicker moods={moods} value={mood} onChange={setMood} />
      <SubmitRow pending={pending} instrumental={instrumental} onInstrumental={setInstrumental} />
      <FormError state={state} />
    </form>
  );
}

// ---- advanced ----------------------------------------------------------------

const SECTION_TAGS = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"];

function AdvancedForm({
  moods,
  onCreated,
  defaultModel,
  draft,
}: FormProps & { defaultModel: SunoModel; draft: AdvancedDraft | null }) {
  const { m } = useI18n();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [lyrics, setLyrics] = useState(draft?.lyrics ?? "");
  const [style, setStyle] = useState(draft?.style ?? "");
  const [model, setModel] = useState<SunoModel>(defaultModel);
  const [mood, setMood] = useState<string | null>(null);
  const [instrumental, setInstrumental] = useState(false);
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  // Fields are kept after a successful submit so you can re-roll the same song.
  const [state, formAction, pending] = useActionState<GenerateState, FormData>(async (prev, formData) => {
    const result = await generateAdvanced(prev, formData);
    if (result?.ok) onCreated(result.generationId);
    return result;
  }, undefined);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  const limits = limitsFor(model);

  const surprise = () => {
    const ideas = m.generate.advancedIdeas;
    const idea = pick(ideas, ideas.find((i) => i.title === title));
    setTitle(idea.title);
    setStyle(idea.style);
    setLyrics(idea.lyrics);
  };

  const insertTag = (tag: string) => {
    const el = lyricsRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const before = value.slice(0, start);
    // Put the tag on its own line, with a blank line before it unless we're at the top.
    const prefix = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const insert = `${prefix}[${tag}]\n`;
    setLyrics(before + insert + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <form action={formAction} className={`${card} flex flex-col gap-6 p-6 sm:p-8`}>
      {draft?.messageId && <input type="hidden" name="fromChat" value={draft.messageId} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{m.generate.advancedIntro}</p>
        <button type="button" onClick={surprise} className={`${btnGhost} whitespace-nowrap text-accent-fg`}>
          <Sparkle /> {m.generate.fillExample}
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
        <Field label={m.generate.title} count={title.length} max={TITLE_MAX} errors={errors?.title}>
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            required
            placeholder={m.generate.titlePlaceholder}
            className={input}
          />
        </Field>
        <Field label={m.generate.model} errors={errors?.model}>
          <select name="model" value={model} onChange={(e) => setModel(e.target.value as SunoModel)} className={`${input} cursor-pointer`}>
            {MODELS.map((opt) => (
              <option key={opt} value={opt}>
                {MODEL_LABELS[opt]}
                {opt === defaultModel ? ` ${m.generate.modelDefault}` : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={m.generate.style} hint={m.generate.styleHint} count={style.length} max={limits.style} errors={errors?.style}>
        <textarea
          name="style"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={2}
          required
          placeholder={m.generate.stylePlaceholder}
          className={`${input} resize-y`}
        />
      </Field>

      {!instrumental && (
        <Field label={m.generate.lyrics} count={lyrics.length} max={limits.lyrics} errors={errors?.lyrics}>
          <div className="flex flex-wrap gap-1.5">
            {SECTION_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => insertTag(tag)}
                className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted transition hover:border-pink hover:text-accent-fg"
              >
                [{tag}]
              </button>
            ))}
          </div>
          <textarea
            ref={lyricsRef}
            name="lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={12}
            placeholder={m.generate.lyricsPlaceholder}
            className={`${input} resize-y font-mono text-sm leading-relaxed`}
          />
        </Field>
      )}

      <MoodPicker moods={moods} value={mood} onChange={setMood} />
      <SubmitRow pending={pending} instrumental={instrumental} onInstrumental={setInstrumental} />
      <FormError state={state} />
    </form>
  );
}

// ---- remix -------------------------------------------------------------------

const REMIX_MODELS = ["V6", "V6_WILD", "V6_MINI"] as const satisfies readonly SunoModel[];

function RemixForm({ source, moods, onCreated }: FormProps & { source: RemixSourceInfo }) {
  const { m } = useI18n();
  const [title, setTitle] = useState(`${source.title} (Remix)`.slice(0, TITLE_MAX));
  const [style, setStyle] = useState("");
  const [lyrics, setLyrics] = useState(source.lyrics ?? "");
  const [model, setModel] = useState<(typeof REMIX_MODELS)[number]>("V6");
  const [mood, setMood] = useState<string | null>(null);
  const [instrumental, setInstrumental] = useState(source.instrumental);
  const [state, formAction, pending] = useActionState<GenerateState, FormData>(async (prev, formData) => {
    const result = await generateRemix(prev, formData);
    if (result?.ok) onCreated(result.generationId);
    return result;
  }, undefined);
  const errors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className={`${card} flex flex-col gap-6 p-6 sm:p-8`}>
      <input type="hidden" name="sourceTrackId" value={source.id} />

      <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface-2 p-3">
        {source.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source.coverUrl} alt="" className="h-16 w-16 flex-none rounded-xl object-cover" />
        ) : (
          <div className="h-16 w-16 flex-none rounded-xl bg-brand opacity-50" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-fg">{m.generate.remixing}</p>
          <p className="truncate font-semibold">{source.title}</p>
          <p className="truncate text-sm text-muted">{fmt(m.generate.by, { name: source.username })}</p>
        </div>
        <Link href="/generate" className={`${btnGhost} whitespace-nowrap`}>
          {m.generate.cancel}
        </Link>
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
        <Field label={m.generate.title} count={title.length} max={TITLE_MAX} errors={errors?.title}>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} required className={input} />
        </Field>
        <Field label={m.generate.model} errors={errors?.model}>
          <select name="model" value={model} onChange={(e) => setModel(e.target.value as typeof model)} className={`${input} cursor-pointer`}>
            {REMIX_MODELS.map((opt) => (
              <option key={opt} value={opt}>
                {MODEL_LABELS[opt]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label={m.generate.newStyle} hint={m.generate.newStyleHint} count={style.length} max={1000} errors={errors?.style}>
        <textarea
          name="style"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={2}
          required
          placeholder={m.generate.newStylePlaceholder}
          className={`${input} resize-y`}
        />
        {source.style && (
          <p className="line-clamp-2 text-xs text-subtle" title={source.style}>
            <span className="font-medium text-muted">{m.generate.original}</span> {source.style}
          </p>
        )}
      </Field>

      {!instrumental && (
        <Field label={m.generate.lyrics} hint={source.lyrics ? m.generate.lyricsHintOriginal : m.generate.lyricsHintAdd} count={lyrics.length} max={5000} errors={errors?.lyrics}>
          <textarea
            name="lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={10}
            className={`${input} resize-y font-mono text-sm leading-relaxed`}
          />
        </Field>
      )}

      <MoodPicker moods={moods} value={mood} onChange={setMood} />
      <SubmitRow pending={pending} instrumental={instrumental} onInstrumental={setInstrumental} label={m.generate.createRemix} />
      <FormError state={state} />
    </form>
  );
}

// ---- shared form bits ------------------------------------------------------------

function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" className="-mt-0.5 mr-1 inline h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </svg>
  );
}

function Field({
  label: text,
  hint,
  count,
  max,
  errors,
  action,
  children,
}: {
  label: string;
  hint?: string;
  count?: number;
  max?: number;
  errors?: string[];
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const over = count !== undefined && max !== undefined && count > max;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={label}>
          {text} {hint && <span className="font-normal text-subtle">· {hint}</span>}
        </span>
        {action}
      </div>
      {children}
      {(errors?.length || max !== undefined) && (
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            {errors?.map((e) => (
              <span key={e} className="text-xs text-danger">
                {e}
              </span>
            ))}
          </div>
          {max !== undefined && (
            <span className={`text-xs tabular-nums ${over ? "font-medium text-danger" : "text-subtle"}`}>
              {count}/{max}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MoodPicker({ moods, value, onChange }: { moods: string[]; value: string | null; onChange: (mood: string | null) => void }) {
  const { m } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <span className={label}>
        {m.generate.mood} <span className="font-normal text-subtle">· {m.generate.optional}</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {moods.map((mood) => (
          <button key={mood} type="button" aria-pressed={value === mood} onClick={() => onChange(value === mood ? null : mood)} className={chip(value === mood)}>
            {lookup(m.moods, mood)}
          </button>
        ))}
      </div>
      <input type="hidden" name="mood" value={value ?? ""} />
    </div>
  );
}

function SubmitRow({
  pending,
  instrumental,
  onInstrumental,
  label: submitLabel,
}: {
  pending: boolean;
  instrumental: boolean;
  onInstrumental: (v: boolean) => void;
  label?: string;
}) {
  const { m } = useI18n();
  // Kept in state (not left to the browser) so the choice survives the form reset after each submit.
  const [isPrivate, setPrivate] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Switch name="instrumental" checked={instrumental} onChange={onInstrumental} label={m.common.instrumental} hint={m.generate.noVocals} />
        <Switch name="private" checked={isPrivate} onChange={setPrivate} label={m.common.private} hint={m.generate.onlyYou} />
      </div>

      <button type="submit" disabled={pending} className={`${btnPrimary} w-full px-7 py-3 text-base sm:w-auto`}>
        {pending ? (
          <>
            <Equalizer className="h-4" bars={3} /> {m.generate.sending}
          </>
        ) : (
          (submitLabel ?? m.generate.createSong)
        )}
      </button>
    </div>
  );
}

function Switch({
  name,
  checked,
  onChange,
  label: text,
  hint,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-3 text-sm">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="relative h-6 w-11 flex-none rounded-full bg-surface-3 transition after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-violet peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-pink" />
      <span>
        <span className="font-medium">{text}</span> <span className="text-subtle">· {hint}</span>
      </span>
    </label>
  );
}

function FormError({ state }: { state: GenerateState }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
      {state.error}
    </p>
  );
}

// ---- progress ------------------------------------------------------------------

const STAGES = [
  { key: ["pending"], blurb: "stagePending" },
  { key: ["text_ready"], blurb: "stageText" },
  { key: ["first_ready"], blurb: "stageFirst" },
  { key: ["complete"], blurb: "stageComplete" },
] as const satisfies { key: ClientGeneration["status"][]; blurb: string }[];

const formatElapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

function useElapsed(since: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return since ? Math.max(0, Math.floor(now / 1000 - since)) : 0;
}

function GenerationProgress({ id }: { id: number }) {
  const { m } = useI18n();
  const [gen, setGen] = useState<ClientGeneration | null>(null);
  const [netError, setNetError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/generations/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ClientGeneration;
        if (cancelled) return;
        setGen(data);
        setNetError(false);
        if (data.status === "complete" || data.status === "failed") return;
      } catch {
        if (!cancelled) setNetError(true);
      }
      if (!cancelled) timer = setTimeout(poll, 4000);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  const failed = gen?.status === "failed";
  const done = gen?.status === "complete";
  const stageIndex = gen ? Math.max(0, STAGES.findIndex((s) => (s.key as readonly string[]).includes(gen.status))) : 0;
  const elapsed = useElapsed(gen?.createdAt, !done && !failed);
  // Honest-ish progress: stage-based, creeping forward with time, never "done" until it is.
  const pct = done ? 100 : Math.min(92, 8 + stageIndex * 28 + Math.min(20, elapsed / 4));

  return (
    <div className={`${card} animate-pop overflow-hidden`}>
      <div className="flex items-start gap-4 p-5">
        <div
          className={`grid h-11 w-11 flex-none place-items-center rounded-2xl text-lg font-bold ${
            failed ? "bg-danger/15 text-danger" : done ? "bg-success/15 text-success" : "bg-surface-2"
          }`}
        >
          {failed ? "!" : done ? "✓" : <Equalizer className="h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium">{gen?.prompt ?? "…"}</p>
          <p className={`mt-0.5 text-sm ${failed ? "text-danger" : "text-muted"}`}>
            {failed
              ? fmt(m.generate.failed, { error: lookup(m.generationErrors, gen?.error) ?? m.generate.unknownError })
              : m.generate[STAGES[stageIndex].blurb]}
            {!done && !failed && elapsed > 0 && (
              <span className="text-subtle"> · {fmt(m.generate.elapsed, { time: formatElapsed(elapsed) })}</span>
            )}
          </p>
          {netError && <p className="mt-1 text-xs text-warn">{m.generate.lostContact}</p>}
        </div>
      </div>

      {!failed && (
        <div className="h-1 bg-surface-2">
          <div className="h-full bg-brand transition-[width] duration-1000 ease-out" style={{ width: `${pct}%` }} />
        </div>
      )}

      {gen && gen.tracks.length > 0 && (
        <ul className="grid gap-3 p-5 sm:grid-cols-2">
          {gen.tracks.map((t, i) => (
            <li key={t.id} className="flex animate-pop gap-3 rounded-2xl border border-line bg-surface-2 p-3">
              {t.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.coverUrl} alt="" className="h-[72px] w-[72px] flex-none rounded-xl object-cover" />
              ) : (
                <div className="h-[72px] w-[72px] flex-none rounded-xl bg-brand opacity-40" />
              )}
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
                <p className="truncate text-sm font-semibold">
                  {t.title ?? m.common.untitled} <span className="font-normal text-subtle">· {fmt(m.generate.take, { n: i + 1 })}</span>
                </p>
                {t.audioUrl ? <Player src={t.audioUrl} seed={t.id} duration={t.duration} compact /> : <div className="skeleton h-8 rounded-lg" />}
              </div>
            </li>
          ))}
        </ul>
      )}

      {done && (
        <div className="border-t border-line px-5 py-3">
          <Link href="/catalogue" className="text-sm font-medium text-accent-fg hover:underline">
            {m.generate.saved}
          </Link>
        </div>
      )}
    </div>
  );
}
