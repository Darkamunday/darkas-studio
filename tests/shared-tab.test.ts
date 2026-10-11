// A project's Shared tab: images, songs and pinned replies made in its chats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import * as P from "@/lib/chat/projects";
import * as SH from "@/lib/chat/shared";
import { assertPlain, makeChatImage, makeConversation, makeMessage, makeSong, makeUser } from "./helpers";

// Same rule as getViewableImage in images.ts (which imports Next's auth, so can't load here).
const canSeeImage = (userId: number, id: number) => {
  const row = db.prepare("SELECT * FROM chat_images WHERE id = ?").get(id) as { user_id: number; project_id: number | null; project_hidden: number };
  return row.user_id === userId || SH.canSeeSharedImage(userId, row);
};

function setup() {
  const owner = makeUser(), a = makeUser(), b = makeUser(), outsider = makeUser();
  const p = P.createProject(owner, { name: "Test Project", memberIds: [a, b] });
  return { owner, a, b, outsider, p };
}

test("images made in a project's chats are on its tab; private chats' images aren't", () => {
  const { a, b, outsider, p } = setup();
  const inProject = makeChatImage(a, makeConversation(a, p.id));
  const elsewhere = makeChatImage(a, makeConversation(a, null));
  const tab = SH.listShared(b, p.id)!;
  assert.ok(tab.some((x) => x.kind === "media" && x.id === inProject));
  assert.ok(!tab.some((x) => x.kind === "media" && x.id === elsewhere));
  assert.ok(canSeeImage(b, inProject));
  assert.ok(!canSeeImage(b, elsewhere));
  assert.equal(SH.listShared(outsider, p.id), undefined);
  assert.ok(!canSeeImage(outsider, inProject));
  assertPlain(tab);
});

test("what was shared stays shared if the chat is moved out later", () => {
  const { a, b, p } = setup();
  const chat = makeConversation(a, p.id);
  const img = makeChatImage(a, chat);
  db.prepare("UPDATE conversations SET project_id = NULL WHERE id = ?").run(chat);
  assert.ok(SH.listShared(b, p.id)!.some((x) => x.id === img));
});

test("songs from 'Make it a song' show with only their public takes", () => {
  const { a, b, p } = setup();
  const reply = makeMessage(makeConversation(b, p.id), "assistant");
  assert.equal(SH.projectOfReply(b, reply), p.id);
  assert.equal(SH.projectOfReply(a, reply), null);
  const song = makeSong(b, { projectId: p.id });
  db.prepare("INSERT INTO tracks (generation_id, suno_audio_id, is_private) VALUES (?, 'test-private-take', 1)").run(song.generationId);
  const shown = SH.listShared(a, p.id)!.find((x) => x.kind === "song");
  assert.ok(shown && shown.kind === "song");
  assert.deepEqual(shown.takes.map((t) => t.id), [song.trackId]);
});

test("the maker or the owner can take things off the tab; other members can't", () => {
  const { owner, a, b, p } = setup();
  const song = makeSong(b, { projectId: p.id });
  assert.equal(SH.hideShared(a, p.id, "song", song.generationId), false);
  assert.ok(SH.hideShared(owner, p.id, "song", song.generationId));
  assert.ok(!SH.listShared(a, p.id)!.some((x) => x.kind === "song"));
  const img = makeChatImage(a, makeConversation(a, p.id));
  assert.ok(SH.hideShared(a, p.id, "media", img));
  assert.ok(!canSeeImage(b, img));
  assert.ok(canSeeImage(a, img), "still the maker's own picture");
});

test("people taken off the project drop off its tab", () => {
  const { owner, a, b, p } = setup();
  const img = makeChatImage(b, makeConversation(b, p.id));
  P.updateProject(owner, p.id, { memberIds: [a] });
  assert.ok(!SH.listShared(a, p.id)!.some((x) => x.id === img));
  assert.ok(!canSeeImage(a, img));
});

test("pinned replies: only your own replies in the project, kept if the chat is deleted", () => {
  const { owner, a, b, p } = setup();
  const chat = makeConversation(a, p.id);
  const reply = makeMessage(chat, "assistant", "Verse one draft");
  const question = makeMessage(chat, "user", "a question");
  const elsewhere = makeMessage(makeConversation(a, null), "assistant", "private");
  assert.ok(SH.pinReply(a, reply));
  assert.ok(SH.pinReply(a, reply), "pinning twice is fine");
  assert.equal(SH.pinReply(b, reply), false);
  assert.equal(SH.pinReply(a, question), false);
  assert.equal(SH.pinReply(a, elsewhere), false);
  assert.deepEqual(SH.pinnedReplyIds(a, chat), [reply]);
  const pin = SH.listShared(b, p.id)!.find((x) => x.kind === "reply");
  assert.ok(pin && pin.kind === "reply" && pin.content === "Verse one draft" && !pin.canRemove);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(chat);
  assert.ok(SH.listShared(b, p.id)!.some((x) => x.kind === "reply"));
  assert.ok(SH.hideShared(owner, p.id, "reply", pin.id));
  assert.ok(!SH.listShared(a, p.id)!.some((x) => x.kind === "reply"));
});

test("unpinning, and removed members' pins leaving the tab", () => {
  const { owner, a, b, p } = setup();
  const chat = makeConversation(a, p.id);
  const reply = makeMessage(chat, "assistant", "Chorus idea");
  SH.pinReply(a, reply);
  assert.ok(SH.unpinReply(a, reply));
  assert.deepEqual(SH.pinnedReplyIds(a, chat), []);
  SH.pinReply(a, reply);
  P.updateProject(owner, p.id, { memberIds: [b] });
  assert.ok(!SH.listShared(b, p.id)!.some((x) => x.kind === "reply"));
});
