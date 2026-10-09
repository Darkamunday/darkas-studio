"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/chat/events";
import type { ClientImage } from "@/lib/chat/images";
import type { ClientToolCall } from "@/lib/chat/tools";
import type { ClientUpload } from "@/lib/chat/uploads";

export type UiMessage = {
  /** Stable React key; real ids arrive from the server as the stream goes. */
  key: string;
  id: number | null;
  role: "user" | "assistant";
  content: string;
  /** The model's reasoning before replying, and how long it took (assistant messages only). */
  thinking?: string;
  thinkingMs?: number | null;
  /** Images made for this reply. */
  images?: ClientImage[];
  /** Connected tools this reply used (or wants approval for). */
  tools?: ClientToolCall[];
  /** Pictures the person attached (user messages only). */
  pictures?: ClientUpload[];
};

/** Image settings sent along with a message: the model and shape picked, and whether to improve the description. */
export type ImagePrefs = { model: string; aspect: "square" | "portrait" | "landscape"; improve: boolean };

type Request = {
  conversationId?: number;
  content?: string;
  imageIds?: number[];
  regenerate?: true;
  model?: string;
  think?: boolean;
  fileIds?: number[];
  projectId?: number;
  skillIds?: number[];
  image?: ImagePrefs;
  resume?: { toolCallId: number; decision: "approve" | "decline" };
};

/** Settings for a send. Files, project and skills only matter for a chat's first message (they're saved with it). */
export type SendOptions = {
  model?: string;
  think?: boolean;
  fileIds?: number[];
  projectId?: number | null;
  skillIds?: number[];
  image?: ImagePrefs;
  /** Pictures attached to this message. */
  pictures?: ClientUpload[];
};

type Handlers = {
  onConversation?: (id: number, isNew: boolean) => void;
  onTitle?: (title: string) => void;
  onUsage?: (usage: { sent: number; cap: number | null }) => void;
  onFinish?: () => void;
  /** An error reason (a key of m.chat.errors), with the cap (daily_cap) or model (files_too_big). */
  onError?: (reason: string, info?: { cap?: number; model?: string }) => void;
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
        const err = (await res.json().catch(() => ({}))) as { error?: string; cap?: number; model?: string };
        // Refused before anything was saved: put the list back as it was.
        setMessages(before);
        h.onError?.(err.error ?? "generic", { cap: err.cap, model: err.model });
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
            case "thinking":
              patchLast((m) => ({ ...m, thinking: (m.thinking ?? "") + event.text }));
              break;
            case "delta":
              gotReply = true;
              patchLast((m) => ({ ...m, content: m.content + event.text }));
              break;
            case "done":
              patchLast((m) => ({ ...m, id: event.messageId, thinkingMs: event.thinkingMs }));
              break;
            case "title":
              h.onTitle?.(event.title);
              break;
            case "tool": {
              // A card can belong to an earlier reply (e.g. the one that asked for approval): update it there.
              gotReply = true;
              const call = event.call;
              setMessages((list) => {
                const owner = list.findIndex((m) => m.tools?.some((t) => t.id === call.id));
                const at = owner >= 0 ? owner : list.length - 1;
                return list.map((m, i) => {
                  if (i !== at) return m;
                  const tools = m.tools ?? [];
                  return { ...m, tools: tools.some((t) => t.id === call.id) ? tools.map((t) => (t.id === call.id ? call : t)) : [...tools, call] };
                });
              });
              break;
            }
            case "image": {
              gotReply = true;
              const img = event.image;
              patchLast((m) => {
                const list = m.images ?? [];
                const at = list.findIndex((i) => i.id === img.id);
                return { ...m, images: at < 0 ? [...list, img] : list.map((i) => (i.id === img.id ? img : i)) };
              });
              break;
            }
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
      // Drop a reply bubble with no answer text (stopped or failed before any — even mid-thinking);
      // the server doesn't keep those either.
      if (!gotReply) setMessages((list) => (list.at(-1)?.role === "assistant" && !list.at(-1)!.content ? list.slice(0, -1) : list));
      h.onFinish?.();
    }
    return true;
  }, []);

  const send = useCallback(
    (content: string, { model, think, fileIds, projectId, skillIds, image, pictures }: SendOptions = {}) => {
      const userKey = newKey();
      const before = messagesRef.current;
      setMessages((list) => [
        ...list,
        { key: userKey, id: null, role: "user", content, pictures },
        { key: newKey(), id: null, role: "assistant", content: "" },
      ]);
      // What was picked before the chat exists rides along with its first message.
      const first = idRef.current === null;
      return run(
        {
          conversationId: idRef.current ?? undefined,
          content,
          imageIds: pictures?.length ? pictures.map((p) => p.id) : undefined,
          model,
          think,
          fileIds: first && fileIds?.length ? fileIds : undefined,
          projectId: first && projectId ? projectId : undefined,
          skillIds: first && skillIds?.length ? skillIds : undefined,
          image,
        },
        userKey,
        before,
      );
    },
    [run],
  );

  const regenerate = useCallback(
    (model?: string, think?: boolean, image?: ImagePrefs) => {
      if (idRef.current === null) return Promise.resolve(false);
      const before = messagesRef.current;
      setMessages((list) => [
        ...(list.at(-1)?.role === "assistant" ? list.slice(0, -1) : list),
        { key: newKey(), id: null, role: "assistant", content: "" },
      ]);
      return run({ conversationId: idRef.current, regenerate: true, model, think, image }, null, before);
    },
    [run],
  );

  /** After an approval card: run (or skip) the tool, and let the model carry on in a new reply. */
  const resume = useCallback(
    (toolCallId: number, decision: "approve" | "decline", model?: string, think?: boolean, image?: ImagePrefs) => {
      if (idRef.current === null) return Promise.resolve(false);
      const before = messagesRef.current;
      setMessages((list) => [...list, { key: newKey(), id: null, role: "assistant", content: "" }]);
      return run({ conversationId: idRef.current, resume: { toolCallId, decision }, model, think, image }, null, before);
    },
    [run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, setMessages, streaming, send, regenerate, resume, stop };
}
