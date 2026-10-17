import "server-only";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { db, transaction } from "../db";
import { MEDIA_DIR, resolveMediaPath } from "../storage";
import { DEFAULT_MONTHLY_CREDIT_CAP, type Section } from "@/config/video";
import type { SectionSpan } from "./analyse";

// Music videos: who can make them (people an admin switches on), what each is made of, and the credits
// they use. Every query is scoped to the video's owner. Files live in MEDIA_DIR/videos/<id>/.

export const videoDir = (videoId: number) => path.join(MEDIA_DIR, "videos", String(videoId));

// ---- access and credits ----------------------------------------------------------------------

type Flags = { is_admin: number; video_enabled: number; video_credit_cap: number | null };
const flags = (userId: number) =>
  db.prepare("SELECT is_admin, video_enabled, video_credit_cap FROM users WHERE id = ? AND disabled = 0").get(userId) as Flags | undefined;

/** Whoever an admin has switched videos on for — admins included (they can be switched off too). */
export function hasVideoAccess(userId: number): boolean {
  return !!flags(userId)?.video_enabled;
}

export function setVideoEnabled(userId: number, on: boolean) {
  db.prepare("UPDATE users SET video_enabled = ? WHERE id = ?").run(on ? 1 : 0, userId);
}

/** Switch videos on or off for everyone, admins included. */
export function setVideoEnabledForAll(on: boolean) {
  db.prepare("UPDATE users SET video_enabled = ?").run(on ? 1 : 0);
}

/** Blank (null) goes back to the default. */
export function setVideoCreditCap(userId: number, cap: number | null) {
  db.prepare("UPDATE users SET video_credit_cap = ? WHERE id = ?").run(cap, userId);
}

/** This person's monthly credit cap, or null for none (admins). */
export function monthlyCap(userId: number): number | null {
  const f = flags(userId);
  if (!f || f.is_admin) return null;
  return f.video_credit_cap ?? DEFAULT_MONTHLY_CREDIT_CAP;
}

/** Credits used this calendar month (UTC). */
export function creditsThisMonth(userId: number): number {
  return (
    db
      .prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM video_spend WHERE user_id = ? AND created_at >= unixepoch('now', 'start of month')")
      .get(userId) as { n: number }
  ).n;
}

/** Whether spending `credits` more is within this person's monthly cap. */
export function withinCap(userId: number, credits: number): boolean {
  const cap = monthlyCap(userId);
  return cap === null || creditsThisMonth(userId) + credits <= cap;
}

export function recordSpend(userId: number, videoId: number, credits: number, what: string) {
  if (!(credits > 0)) return;
  transaction(() => {
    db.prepare("INSERT INTO video_spend (user_id, video_id, credits, what) VALUES (?, ?, ?, ?)").run(userId, videoId, credits, what);
    db.prepare("UPDATE videos SET credits_spent = credits_spent + ?, updated_at = unixepoch() WHERE id = ?").run(credits, videoId);
  });
}

/** Each person's video access and spend, for the admin page. */
export function videoUsageByUser(): { id: number; username: string; is_admin: number; video_enabled: number; video_credit_cap: number | null; month: number; videos: number }[] {
  return (
    db
      .prepare(
        `SELECT u.id, u.username, u.is_admin, u.video_enabled, u.video_credit_cap,
                COALESCE((SELECT SUM(credits) FROM video_spend s WHERE s.user_id = u.id AND s.created_at >= unixepoch('now', 'start of month')), 0) AS month,
                (SELECT COUNT(*) FROM videos v WHERE v.user_id = u.id) AS videos
           FROM users u WHERE u.disabled = 0 ORDER BY u.is_admin DESC, u.video_enabled DESC, u.username COLLATE NOCASE`,
      )
      .all() as ReturnType<typeof videoUsageByUser>
  ).map((r) => ({ ...r }));
}

// ---- videos ----------------------------------------------------------------------------------

