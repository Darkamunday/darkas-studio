// Replies as server-side jobs: they carry on without a watcher, replay to whoever connects, and stop only when asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "@/lib/chat/live";
import type { ChatEvent } from "@/lib/chat/events";

async function readAll(stream: ReadableStream<Uint8Array>, max = 100): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  const reader = (stream as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (out.length < max) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    for (let nl; (nl = buf.indexOf("\n")) >= 0; buf = buf.slice(nl + 1)) out.push(JSON.parse(buf.slice(0, nl)));
  }
  return out;
}

test("one reply at a time per chat; owners only", () => {
  const live = L.startLive(1, 101)!;
  assert.ok(live);
  assert.equal(L.startLive(1, 101), null, "a second one waits");
  assert.ok(L.isLive(1, 101));
  assert.ok(!L.isLive(2, 101), "someone else's chat");
  assert.equal(L.watchLive(2, 101), undefined);
  assert.equal(L.stopLive(2, 101), false);
  live.finish();
  assert.ok(!L.isLive(1, 101));
  assert.ok(L.startLive(1, 101), "a new reply can start once it's finished");
});

test("someone opening the chat later gets everything so far, then the rest live", async () => {
  const live = L.startLive(1, 102)!;
  live.send({ type: "delta", text: "Hel" });
  const late = L.watchLive(1, 102)!;
  live.send({ type: "delta", text: "lo" });
  live.finish();
  const events = await readAll(late);
  assert.deepEqual(events.map((e) => (e.type === "delta" ? e.text : e.type)), ["Hel", "lo"]);
});

test("the reply carries on when its watcher goes away", async () => {
  const live = L.startLive(1, 103)!;
  const first = L.watch(live);
  await first.cancel(); // the browser left
  live.send({ type: "delta", text: "still going" });
  assert.ok(!live.signal.aborted);
  const again = L.watchLive(1, 103)!;
  live.finish();
  assert.deepEqual((await readAll(again)).map((e) => e.type), ["delta"]);
});

test("Stop aborts the job; a saved reply isn't offered again (the chat shows it)", () => {
  const live = L.startLive(1, 104)!;
  assert.ok(L.stopLive(1, 104));
  assert.ok(live.signal.aborted);
  live.markSaved();
  assert.equal(L.watchLive(1, 104), undefined);
  assert.ok(L.isLive(1, 104), "still running until it finishes (title, memory)");
  live.finish();
});
