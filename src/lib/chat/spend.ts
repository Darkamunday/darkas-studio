import "server-only";
import { db } from "../db";
import { chatDay } from "./access";
import { costOf, findChatModel } from "@/config/chat";
import type { TokenUsage } from "./ollama";

/** Add one request's tokens and cost to today's tally for this person and model. */
export function recordSpend(userId: number, modelId: string, usage: TokenUsage, estimated = false) {
  const model = findChatModel(modelId);
  const cost = model ? costOf(model, usage.input, usage.output) : 0;
  db.prepare(
    `INSERT INTO chat_spend (user_id, day, model, requests, input_tokens, output_tokens, cost_usd, estimated)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT (user_id, day, model) DO UPDATE SET
       requests      = requests + 1,
       input_tokens  = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_usd      = cost_usd + excluded.cost_usd,
       estimated     = estimated + excluded.estimated`,
  ).run(userId, chatDay(), modelId, usage.input, usage.output, cost, estimated ? 1 : 0);
}

/** First day of this calendar month (Europe/London), as YYYY-MM-DD. */
const monthStart = () => `${chatDay().slice(0, 8)}01`;

export type SpendTotals = { today: number; month: number; all: number; estimated: number };

export function spendTotals(): SpendTotals {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN day = :today THEN cost_usd END), 0) AS today,
              COALESCE(SUM(CASE WHEN day >= :month THEN cost_usd END), 0) AS month,
              COALESCE(SUM(cost_usd), 0)                                AS "all",
              COALESCE(SUM(CASE WHEN day >= :month THEN estimated END), 0) AS estimated
         FROM chat_spend`,
    )
    .get({ today: chatDay(), month: monthStart() }) as SpendTotals;
}

export type ModelSpend = { model: string; requests: number; input_tokens: number; output_tokens: number; cost_usd: number };

/** This month's spend per model, most expensive first. */
export function spendByModel(): ModelSpend[] {
  return db
    .prepare(
      `SELECT model, SUM(requests) AS requests, SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd
         FROM chat_spend WHERE day >= ?
        GROUP BY model ORDER BY cost_usd DESC`,
    )
    .all(monthStart()) as ModelSpend[];
}

/** This month's spend per person, by user id. */
export function spendByUser(): Map<number, number> {
  const rows = db
    .prepare("SELECT user_id, SUM(cost_usd) AS cost FROM chat_spend WHERE day >= ? GROUP BY user_id")
    .all(monthStart()) as { user_id: number; cost: number }[];
  return new Map(rows.map((r) => [r.user_id, r.cost]));
}
