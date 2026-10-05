import "server-only";
import { randomInt } from "node:crypto";

// Client for Comfy Cloud's v2 job API (https://docs.comfy.org/api-reference/v2/overview), used to
// make cover art. Needs COMFY_CLOUD_API_KEY (API access is on Comfy's Creator/Pro plans); without
// it the cover feature stays hidden. COMFY_MOCK=1 fakes it locally.

const BASE = (process.env.COMFY_CLOUD_URL ?? "https://cloud.comfy.org").replace(/\/+$/, "");
const KEY = process.env.COMFY_CLOUD_API_KEY;
const MOCK = process.env.COMFY_MOCK === "1";

export const coversEnabled = () => MOCK || Boolean(KEY);

/** Keys into the `covers.errors` messages. */
export type ComfyErrorReason = "not_configured" | "no_credits" | "busy" | "failed" | "generic";

export class ComfyError extends Error {
  constructor(
    public reason: ComfyErrorReason,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!KEY) throw new ComfyError("not_configured");
  const res = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  // Details go to the log; people see a short message in their own language.
  console.error(`[comfy] ${init?.method ?? "GET"} ${path} → ${res.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`);
  if (res.status === 402) throw new ComfyError("no_credits");
  if (res.status === 429) throw new ComfyError("busy");
  throw new ComfyError("generic", `HTTP ${res.status}`);
}

/**
 * Z-Image Turbo text-to-image, from Comfy's own template: a small distilled model (8 steps, cfg 1,
 * no negative prompt), quick and cheap. Square, like the provider's own covers.
 */
function coverWorkflow(prompt: string, seed: number) {
  return {
    "28": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "30": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" } },
    "29": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "27": { class_type: "CLIPTextEncode", inputs: { clip: ["30", 0], text: prompt } },
    "33": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["27", 0] } },
    "11": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["28", 0], shift: 3 } },
    "13": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "3": {
      class_type: "KSampler",
      inputs: {
        model: ["11", 0],
        positive: ["27", 0],
        negative: ["33", 0],
        latent_image: ["13", 0],
        seed,
        steps: 8,
        cfg: 1,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["29", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "darkas-studio-cover" } },
  };
}

type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "canceling" | "canceled" | "failed" | "expired";
  outputs: { type: string; url: string; content_type: string }[];
  error: { code: string; message: string } | null;
};

/** Start a cover; returns the Comfy job id. */
export async function startCover(prompt: string): Promise<string> {
  if (MOCK) return `mock-${Date.now()}`;
  const job = await call<Job>("/api/v2/jobs", {
    method: "POST",
    body: JSON.stringify({ workflow: coverWorkflow(prompt, randomInt(0, 2 ** 31)) }),
  });
  return job.id;
}

export type CoverStatus = { state: "pending" } | { state: "ready"; imageUrl: string } | { state: "failed" };

/** Where a job is. On success, `imageUrl` is a short-lived link to download the image from (no key needed). */
export async function coverStatus(jobId: string): Promise<CoverStatus> {
  if (MOCK) {
    const elapsed = Date.now() - Number(jobId.split("-")[1]);
    return elapsed < 4000 ? { state: "pending" } : { state: "ready", imageUrl: `https://picsum.photos/seed/${jobId}/1024` };
  }
  const job = await call<Job>(`/api/v2/jobs/${encodeURIComponent(jobId)}`);
  if (job.status === "succeeded") {
    const image = job.outputs.find((o) => o.type === "image");
    if (!image) return { state: "failed" };
    return { state: "ready", imageUrl: await signedUrl(image.url) };
  }
  if (job.status === "failed" || job.status === "canceled" || job.status === "expired") {
    console.error(`[comfy] cover job ${jobId} ${job.status}: ${job.error?.code ?? ""} ${job.error?.message ?? ""}`);
    return { state: "failed" };
  }
  return { state: "pending" };
}

/** Output URLs need our key; they redirect to a signed storage URL that doesn't, which we hand to the downloader. */
async function signedUrl(contentUrl: string): Promise<string> {
  const url = contentUrl.startsWith("http") ? contentUrl : `${BASE}${contentUrl}`;
  const res = await fetch(url, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) return new URL(location, url).toString();
  throw new ComfyError("generic", `expected a redirect for ${url}, got HTTP ${res.status}`);
}
