import "server-only";
import { db } from "./db";

export type UserUsage = {
  id: number;
  username: string;
  is_admin: number;
  disabled: number;
  created_at: number;
  total: number;
  completed: number;
  failed: number;
  in_progress: number;
  last_7d: number;
  last_generated_at: number | null;
};

/** Usage is derived from the generations table, so it can't drift from what actually happened. */
export function usageByUser(): UserUsage[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.is_admin, u.disabled, u.created_at,
              COUNT(g.id)                                                   AS total,
              COALESCE(SUM(g.status = 'complete'), 0)                       AS completed,
              COALESCE(SUM(g.status = 'failed'), 0)                         AS failed,
              COALESCE(SUM(g.status NOT IN ('complete', 'failed')), 0)      AS in_progress,
              COALESCE(SUM(g.created_at > unixepoch() - 7 * 86400), 0)      AS last_7d,
              MAX(g.created_at)                                             AS last_generated_at
         FROM users u
         LEFT JOIN generations g ON g.user_id = u.id
        GROUP BY u.id
        ORDER BY total DESC, u.username COLLATE NOCASE`,
    )
    .all() as UserUsage[];
}

export function usageTotals() {
  return db
    .prepare(
      `SELECT COUNT(*)                                              AS total,
              COALESCE(SUM(status = 'complete'), 0)                 AS completed,
              COALESCE(SUM(status = 'failed'), 0)                   AS failed,
              COALESCE(SUM(created_at > unixepoch() - 7 * 86400), 0) AS last_7d,
              (SELECT COUNT(*) FROM tracks)                         AS tracks
         FROM generations`,
    )
    .get() as { total: number; completed: number; failed: number; last_7d: number; tracks: number };
}

export type RecentGeneration = {
  id: number;
  username: string;
  mode: "simple" | "advanced" | "remix";
  model: string;
  status: string;
  error: string | null;
  summary: string | null;
  created_at: number;
};

export function recentGenerations(limit = 15): RecentGeneration[] {
  return db
    .prepare(
      `SELECT g.id, u.username,
              CASE WHEN g.remix_of_username IS NOT NULL THEN 'remix' ELSE g.mode END AS mode,
              g.model, g.status, g.error,
              COALESCE(g.title, g.prompt, g.style) AS summary, g.created_at
         FROM generations g JOIN users u ON u.id = g.user_id
        ORDER BY g.created_at DESC, g.id DESC
        LIMIT ?`,
    )
    .all(limit) as RecentGeneration[];
}
