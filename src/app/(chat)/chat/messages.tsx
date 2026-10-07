"use client";

import { useI18n } from "@/lib/i18n/client";
import { Markdown } from "./markdown";
import { CopyAction } from "./copy-action";
import type { UiMessage } from "./use-chat-stream";

export function MessageList({
  messages,
  streaming,
  onRegenerate,
}: {
  messages: UiMessage[];
  streaming: boolean;
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
              live={streaming && i === last}
              onRegenerate={!streaming && i === last ? onRegenerate : undefined}
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
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({ content, live, onRegenerate }: { content: string; live: boolean; onRegenerate?: () => void }) {
  const { m } = useI18n();
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
        {content ? (
          <>
            <Markdown content={content} />
            {live && <span aria-hidden className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-pink align-middle" />}
          </>
        ) : live ? (
          <TypingDots label={m.chat.thinking} />
        ) : null}
        {!live && content && (
          <div className="-ml-1.5 mt-2 flex items-center gap-0.5">
            <CopyAction getText={() => content} label={m.chat.copyMessage} />
            {onRegenerate && (
              <ActionButton onClick={onRegenerate} label={m.chat.regenerate}>
                <RegenerateIcon />
              </ActionButton>
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
