"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { SunoError } from "@/lib/suno";
import { fetchTimedLyrics, getTimingTrack } from "@/lib/timed-lyrics";
import { canViewTrack } from "@/lib/tracks";
import { setMasterPrompt } from "@/lib/chat/master-prompt";
import {
  addServer,
  deleteServer,
  refreshTools,
  setServerEnabled,
  setToolAccess,
  setToolApproval,
  type Access,
} from "@/lib/mcp/registry";
import { MAX_MASTER_PROMPT_CHARS } from "@/config/chat";

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
  revalidatePath("/admin", "layout");
}

export async function revokeInvite(formData: FormData) {
  await requireAdmin();
  db.prepare("DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL").run(String(formData.get("code")));
  revalidatePath("/admin", "layout");
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
  revalidatePath("/admin", "layout");
}

export async function setUserAdmin(formData: FormData) {
  const id = await targetUser(formData);
  if (id === null) return;
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(formData.get("admin") === "1" ? 1 : 0, id);
  revalidatePath("/admin", "layout");
}

// ---- chat access ----------------------------------------------------------------
// Changes apply on the user's next request: every chat page and route reads these columns fresh.

export async function setChatEnabled(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!Number.isInteger(id)) return;
  db.prepare("UPDATE users SET chat_enabled = ? WHERE id = ?").run(formData.get("enabled") === "1" ? 1 : 0, id);
  revalidatePath("/admin", "layout");
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
  revalidatePath("/admin", "layout");
}

/** Bulk switch. Admins always have chat, so their flag is left alone. */
export async function setChatForAll(formData: FormData) {
  await requireAdmin();
  db.prepare("UPDATE users SET chat_enabled = ? WHERE is_admin = 0").run(formData.get("enabled") === "1" ? 1 : 0);
  revalidatePath("/admin", "layout");
}

// ---- images in chat ----------------------------------------------------------------------

export async function setImageEnabled(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!Number.isInteger(id)) return;
  db.prepare("UPDATE users SET image_enabled = ? WHERE id = ?").run(formData.get("enabled") === "1" ? 1 : 0, id);
  revalidatePath("/admin", "layout");
}

/** Blank clears the personal image limit, falling back to the default in src/config/images.ts. */
export async function setImageCap(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("userId"));
  if (!Number.isInteger(id)) return;
  const raw = String(formData.get("cap") ?? "").trim();
  const cap = raw === "" ? null : Math.floor(Number(raw));
  if (cap !== null && !(Number.isFinite(cap) && cap >= 0 && cap <= 10_000)) return;
  db.prepare("UPDATE users SET image_daily_cap = ? WHERE id = ?").run(cap, id);
  revalidatePath("/admin", "layout");
}

/** The chat master prompt, for everyone. `reset` (or blank) goes back to the default in the config. */
export async function saveMasterPrompt(formData: FormData) {
  const admin = await requireAdmin();
  const text = formData.get("reset") === "1" ? "" : String(formData.get("prompt") ?? "");
  if (text.length > MAX_MASTER_PROMPT_CHARS) return;
  setMasterPrompt(text, admin.id);
  revalidatePath("/admin", "layout");
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
  revalidatePath("/admin", "layout");
  return { ok: true };
}

// ---- MCP connections -----------------------------------------------------------------------

const ACCESS = new Set(["off", "admins", "everyone"]);

export async function addMcpServer(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  const url = String(formData.get("url") ?? "").trim();
  const headerName = String(formData.get("headerName") ?? "").trim() || null;
  const headerValue = String(formData.get("headerValue") ?? "").trim() || null;
  // https anywhere; plain http only for a server on this machine.
  if (!name || !/^(https:\/\/\S+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S*)$/.test(url)) return { error: "bad_server" };
  const id = addServer({ name, url, headerName, headerValue: headerName ? headerValue : null });
  try {
    await refreshTools(id);
  } catch {
    revalidatePath("/admin", "layout");
    return { error: "refresh_failed" };
  }
  revalidatePath("/admin", "layout");
  return {};
}

export async function refreshMcpServer(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  try {
    await refreshTools(Number(formData.get("serverId")));
  } catch {
    return { error: "refresh_failed" };
  }
  revalidatePath("/admin", "layout");
  return {};
}

export async function removeMcpServer(formData: FormData) {
  await requireAdmin();
  deleteServer(Number(formData.get("serverId")));
  revalidatePath("/admin", "layout");
}

export async function setMcpServerEnabled(formData: FormData) {
  await requireAdmin();
  setServerEnabled(Number(formData.get("serverId")), formData.get("enabled") === "1");
  revalidatePath("/admin", "layout");
}

export async function setMcpToolAccess(formData: FormData) {
  await requireAdmin();
  const access = String(formData.get("access"));
  if (!ACCESS.has(access)) return;
  setToolAccess(Number(formData.get("serverId")), String(formData.get("tool")), access as Access);
  revalidatePath("/admin", "layout");
}

export async function setMcpToolApproval(formData: FormData) {
  await requireAdmin();
  setToolApproval(Number(formData.get("serverId")), String(formData.get("tool")), formData.get("approval") === "1");
  revalidatePath("/admin", "layout");
}

/** Set every tool on a server to one access level at once. */
export async function setMcpAllAccess(formData: FormData) {
  await requireAdmin();
  const access = String(formData.get("access"));
  if (!ACCESS.has(access)) return;
  db.prepare("UPDATE mcp_tools SET access = ? WHERE server_id = ?").run(access, Number(formData.get("serverId")));
  revalidatePath("/admin", "layout");
}
