/** Today's date in Tashkent as YYYY-MM-DD (matches the API's default period). */
export function tashkentToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
