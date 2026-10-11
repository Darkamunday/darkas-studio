// Music albums: private or shared (collaborative), and private songs never shown to others.
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import * as A from "@/lib/albums";
import { assertPlain, makeSong, makeUser } from "./helpers";

const ids = (tracks: A.AlbumTrack[] | undefined) => (tracks ?? []).map((t) => t.id);

test("a private album is the owner's alone, and can hold their private songs", () => {
  const owner = makeUser(), a = makeUser(), b = makeUser();
  const album = A.createAlbum(owner, { name: "Test Private" });
  assertPlain(album);
  const mine = makeSong(owner, { private: true }).trackId;
  const theirsPublic = makeSong(a).trackId;
  const theirsPrivate = makeSong(b, { private: true }).trackId;
  assert.equal(A.addTrack(owner, album.id, mine), "added");
  assert.equal(A.addTrack(owner, album.id, theirsPublic), "added");
  assert.equal(A.addTrack(owner, album.id, theirsPrivate), "not_found");
  assert.equal(A.addTrack(owner, album.id, theirsPublic), "already");
  assert.equal(A.getAlbum(a, album.id), undefined);
  assert.equal(A.albumTracks(a, album.id), undefined);
  assert.equal(A.addTrack(a, album.id, theirsPublic), "not_found");
});

test("shared albums are collaborative, but private songs stay with their maker", () => {
  const owner = makeUser("test_album_owner"), a = makeUser(), b = makeUser(), outsider = makeUser();
  const album = A.createAlbum(owner, { name: "Test Shared", memberIds: [a, b, owner, 999999] });
  assert.deepEqual(album.members.map((p) => p.id).sort(), [a, b].sort());
  const seen = A.getAlbum(a, album.id)!;
  assert.equal(seen.owner, "test_album_owner");
  assert.deepEqual(seen.members, []);
  assert.equal(A.getAlbum(outsider, album.id), undefined);

  const aPublic = makeSong(a).trackId, aPrivate = makeSong(a, { private: true }).trackId, ownerSong = makeSong(owner).trackId;
  assert.equal(A.addTrack(a, album.id, aPublic), "added");
  assert.equal(A.addTrack(a, album.id, aPrivate), "added");
  assert.equal(A.addTrack(owner, album.id, ownerSong), "added");
  assert.ok(!ids(A.albumTracks(b, album.id)).includes(aPrivate));
  assert.equal(A.getAlbum(b, album.id)!.itemCount, 2);
  assert.ok(A.albumTracks(a, album.id)!.find((t) => t.id === aPrivate)!.isPrivate);
  assertPlain(A.albumTracks(a, album.id));
  assertPlain(A.listAlbums(a));
});

test("members remove only what they added; only the owner edits, reorders or deletes", async () => {
  const owner = makeUser(), a = makeUser(), b = makeUser();
  const album = A.createAlbum(owner, { name: "Test", memberIds: [a, b] });
  const aSong = makeSong(a).trackId, ownerSong = makeSong(owner).trackId;
  A.addTrack(a, album.id, aSong);
  A.addTrack(owner, album.id, ownerSong);
  assert.equal(A.removeTrack(b, album.id, aSong), false);
  assert.equal(A.removeTrack(a, album.id, ownerSong), false);
  assert.ok(A.removeTrack(a, album.id, aSong));
  assert.equal(A.updateAlbum(a, album.id, { name: "changed" }), undefined);
  assert.equal(A.moveTrack(a, album.id, ownerSong, "up"), false);
  assert.equal(await A.deleteAlbum(a, album.id), false);
  assert.ok(A.leaveAlbum(b, album.id));
  assert.equal(A.getAlbum(b, album.id), undefined);
  assert.ok(await A.deleteAlbum(owner, album.id));
  assert.ok(db.prepare("SELECT 1 FROM tracks WHERE id = ?").get(ownerSong), "deleting an album keeps its songs");
});

test("order, cover, and songs going to the bin and back", () => {
  const owner = makeUser();
  const album = A.createAlbum(owner, { name: "Order" });
  const [s1, s2, s3] = [makeSong(owner).trackId, makeSong(owner, { cover: true }).trackId, makeSong(owner).trackId];
  for (const t of [s1, s2, s3]) A.addTrack(owner, album.id, t);
  assert.ok(A.moveTrack(owner, album.id, s3, "up"));
  assert.deepEqual(ids(A.albumTracks(owner, album.id)), [s1, s3, s2]);
  assert.equal(A.moveTrack(owner, album.id, s1, "up"), false);
  assert.ok(A.getAlbum(owner, album.id)!.coverUrl!.includes(`/api/media/${s2}/cover`));
  assert.equal(A.updateAlbum(owner, album.id, { coverTrackId: makeSong(owner).trackId })!.coverTrackId, null, "cover must be in the album");

  // The bin deletes the track row and puts it back with the same id.
  db.prepare("CREATE TEMP TABLE kept AS SELECT * FROM tracks WHERE id = ?").run(s1);
  db.prepare("DELETE FROM tracks WHERE id = ?").run(s1);
  assert.ok(!ids(A.albumTracks(owner, album.id)).includes(s1));
  db.prepare("INSERT INTO tracks SELECT * FROM kept").run();
  assert.equal(ids(A.albumTracks(owner, album.id))[0], s1);
});

test("'everyone' albums are open to all; Add-to-album lists the right ones", () => {
  const admin = makeUser("test_admin_al", { admin: true }), a = makeUser(), outsider = makeUser();
  const everyone = A.createAlbum(admin, { name: "Everyone", everyone: true });
  const priv = A.createAlbum(admin, { name: "Mine" });
  assert.ok(A.getAlbum(outsider, everyone.id));
  assert.equal(A.addTrack(outsider, everyone.id, makeSong(outsider).trackId), "added");
  const song = makeSong(a).trackId;
  const choices = A.albumsForTrack(a, song);
  assert.ok(choices.some((c) => c.id === everyone.id && c.shared && !c.has));
  assert.ok(!choices.some((c) => c.id === priv.id));
});
