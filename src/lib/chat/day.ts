// Kept apart from access.ts (which needs Next's request helpers) so code that only needs the date can
// be loaded anywhere, including the tests.

/** Today's date in Europe/London as YYYY-MM-DD — the day the daily cap resets on. */
export function chatDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}
