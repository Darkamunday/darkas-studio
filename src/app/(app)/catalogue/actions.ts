"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteTrack, setTrackPrivate } from "@/lib/tracks";
import { disableShare, enableShare } from "@/lib/sharing";
import { setAllowRemix } from "@/lib/remix";
import { appUrl } from "@/lib/url";
import { getI18n } from "@/lib/i18n/server";

export async function deleteTrackAction(trackId: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  // The permission check lives in deleteTrack, not the UI, so a hand-crafted request can't bypass it.
  const result = await deleteTrack(user, Number(trackId));
  if (result === "forbidden") return { ok: false, error: (await getI18n()).m.catalogue.errors.deleteOwn };
  revalidatePath("/catalogue");
  revalidatePath("/admin");
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
