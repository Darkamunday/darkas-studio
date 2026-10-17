// Music videos: who can make them, credit caps, and making and deleting videos with their files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolveMediaPath } from "@/lib/storage";
import * as V from "@/lib/video/store";
import { DEFAULT_MONTHLY_CREDIT_CAP } from "@/config/video";
import { assertPlain, makeSong, makeUser } from "./helpers";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

test("off by default and switched per person — admins included; all on or off at once", () => {
  const a = makeUser(), admin = makeUser("test_admin_v", { admin: true });
  assert.equal(V.hasVideoAccess(a), false);
  assert.equal(V.hasVideoAccess(admin), false, "admins need the switch too");
  V.setVideoEnabled(a, true);
  V.setVideoEnabled(admin, true);
  assert.ok(V.hasVideoAccess(a) && V.hasVideoAccess(admin));
  V.setVideoEnabled(admin, false);
  assert.equal(V.hasVideoAccess(admin), false, "an admin can be switched off");
  V.setVideoEnabledForAll(true);
  assert.ok(V.hasVideoAccess(a) && V.hasVideoAccess(admin));
  V.setVideoEnabledForAll(false);
  assert.ok(!V.hasVideoAccess(a) && !V.hasVideoAccess(admin));
});

test("monthly credit caps: default, personal, none for admins", () => {
  const a = makeUser(), admin = makeUser("test_admin_v2", { admin: true });
  assert.equal(V.monthlyCap(a), DEFAULT_MONTHLY_CREDIT_CAP);
  assert.equal(V.monthlyCap(admin), null);
  V.setVideoCreditCap(a, 100);
  assert.equal(V.monthlyCap(a), 100);
  const video = V.createVideo(a, { title: "Test Video", concept: "", trackId: makeSong(a).trackId, cast: [{ code: "A", name: "Test A", description: "test" }] });
  return video.then((v) => {
    assert.ok(V.withinCap(a, 100));
    V.recordSpend(a, v.id, 60, "stills");
    assert.equal(V.creditsThisMonth(a), 60);
    assert.ok(V.withinCap(a, 40) && !V.withinCap(a, 41));
    assert.equal(V.getVideo(a, v.id)!.creditsSpent, 60);
    assert.ok(V.withinCap(admin, 1e9));
  });
});

test("which songs a video can be for", () => {
  const a = makeUser(), b = makeUser();
  assert.ok(V.usableTrack(a, makeSong(a, { private: true }).trackId), "own private song");
  assert.ok(V.usableTrack(a, makeSong(b).trackId), "someone's public song");
  assert.equal(V.usableTrack(a, makeSong(b, { private: true }).trackId), undefined, "not someone's private song");
});

test("making a video with an uploaded track and cast photos; owner-only; deleting removes its files", async () => {
  const a = makeUser(), b = makeUser();
  const video = await V.createVideo(a, {
    title: "Test Video",
    concept: "A test concept",
    upload: { data: Buffer.from("not really audio"), ext: ".mp3" },
    cast: [
      { code: "V", name: "Test Violinist", description: "test description", photo: { data: png, ext: ".png" } },
      { code: "P", name: "Test Piper", description: "test description" },
    ],
  });
  assertPlain(video);
  assert.equal(video.song.trackId, null);
  assert.equal(video.song.audioUrl, `/api/videos/${video.id}/audio`);
  assert.deepEqual(video.cast.map((c) => [c.code, !!c.photoUrl]), [["V", true], ["P", false]]);
  const photo = V.castPhoto(a, video.id, video.cast[0].id)!;
  assert.ok(existsSync(resolveMediaPath(photo)));
  assert.equal(V.castPhoto(b, video.id, video.cast[0].id), null);
  assert.equal(V.getVideo(b, video.id), undefined);
  assert.deepEqual(V.listVideos(b), []);
  assert.equal(await V.deleteVideo(b, video.id), false);
  assert.ok(await V.deleteVideo(a, video.id));
  assert.ok(!existsSync(V.videoDir(video.id)));
});

test("analysis results are saved and shown", async () => {
  const a = makeUser();
  const v = await V.createVideo(a, { title: "Test", concept: "", trackId: makeSong(a).trackId, cast: [{ code: "A", name: "Test A", description: "x" }] });
  V.saveAnalysis(v.id, { duration: 120, bpm: 128.7, offset: 0.05, sections: [{ label: "intro", start: 0, end: 120 }] });
  const got = V.getVideo(a, v.id)!;
  assert.equal(got.status, "analysed");
  assert.deepEqual(got.analysis, { duration: 120, bpm: 128.7, offset: 0.05, barSeconds: 1.865, sections: [{ label: "intro", start: 0, end: 120 }] });
});
