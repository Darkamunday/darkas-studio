"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/chat/events";

export type UiMessage = {
  /** Stable React key; real ids arrive from the server as the stream goes. */
  key: string;
  id: number | null;
  role: "user" | "assistant";
  content: string;
};

type Request = { conversationId?: number; content?: string; regenerate?: true; model?: string };

type Handlers = {
  onConversation?: (id: number, isNew: boolean) => void;
  onTitle?: (title: string) => void;
  onUsage?: (usage: { sent: number; cap: number | null }) => void;
  onFinish?: () => void;
  /** An error reason (a key of m.chat.errors) and, for daily_cap, the cap. */
  onError?: (reason: string, cap?: number) => void;
};

let keySeq = 0;
export const newKey = () => `local-${++keySeq}`;

/**
 * Talks to POST /api/chat and keeps the message list in step with the stream.
 * Stop aborts the request; the server keeps whatever had arrived.
 */
export function useChatStream(initial: UiMessage[], conversationId: number | null, handlers: Handlers) {
  const [messages, setMessages] = useState<UiMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(conversationId);
  const handlersRef = useRef(handlers);
  const messagesRef = useRef(messages);
  useEffect(() => {
    handlersRef.current = handlers;
    idRef.current = conversationId;
    messagesRef.current = messages;
  });

  // Leaving the page stops the reply (the server saves what it has so far).
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (fn: (m: UiMessage) => UiMessage) =>
    setMessages((list) => (list.length ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  const run = useCallback(async (body: Request, userKey: string | null, before: UiMessage[]) => {
    const h = handlersRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    let gotReply = false;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; cap?: number };
        // Refused before anything was saved: put the list back as it was.
        setMessages(before);
        h.onError?.(err.error ?? "generic", err.cap);
        return false;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          switch (event.type) {
            case "meta":
              h.onConversation?.(event.conversationId, idRef.current !== event.conversationId);
              h.onUsage?.(event.usage);
              idRef.current = event.conversationId;
              if (event.userMessageId !== null) {
                const id = event.userMessageId;
                setMessages((list) => list.map((m) => (m.key === userKey ? { ...m, id } : m)));
              }
              break;
            case "delta":
              gotReply = true;
              patchLast((m) => ({ ...m, content: m.content + event.text }));
              break;
            case "done":
              patchLast((m) => ({ ...m, id: event.messageId }));
              break;
            case "title":
              h.onTitle?.(event.title);
              break;
            case "error":
              h.onError?.(event.reason);
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") h.onError?.("generic");
    } finally {
      abortRef.current = null;
      setStreaming(false);
      // Drop an empty reply bubble (stopped or failed before any text).
      if (!gotReply) setMessages((list) => (list.at(-1)?.role === "assistant" && !list.at(-1)!.content ? list.slice(0, -1) : list));
      h.onFinish?.();
    }
    return true;
  }, []);

  const send = useCallback(
    (content: string, model?: string) => {
      const userKey = newKey();
      const before = messagesRef.current;
      setMessages((list) => [
        ...list,
        { key: userKey, id: null, role: "user", content },
        { key: newKey(), id: null, role: "assistant", content: "" },
      ]);
      return run({ conversationId: idRef.current ?? undefined, content, model }, userKey, before);
    },
    [run],
  );

  const regenerate = useCallback(
    (model?: string) => {
      if (idRef.current === null) return Promise.resolve(false);
      const before = messagesRef.current;
      setMessages((list) => [
        ...(list.at(-1)?.role === "assistant" ? list.slice(0, -1) : list),
        { key: newKey(), id: null, role: "assistant", content: "" },
      ]);
      return run({ conversationId: idRef.current, regenerate: true, model }, null, before);
    },
    [run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, setMessages, streaming, send, regenerate, stop };
}
