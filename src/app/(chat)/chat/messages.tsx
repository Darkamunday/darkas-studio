"use client";

import { useI18n } from "@/lib/i18n/client";
import type { UiMessage } from "./use-chat-stream";

export function MessageList({ messages, streaming }: { messages: UiMessage[]; streaming: boolean }) {
  return (
    <ol className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {messages.map((msg, i) => (
        <li key={msg.key}>
          {msg.role === "user" ? (
            <UserMessage content={msg.content} />
          ) : (
            <AssistantMessage content={msg.content} live={streaming && i === messages.length - 1} />
          )}
        </li>
      ))}
    </ol>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-pink/12 px-4 py-2.5 text-fg">
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({ content, live }: { content: string; live: boolean }) {
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
          // Plain text for now; Markdown rendering arrives in the next phase.
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            {content}
            {live && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-pink align-middle" />}
          </div>
        ) : live ? (
          <TypingDots label={m.chat.thinking} />
        ) : null}
      </div>
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
