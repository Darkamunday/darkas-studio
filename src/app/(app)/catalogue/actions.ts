"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteTrack, recoverLostTakes, restoreTrack } from "@/lib/bin";
import { setTrackPrivate } from "@/lib/tracks";
import { disableShare, enableShare } from "@/lib/sharing";
import { setAllowRemix } from "@/lib/remix";
import { appUrl } from "@/lib/url";
import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/format";
import { ComfyError, coversEnabled } from "@/lib/comfy";
import { COVER_PROMPT_MAX, applyCoverJob, checkCoverJob, discardCoverJob, startCoverJob } from "@/lib/covers";

export async function deleteTrackAction(trackId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  // The permission check lives in deleteTrack, not the UI, so a hand-crafted request can't bypass it.
  const result = deleteTrack(user, Number(trackId));
  if (result === "forbidden") return { ok: false, error: (await getI18n()).m.catalogue.errors.deleteOwn };
  revalidatePath("/catalogue");
  revalidatePath("/catalogue/deleted");
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function shareTrackAction(trackId: number): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await requireUser();
  // Ownership is checked in enableShare — no admin override, by design.
  const token = enableShare(user.id, Number(trackId));
  if (!token) return { ok: false, error: (await getI18n()).m.catalogue.errors.shareOwner };
  revalidatePath("/catalogue");
  return { ok: true, url: `${await appUrl()}/s/${token}` };
}

export async function unshareTrackAction(trackId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!disableShare(user.id, Number(trackId))) return { ok: false, error: (await getI18n()).m.catalogue.errors.sharingOwner };
  revalidatePath("/catalogue");
  return { ok: true };
}

export async function setAllowRemixAction(trackId: number, allow: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  // Creator-only, like sharing: admins can't change someone else's remix setting.
  if (!setAllowRemix(user.id, Number(trackId), Boolean(allow))) {
    return { ok: false, error: (await getI18n()).m.catalogue.errors.ownerOnly };
  }
  revalidatePath("/catalogue");
  return { ok: true };
}

export async function setTrackPrivateAction(trackId: number, isPrivate: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  // Creator-only, like sharing and remix settings.
  if (!setTrackPrivate(user.id, Number(trackId), Boolean(isPrivate))) {
    return { ok: false, error: (await getI18n()).m.catalogue.errors.ownerOnly };
  }
  revalidatePath("/catalogue");
  return { ok: true };
}

export async function restoreTrackAction(trackId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  // Permission lives in restoreTrack: owners for their own deletions, admins for anything.
  const result = restoreTrack(user, Number(trackId));
  if (result !== "restored") {
    const { m } = await getI18n();
    return { ok: false, error: result === "forbidden" ? m.bin.errors.forbidden : m.bin.errors.notFound };
  }
  revalidatePath("/catalogue");
  revalidatePath("/catalogue/deleted");
  revalidatePath("/admin", "layout");
  return { ok: true };
}

export async function recoverLostAction(generationId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const result = await recoverLostTakes(user, Number(generationId));
  revalidatePath("/catalogue");
  revalidatePath("/catalogue/deleted");
  if (result === "recovered") return { ok: true };
  const e = (await getI18n()).m.bin.errors;
  return { ok: false, error: result === "gone" ? e.gone : result === "forbidden" ? e.forbidden : result === "not_found" ? e.notFound : e.studio };
}

// ---- AI covers (creator-only) ----

type CoverResult = { ok: true; jobId?: number; status?: "pending" | "ready" | "failed"; previewUrl?: string | null } | { ok: false; error: string };

export async function startCoverAction(trackId: number, prompt: string): Promise<CoverResult> {
  const user = await requireUser();
  const { m } = await getI18n();
  const e = m.covers.errors;
  if (!coversEnabled()) return { ok: false, error: e.not_configured };
  const text = String(prompt ?? "").trim();
  if (text.length < 3) return { ok: false, error: e.tooShort };
  if (text.length > COVER_PROMPT_MAX) return { ok: false, error: fmt(m.generate.errors.maxChars, { n: COVER_PROMPT_MAX }) };
  try {
    const res = await startCoverJob(user.id, Number(trackId), text);
    if (!res.ok) return { ok: false, error: res.reason === "busy" ? e.oneAtATime : e.forbidden };
    return { ok: true, jobId: res.jobId };
  } catch (err) {
    if (err instanceof ComfyError) return { ok: false, error: e[err.reason] };
    console.error("[covers] start failed", err);
    return { ok: false, error: e.generic };
  }
}

export async function checkCoverAction(jobId: number): Promise<CoverResult> {
  const user = await requireUser();
  const e = (await getI18n()).m.covers.errors;
  try {
    const view = await checkCoverJob(user.id, Number(jobId));
    if (!view) return { ok: false, error: e.forbidden };
    if (view.status === "failed") return { ok: false, error: e.failed };
    return { ok: true, status: view.status, previewUrl: view.previewUrl };
  } catch (err) {
    // A hiccup while polling isn't fatal: the client just asks again.
    console.error("[covers] check failed", err);
    return { ok: true, status: "pending" };
  }
}

export async function applyCoverAction(jobId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!(await applyCoverJob(user.id, Number(jobId)))) return { ok: false, error: (await getI18n()).m.covers.errors.forbidden };
  revalidatePath("/catalogue");
  return { ok: true };
}

export async function discardCoverAction(jobId: number): Promise<void> {
  const user = await requireUser();
  await discardCoverJob(user.id, Number(jobId));
}
