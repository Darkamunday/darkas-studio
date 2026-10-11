// Pictures attached to chat messages: what's accepted, who can see them, and clean-up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { db } from "@/lib/db";
import { resolveMediaPath } from "@/lib/storage";
import * as U from "@/lib/chat/uploads";
import { assertPlain, makeConversation, makeMessage, makeUser } from "./helpers";

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const fileOf = (userId: number, id: number) => resolveMediaPath(U.getUpload(userId, id)!.file_path);

test("accepts JPEG and PNG by their contents; refuses anything else or too big", async () => {
  const a = makeUser();
  const j = await U.saveUpload(a, jpeg);
  const p = await U.saveUpload(a, png);
  assertPlain(j);
  assert.equal(j.url, `/api/chat/uploads/${j.id}`);
  assert.ok(fileOf(a, j.id).endsWith(".jpg") && existsSync(fileOf(a, j.id)));
  assert.ok(fileOf(a, p.id).endsWith(".png"));
  await assert.rejects(U.saveUpload(a, Buffer.from("<svg>not a picture</svg>")), (e: U.UploadError) => e.reason === "upload_type");
  await assert.rejects(U.saveUpload(a, Buffer.concat([jpeg, Buffer.alloc(6 * 1024 * 1024)])), (e: U.UploadError) => e.reason === "file_too_big");
});

test("only the owner can fetch, send or delete a picture, and it can only be sent once", async () => {
  const a = makeUser(), b = makeUser();
  const u = await U.saveUpload(a, jpeg);
  assert.equal(U.getUpload(b, u.id), undefined);
  assert.ok(U.unsentUploads(a, [u.id]));
  assert.ok(!U.unsentUploads(b, [u.id]));
  assert.ok(!U.unsentUploads(a, [u.id, 999999]));
  assert.equal(await U.deleteUnsent(b, u.id), false);
  const chat = makeConversation(a);
  const msg = makeMessage(chat, "user", "");
  U.claimUploads(a, [u.id], chat, msg);
  assert.ok(!U.unsentUploads(a, [u.id]), "already sent");
  assert.equal(await U.deleteUnsent(a, u.id), false, "sent pictures go with their chat");
  const listed = U.listUploads(a, chat);
  assert.deepEqual(listed.map((x) => x.messageId), [msg]);
  assertPlain(listed);
  assert.deepEqual(U.listUploads(b, chat), []);
});

test("only the latest 3 messages' pictures are sent to the model; the rest are counted for a note", async () => {
  const a = makeUser();
  const chat = makeConversation(a);
  const messages: number[] = [];
  for (let i = 0; i < 4; i++) {
    const up = await U.saveUpload(a, jpeg);
    const msg = makeMessage(chat, "user", "");
    U.claimUploads(a, [up.id], chat, msg);
    messages.push(msg);
  }
  const sent = await U.imagesForPrompt(a, chat);
  assert.ok(!sent.has(messages[0]));
  for (const m of messages.slice(1)) assert.equal(sent.get(m)?.length, 1);
  assert.equal(U.uploadCounts(a, chat).get(messages[0]), 1);
});

test("unsent pictures are cleared after a day, and deleting a chat removes its files", async () => {
  const a = makeUser();
  const old = await U.saveUpload(a, jpeg);
  const oldFile = fileOf(a, old.id);
  db.prepare("UPDATE chat_uploads SET created_at = unixepoch() - 90000 WHERE id = ?").run(old.id);
  await U.saveUpload(a, jpeg); // uploading prunes
  assert.equal(U.getUpload(a, old.id), undefined);
  assert.ok(!existsSync(oldFile));

  const chat = makeConversation(a);
  const sent = await U.saveUpload(a, jpeg);
  U.claimUploads(a, [sent.id], chat, makeMessage(chat, "user", ""));
  const sentFile = fileOf(a, sent.id);
  await U.removeConversationUploads(a, chat);
  assert.ok(!existsSync(sentFile));
});
