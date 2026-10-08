"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { ClientToolCall } from "@/lib/chat/tools";

/** The few argument fields worth showing on the card itself. */
function headline(args: Record<string, unknown>): string | null {
  for (const key of ["prompt", "query", "q", "description", "template_name", "model", "name"]) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * A connected tool the assistant used: what it ran and how it went. One waiting for approval shows
 * what it wants to do with Run it / Don't run.
 */
export function ToolCard({
  call,
  onDecide,
}: {
  call: ClientToolCall;
  /** Set when the person can decide now (not while a reply is streaming). */
  onDecide?: (id: number, decision: "approve" | "decline") => void;
}) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const awaiting = call.status === "awaiting_approval";
  const label = { awaiting_approval: m.chat.toolAwaiting, running: m.chat.toolRunning, done: m.chat.toolDone, failed: m.chat.toolFailed, declined: m.chat.toolDeclined }[call.status];
  const tone = {
    awaiting_approval: "border-pink/50 bg-pink/8",
    running: "border-line bg-surface/60",
    done: "border-line bg-surface/60",
    failed: "border-danger/40 bg-danger/5",
    declined: "border-line bg-surface/40 opacity-75",
  }[call.status];
  const what = headline(call.args);

  return (
    <div className={`my-2 rounded-2xl border px-3.5 py-2.5 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>🔧</span>
        <span className="font-medium">{call.server}</span>
        <code className="text-xs text-accent-fg">{call.tool}</code>
        <span className={`ml-auto inline-flex items-center gap-1.5 text-xs ${call.status === "failed" ? "text-danger" : call.status === "done" ? "text-success" : "text-muted"}`}>
          {call.status === "running" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink" />}
          {label}
        </span>
      </div>
      {what && <p className="mt-1 line-clamp-2 text-xs text-muted" title={what}>{what}</p>}
      {awaiting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-subtle">{m.chat.toolSpends}</span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={!onDecide}
              onClick={() => onDecide?.(call.id, "decline")}
              className="rounded-lg border border-line px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg disabled:opacity-50"
            >
              {m.chat.toolDecline}
            </button>
            <button
              type="button"
              disabled={!onDecide}
              onClick={() => onDecide?.(call.id, "approve")}
              className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-50"
            >
              {m.chat.toolApprove}
            </button>
          </div>
        </div>
      )}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-xs text-subtle transition hover:text-fg">
        {open ? m.chat.toolHideDetails : m.chat.toolDetails}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify(call.args, null, 2)}
          </pre>
          {call.summary && (
            <p className="whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-2.5 text-[11px] leading-relaxed text-muted">
              <span className="font-medium text-fg">{m.chat.toolResult}: </span>
              {call.summary}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
