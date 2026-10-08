import "server-only";
import path from "node:path";
import { randomInt } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { db } from "../db";
import { ComfyMcpError, callTool, type ToolResult } from "../comfy-mcp";
import { COVER_DIR, MEDIA_DIR, downloadTo, removeMediaFile, resolveMediaPath } from "../storage";
import { chatDay } from "./access";
import { DEFAULT_IMAGE_DAILY_CAP, IMAGE_ASPECTS, findImageModel, type ImageAspect } from "@/config/images";

// Images in chat, made on Comfy Cloud through its MCP server. A row is written as soon as one is
// asked for (status 'pending'); the job runs in the background, and the file is copied into
// MEDIA_DIR/chat-images when it's done (Comfy's download links expire after a few minutes).

export const CHAT_IMAGE_DIR = path.join(MEDIA_DIR, "chat-images");
const MAX_WAIT_MS = 6 * 60_000;

type ImageRow = {
  id: number;
  user_id: number;
  conversation_id: number;
  message_id: number | null;
  prompt: string;
  model: string;
  aspect: string;
  status: "pending" | "ready" | "failed";
  comfy_job_id: string | null;
  file_path: string | null;
  error: string | null;
  created_at: number;
};

/** An image as the browser sees it. Shared by server and client code. */
export type ClientImage = {
  id: number;
  messageId: number | null;
  status: "pending" | "ready" | "failed";
  prompt: string;
  model: string;
  aspect: string;
  url: string | null;
  error: string | null;
};

export const toClientImage = (r: ImageRow): ClientImage => ({
  id: r.id,
  messageId: r.message_id,
  status: r.status,
  prompt: r.prompt,
  model: r.model,
  aspect: r.aspect,
  url: r.status === "ready" ? `/api/chat/images/${r.id}/file` : null,
  error: r.error,
});

const getRow = (id: number) => db.prepare("SELECT * FROM chat_images WHERE id = ?").get(id) as ImageRow | undefined;

/** One of this person's images. */
export function getImage(userId: number, id: number): ImageRow | undefined {
  const row = getRow(id);
  return row && row.user_id === userId ? row : undefined;
}

export function listImages(userId: number, conversationId: number): ClientImage[] {
  return (
    db
      .prepare("SELECT * FROM chat_images WHERE user_id = ? AND conversation_id = ? ORDER BY id")
      .all(userId, conversationId) as ImageRow[]
  ).map(toClientImage);
}

/** Tie images to the assistant message they were made for, once it's saved. */
export function attachImagesToMessage(imageIds: number[], messageId: number) {
  for (const id of imageIds) db.prepare("UPDATE chat_images SET message_id = ? WHERE id = ?").run(messageId, id);
}

// ---- access and the daily cap -------------------------------------------------------

type ImageFlags = { is_admin: number; chat_enabled: number; image_enabled: number; image_daily_cap: number | null };
const flags = (userId: number) =>
  db.prepare("SELECT is_admin, chat_enabled, image_enabled, image_daily_cap FROM users WHERE id = ?").get(userId) as
    | ImageFlags
    | undefined;

/** Admins always; others when an admin has switched images on for them (and they have chat). */
export function hasImageAccess(userId: number): boolean {
  const f = flags(userId);
  return !!f && (!!f.is_admin || (!!f.image_enabled && !!f.chat_enabled));
}

/** Daily image cap, or null for none (admins). */
export function imageCapFor(userId: number): number | null {
  const f = flags(userId);
  if (!f || f.is_admin) return null;
  return f.image_daily_cap ?? DEFAULT_IMAGE_DAILY_CAP;
}

