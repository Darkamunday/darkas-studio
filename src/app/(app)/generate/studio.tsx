"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ClientGeneration } from "@/lib/serialize";
import { MODELS, MODEL_LABELS, SIMPLE_PROMPT_MAX, TITLE_MAX, limitsFor, type SunoModel } from "@/lib/models";
import { Equalizer } from "@/components/equalizer";
import { Player } from "@/components/player";
import { btnGhost, btnPrimary, card, chip, input, label } from "@/components/ui";
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

// ---- "Surprise me" ideas -------------------------------------------------------

const SIMPLE_IDEAS = [
  "A sunny UK garage track about missing the last train home, soulful female vocal",
  "Lo-fi hip hop for a rainy Sunday, vinyl crackle, mellow Rhodes piano",
  "An 80s synthwave anthem about driving to the seaside at midnight",
  "A cosy acoustic folk song about the best cup of tea in the world",
  "High-energy drum and bass with a euphoric vocal hook about summer festivals",
  "A dramatic sea shanty about losing the TV remote",
  "Dreamy bedroom pop about texting someone at 3am, soft male vocal",
  "An upbeat Motown-style love song about a dog called Biscuit",
];

const ADVANCED_IDEAS = [
  {
    title: "Night Bus Home",
    style: "UK garage, 2-step, soulful female vocals, warm sub bass, shuffled hats, 134bpm",
    lyrics:
      "[Verse]\nTop deck, front seat, city lights running\nFogged-up window, drawing hearts in the rain\n\n[Chorus]\nOn the night bus home, I'm thinking 'bout you\nEvery stop is a heartbeat, every light is a clue\n\n[Bridge]\nRing the bell, ring the bell\nI'm almost there",
  },
  {
    title: "Kettle's On",
    style: "indie folk, acoustic guitar, hand claps, cheerful, warm male and female harmonies",
    lyrics:
      "[Verse]\nGrey sky morning, slippers on the stair\nBiscuits in the cupboard, if you know where\n\n[Chorus]\nKettle's on, kettle's on\nWhatever's wrong, the kettle's on\n\n[Outro]\nTwo sugars, love",
  },
  {
    title: "Neon Tide",
    style: "synthwave, retro 80s, gated reverb drums, arpeggiated synths, dreamy female vocals",
    lyrics:
      "[Intro]\n\n[Verse]\nChrome and cherry, the coast road hums\nWe chase the tide till the morning comes\n\n[Chorus]\nRide the neon tide\nNothing left to hide\n\n[Outro]",
  },
];

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
}: {
  moods: string[];
  defaultModel: SunoModel;
  initialPending: number[];
  remix: RemixSourceInfo | null;
}) {
  const [mode, setMode] = useState<Mode>("simple");
  const [watching, setWatching] = useState<number[]>(initialPending);

  const onCreated = (id: number) => setWatching((w) => (w.includes(id) ? w : [id, ...w]));

  const inStudio = watching.length > 0 && (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-subtle">In the studio</h2>
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
        {(["simple", "advanced"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`relative z-10 rounded-xl px-6 py-2 font-medium capitalize transition-colors ${
              mode === m ? "text-white" : "text-muted hover:text-fg"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Both stay mounted so switching tabs doesn't throw away a half-written song. */}
      <div hidden={mode !== "simple"}>
        <SimpleForm moods={moods} onCreated={onCreated} />
      </div>
      <div hidden={mode !== "advanced"}>
        <AdvancedForm moods={moods} onCreated={onCreated} defaultModel={defaultModel} />
      </div>

      {inStudio}
    </div>
  );
}

// ---- simple ------------------------------------------------------------------

function SimpleForm({ moods, onCreated }: FormProps) {
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
        label="Describe the song you want"
        count={prompt.length}
        max={SIMPLE_PROMPT_MAX}
        errors={errors?.prompt}
        action={
          <button type="button" onClick={() => setPrompt((p) => pick(SIMPLE_IDEAS, p))} className={`${btnGhost} whitespace-nowrap text-accent-fg`}>
            <Sparkle /> Surprise me
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
          placeholder="Genre, mood, what it's about, who's singing… the more vibes the better."
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

function AdvancedForm({ moods, onCreated, defaultModel }: FormProps & { defaultModel: SunoModel }) {
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
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
    const idea = pick(ADVANCED_IDEAS, ADVANCED_IDEAS.find((i) => i.title === title));
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Write your own lyrics and dial in the exact sound.</p>
        <button type="button" onClick={surprise} className={`${btnGhost} whitespace-nowrap text-accent-fg`}>
          <Sparkle /> Fill with an example
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
        <Field label="Title" count={title.length} max={TITLE_MAX} errors={errors?.title}>
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            required
            placeholder="Last Train Home"
            className={input}
          />
        </Field>
        <Field label="Model" errors={errors?.model}>
          <select name="model" value={model} onChange={(e) => setModel(e.target.value as SunoModel)} className={`${input} cursor-pointer`}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
                {m === defaultModel ? " (default)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Style" hint="genre, vibe, instruments, vocals, tempo" count={style.length} max={limits.style} errors={errors?.style}>
        <textarea
          name="style"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={2}
          required
          placeholder="UK garage, 2-step, female vocals, warm bass, 140bpm"
          className={`${input} resize-y`}
        />
      </Field>

      {!instrumental && (
        <Field label="Lyrics" count={lyrics.length} max={limits.lyrics} errors={errors?.lyrics}>
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
            placeholder={"[Verse]\nMissed the last train, standing in the rain\n\n[Chorus]\nTake me home…"}
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
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-fg">Remixing</p>
          <p className="truncate font-semibold">{source.title}</p>
          <p className="truncate text-sm text-muted">by {source.username}</p>
        </div>
        <Link href="/generate" className={`${btnGhost} whitespace-nowrap`}>
          Cancel
        </Link>
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
        <Field label="Title" count={title.length} max={TITLE_MAX} errors={errors?.title}>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} required className={input} />
        </Field>
        <Field label="Model" errors={errors?.model}>
          <select name="model" value={model} onChange={(e) => setModel(e.target.value as typeof model)} className={`${input} cursor-pointer`}>
            {REMIX_MODELS.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="New style" hint="what should it sound like now?" count={style.length} max={1000} errors={errors?.style}>
        <textarea
          name="style"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          rows={2}
          required
          placeholder="e.g. UK garage, 2-step, soulful female vocals, 134bpm"
          className={`${input} resize-y`}
        />
        {source.style && (
          <p className="line-clamp-2 text-xs text-subtle" title={source.style}>
            <span className="font-medium text-muted">Original:</span> {source.style}
          </p>
        )}
      </Field>

      {!instrumental && (
        <Field label="Lyrics" hint={source.lyrics ? "the original words — tweak away" : "the original was instrumental, so add some words"} count={lyrics.length} max={5000} errors={errors?.lyrics}>
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
      <SubmitRow pending={pending} instrumental={instrumental} onInstrumental={setInstrumental} label="Create remix" />
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

function MoodPicker({ moods, value, onChange }: { moods: string[]; value: string | null; onChange: (m: string | null) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className={label}>
        Mood <span className="font-normal text-subtle">· optional</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {moods.map((m) => (
          <button key={m} type="button" aria-pressed={value === m} onClick={() => onChange(value === m ? null : m)} className={chip(value === m)}>
            {m}
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
  label: submitLabel = "Create song",
}: {
  pending: boolean;
  instrumental: boolean;
  onInstrumental: (v: boolean) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
      <label className="flex cursor-pointer select-none items-center gap-3 text-sm">
        <input type="checkbox" name="instrumental" checked={instrumental} onChange={(e) => onInstrumental(e.target.checked)} className="peer sr-only" />
        <span className="relative h-6 w-11 rounded-full bg-surface-3 transition after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:bg-violet peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-pink" />
        <span>
          <span className="font-medium">Instrumental</span> <span className="text-subtle">· no vocals</span>
        </span>
      </label>

      <button type="submit" disabled={pending} className={`${btnPrimary} w-full px-7 py-3 text-base sm:w-auto`}>
        {pending ? (
          <>
            <Equalizer className="h-4" bars={3} /> Sending to the studio…
          </>
        ) : (
          submitLabel
        )}
      </button>
    </div>
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

const STAGES: { key: ClientGeneration["status"][]; blurb: string }[] = [
  { key: ["pending"], blurb: "Tuning the instruments…" },
  { key: ["text_ready"], blurb: "Scribbling lyrics on a napkin…" },
  { key: ["first_ready"], blurb: "First take's in — mastering the rest…" },
  { key: ["complete"], blurb: "Fresh out the studio!" },
];

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
  const stageIndex = gen ? Math.max(0, STAGES.findIndex((s) => s.key.includes(gen.status))) : 0;
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
            {failed ? `Didn't make it — ${gen?.error ?? "unknown error"}` : STAGES[stageIndex].blurb}
            {!done && !failed && elapsed > 0 && <span className="text-subtle"> · {formatElapsed(elapsed)} (usually about a minute)</span>}
          </p>
          {netError && <p className="mt-1 text-xs text-warn">Lost contact with the studio — retrying…</p>}
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
                  {t.title ?? "Untitled"} <span className="font-normal text-subtle">· take {i + 1}</span>
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
            Saved to the catalogue →
          </Link>
        </div>
      )}
    </div>
  );
}
