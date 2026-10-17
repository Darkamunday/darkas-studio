// Music video settings — edit freely, then rebuild. Shared by server and client, so no secrets here.
// The Comfy templates, node addresses and prompt wording come from a workflow that made a finished
// video by hand; keep them in step with Comfy Cloud if it changes a template.

/** Monthly Comfy credit cap for people an admin has switched on (admins have none). */
export const DEFAULT_MONTHLY_CREDIT_CAP = 1_000;
/** Most credits one video may use (a full 4-minute video is about 900). */
export const MAX_CREDITS_PER_VIDEO = 1_500;

/** Longest track a video can be made for, and the biggest upload. */
export const MAX_TRACK_SECONDS = 8 * 60;
export const MAX_TRACK_BYTES = 40 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_CAST = 6;
export const VIDEO_TITLE_MAX = 80;
export const VIDEO_CONCEPT_MAX = 2_000;
export const CAST_DESCRIPTION_MAX = 400;

// ---- analysis -------------------------------------------------------------------------------

/** The tempo range searched for (beats per minute). */
export const MIN_BPM = 80;
export const MAX_BPM = 180;
/** Beats per bar (4/4). */
export const BEATS_PER_BAR = 4;

/** Song sections, from the energy curve. */
export type Section = "intro" | "build" | "drop" | "breakdown" | "outro";

// ---- shot list -------------------------------------------------------------------------------

/** About this many shots per minute (38 per 4 minutes). */
export const SHOTS_PER_MINUTE = 9.5;
/** Bars per shot: short in drops, longer in calmer parts. */
export const BARS_PER_SHOT: Record<Section, [min: number, max: number]> = {
  intro: [4, 5],
  build: [2, 4],
  drop: [2, 2],
  breakdown: [4, 5],
  outro: [4, 5],
};
/** Cuts are rounded to this (seconds) — a frame at 25 fps. */
export const CUT_ROUNDING = 0.04;
/** Audio slices for clips run this much past the shot's end. */
export const SLICE_TAIL = 0.4;
