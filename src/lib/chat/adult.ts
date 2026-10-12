import "server-only";
import { db } from "../db";
import { openRouterConfigured } from "./openrouter";

// Who can use adult (18+) chats: people an admin has switched on, who have also confirmed they're 18
// or older. The app-wide requirement is an OpenRouter key; without one the option isn't offered.

type Flags = { adult_enabled: number; adult_confirmed_at: number | null };
const flags = (userId: number) =>
  db.prepare("SELECT adult_enabled, adult_confirmed_at FROM users WHERE id = ?").get(userId) as Flags | undefined;

/** "off": not switched on for them; "confirm": switched on, still to confirm 18+; "on": can use it. */
export type AdultAccess = "off" | "confirm" | "on";

export function adultAccess(userId: number): AdultAccess {
  const f = flags(userId);
  if (!f?.adult_enabled || !openRouterConfigured()) return "off";
  return f.adult_confirmed_at ? "on" : "confirm";
}

/** The person confirms they're 18+ (only once switched on for them). */
export function confirmAdult(userId: number): boolean {
  return (
    db
      .prepare("UPDATE users SET adult_confirmed_at = unixepoch() WHERE id = ? AND adult_enabled = 1 AND adult_confirmed_at IS NULL")
      .run(userId).changes > 0 || adultAccess(userId) === "on"
  );
}

/** Admins switch it on or off per person. Switching off also clears the 18+ confirmation. */
export function setAdultEnabled(userId: number, on: boolean) {
  db.prepare("UPDATE users SET adult_enabled = ?, adult_confirmed_at = CASE WHEN ? THEN adult_confirmed_at END WHERE id = ?").run(
    on ? 1 : 0,
    on ? 1 : 0,
    userId,
  );
}

/** Whether this is one of the person's adult chats. */
export function isAdultConversation(userId: number, conversationId: number): boolean {
  return !!db.prepare("SELECT 1 FROM conversations WHERE id = ? AND user_id = ? AND adult = 1").get(conversationId, userId);
}

/** Each person's adult-chat state, for the admin page. */
export function adultStatuses(): Map<number, { enabled: boolean; confirmedAt: number | null }> {
  const rows = db.prepare("SELECT id, adult_enabled, adult_confirmed_at FROM users").all() as {
    id: number;
    adult_enabled: number;
    adult_confirmed_at: number | null;
  }[];
  return new Map(rows.map((r) => [r.id, { enabled: !!r.adult_enabled, confirmedAt: r.adult_confirmed_at }]));
}
