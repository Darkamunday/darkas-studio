"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

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
