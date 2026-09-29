/** Today's date in Tashkent as YYYY-MM-DD (matches the API's default period). */
export function tashkentToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** First day the API keeps data for (spec §4): the 1st of the month two months back. */
export function windowStartFor(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - 2, 1)).toISOString().slice(0, 10);
}
