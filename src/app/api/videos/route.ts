import type { NextRequest } from "next/server";
import { z } from "zod";
import { CAST_DESCRIPTION_MAX, MAX_CAST, MAX_PHOTO_BYTES, MAX_TRACK_BYTES, VIDEO_CONCEPT_MAX, VIDEO_TITLE_MAX } from "@/config/video";
import { audioExt, pictureExt, requireVideoApi } from "@/lib/video/api";
import { createVideo, listVideos, usableTrack, type NewCast } from "@/lib/video/store";
import { analyseVideo } from "@/lib/video/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  return Response.json({ videos: listVideos(auth.user.id) });
}

const Fields = z.object({
  title: z.string().trim().min(1).max(VIDEO_TITLE_MAX),
  concept: z.string().trim().max(VIDEO_CONCEPT_MAX),
  trackId: z.coerce.number().int().positive().optional(),
  cast: z
    .array(
      z.object({
        code: z.string().trim().regex(/^[A-Z]{1,3}$/),
        name: z.string().trim().min(1).max(40),
        description: z.string().trim().min(1).max(CAST_DESCRIPTION_MAX),
      }),
    )
    .min(1)
    .max(MAX_CAST),
});

/**
 * Start a video (multipart): title, concept, either trackId (a catalogue song) or a "track" file, "cast"
 * as JSON, and an optional "photo-<i>" file for each cast member. Analysing the track starts straight away.
 */
export async function POST(req: NextRequest) {
  const auth = await requireVideoApi();
  if (auth.error) return auth.error;
  const fail = (error: string, status = 400) => Response.json({ error }, { status });
  const form = await req.formData().catch(() => null);
  if (!form) return fail("bad_request");
  let castJson: unknown;
  try {
    castJson = JSON.parse(String(form.get("cast") ?? "[]"));
  } catch {
    return fail("bad_request");
  }
  const parsed = Fields.safeParse({
    title: form.get("title"),
    concept: form.get("concept") ?? "",
    trackId: form.get("trackId") || undefined,
    cast: castJson,
  });
  if (!parsed.success) return fail("bad_request");
  const { title, concept, trackId, cast } = parsed.data;
  if (new Set(cast.map((c) => c.code)).size !== cast.length) return fail("duplicate_cast");

  let upload: { data: Buffer; ext: string } | undefined;
  if (trackId) {
    if (!usableTrack(auth.user.id, trackId)) return fail("not_found", 404);
  } else {
    const file = form.get("track");
    if (!(file instanceof File)) return fail("no_track");
    const ext = audioExt(file.name);
    if (!ext) return fail("track_type");
    if (file.size > MAX_TRACK_BYTES) return fail("track_too_big", 413);
    upload = { data: Buffer.from(await file.arrayBuffer()), ext };
  }

  const members: NewCast[] = [];
  for (const [i, c] of cast.entries()) {
    const photo = form.get(`photo-${i}`);
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > MAX_PHOTO_BYTES) return fail("photo_too_big", 413);
      const data = Buffer.from(await photo.arrayBuffer());
      const ext = pictureExt(data);
      if (!ext) return fail("photo_type");
      members.push({ ...c, photo: { data, ext } });
    } else members.push(c);
  }

  const video = await createVideo(auth.user.id, { title, concept, trackId, upload, cast: members });
  void analyseVideo(auth.user.id, video.id);
  return Response.json({ video });
}
