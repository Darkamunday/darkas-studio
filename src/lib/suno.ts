import "server-only";
import { isModel, type SunoModel } from "./models";

// Client for sunoapi.org (https://docs.sunoapi.org). Set SUNO_MOCK=1 to fake
// responses locally without spending credits.

const BASE = process.env.SUNO_API_BASE ?? "https://api.sunoapi.org/api/v1";
const CALLBACK_URL = process.env.SUNO_CALLBACK_URL ?? "https://music.darka-ai.co.uk/api/suno/callback";
const MOCK = process.env.SUNO_MOCK === "1";

export const DEFAULT_MODEL: SunoModel = isModel(process.env.SUNO_DEFAULT_MODEL) ? process.env.SUNO_DEFAULT_MODEL : "V6";

export type SunoTaskStatus =
  | "PENDING"
  | "TEXT_SUCCESS"
  | "FIRST_SUCCESS"
  | "SUCCESS"
  | "CREATE_TASK_FAILED"
  | "GENERATE_AUDIO_FAILED"
  | "CALLBACK_EXCEPTION"
  | "SENSITIVE_WORD_ERROR";

export type SunoClip = {
  id: string;
  audioUrl: string | null;
  streamAudioUrl: string | null;
  imageUrl: string | null;
  prompt: string | null; // lyrics
  title: string | null;
  tags: string | null;
  duration: number | null;
};

export type SunoRecord = {
  status: SunoTaskStatus;
  errorMessage: string | null;
  clips: SunoClip[];
};

/** Keys into the `studioErrors` messages, so the user sees it in their own language. */
export type SunoErrorReason =
  | "not_configured"
  | "bad_key"
  | "busy"
  | "too_long"
  | "no_credits"
  | "rate_limited"
  | "maintenance"
  | "generic";

export class SunoError extends Error {
  constructor(
    public reason: SunoErrorReason,
    public code?: number,
  ) {
    super(reason);
  }
}

const REASONS: Record<number, SunoErrorReason> = {
  401: "bad_key",
  405: "busy",
  413: "too_long",
  429: "no_credits",
  430: "rate_limited",
  455: "maintenance",
};

// The texts shown for these reasons never name the provider; the raw details go to the server log instead.

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.SUNO_API_KEY;
  if (!key) {
    console.error("[suno] SUNO_API_KEY is not set");
    throw new SunoError("not_configured");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as { code: number; msg: string; data: T } | null;
  if (!body) {
    console.error(`[suno] ${path} returned HTTP ${res.status} with no JSON body`);
    throw new SunoError("generic", res.status);
  }
  if (body.code !== 200) {
    console.error(`[suno] ${path} failed: code=${body.code} msg=${body.msg}`);
    throw new SunoError(REASONS[body.code] ?? "generic", body.code);
  }
  return body.data;
}

export type GenerateInput = {
  customMode: boolean;
  instrumental: boolean;
  model: SunoModel;
  prompt?: string; // simple: song description; custom: lyrics
  style?: string;
  title?: string;
};

/** The site's public origin, reachable by the provider's servers (never a LAN address). */
export const PUBLIC_ORIGIN = (process.env.APP_URL ?? new URL(CALLBACK_URL).origin).replace(/\/+$/, "");

export type RemixInput = {
  uploadUrl: string;
  model: SunoModel;
  instrumental: boolean;
  title: string;
  style: string;
  lyrics?: string;
};

/** Re-perform an existing song in a new style, keeping its melody ("Upload and Cover Audio"). */
export async function remix(input: RemixInput): Promise<string> {
  if (MOCK) return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = await call<{ taskId: string }>("/generate/upload-cover", {
    method: "POST",
    body: JSON.stringify({ ...input, callBackUrl: CALLBACK_URL }),
  });
  return data.taskId;
}

export async function generate(input: GenerateInput): Promise<string> {
  if (MOCK) return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const data = await call<{ taskId: string }>("/generate", {
    method: "POST",
    body: JSON.stringify({ ...input, callBackUrl: CALLBACK_URL }),
  });
  return data.taskId;
}

type RawClip = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
const pick = (c: RawClip, ...keys: string[]) => keys.map((k) => str(c[k])).find(Boolean) ?? null;

// The API has used both camelCase and snake_case field names; accept either.
export function normalizeClip(c: RawClip): SunoClip {
  return {
    id: String(c.id),
    audioUrl: pick(c, "audioUrl", "audio_url", "sourceAudioUrl", "source_audio_url"),
    streamAudioUrl: pick(c, "streamAudioUrl", "stream_audio_url", "sourceStreamAudioUrl", "source_stream_audio_url"),
    imageUrl: pick(c, "imageUrl", "image_url", "sourceImageUrl", "source_image_url"),
    prompt: pick(c, "prompt"),
    title: pick(c, "title"),
    tags: pick(c, "tags"),
    duration: typeof c.duration === "number" ? c.duration : null,
  };
}

export async function getRecord(taskId: string): Promise<SunoRecord | null> {
  if (MOCK) return mockRecord(taskId);
  const data = await call<{
    status: SunoTaskStatus;
    errorMessage?: string | null;
    response?: { sunoData?: RawClip[] | null } | null;
  } | null>(`/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
  if (!data) return null;
  return {
    status: data.status,
    errorMessage: data.errorMessage ?? null,
    clips: (data.response?.sunoData ?? []).map(normalizeClip),
  };
}

export type AlignedWord = { word: string; startS: number; endS: number; success: boolean };

/**
 * Word-by-word timings for one take's lyrics. Costs credits (0.5 per call when this was written),
 * so callers keep the result. Words carry the lyrics' own line breaks and [Section] tags.
 */
export async function getTimestampedLyrics(taskId: string, audioId: string): Promise<AlignedWord[]> {
  if (MOCK) {
    const words = ["[Verse]\nMock ", "lyrics ", "for ", "testing\n", "[Chorus]\nLa ", "la ", "la\n"];
    return words.map((word, i) => ({ word, startS: 2 + i * 1.5, endS: 3 + i * 1.5, success: true }));
  }
  const data = await call<{ alignedWords?: AlignedWord[] | null } | null>("/generate/get-timestamped-lyrics", {
    method: "POST",
    body: JSON.stringify({ taskId, audioId }),
  });
  return (data?.alignedWords ?? []).map(({ word, startS, endS, success }) => ({ word, startS, endS, success }));
}

export async function getCredits(): Promise<number> {
  if (MOCK) return 999;
  return call<number>("/generate/credit");
}

// ---- mock ------------------------------------------------------------------

function mockRecord(taskId: string): SunoRecord {
  const started = Number(taskId.split("-")[1]);
  const elapsed = (Date.now() - started) / 1000;
  const sample = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
  const clip = (n: number): SunoClip => ({
    id: `${taskId}-${n}`,
    audioUrl: elapsed > 20 ? sample : null,
    streamAudioUrl: sample,
    imageUrl: `https://picsum.photos/seed/${taskId}${n}/400`,
    prompt: "[Verse]\nMock lyrics for testing\n[Chorus]\nLa la la",
    title: `Mock Song ${n}`,
    tags: "synthpop, dreamy, female vocals",
    duration: 120,
  });
  if (elapsed < 6) return { status: "PENDING", errorMessage: null, clips: [] };
  if (elapsed < 12) return { status: "TEXT_SUCCESS", errorMessage: null, clips: [] };
  if (elapsed < 20) return { status: "FIRST_SUCCESS", errorMessage: null, clips: [clip(1)] };
  return { status: "SUCCESS", errorMessage: null, clips: [clip(1), clip(2)] };
}
