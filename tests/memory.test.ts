// Chat memory: the rules for saving, editing and switching it off (not the model's judgement).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as K from "@/lib/chat/memory";
import { systemPrompt } from "@/lib/chat/context";
import { MAX_MEMORIES, MAX_MEMORY_CHARS } from "@/config/chat";
import { assertPlain, makeConversation, makeMessage, makeUser } from "./helpers";

test("saving tidies, refuses empties and near-duplicates, and caps length and count", () => {
  const a = makeUser();
  const first = K.addMemory(a, "  Is writing a concept   album about a lighthouse keeper. ", "model");
  assert.ok(first.ok);
  assert.equal(first.memory.content, "Is writing a concept album about a lighthouse keeper.");
  assertPlain(first.memory);
  assert.equal(K.addMemory(a, "IS WRITING A CONCEPT ALBUM ABOUT A LIGHTHOUSE KEEPER.", "person").ok, false);
  assert.equal(K.addMemory(a, "   ", "person").ok, false);
  assert.ok(K.addMemory(a, "x".repeat(500), "person").ok);
  assert.equal(K.listMemories(a).at(-1)!.content.length, MAX_MEMORY_CHARS);
  for (let i = 0; K.listMemories(a).length < MAX_MEMORIES; i++) K.addMemory(a, `Test fact ${i}`, "person");
  const full = K.addMemory(a, "one too many", "person");
  assert.ok(!full.ok && full.reason === "too_many_memories");
});

test("memories are private to their owner", () => {
  const a = makeUser(), b = makeUser();
  const saved = K.addMemory(a, "Prefers British spelling.", "person");
  assert.ok(saved.ok);
  assert.deepEqual(K.listMemories(b), []);
  assert.equal(K.getMemory(b, saved.memory.id), undefined);
  assert.equal(K.updateMemory(b, saved.memory.id, "changed"), undefined);
  assert.equal(K.deleteMemory(b, saved.memory.id), false);
  assert.equal(K.updateMemory(a, saved.memory.id, "Prefers American spelling.")!.content, "Prefers American spelling.");
});

test("notes under replies are per chat and owner", () => {
  const a = makeUser(), b = makeUser();
  const chat = makeConversation(a);
  const saved = K.addMemory(a, "Plays mostly dark synth-pop.", "model");
  assert.ok(saved.ok);
  K.attachMemoriesToMessage([saved.memory.id], makeMessage(chat, "assistant"));
  assert.deepEqual(K.memoriesSavedIn(a, chat).map((x) => x.id), [saved.memory.id]);
  assert.deepEqual(K.memoriesSavedIn(b, chat), []);
});

test("the personal and app-wide switches; admins only ever see counts", () => {
  const a = makeUser(), b = makeUser(), admin = makeUser("test_admin_m", { admin: true });
  assert.ok(K.memoryActive(a));
  K.setMemoryForUser(a, false);
  assert.ok(!K.memoryActive(a) && K.memoryActive(b));
  K.setMemoryForUser(a, true);
  K.setMemoryForApp(false, admin);
  assert.ok(!K.memoryActive(a) && !K.memoryOnForApp());
  K.setMemoryForApp(true, admin);
  assert.ok(K.memoryActive(a));
  K.addMemory(a, "Test fact.", "person");
  assert.equal(K.memoryCounts().get(a), 1);
  K.deleteAllMemories(a);
  assert.deepEqual(K.listMemories(a), []);
});

test("noticing what to remember applies saves and forgets, and never throws", async () => {
  const a = makeUser(), b = makeUser();
  const old = K.addMemory(a, "Prefers American spelling.", "person");
  const theirs = K.addMemory(b, "Has a test cat.", "person");
  assert.ok(old.ok && theirs.ok);
  const changes = await K.noticeMemories(a, "Actually, I prefer British spelling now.", null, async () =>
    JSON.stringify({ save: ["Prefers British spelling."], forget: [old.memory.id, theirs.memory.id] }),
  );
  assert.deepEqual(changes.map((c) => `${c.action}:${c.memory.content}`), ["forgotten:Prefers American spelling.", "saved:Prefers British spelling."]);
  assert.ok(K.getMemory(b, theirs.memory.id), "can't forget someone else's memory");
  assert.deepEqual(await K.noticeMemories(a, "hello", null, async () => "not json"), []);
  assert.deepEqual(await K.noticeMemories(a, "hello", null, async () => { throw new Error("model down"); }), []);
});

test("the system prompt carries memories only when memory is on", () => {
  const withMemories = systemPrompt({ base: "BASE", memory: { items: [{ id: 7, content: "Prefers British spelling." }] } });
  assert.ok(withMemories.includes("- Prefers British spelling."));
  assert.ok(!systemPrompt({ base: "BASE", memory: null }).toLowerCase().includes("memor"));
});
