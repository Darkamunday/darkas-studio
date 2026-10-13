import "server-only";
import type { ChatEvent } from "./events";

// Replies run as jobs on the server, not tied to the browser's connection: leaving the chat, switching
// apps on a phone or losing signal doesn't stop them. A job keeps every event it has sent, so whoever
// connects (the browser that started it, or the same chat opened again) gets them all replayed and then
// follows along live. Only Stop (or the server restarting) ends one early. Finished jobs are dropped
// shortly after (the saved chat shows the reply from then on).

const KEEP_FINISHED_MS = 30_000;

export type LiveReply = {
  userId: number;
  conversationId: number;
  /** Aborted by Stop. Model calls and tool loops check it. */
  signal: AbortSignal;
  /** Send an event to everyone watching (and keep it for anyone who connects later). */
  send: (event: ChatEvent) => void;
  /**
   * The reply is saved: from now on, opening the chat shows it from the database, so it's no longer
   * offered to new watchers (that would show it twice). Those already watching carry on.
   */
  markSaved: () => void;
  /** The job is over: close every watcher's stream. */
  finish: () => void;
};

type Job = LiveReply & {
  events: ChatEvent[];
  listeners: Set<(event: ChatEvent | null) => void>;
  done: boolean;
  saved: boolean;
  abort: AbortController;
};

// Survives dev-mode hot reloads (one map per server process; replies don't outlive a restart).
const store = globalThis as unknown as { __liveReplies?: Map<number, Job> };
const jobs = (store.__liveReplies ??= new Map<number, Job>());

/** Start a reply for a chat, or null if one is already running there. */
export function startLive(userId: number, conversationId: number): LiveReply | null {
  const existing = jobs.get(conversationId);
  if (existing && !existing.done) return null;
  const abort = new AbortController();
  const job: Job = {
    userId,
    conversationId,
    signal: abort.signal,
    abort,
    events: [],
    listeners: new Set(),
    done: false,
    saved: false,
    markSaved: () => {
      job.saved = true;
    },
    send: (event) => {
      if (job.done) return;
      job.events.push(event);
      for (const listen of job.listeners) listen(event);
    },
    finish: () => {
      if (job.done) return;
      job.done = true;
      for (const listen of job.listeners) listen(null);
      job.listeners.clear();
      setTimeout(() => {
        if (jobs.get(conversationId) === job) jobs.delete(conversationId);
      }, KEEP_FINISHED_MS).unref?.();
    },
  };
  jobs.set(conversationId, job);
  return job;
}

/** Whether a reply is running (not just recently finished) in one of this person's chats. */
export function isLive(userId: number, conversationId: number): boolean {
  const job = jobs.get(conversationId);
  return !!job && job.userId === userId && !job.done;
}

/** Stop a running reply in one of this person's chats. What it has so far is kept. */
export function stopLive(userId: number, conversationId: number): boolean {
  const job = jobs.get(conversationId);
  if (!job || job.userId !== userId || job.done) return false;
  job.abort.abort();
  return true;
}

/**
 * A stream of a reply's events as NDJSON: everything so far, then live until it finishes. Closing the
 * stream (the browser going away) only stops watching — the reply carries on. Undefined if this person
 * has no reply still being written in that chat (once it's saved, the chat itself shows it).
 */
export function watchLive(userId: number, conversationId: number): ReadableStream<Uint8Array> | undefined {
  const job = jobs.get(conversationId);
  if (!job || job.userId !== userId || job.saved || job.done) return undefined;
  return watch(job);
}

/** The same stream for a job just started (the request that started it watches it). */
export function watch(reply: LiveReply): ReadableStream<Uint8Array> {
  const job = reply as Job;
  const encoder = new TextEncoder();
  let listener: ((event: ChatEvent | null) => void) | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: ChatEvent | null) => {
        try {
          if (event) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          else controller.close();
        } catch {
          // The browser went away: stop watching; the reply carries on.
          if (listener) job.listeners.delete(listener);
        }
      };
      for (const event of job.events) write(event);
      if (job.done) return write(null);
      listener = write;
      job.listeners.add(listener);
    },
    cancel() {
      if (listener) job.listeners.delete(listener);
    },
  });
}

export const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  // Stops proxies (e.g. Nginx) from buffering the stream.
  "X-Accel-Buffering": "no",
};
