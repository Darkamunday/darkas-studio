import "server-only";
import { db } from "../db";
import { getCurrentUser, type User } from "../auth";
import { DEFAULT_DAILY_CAP } from "@/config/chat";

// Chat is off per user until an admin turns it on. Every chat page and route checks here,
// reading the user row fresh each time so admin changes apply on the next request.

type ChatFlags = { is_admin: number; chat_enabled: number; chat_daily_cap: number | null };

function flags(userId: number): ChatFlags | undefined {
  return db.prepare("SELECT is_admin, chat_enabled, chat_daily_cap FROM users WHERE id = ?").get(userId) as
    | ChatFlags
    | undefined;
}

export function hasChatAccess(user: User): boolean {
  const f = flags(user.id);
  return !!f && (!!f.is_admin || !!f.chat_enabled);
}

/** For route handlers: the signed-in user with chat access, or the error Response to return. */
export async function requireChatApi(): Promise<{ user: User; error?: never } | { user?: never; error: Response }> {
  const user = await getCurrentUser();
  if (!user) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  if (!hasChatAccess(user)) return { error: Response.json({ error: "chat_disabled" }, { status: 403 }) };
  return { user };
}

/** Today's date in Europe/London as YYYY-MM-DD — the day the daily cap resets on. */
export function chatDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

/** The user's daily message cap, or null for no cap (admins). */
export function capFor(userId: number): number | null {
  const f = flags(userId);
  if (!f || f.is_admin) return null;
  return f.chat_daily_cap ?? DEFAULT_DAILY_CAP;
}

export function sentToday(userId: number): number {
  const row = db.prepare("SELECT count FROM chat_usage WHERE user_id = ? AND day = ?").get(userId, chatDay()) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

/** Count one send against today's allowance. Call inside the same transaction that saves the message. */
export function recordSend(userId: number) {
  db.prepare(
    `INSERT INTO chat_usage (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1`,
  ).run(userId, chatDay());
}