export type VideoStatus = "draft" | "analysing" | "analysed" | "planning" | "plan_ready" | "stills" | "clips" | "assembling" | "done" | "failed";

type VideoRow = {
  id: number;
  user_id: number;
  track_id: number | null;
  audio_path: string | null;
  title: string;
  concept: string | null;
  status: VideoStatus;
  error: string | null;
  duration: number | null;
  bpm: number | null;
  beat_offset: number | null;
  sections: string | null;
  treatment: string | null;
  credits_estimated: number | null;
  credits_spent: number;
  output_path: string | null;
  created_at: number;
  updated_at: number;
};

export type CastMember = { id: number; code: string; name: string; description: string; photoUrl: string | null };

/** A video as the browser sees it. Shared by server and client code. */
export type ClientVideo = {
  id: number;
  title: string;
  concept: string;
  status: VideoStatus;
  error: string | null;
  /** The song it's for: a catalogue song's title, or the uploaded file. */
  song: { trackId: number | null; title: string; audioUrl: string };
  analysis: { duration: number; bpm: number; offset: number; barSeconds: number; sections: SectionSpan[] } | null;
  cast: CastMember[];
  creditsSpent: number;
  createdAt: number;
  updatedAt: number;
};

const getRow = (userId: number, id: number) =>
  db.prepare("SELECT * FROM videos WHERE id = ? AND user_id = ?").get(id, userId) as VideoRow | undefined;

function castOf(videoId: number): CastMember[] {
  return (
    db.prepare("SELECT id, code, name, description, ref_path FROM video_cast WHERE video_id = ? ORDER BY id").all(videoId) as {
      id: number;
      code: string;
      name: string;
      description: string;
      ref_path: string | null;
    }[]
  ).map((c) => ({ id: c.id, code: c.code, name: c.name, description: c.description, photoUrl: c.ref_path ? `/api/videos/${videoId}/cast/${c.id}/photo` : null }));
}

function songOf(v: VideoRow): ClientVideo["song"] {
  if (v.track_id) {
    const t = db.prepare("SELECT title FROM tracks WHERE id = ?").get(v.track_id) as { title: string | null } | undefined;
    return { trackId: v.track_id, title: t?.title ?? "", audioUrl: `/api/media/${v.track_id}` };
  }
  return { trackId: null, title: v.title, audioUrl: `/api/videos/${v.id}/audio` };
}