export function imagesToday(userId: number): number {
  const row = db.prepare("SELECT count FROM image_usage WHERE user_id = ? AND day = ?").get(userId, chatDay()) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

/** Whether this person can make one more image right now. */
export function canMakeImage(userId: number): boolean {
  if (!hasImageAccess(userId)) return false;
  const cap = imageCapFor(userId);
  return cap === null || imagesToday(userId) < cap;
}

// ---- making one -------------------------------------------------------------------------

/** Z-Image Turbo, from Comfy's own template (8 steps, cfg 1, no negative prompt) — as covers use. */
function zImageWorkflow(prompt: string, width: number, height: number) {
  const meta = (title: string) => ({ _meta: { title } });
  return {
    "28": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }, ...meta("Model") },
    "30": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" }, ...meta("Text encoder") },
    "29": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" }, ...meta("VAE") },
    "27": { class_type: "CLIPTextEncode", inputs: { clip: ["30", 0], text: prompt }, ...meta("Prompt") },
    "33": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["27", 0] }, ...meta("Negative") },
    "11": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["28", 0], shift: 3 }, ...meta("Sampling") },
    "13": { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 }, ...meta("Size") },
    "3": {
      class_type: "KSampler",
      inputs: {
        model: ["11", 0],
        positive: ["27", 0],
        negative: ["33", 0],
        latent_image: ["13", 0],
        seed: randomInt(0, 2 ** 31),
        steps: 8,
        cfg: 1,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1,
      },
      ...meta("Sampler"),
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["29", 0] }, ...meta("Decode") },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "darkas-studio-chat" }, ...meta("Save") },
  };
}

