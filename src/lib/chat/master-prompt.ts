import "server-only";
import { db } from "../db";
import { SYSTEM_PROMPT } from "@/config/chat";

// The master prompt sent first with every chat message, for everyone. Admins edit it on the Admin
// page; with nothing saved, the default in src/config/chat.ts applies.

const KEY = "chat_master_prompt";

export type MasterPrompt = { text: string; custom: boolean; updated_at: number | null; updated_by_name: string | null };

export function getMasterPrompt(): MasterPrompt {
  const row = db
    .prepare(
      `SELECT s.value, s.updated_at, u.username AS updated_by_name
         FROM settings s LEFT JOIN users u ON u.id = s.updated_by
        WHERE s.key = ?`,
    )
    .get(KEY) as { value: string; updated_at: number; updated_by_name: string | null } | undefined;
  if (!row) return { text: SYSTEM_PROMPT, custom: false, updated_at: null, updated_by_name: null };
  return { text: row.value, custom: true, updated_at: row.updated_at, updated_by_name: row.updated_by_name };
}

/** Save a new master prompt. Blank, or the same as the default, goes back to the default. */
export function setMasterPrompt(text: string, adminId: number) {
  const value = text.trim();
  if (!value || value === SYSTEM_PROMPT.trim()) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
    return;
  }
  db.prepare(
    `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = unixepoch(), updated_by = excluded.updated_by`,
  ).run(KEY, value, adminId);
}