function toClient(v: VideoRow): ClientVideo {
  const sections = v.sections ? (JSON.parse(v.sections) as SectionSpan[]) : null;
  return {
    id: v.id,
    title: v.title,
    concept: v.concept ?? "",
    status: v.status,
    error: v.error,
    song: songOf(v),
    analysis:
      v.bpm && v.duration && sections
        ? { duration: v.duration, bpm: v.bpm, offset: v.beat_offset ?? 0, barSeconds: Math.round((240 / v.bpm) * 1000) / 1000, sections }
        : null,
    cast: castOf(v.id),
    creditsSpent: Math.round(v.credits_spent * 10) / 10,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}

export function listVideos(userId: number): ClientVideo[] {
  return (db.prepare("SELECT * FROM videos WHERE user_id = ? ORDER BY updated_at DESC, id DESC").all(userId) as VideoRow[]).map(toClient);
}

export function getVideo(userId: number, id: number): ClientVideo | undefined {
  const v = getRow(userId, id);
  return v && toClient(v);
}

/** The file of a video's song: a catalogue song this person can see, or the uploaded track. */
export function songFile(userId: number, id: number): string | null {
  const v = getRow(userId, id);
  if (!v) return null;
  if (v.audio_path) return resolveMediaPath(v.audio_path);
  const t = db
    .prepare(
      `SELECT t.audio_path FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE t.id = ? AND (t.is_private = 0 OR g.user_id = ?)`,
    )
    .get(v.track_id, userId) as { audio_path: string | null } | undefined;
  return t?.audio_path ? resolveMediaPath(t.audio_path) : null;
}

export function uploadedAudioPath(userId: number, id: number): string | null {
  return getRow(userId, id)?.audio_path ?? null;
}

/** The catalogue song a video is for, if any. */
export function videoTrackId(userId: number, id: number): number | null {
  return getRow(userId, id)?.track_id ?? null;
}

/** A catalogue song this person may make a video for (their own, or anyone's public one), with its title. */
export function usableTrack(userId: number, trackId: number): { id: number; title: string | null } | undefined {
  return db
    .prepare(
      `SELECT t.id, t.title FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE t.id = ? AND g.status = 'complete' AND (t.is_private = 0 OR g.user_id = ?)`,
    )
    .get(trackId, userId) as { id: number; title: string | null } | undefined;
}

export type NewCast = { code: string; name: string; description: string; photo?: { data: Buffer; ext: string } };

/** Make a video (with its cast and any photos and uploaded track). */
export async function createVideo(
  userId: number,
  input: { title: string; concept: string; trackId?: number; upload?: { data: Buffer; ext: string }; cast: NewCast[] },
): Promise<ClientVideo> {
  const id = transaction(() => {
    const id = Number(
      db
        .prepare("INSERT INTO videos (user_id, track_id, title, concept) VALUES (?, ?, ?, ?)")
        .run(userId, input.trackId ?? null, input.title, input.concept || null).lastInsertRowid,
    );
    for (const c of input.cast) {
      db.prepare("INSERT INTO video_cast (video_id, code, name, description) VALUES (?, ?, ?, ?)").run(id, c.code, c.name, c.description);
    }
    return id;
  });
  try {
    const dir = videoDir(id);
    await mkdir(dir, { recursive: true });
    if (input.upload) {
      const file = path.join(dir, `track${input.upload.ext}`);
      await writeFile(file, input.upload.data);
      db.prepare("UPDATE videos SET audio_path = ? WHERE id = ?").run(path.relative(MEDIA_DIR, file), id);
    }
    for (const c of input.cast) {
      if (!c.photo) continue;
      const castId = (db.prepare("SELECT id FROM video_cast WHERE video_id = ? AND code = ?").get(id, c.code) as { id: number }).id;
      const file = path.join(dir, `cast-${castId}${c.photo.ext}`);
      await writeFile(file, c.photo.data);
      db.prepare("UPDATE video_cast SET ref_path = ? WHERE id = ?").run(path.relative(MEDIA_DIR, file), castId);
    }
  } catch (err) {
    await deleteVideo(userId, id);
    throw err;
  }
  return getVideo(userId, id)!;
}

/** A cast member's reference photo, for its video's owner. */
export function castPhoto(userId: number, videoId: number, castId: number): string | null {
  if (!getRow(userId, videoId)) return null;
  const c = db.prepare("SELECT ref_path FROM video_cast WHERE id = ? AND video_id = ?").get(castId, videoId) as { ref_path: string | null } | undefined;
  return c?.ref_path ?? null;
}

export function setStatus(id: number, status: VideoStatus, error: string | null = null) {
  db.prepare("UPDATE videos SET status = ?, error = ?, updated_at = unixepoch() WHERE id = ?").run(status, error, id);
}

export function saveAnalysis(id: number, a: { duration: number; bpm: number; offset: number; sections: SectionSpan[] }) {
  db.prepare("UPDATE videos SET duration = ?, bpm = ?, beat_offset = ?, sections = ?, status = 'analysed', error = NULL, updated_at = unixepoch() WHERE id = ?").run(
    a.duration,
    a.bpm,
    a.offset,
    JSON.stringify(a.sections),
    id,
  );
}

/** Delete a video and all its files. */
export async function deleteVideo(userId: number, id: number): Promise<boolean> {
  if (!getRow(userId, id)) return false;
  db.prepare("DELETE FROM videos WHERE id = ? AND user_id = ?").run(id, userId);
  await rm(videoDir(id), { recursive: true, force: true });
  return true;
}

export type { Section };
