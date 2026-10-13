"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatEvent } from "@/lib/chat/events";
import type { ClientImage } from "@/lib/chat/images";
import type { ClientToolCall } from "@/lib/chat/tools";
import type { ClientUpload } from "@/lib/chat/uploads";
import type { ClientMemory } from "@/lib/chat/memory";

/** A note in a reply that the assistant saved or forgot a memory (undone: the person took it back). */
export type MemoryNote = { action: "saved" | "forgotten"; memory: ClientMemory; undone?: boolean };

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
  /** Memories this reply saved or forgot. */
  memories?: MemoryNote[];
};

/** Image settings sent along with a message: the model and shape picked, and whether to improve the description. */
export type ImagePrefs = { model: string; aspect: "square" | "portrait" | "landscape"; improve: boolean };

type Request = {
  conversationId?: number;
  content?: string;
  imageIds?: number[];
  adult?: boolean;
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
  /** Start the chat as an adult (18+) chat (first message only). */
  adult?: boolean;
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
 * Talks to POST /api/chat and keeps the message list in step with the stream. Replies run on the server
 * as jobs that don't stop when this page goes away (see live.ts): opening a chat, or coming back to the
 * app after switching away on a phone, picks up the reply where it is. Stop asks the server to stop it.
 */
export function useChatStream(initial: UiMessage[], conversationId: number | null, handlers: Handlers) {
  const [messages, setMessages] = useState<UiMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(conversationId);
  const handlersRef = useRef(handlers);
  const messagesRef = useRef(messages);
  // The connection dropped mid-reply (app switched away, signal lost): pick it up again on return.
  const interruptedRef = useRef(false);
  useEffect(() => {
    handlersRef.current = handlers;
    idRef.current = conversationId;
    messagesRef.current = messages;
  });

  const patchLast = (fn: (m: UiMessage) => UiMessage) =>
    setMessages((list) => (list.length ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  /** Read a reply's event stream into the message list. */
  const consume = useCallback(async (stream: NonNullable<Response["body"]>, userKey: string | null, state: { gotReply: boolean }) => {
    const h = handlersRef.current;
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
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
            state.gotReply = true;
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
            state.gotReply = true;
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
            state.gotReply = true;
            const img = event.image;
            patchLast((m) => {
              const list = m.images ?? [];
              const at = list.findIndex((i) => i.id === img.id);
              return { ...m, images: at < 0 ? [...list, img] : list.map((i) => (i.id === img.id ? img : i)) };
            });
            break;
          }
          case "memory": {
            state.gotReply = true;
            const note: MemoryNote = { action: event.action, memory: event.memory };
            patchLast((m) => ({ ...m, memories: [...(m.memories ?? []), note] }));
            break;
          }
          case "error":
            h.onError?.(event.reason);
            break;
        }
      }
    }
  }, []);

  /** Whether a dropped connection means "picked up later" rather than an error. */
  const dropped = (err: unknown) => (err as Error).name !== "AbortError" && (document.hidden || err instanceof TypeError);

  const run = useCallback(
    async (body: Request, userKey: string | null, before: UiMessage[]) => {
      const h = handlersRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);
      const state = { gotReply: false };
      let interrupted = false;
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
        await consume(res.body, userKey, state);
      } catch (err) {
        // Lost the connection (e.g. switched apps): the reply carries on on the server; pick it up on return.
        if (dropped(err) && idRef.current !== null) interrupted = interruptedRef.current = true;
        else if ((err as Error).name !== "AbortError") h.onError?.("generic");
      } finally {
        abortRef.current = null;
        setStreaming(false);
        // Drop a reply bubble with no answer text (stopped or failed before any — even mid-thinking);
        // the server doesn't keep those either. Not when we only lost sight of it.
        if (!state.gotReply && !interrupted && !ctrl.signal.aborted) {
          setMessages((list) => (list.at(-1)?.role === "assistant" && !list.at(-1)!.content ? list.slice(0, -1) : list));
        }
        h.onFinish?.();
      }
      return true;
    },
    [consume],
  );

  /**
   * Follow the reply running in this chat, if any: everything so far, then live. Returns false when
   * there's none to follow (it finished a while ago, or never started).
   */
  const follow = useCallback(async (): Promise<boolean> => {
    const id = idRef.current;
    if (id === null || abortRef.current) return true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/chat/conversations/${id}/live`, { signal: ctrl.signal, cache: "no-store" });
      if (res.status === 204 || !res.body) return false;
      interruptedRef.current = false;
      setStreaming(true);
      // The replay sends the whole reply again: start from an empty bubble (replacing a half-shown one).
      setMessages((list) => {
        const last = list.at(-1);
        const base = last?.role === "assistant" && last.id === null ? list.slice(0, -1) : list;
        return [...base, { key: newKey(), id: null, role: "assistant", content: "" }];
      });
      await consume(res.body, null, { gotReply: false });
      return true;
    } catch (err) {
      if (dropped(err)) interruptedRef.current = true;
      return true;
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreaming(false);
      handlersRef.current.onFinish?.();
    }
  }, [consume]);

  // Opening a chat whose reply is still running shows it carrying on.
  useEffect(() => {
    // Started after this render (follow updates state once the server answers).
    const timer = setTimeout(() => void follow(), 0);
    return () => {
      clearTimeout(timer);
      // Leaving the page only stops watching; the reply carries on on the server.
      abortRef.current?.abort();
    };
  }, [follow]);

  // Coming back to the app (phones pause the page when you switch away): pick the reply up again. If
  // it finished long enough ago that the server no longer has it live, reload to show the saved result.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !interruptedRef.current) return;
      void follow().then((found) => {
        if (!found) window.location.reload();
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [follow]);

  const send = useCallback(
    (content: string, { model, think, fileIds, projectId, skillIds, image, pictures, adult }: SendOptions = {}) => {
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
          projectId: first && projectId && !adult ? projectId : undefined,
          adult: first && adult ? true : undefined,
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

  /** Stop the reply: ask the server (it keeps what it has so far); before the chat exists, just let go. */
  const stop = useCallback(() => {
    const id = idRef.current;
    if (id === null) return abortRef.current?.abort();
    void fetch(`/api/chat/conversations/${id}/stop`, { method: "POST" }).catch(() => abortRef.current?.abort());
  }, []);

  return { messages, setMessages, streaming, send, regenerate, resume, stop };
}
