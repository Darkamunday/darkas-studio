"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/format";
import { Markdown } from "./markdown";
import { CopyAction } from "./copy-action";
import type { UiMessage } from "./use-chat-stream";
import { ImageCard } from "./image-card";
import type { ClientImage } from "@/lib/chat/images";

export function MessageList({
  messages,
  streaming,
  onRegenerate,
  onMakeSong,
  makingSong,
  onImageAgain,
}: {
  messages: UiMessage[];
  streaming: boolean;
  /** Make another image like this one. */
  onImageAgain?: (image: ClientImage) => void;
  /** Turn a saved reply into a song on the Create page. */
  onMakeSong?: (messageId: number) => void;
  /** The reply currently being turned into a song, if any. */
  makingSong?: number | null;
  /** Re-answer the last message; absent when there's no saved chat to regenerate in. */
  onRegenerate?: () => void;
}) {
  const { m } = useI18n();
  const last = messages.length - 1;
  // The last question has no answer (the reply failed or was stopped before any text).
  const unanswered = !streaming && messages[last]?.role === "user";

  return (
    <ol className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {messages.map((msg, i) => (
        <li key={msg.key}>
          {msg.role === "user" ? (
            <UserMessage content={msg.content} />
          ) : (
            <AssistantMessage
              content={msg.content}
              images={msg.images}
              onImageAgain={streaming ? undefined : onImageAgain}
              thinking={msg.thinking}
              thinkingMs={msg.thinkingMs}
              live={streaming && i === last}
              onRegenerate={!streaming && i === last ? onRegenerate : undefined}
              onMakeSong={msg.id !== null && onMakeSong ? () => onMakeSong(msg.id!) : undefined}
              makingSong={makingSong != null && makingSong === msg.id}
            />
          )}
        </li>
      ))}
      {unanswered && onRegenerate && (
        <li className="flex justify-center">
          <ActionButton onClick={onRegenerate} label={m.chat.retry} withText>
            <RegenerateIcon />
          </ActionButton>
        </li>
      )}
    </ol>
  );
}

function UserMessage({ content }: { content: string }) {
  const { m } = useI18n();
  return (
    <div className="group flex items-start justify-end gap-1">
      <div className="mt-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 max-md:hidden">
        <CopyAction getText={() => content} label={m.chat.copyMessage} />
      </div>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-pink/12 px-4 py-2.5 text-fg">
        <SlashCommand content={content} />
      </div>
    </div>
  );
}

/** A message, with a leading /skill command shown as a highlighted tag. */
function SlashCommand({ content }: { content: string }) {
  const command = /^\/[a-z0-9][a-z0-9-]{1,29}(?=\s|$)/.exec(content)?.[0];
  if (!command) return <>{content}</>;
  return (
    <>
      <span className="mr-1 rounded-md bg-pink/20 px-1.5 py-0.5 font-mono text-sm text-accent-fg">{command}</span>
      {content.slice(command.length).replace(/^\s+/, "")}
    </>
  );
}

function AssistantMessage({
  content,
  images = [],
  onImageAgain,
  thinking,
  thinkingMs,
  live,
  onRegenerate,
  onMakeSong,
  makingSong,
}: {
  content: string;
  images?: ClientImage[];
  onImageAgain?: (image: ClientImage) => void;
  thinking?: string;
  thinkingMs?: number | null;
  live: boolean;
  onRegenerate?: () => void;
  onMakeSong?: () => void;
  makingSong?: boolean;
}) {
  const { m } = useI18n();
  // Hide any "[Image shown…]" note a model imitates (the server strips it before saving, too).
  const shown = content.replace(/^\[Image (?:shown|made)[^\n]*$\n?/gim, "").trim();
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-xl bg-gradient-to-br from-pink/25 to-violet/25 text-sm"
      >
        ✦
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <span className="sr-only">{m.chat.assistant}</span>
        {thinking && <ThinkingBlock text={thinking} ms={thinkingMs ?? null} active={live && !content} />}
        {shown ? (
          <>
            <Markdown content={shown} />
            {live && <span aria-hidden className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-pink align-middle" />}
          </>
        ) : live && !thinking && images.length === 0 ? (
          <TypingDots label={m.chat.thinking} />
        ) : null}
        {images.map((img) => (
          <ImageCard key={img.id} image={img} onAgain={onImageAgain} />
        ))}
        {!live && shown && (
          <div className="-ml-1.5 mt-2 flex items-center gap-0.5">
            <CopyAction getText={() => content} label={m.chat.copyMessage} />
            {onRegenerate && (
              <ActionButton onClick={onRegenerate} label={m.chat.regenerate}>
                <RegenerateIcon />
              </ActionButton>
            )}
            {onMakeSong && (
              <button
                type="button"
                onClick={onMakeSong}
                disabled={makingSong}
                className="ml-1 inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-muted transition hover:border-pink/50 hover:text-accent-fg disabled:cursor-wait disabled:opacity-80"
              >
                <svg aria-hidden viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${makingSong ? "animate-pulse text-pink" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                {makingSong ? m.chat.makingSong : m.chat.makeSong}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  withText,
  children,
}: {
  onClick: () => void;
  label: string;
  withText?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-xs text-subtle transition hover:bg-surface-3 hover:text-fg ${
        withText ? "border border-line px-3" : ""
      }`}
    >
      {children}
      {withText && <span>{label}</span>}
    </button>
  );
}

function RegenerateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
    </svg>
  );
}

/**
 * The model's reasoning: open and streaming while it thinks, folded to "Thought for 6s" once the
 * answer starts. Readers can open or close it whenever they like.
 */
function ThinkingBlock({ text, ms, active }: { text: string; ms: number | null; active: boolean }) {
  const { m } = useI18n();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? active;
  const label = active
    ? m.chat.thinking
    : ms !== null && ms >= 1000
      ? fmt(m.chat.thoughtFor, { s: Math.round(ms / 1000) })
      : m.chat.thoughtBriefly;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        title={open ? m.chat.thoughtHide : m.chat.thoughtShow}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-muted transition hover:border-line-strong hover:text-fg"
      >
        <svg aria-hidden viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${active ? "animate-pulse text-pink" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
        </svg>
        <span>{label}</span>
        <svg aria-hidden viewBox="0 0 24 24" className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-violet/40 pl-3 text-sm leading-relaxed text-subtle">
          {text}
        </div>
      )}
    </div>
  );
}

function TypingDots({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1 py-2">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 animate-bounce rounded-full bg-pink/70"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
