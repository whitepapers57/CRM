/** Today's date in Tashkent as YYYY-MM-DD (matches the API's default period). */
export function tashkentToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** First day the API keeps data for (spec §4): fixed at 1 Sep 2026, never trimmed. Matches DATA_START in apps/api/src/sync/window.ts. */
export function windowStartFor(): string {
  return "2026-09-01";
}
