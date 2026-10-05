"use client";

import { useEffect, useState, useTransition } from "react";
import { Equalizer } from "@/components/equalizer";
import { btnGhost, btnPrimary, btnSecondary, input } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { applyCoverAction, checkCoverAction, discardCoverAction, startCoverAction } from "./actions";

const PROMPT_MAX = 600; // keep in step with COVER_PROMPT_MAX in lib/covers.ts

type Stage = { kind: "closed" } | { kind: "prompt" } | { kind: "working"; jobId: number } | { kind: "ready"; jobId: number; previewUrl: string };

/** Creator-only: describe a cover, get an AI image, then keep it or try again. */
export function CoverChanger({ trackId, suggestion }: { trackId: number; suggestion: string }) {
  const { m } = useI18n();
  const [stage, setStage] = useState<Stage>({ kind: "closed" });
  const [prompt, setPrompt] = useState(suggestion);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Poll while the image is being made.
  const workingJob = stage.kind === "working" ? stage.jobId : null;
  useEffect(() => {
    if (workingJob === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const res = await checkCoverAction(workingJob);
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setStage({ kind: "prompt" });
      } else if (res.status === "ready" && res.previewUrl) {
        setStage({ kind: "ready", jobId: workingJob, previewUrl: res.previewUrl });
      } else {
        timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workingJob]);

  const generate = () =>
    startTransition(async () => {
      setError(null);
      const res = await startCoverAction(trackId, prompt);
      if (res.ok && res.jobId) setStage({ kind: "working", jobId: res.jobId });
      else if (!res.ok) setError(res.error);
    });

  const apply = (jobId: number) =>
    startTransition(async () => {
      const res = await applyCoverAction(jobId);
      if (res.ok) setStage({ kind: "closed" });
      else setError(res.error ?? m.covers.errors.generic);
    });

  const close = () => {
    if (stage.kind === "ready") void discardCoverAction(stage.jobId);
    setStage({ kind: "closed" });
    setError(null);
  };

  if (stage.kind === "closed") {
    return (
      <button type="button" onClick={() => setStage({ kind: "prompt" })} className={btnSecondary}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-4.5-4.5L6 21" />
        </svg>
        {m.covers.change}
      </button>
    );
  }

  return (
    <div className="flex w-full animate-pop flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-3 text-sm">
      {stage.kind === "ready" ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.previewUrl} alt="" className="aspect-square w-full rounded-xl object-cover" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => apply(stage.jobId)} disabled={pending} className={`${btnPrimary} px-4 py-1.5 text-sm`}>
              {pending ? m.covers.applying : m.covers.useThis}
            </button>
            <button type="button" onClick={generate} disabled={pending} className={btnSecondary}>
              {m.covers.tryAgain}
            </button>
            <button type="button" onClick={close} disabled={pending} className={`${btnGhost} ml-auto`}>
              {m.covers.cancel}
            </button>
          </div>
        </>
      ) : stage.kind === "working" ? (
        <div className="skeleton grid aspect-square w-full place-items-center rounded-xl">
          <div className="flex flex-col items-center gap-3 text-muted">
            <Equalizer className="h-8" bars={5} />
            {m.covers.generating}
          </div>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-fg">{m.covers.promptLabel}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={PROMPT_MAX}
              placeholder={m.covers.promptPlaceholder}
              className={`${input} resize-y px-3 py-2 text-sm`}
            />
          </label>
          <p className="text-xs text-subtle">{m.covers.hint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={generate} disabled={pending || prompt.trim().length < 3} className={`${btnPrimary} px-4 py-1.5 text-sm`}>
              {m.covers.generate}
            </button>
            <button type="button" onClick={close} className={`${btnGhost} ml-auto`}>
              {m.covers.cancel}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
