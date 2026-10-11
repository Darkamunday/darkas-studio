// Picture albums: pictures and video made in chat, with their own copy of each file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { db } from "@/lib/db";
import { resolveMediaPath } from "@/lib/storage";
import * as A from "@/lib/albums";
import * as P from "@/lib/picture-albums";
import { assertPlain, makeChatImage, makeConversation, makeSong, makeUser } from "./helpers";

const image = (userId: number, kind: "image" | "video" | "audio" = "image", status = "ready") =>
  makeChatImage(userId, makeConversation(userId), kind, status);
const fileOf = (userId: number, pictureId: number) => resolveMediaPath(P.pictureFile(userId, pictureId)!.file_path);

test("music and picture albums are kept apart", async () => {
  const owner = makeUser();
  const pictures = A.createAlbum(owner, { name: "Pictures", kind: "pictures" });
  const music = A.createAlbum(owner, { name: "Music" });
  assert.deepEqual(A.listAlbums(owner, "pictures").map((x) => x.id), [pictures.id]);
  assert.deepEqual(A.listAlbums(owner, "music").map((x) => x.id), [music.id]);
  const song = makeSong(owner).trackId;
  assert.equal(A.addTrack(owner, pictures.id, song), "not_found");
  assert.ok(!A.albumsForTrack(owner, song).some((c) => c.id === pictures.id));
  const pic = image(owner);
  assert.equal(await P.addPicture(owner, music.id, pic), "not_found");
  assert.ok(!P.albumsForImage(owner, pic).some((c) => c.id === music.id));
});

test("members add their own finished pictures and videos; nothing else", async () => {
  const owner = makeUser(), a = makeUser(), outsider = makeUser();
  const album = A.createAlbum(owner, { name: "Shared Pictures", kind: "pictures", memberIds: [a] });
  assert.equal(await P.addPicture(a, album.id, image(a)), "added");
  assert.equal(await P.addPicture(a, album.id, image(a, "video")), "added");
  assert.equal(await P.addPicture(a, album.id, image(a, "audio")), "not_found");
  assert.equal(await P.addPicture(a, album.id, image(a, "image", "pending")), "not_found");
  assert.equal(await P.addPicture(a, album.id, image(owner)), "not_found", "not someone else's picture");
  assert.equal(await P.addPicture(outsider, album.id, image(outsider)), "not_found");
  const pics = P.albumPictures(a, album.id)!;
  assert.deepEqual(pics.map((p) => p.kind), ["image", "video"]);
  assertPlain(pics);
  assert.equal(P.albumPictures(outsider, album.id), undefined);
  assert.equal(P.pictureFile(outsider, pics[0].id), undefined);
  assert.ok(P.albumsForImage(a, image(a)).some((c) => c.id === album.id && c.shared));
});

test("the album's copy survives the chat being deleted; removing deletes only the copy", async () => {
  const owner = makeUser(), a = makeUser();
  const album = A.createAlbum(owner, { name: "Test", kind: "pictures", memberIds: [a] });
  const pic = image(a);
  assert.equal(await P.addPicture(a, album.id, pic), "added");
  assert.equal(await P.addPicture(a, album.id, pic), "already");
  const original = resolveMediaPath((db.prepare("SELECT file_path FROM chat_images WHERE id = ?").get(pic) as { file_path: string }).file_path);
  const [added] = P.albumPictures(owner, album.id)!;
  rmSync(original);
  db.prepare("DELETE FROM conversations WHERE id = (SELECT conversation_id FROM chat_images WHERE id = ?)").run(pic);
  assert.ok(existsSync(fileOf(owner, added.id)));
  const copy = fileOf(owner, added.id);
  assert.ok(await P.removePicture(a, album.id, added.id));
  assert.ok(!existsSync(copy));
});

test("permissions, order and cover", async () => {
  const owner = makeUser(), a = makeUser();
  const album = A.createAlbum(owner, { name: "Test", kind: "pictures", memberIds: [a] });
  await P.addPicture(a, album.id, image(a));
  await P.addPicture(a, album.id, image(a, "video"));
  await P.addPicture(owner, album.id, image(owner));
  const [p1, p2, p3] = P.albumPictures(owner, album.id)!;
  assert.equal(A.getAlbum(owner, album.id)!.coverUrl, `/api/albums/pictures/${p1.id}`);
  assert.equal(A.getAlbum(owner, album.id)!.itemCount, 3);
  assert.equal(A.updateAlbum(owner, album.id, { coverPictureId: p2.id })!.coverPictureId, null, "a video can't be the cover");
  assert.equal(A.updateAlbum(owner, album.id, { coverPictureId: p3.id })!.coverPictureId, p3.id);
  assert.equal(P.movePicture(a, album.id, p3.id, "up"), false);
  assert.ok(P.movePicture(owner, album.id, p3.id, "up"));
  assert.deepEqual(P.albumPictures(owner, album.id)!.map((p) => p.id), [p1.id, p3.id, p2.id]);
  assert.equal(await P.removePicture(a, album.id, p3.id), false);
  assert.ok(await P.removePicture(owner, album.id, p3.id));
  assert.equal(A.getAlbum(owner, album.id)!.coverPictureId, null, "removing the cover clears it");
});

test("deleting a picture album deletes its copies", async () => {
  const owner = makeUser();
  const album = A.createAlbum(owner, { name: "Test", kind: "pictures" });
  await P.addPicture(owner, album.id, image(owner));
  const copy = fileOf(owner, P.albumPictures(owner, album.id)![0].id);
  assert.ok(await A.deleteAlbum(owner, album.id));
  assert.ok(!existsSync(copy));
});
