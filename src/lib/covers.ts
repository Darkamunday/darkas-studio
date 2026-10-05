import "server-only";
import { coverStatus, startCover } from "./comfy";
import { db } from "./db";
import { COVER_DIR, downloadTo, removeMediaFile } from "./storage";

// Creator-only AI cover art: start a job, poll it, then apply or discard the result.
// Nothing changes on the track until its creator picks an image.

export { COVER_PROMPT_MAX } from "./cover-url";
const TIMEOUT_SECONDS = 5 * 60;

type CoverJob = {
  id: number;
  track_id: number;
  user_id: number;
  comfy_job_id: string;
  prompt: string;
  status: "pending" | "ready" | "failed" | "applied" | "discarded";
  image_path: string | null;
  created_at: number;
};

const getJob = (id: number) => db.prepare("SELECT * FROM cover_jobs WHERE id = ?").get(id) as CoverJob | undefined;

/** The live track, if this user made it. */
function ownedTrack(userId: number, trackId: number) {
  return db
    .prepare(
      `SELECT t.id, t.image_path FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE t.id = ? AND g.user_id = ? AND g.status = 'complete'`,
    )
    .get(trackId, userId) as { id: number; image_path: string | null } | undefined;
}

/** Drop earlier attempts for this track that were never used, files and all. */
async function clearUnused(userId: number, trackId: number) {
  const old = db
    .prepare("SELECT id, image_path FROM cover_jobs WHERE user_id = ? AND track_id = ? AND status IN ('ready', 'failed', 'discarded')")
    .all(userId, trackId) as { id: number; image_path: string | null }[];
  for (const j of old) {
    db.prepare("DELETE FROM cover_jobs WHERE id = ?").run(j.id);
    if (j.image_path) await removeMediaFile(j.image_path);
  }
}

export type StartResult = { ok: true; jobId: number } | { ok: false; reason: "forbidden" | "busy" };

export async function startCoverJob(userId: number, trackId: number, prompt: string): Promise<StartResult> {
  if (!ownedTrack(userId, trackId)) return { ok: false, reason: "forbidden" };
  // One at a time per person keeps a runaway click from spending GPU time.
  const pending = db
    .prepare("SELECT COUNT(*) AS n FROM cover_jobs WHERE user_id = ? AND status = 'pending' AND created_at > unixepoch() - ?")
    .get(userId, TIMEOUT_SECONDS) as { n: number };
  if (pending.n > 0) return { ok: false, reason: "busy" };

  await clearUnused(userId, trackId);
  // Throws ComfyError; the caller turns it into a message.
  // "Album cover" wording makes the model draw a frame round the picture; this keeps it full-bleed.
  const comfyJobId = await startCover(`Full-bleed artwork filling the whole frame, edge to edge. ${prompt}`);
  const r = db
    .prepare("INSERT INTO cover_jobs (track_id, user_id, comfy_job_id, prompt) VALUES (?, ?, ?, ?)")
    .run(trackId, userId, comfyJobId, prompt);
  return { ok: true, jobId: Number(r.lastInsertRowid) };
}

export type JobView = { status: "pending" | "ready" | "failed"; previewUrl: string | null };

/** Check on a job (and fetch the image once it's done). Only its creator may. */
export async function checkCoverJob(userId: number, jobId: number): Promise<JobView | null> {
  const job = getJob(jobId);
  if (!job || job.user_id !== userId) return null;
  if (job.status === "pending") {
    if (Date.now() / 1000 - job.created_at > TIMEOUT_SECONDS) {
      db.prepare("UPDATE cover_jobs SET status = 'failed' WHERE id = ?").run(job.id);
      return { status: "failed", previewUrl: null };
    }
    const s = await coverStatus(job.comfy_job_id);
    if (s.state === "failed") {
      db.prepare("UPDATE cover_jobs SET status = 'failed' WHERE id = ?").run(job.id);
      return { status: "failed", previewUrl: null };
    }
    if (s.state === "pending") return { status: "pending", previewUrl: null };
    const path = await downloadTo(s.imageUrl, COVER_DIR, `ai-${job.id}`, ".png");
    db.prepare("UPDATE cover_jobs SET status = 'ready', image_path = ? WHERE id = ? AND status = 'pending'").run(path, job.id);
    return { status: "ready", previewUrl: `/api/cover-jobs/${job.id}/image` };
  }
  if (job.status === "ready") return { status: "ready", previewUrl: `/api/cover-jobs/${job.id}/image` };
  return { status: "failed", previewUrl: null };
}

/** Make a finished image the track's cover. The old cover file is removed. */
export async function applyCoverJob(userId: number, jobId: number): Promise<boolean> {
  const job = getJob(jobId);
  if (!job || job.user_id !== userId || job.status !== "ready" || !job.image_path) return false;
  const track = ownedTrack(userId, job.track_id);
  if (!track) return false;

  db.prepare("UPDATE tracks SET image_path = ? WHERE id = ?").run(job.image_path, track.id);
  db.prepare("UPDATE cover_jobs SET status = 'applied' WHERE id = ?").run(job.id);
  if (track.image_path && track.image_path !== job.image_path) await removeMediaFile(track.image_path);
  await clearUnused(userId, track.id);
  return true;
}

export async function discardCoverJob(userId: number, jobId: number): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.user_id !== userId || job.status === "applied") return;
  db.prepare("UPDATE cover_jobs SET status = 'discarded' WHERE id = ?").run(job.id);
  await clearUnused(userId, job.track_id);
}

/** For the preview route: a finished, unused image this user made. */
export function previewPath(userId: number, jobId: number): string | null {
  const job = getJob(jobId);
  return job && job.user_id === userId && job.status === "ready" ? job.image_path : null;
}
