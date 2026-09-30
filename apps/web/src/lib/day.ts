const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-01" → that calendar day at local midnight (what a date picker shows). */
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** A picked calendar date → "YYYY-MM-DD", read with local getters so it never shifts a day. */
export function dateToDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
