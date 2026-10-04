"use server";

import * as z from "zod";
import { requireUser, type User } from "@/lib/auth";
import { MODELS, SIMPLE_PROMPT_MAX, TITLE_MAX, limitsFor } from "@/lib/models";
import { canRemix, getRemixSource, remixSourceUrl } from "@/lib/remix";
import { DEFAULT_MODEL, generate, remix, SunoError, type GenerateInput, type RemixInput } from "@/lib/suno";
import { MAX_IN_FLIGHT_PER_USER, MOODS, canViewTrack, inFlightCount, insertGeneration } from "@/lib/tracks";
import { fmt } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n/server";

export type GenerateState =
  | { ok: true; generationId: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  | undefined;

// Form submissions encode newlines as \r\n; store and send plain \n.
const text = () => z.string().transform((s) => s.replace(/\r\n?/g, "\n").trim());

type Errors = Messages["generate"]["errors"];

const invalid = (e: Errors, error: z.ZodError): GenerateState => ({
  ok: false,
  error: e.checkFields,
  fieldErrors: z.flattenError(error).fieldErrors,
});

/** Shared tail of both modes: rate-limit, call Suno, record the generation. */
async function submit(
  m: Messages,
  user: User,
  input: GenerateInput | ({ kind: "remix" } & RemixInput),
  record: Omit<Parameters<typeof insertGeneration>[0], "userId" | "taskId" | "instrumental" | "model">,
): Promise<GenerateState> {
  if (inFlightCount(user.id) >= MAX_IN_FLIGHT_PER_USER) {
    return { ok: false, error: fmt(m.generate.errors.tooMany, { n: MAX_IN_FLIGHT_PER_USER }) };
  }

  let taskId: string;
  try {
    if ("kind" in input) {
      // `kind` is our routing marker only — don't send it to the API.
      const { kind, ...remixInput } = input;
      void kind;
      taskId = await remix(remixInput);
    } else {
      taskId = await generate(input);
    }
  } catch (err) {
    if (err instanceof SunoError) return { ok: false, error: m.studioErrors[err.reason] };
    console.error("[generate] unexpected error", err);
    return { ok: false, error: m.generate.errors.unexpected };
  }

  const generationId = insertGeneration({
    ...record,
    userId: user.id,
    taskId,
    instrumental: input.instrumental,
    model: input.model,
  });
  return { ok: true, generationId };
}

// ---- simple ------------------------------------------------------------------

const simpleSchema = (e: Errors) =>
  z.object({
    prompt: text().pipe(
      z
        .string()
        .min(3, { error: e.tellMore })
        .max(SIMPLE_PROMPT_MAX, { error: fmt(e.maxChars, { n: SIMPLE_PROMPT_MAX }) }),
    ),
    instrumental: z.boolean(),
    mood: z.enum(MOODS).nullable(),
    isPrivate: z.boolean(),
  });

export async function generateSimple(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const parsed = simpleSchema(m.generate.errors).safeParse({
    prompt: formData.get("prompt"),
    instrumental: formData.get("instrumental") === "on",
    mood: formData.get("mood") || null,
    isPrivate: formData.get("private") === "on",
  });
  if (!parsed.success) return invalid(m.generate.errors, parsed.error);

  const { prompt, instrumental, mood, isPrivate } = parsed.data;
  return submit(
    m,
    user,
    { customMode: false, instrumental, model: DEFAULT_MODEL, prompt },
    { mode: "simple", prompt, mood, isPrivate },
  );
}

// ---- advanced ----------------------------------------------------------------

const advancedSchema = (e: Errors) =>
  z
    .object({
      title: z
        .string()
        .trim()
        .min(1, { error: e.giveTitle })
        .max(TITLE_MAX, { error: fmt(e.maxChars, { n: TITLE_MAX }) }),
      style: text().pipe(z.string().min(2, { error: e.describeStyle })),
      lyrics: text(),
      instrumental: z.boolean(),
      model: z.enum(MODELS),
      mood: z.enum(MOODS).nullable(),
      isPrivate: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const max = limitsFor(v.model);
      if (v.style.length > max.style) {
        ctx.addIssue({ code: "custom", path: ["style"], message: fmt(e.maxCharsModel, { n: max.style }) });
      }
      if (!v.instrumental) {
        if (v.lyrics.length < 10) {
          ctx.addIssue({ code: "custom", path: ["lyrics"], message: e.addLyrics });
        } else if (v.lyrics.length > max.lyrics) {
          ctx.addIssue({ code: "custom", path: ["lyrics"], message: fmt(e.maxCharsModel, { n: max.lyrics }) });
        }
      }
    });

export async function generateAdvanced(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const parsed = advancedSchema(m.generate.errors).safeParse({
    title: formData.get("title"),
    style: formData.get("style"),
    lyrics: formData.get("lyrics") ?? "",
    instrumental: formData.get("instrumental") === "on",
    model: formData.get("model"),
    mood: formData.get("mood") || null,
    isPrivate: formData.get("private") === "on",
  });
  if (!parsed.success) return invalid(m.generate.errors, parsed.error);

  const { title, style, instrumental, model, mood, isPrivate } = parsed.data;
  const lyrics = instrumental ? null : parsed.data.lyrics;
  return submit(
    m,
    user,
    // In custom mode `prompt` is sung verbatim as the lyrics (works on every model).
    { customMode: true, instrumental, model, title, style, ...(lyrics ? { prompt: lyrics } : {}) },
    { mode: "advanced", title, style, lyrics, mood, isPrivate },
  );
}

// ---- remix -------------------------------------------------------------------

const REMIX_MODELS = ["V6", "V6_WILD", "V6_MINI"] as const; // the only models the remix endpoint accepts

const remixSchema = (e: Errors) =>
  z
    .object({
      sourceTrackId: z.coerce.number().int().positive(),
      title: z
        .string()
        .trim()
        .min(1, { error: e.giveTitle })
        .max(TITLE_MAX, { error: fmt(e.maxChars, { n: TITLE_MAX }) }),
      style: text().pipe(
        z
          .string()
          .min(2, { error: e.describeNewStyle })
          .max(1000, { error: fmt(e.maxChars, { n: 1000 }) }),
      ),
      lyrics: text(),
      instrumental: z.boolean(),
      model: z.enum(REMIX_MODELS),
      mood: z.enum(MOODS).nullable(),
      isPrivate: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (!v.instrumental && v.lyrics.length > 5000) {
        ctx.addIssue({ code: "custom", path: ["lyrics"], message: fmt(e.maxChars, { n: 5000 }) });
      }
    });

export async function generateRemix(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const parsed = remixSchema(m.generate.errors).safeParse({
    sourceTrackId: formData.get("sourceTrackId"),
    title: formData.get("title"),
    style: formData.get("style"),
    lyrics: formData.get("lyrics") ?? "",
    instrumental: formData.get("instrumental") === "on",
    model: formData.get("model"),
    mood: formData.get("mood") || null,
    isPrivate: formData.get("private") === "on",
  });
  if (!parsed.success) return invalid(m.generate.errors, parsed.error);

  const { sourceTrackId, title, style, instrumental, model, mood, isPrivate } = parsed.data;
  const found = getRemixSource(sourceTrackId);
  // Someone else's private song is treated as missing, so its existence isn't revealed.
  const src = found && canViewTrack(user.id, found) ? found : undefined;
  if (!src) return { ok: false, error: m.generate.remixUnavailable };
  if (!canRemix(user, src)) return { ok: false, error: fmt(m.generate.remixOff, { name: src.username }) };
  if (src.duration && src.duration > 8 * 60) return { ok: false, error: m.generate.errors.remixTooLong };

  // Blank lyrics on a vocal remix: keep the original words.
  const lyrics = instrumental ? null : parsed.data.lyrics || src.lyrics;
  return submit(
    m,
    user,
    { kind: "remix", uploadUrl: remixSourceUrl(src.id), model, instrumental, title, style, ...(lyrics ? { lyrics } : {}) },
    { mode: "advanced", title, style, lyrics, mood, isPrivate, remixOf: { trackId: src.id, title: src.title, username: src.username } },
  );
}
