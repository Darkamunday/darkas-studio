"use server";

import * as z from "zod";
import { requireUser, type User } from "@/lib/auth";
import { MODELS, SIMPLE_PROMPT_MAX, TITLE_MAX, limitsFor } from "@/lib/models";
import { canRemix, getRemixSource, remixSourceUrl } from "@/lib/remix";
import { DEFAULT_MODEL, generate, remix, SunoError, type GenerateInput, type RemixInput } from "@/lib/suno";
import { MAX_IN_FLIGHT_PER_USER, MOODS, inFlightCount, insertGeneration } from "@/lib/tracks";

export type GenerateState =
  | { ok: true; generationId: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  | undefined;

// Form submissions encode newlines as \r\n; store and send plain \n.
const text = () => z.string().transform((s) => s.replace(/\r\n?/g, "\n").trim());

const invalid = (error: z.ZodError): GenerateState => ({
  ok: false,
  error: "Check the highlighted fields.",
  fieldErrors: z.flattenError(error).fieldErrors,
});

/** Shared tail of both modes: rate-limit, call Suno, record the generation. */
async function submit(
  user: User,
  input: GenerateInput | ({ kind: "remix" } & RemixInput),
  record: Omit<Parameters<typeof insertGeneration>[0], "userId" | "taskId" | "instrumental" | "model">,
): Promise<GenerateState> {
  if (inFlightCount(user.id) >= MAX_IN_FLIGHT_PER_USER) {
    return { ok: false, error: `You've got ${MAX_IN_FLIGHT_PER_USER} songs cooking already — let one finish first.` };
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
    if (err instanceof SunoError) return { ok: false, error: err.message };
    console.error("[generate] unexpected error", err);
    return { ok: false, error: "Something went wrong reaching the studio — try again in a moment." };
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

const SimpleSchema = z.object({
  prompt: text().pipe(
    z
      .string()
      .min(3, { error: "Tell us a bit more about the song." })
      .max(SIMPLE_PROMPT_MAX, { error: `${SIMPLE_PROMPT_MAX} characters max.` }),
  ),
  instrumental: z.boolean(),
  mood: z.enum(MOODS).nullable(),
});

export async function generateSimple(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const parsed = SimpleSchema.safeParse({
    prompt: formData.get("prompt"),
    instrumental: formData.get("instrumental") === "on",
    mood: formData.get("mood") || null,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { prompt, instrumental, mood } = parsed.data;
  return submit(
    user,
    { customMode: false, instrumental, model: DEFAULT_MODEL, prompt },
    { mode: "simple", prompt, mood },
  );
}

// ---- advanced ----------------------------------------------------------------

const AdvancedSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { error: "Give it a title." })
      .max(TITLE_MAX, { error: `${TITLE_MAX} characters max.` }),
    style: text().pipe(z.string().min(2, { error: "Describe the style — genre, vibe, instruments." })),
    lyrics: text(),
    instrumental: z.boolean(),
    model: z.enum(MODELS),
    mood: z.enum(MOODS).nullable(),
  })
  .superRefine((v, ctx) => {
    const max = limitsFor(v.model);
    if (v.style.length > max.style) {
      ctx.addIssue({ code: "custom", path: ["style"], message: `${max.style} characters max for this model.` });
    }
    if (!v.instrumental) {
      if (v.lyrics.length < 10) {
        ctx.addIssue({ code: "custom", path: ["lyrics"], message: "Add some lyrics (or switch on instrumental)." });
      } else if (v.lyrics.length > max.lyrics) {
        ctx.addIssue({ code: "custom", path: ["lyrics"], message: `${max.lyrics} characters max for this model.` });
      }
    }
  });

export async function generateAdvanced(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const parsed = AdvancedSchema.safeParse({
    title: formData.get("title"),
    style: formData.get("style"),
    lyrics: formData.get("lyrics") ?? "",
    instrumental: formData.get("instrumental") === "on",
    model: formData.get("model"),
    mood: formData.get("mood") || null,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { title, style, instrumental, model, mood } = parsed.data;
  const lyrics = instrumental ? null : parsed.data.lyrics;
  return submit(
    user,
    // In custom mode `prompt` is sung verbatim as the lyrics (works on every model).
    { customMode: true, instrumental, model, title, style, ...(lyrics ? { prompt: lyrics } : {}) },
    { mode: "advanced", title, style, lyrics, mood },
  );
}

// ---- remix -------------------------------------------------------------------

const REMIX_MODELS = ["V6", "V6_WILD", "V6_MINI"] as const; // the only models the remix endpoint accepts

const RemixSchema = z
  .object({
    sourceTrackId: z.coerce.number().int().positive(),
    title: z
      .string()
      .trim()
      .min(1, { error: "Give it a title." })
      .max(TITLE_MAX, { error: `${TITLE_MAX} characters max.` }),
    style: text().pipe(
      z
        .string()
        .min(2, { error: "Describe the new style — that's the whole point of a remix!" })
        .max(1000, { error: "1000 characters max." }),
    ),
    lyrics: text(),
    instrumental: z.boolean(),
    model: z.enum(REMIX_MODELS),
    mood: z.enum(MOODS).nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.instrumental && v.lyrics.length > 5000) {
      ctx.addIssue({ code: "custom", path: ["lyrics"], message: "5000 characters max." });
    }
  });

export async function generateRemix(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  const parsed = RemixSchema.safeParse({
    sourceTrackId: formData.get("sourceTrackId"),
    title: formData.get("title"),
    style: formData.get("style"),
    lyrics: formData.get("lyrics") ?? "",
    instrumental: formData.get("instrumental") === "on",
    model: formData.get("model"),
    mood: formData.get("mood") || null,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { sourceTrackId, title, style, instrumental, model, mood } = parsed.data;
  const src = getRemixSource(sourceTrackId);
  if (!src) return { ok: false, error: "That song isn't available to remix any more." };
  if (!canRemix(user, src)) return { ok: false, error: `${src.username} has turned off remixes for this song.` };
  if (src.duration && src.duration > 8 * 60) return { ok: false, error: "Songs over 8 minutes can't be remixed." };

  // Blank lyrics on a vocal remix: keep the original words.
  const lyrics = instrumental ? null : parsed.data.lyrics || src.lyrics;
  return submit(
    user,
    { kind: "remix", uploadUrl: remixSourceUrl(src.id), model, instrumental, title, style, ...(lyrics ? { lyrics } : {}) },
    { mode: "advanced", title, style, lyrics, mood, remixOf: { trackId: src.id, title: src.title, username: src.username } },
  );
}