/** A value under `key` anywhere in a tool's structured result. */
function find(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj) return (obj as Record<string, unknown>)[key];
  for (const v of Object.values(obj)) {
    const hit = find(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const firstUrl = (r: ToolResult) => (find(r.structured, "results") as { url?: string }[] | undefined)?.[0]?.url;

function check(r: ToolResult, what: string): ToolResult {
  if (r.isError) {
    console.error(`[images] ${what} refused: ${r.text.slice(0, 500)}`);
    throw new ComfyMcpError(/credit|balance|insufficient/i.test(r.text) ? "no_credits" : "rejected", r.text.slice(0, 200));
  }
  return r;
}

/** Start the job on Comfy; returns its prompt_id, or a direct URL for models that answer at once. */
async function submit(row: ImageRow): Promise<{ jobId: string | null; url: string | null }> {
  const model = findImageModel(row.model);
  const size = IMAGE_ASPECTS[row.aspect as ImageAspect] ?? IMAGE_ASPECTS.square;
  if (!model) throw new ComfyMcpError("rejected", `unknown model ${row.model}`);
  const result =
    model.kind === "workflow"
      ? check(await callTool("submit_workflow", { workflow: zImageWorkflow(row.prompt, size.width, size.height) }), "submit_workflow")
      : // The person asked for this image (and the daily cap limits how many), which is the go-ahead
        // Comfy's spend gate asks for.
        check(
          await callTool(
            "partner_generate",
            {
              type: "image",
              model: model.slug,
              prompt: row.prompt,
              aspect_ratio: size.ratio,
              params: model.params ?? {},
              confirm: true,
              // Required by partner_generate (it shapes the download commands it returns; we use the URL).
              client_os: "linux",
            },
            120_000,
          ),
          "partner_generate",
        );
  const jobId = find(result.structured, "prompt_id");
  return { jobId: typeof jobId === "string" ? jobId : null, url: firstUrl(result) ?? null };
}

/** Wait for a job, then return its download URL. */
async function awaitOutput(jobId: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const w = check(await callTool("wait_for_job", { prompt_id: jobId, max_wait_seconds: 60 }, 90_000), "wait_for_job");
    const status = find(w.structured, "job_status") ?? (find(w.structured, "timed_out") ? "in_progress" : undefined);
    if (status === "completed") {
      const out = check(await callTool("get_output", { prompt_id: jobId, client_os: "linux", inline_urls: false }), "get_output");
      const url = firstUrl(out);
      if (url) return url;
      throw new ComfyMcpError("generic", "no output URL");
    }
    if (status === "error" || status === "cancelled") throw new ComfyMcpError("generic", `job ${status}`);
  }
  throw new ComfyMcpError("generic", "timed out");
}

const running = new Map<number, Promise<ClientImage>>();

async function run(id: number): Promise<ClientImage> {
  const row = getRow(id)!;
  try {
    const { jobId, url: direct } = await submit(row);
    if (jobId) db.prepare("UPDATE chat_images SET comfy_job_id = ? WHERE id = ?").run(jobId, id);
    const url = direct ?? (jobId ? await awaitOutput(jobId) : null);
    if (!url) throw new ComfyMcpError("generic", "no job id or URL");
    const file = await downloadTo(url, CHAT_IMAGE_DIR, `img-${id}`, ".png");
    db.prepare("UPDATE chat_images SET status = 'ready', file_path = ? WHERE id = ?").run(file, id);
    // Comfy bills a job a little after it finishes; pick up what it used then.
    if (jobId)
      setTimeout(() => {
        lastReconcile = 0;
        void reconcileUsage().catch(() => {});
      }, 45_000).unref?.();
  } catch (err) {
    const reason = err instanceof ComfyMcpError ? err.reason : "generic";
    if (!(err instanceof ComfyMcpError)) console.error(`[images] image ${id} failed`, err);
    db.prepare("UPDATE chat_images SET status = 'failed', error = ? WHERE id = ?").run(reason, id);
  } finally {
    running.delete(id);
  }
  return toClientImage(getRow(id)!);
}

/**
 * Ask for an image: records it (and counts it against today's allowance) and starts it in the
 * background. `done` settles when it's ready or has failed — it keeps going even if nobody waits.
 */
export function startImage(input: {
  userId: number;
  conversationId: number;
  prompt: string;
  modelId: string;
  aspect: ImageAspect;
}): { image: ClientImage; done: Promise<ClientImage> } {
  const id = Number(
    db
      .prepare("INSERT INTO chat_images (user_id, conversation_id, prompt, model, aspect) VALUES (?, ?, ?, ?, ?)")
      .run(input.userId, input.conversationId, input.prompt, input.modelId, input.aspect).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO image_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1`,
  ).run(input.userId, chatDay());
  const done = run(id);
  running.set(id, done);
  return { image: toClientImage(getRow(id)!), done };
}

/** A pending image's progress (a server restart mid-job leaves it pending: give up after the wait limit). */
export function imageStatus(userId: number, id: number): ClientImage | undefined {
  const row = getImage(userId, id);
  if (!row) return undefined;
  if (row.status === "pending" && !running.has(id) && Date.now() / 1000 - row.created_at > MAX_WAIT_MS / 1000) {
    db.prepare("UPDATE chat_images SET status = 'failed', error = 'generic' WHERE id = ?").run(id);
    return toClientImage(getRow(id)!);
  }
  return toClientImage(row);
}

/** Before a chat is deleted: remove its image files (the rows go with the chat). */
export async function removeConversationImages(userId: number, conversationId: number) {
  const rows = db
    .prepare("SELECT file_path FROM chat_images WHERE user_id = ? AND conversation_id = ? AND file_path IS NOT NULL")
    .all(userId, conversationId) as { file_path: string }[];
  for (const r of rows) await removeMediaFile(r.file_path);
}

// ---- what it cost -------------------------------------------------------------------------

let lastReconcile = 0;

/**
 * Fill in what recent jobs used from Comfy's billing feed: GPU seconds for our own workflows,
 * credits for partner models. Safe to call any time; does nothing when all are known.
 */
export async function reconcileUsage() {
  // At most once a minute: the admin page calls this on every render (including after each click).
  if (Date.now() - lastReconcile < 60_000) return;
  lastReconcile = Date.now();
  const open = db
    .prepare(
      `SELECT id, comfy_job_id FROM chat_images
        WHERE comfy_job_id IS NOT NULL AND gpu_seconds IS NULL AND credits IS NULL AND created_at > unixepoch() - 3 * 86400`,
    )
    .all() as { id: number; comfy_job_id: string }[];
  if (!open.length) return;
  const r = await callTool("get_billing_activity", { limit: 100 });
  // The feed is text with a JSON copy on its last line.
  const json = r.text.split("\n").reverse().find((l) => l.trim().startsWith("{"));
  if (!json) return;
  const events = (JSON.parse(json) as { events?: { params?: { job_id?: string; gpu_seconds?: number; credits_used?: number } }[] }).events ?? [];
  const byJob = new Map(events.map((e) => [e.params?.job_id, e.params]));
  for (const img of open) {
    const p = byJob.get(img.comfy_job_id);
    if (p && (p.gpu_seconds !== undefined || p.credits_used !== undefined)) {
      db.prepare("UPDATE chat_images SET gpu_seconds = ?, credits = ? WHERE id = ?").run(p.gpu_seconds ?? null, p.credits_used ?? null, img.id);
    }
  }
}

// ---- use as a song cover -------------------------------------------------------------------

/** This person's finished songs, newest first (for "Use as cover"). */
export function ownTracks(userId: number): { id: number; title: string | null }[] {
  return db
    .prepare(
      `SELECT t.id, t.title FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE g.user_id = ? AND g.status = 'complete' ORDER BY t.created_at DESC, t.id DESC LIMIT 200`,
    )
    .all(userId) as { id: number; title: string | null }[];
}

/** Make a chat image the cover of one of this person's songs. A copy goes into covers/, so the two stay independent. */
export async function setImageAsCover(userId: number, imageId: number, trackId: number): Promise<boolean> {
  const image = getImage(userId, imageId);
  if (!image || image.status !== "ready" || !image.file_path) return false;
  const track = db
    .prepare(
      `SELECT t.id, t.image_path FROM tracks t JOIN generations g ON g.id = t.generation_id
        WHERE t.id = ? AND g.user_id = ? AND g.status = 'complete'`,
    )
    .get(trackId, userId) as { id: number; image_path: string | null } | undefined;
  if (!track) return false;

  await mkdir(COVER_DIR, { recursive: true });
  const target = path.join(COVER_DIR, `chat-${imageId}-${Date.now()}${path.extname(image.file_path)}`);
  await copyFile(resolveMediaPath(image.file_path), target);
  db.prepare("UPDATE tracks SET image_path = ? WHERE id = ?").run(path.relative(MEDIA_DIR, target), track.id);
  if (track.image_path) await removeMediaFile(track.image_path);
  return true;
}

// ---- admin figures ----------------------------------------------------------------------

export type ImageUserRow = {
  id: number;
  username: string;
  is_admin: number;
  image_enabled: number;
  image_daily_cap: number | null;
  today: number;
  month: number;
  gpu_seconds: number;
  credits: number;
};

/** Per person: image access, today's count and this month's images and usage. */
export function imageUsageByUser(): ImageUserRow[] {
  const month = `${chatDay().slice(0, 8)}01`;
  const monthStart = Math.floor(Date.parse(`${month}T00:00:00Z`) / 1000);
  return db
    .prepare(
      `SELECT u.id, u.username, u.is_admin, u.image_enabled, u.image_daily_cap,
              COALESCE((SELECT count FROM image_usage iu WHERE iu.user_id = u.id AND iu.day = :today), 0) AS today,
              (SELECT COUNT(*) FROM chat_images ci WHERE ci.user_id = u.id AND ci.created_at >= :start) AS month,
              COALESCE((SELECT SUM(gpu_seconds) FROM chat_images ci WHERE ci.user_id = u.id AND ci.created_at >= :start), 0) AS gpu_seconds,
              COALESCE((SELECT SUM(credits) FROM chat_images ci WHERE ci.user_id = u.id AND ci.created_at >= :start), 0) AS credits
         FROM users u
        ORDER BY u.is_admin DESC, u.image_enabled DESC, month DESC, u.username COLLATE NOCASE`,
    )
    .all({ today: chatDay(), start: monthStart }) as ImageUserRow[];
}

let monthSpend: { at: number; value: number | null } | null = null;

/**
 * The Comfy account's spend so far this month, in dollars — everything on that account, not just chat.
 * Null if unavailable. Kept for 5 minutes so admin clicks (which re-render the page) stay quick.
 */
export async function comfyAccountMonthSpend(): Promise<number | null> {
  if (monthSpend && Date.now() - monthSpend.at < 5 * 60_000) return monthSpend.value;
  let value: number | null = null;
  try {
    const r = await callTool("get_usage_report", { group_by: "product", granularity: "month", months: 1 }, 8_000);
    const match = /Total spend[^$]*\$([\d,]+(?:\.\d+)?)/.exec(r.text);
    value = match ? Number(match[1].replace(/,/g, "")) : null;
  } catch {}
  monthSpend = { at: Date.now(), value };
  return value;
}
