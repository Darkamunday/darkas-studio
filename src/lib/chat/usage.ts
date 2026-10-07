import "server-only";
import { db } from "../db";
import { chatDay } from "./access";

export type ChatUserRow = {
  id: number;
  username: string;
  is_admin: number;
  disabled: number;
  chat_enabled: number;
  chat_daily_cap: number | null;
  today: number;
  week: number;
  total: number;
  chats: number;
};

/** First day of the last-7-days window (today and the six before it), Europe/London. */
const weekStart = () => chatDay(new Date(Date.now() - 6 * 86400_000));

/** Chat settings and sends per person, for the admin page. Counts come from chat_usage, so deleted chats still count. */
export function chatUsageByUser(): ChatUserRow[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.is_admin, u.disabled, u.chat_enabled, u.chat_daily_cap,
              COALESCE(SUM(CASE WHEN cu.day = :today THEN cu.count END), 0) AS today,
              COALESCE(SUM(CASE WHEN cu.day >= :week THEN cu.count END), 0) AS week,
              COALESCE(SUM(cu.count), 0)                                   AS total,
              (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS chats
         FROM users u
         LEFT JOIN chat_usage cu ON cu.user_id = u.id
        GROUP BY u.id
        ORDER BY u.is_admin DESC, u.chat_enabled DESC, total DESC, u.username COLLATE NOCASE`,
    )
    .all({ today: chatDay(), week: weekStart() }) as ChatUserRow[];
}

export function chatUsageTotals(): { today: number; week: number } {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN day = :today THEN count END), 0) AS today,
              COALESCE(SUM(CASE WHEN day >= :week THEN count END), 0) AS week
         FROM chat_usage`,
    )
    .get({ today: chatDay(), week: weekStart() }) as { today: number; week: number };
}
