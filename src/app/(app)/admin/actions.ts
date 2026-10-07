"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { SunoError } from "@/lib/suno";
import { fetchTimedLyrics, getTimingTrack } from "@/lib/timed-lyrics";
import { canViewTrack } from "@/lib/tracks";

// Unambiguous alphabet (no 0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newCode() {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export async function createInvite() {
  const admin = await requireAdmin();
  db.prepare("INSERT INTO invite_codes (code, created_by) VALUES (?, ?)").run(newCode(), admin.id);
  revalidatePath("/admin");
}

export async function revokeInvite(formData: FormData) {
  await requireAdmin();
  db.prepare("DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL").run(String(formData.get("code")));
  revalidatePath("/admin");
}

/** Resolve the target user, refusing to act on yourself (avoids locking out the last admin). */
async function targetUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!Number.isInteger(id) || id === admin.id) return null;
  return db.prepare("SELECT id FROM users WHERE id = ?").get(id) ? id : null;
}

export async function setUserDisabled(formData: FormData) {
  const id = await targetUser(formData);
  if (id === null) return;
  const disabled = formData.get("disabled") === "1";
  db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  // Kick them out immediately rather than waiting for the session to expire.
  if (disabled) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  revalidatePath("/admin");
}

export async function setUserAdmin(formData: FormData) {
  const id = await targetUser(formData);
  if (id === null) return;
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(formData.get("admin") === "1" ? 1 : 0, id);
  revalidatePath("/admin");
}

// ---- chat access ----------------------------------------------------------------
// Changes apply on the user's next request: every chat page and route reads these columns fresh.

export async function setChatEnabled(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!Number.isInteger(id)) return;
  db.prepare("UPDATE users SET chat_enabled = ? WHERE id = ?").run(formData.get("enabled") === "1" ? 1 : 0, id);
  revalidatePath("/admin");
}

/** Blank clears the personal limit, falling back to the default in src/config/chat.ts. */
export async function setChatCap(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!Number.isInteger(id)) return;
  const raw = String(formData.get("cap") ?? "").trim();
  const cap = raw === "" ? null : Math.floor(Number(raw));
  if (cap !== null && !(Number.isFinite(cap) && cap >= 0 && cap <= 100_000)) return;
  db.prepare("UPDATE users SET chat_daily_cap = ? WHERE id = ?").run(cap, id);
  revalidatePath("/admin");
}

/** Bulk switch. Admins always have chat, so their flag is left alone. */
export async function setChatForAll(formData: FormData) {
  await requireAdmin();
  db.prepare("UPDATE users SET chat_enabled = ? WHERE is_admin = 0").run(formData.get("enabled") === "1" ? 1 : 0);
  revalidatePath("/admin");
}

export async function fetchTimedLyricsAction(trackId: number): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  const { m } = await getI18n();
  const track = getTimingTrack(Number(trackId));
  // Private songs stay their owner's only, admins included.
  if (!track || !canViewTrack(admin.id, track)) return { ok: false, error: m.timed.notFound };
  if (track.instrumental) return { ok: false, error: m.timed.instrumental };
  try {
    if (!(await fetchTimedLyrics(track, admin.id))) return { ok: false, error: m.timed.none };
  } catch (err) {
    if (err instanceof SunoError) return { ok: false, error: m.studioErrors[err.reason] };
    console.error("[timed-lyrics] unexpected error", err);
    return { ok: false, error: m.generate.errors.unexpected };
  }
  revalidatePath(`/admin/lyrics/${track.id}`);
  revalidatePath("/admin");
  return { ok: true };
}
