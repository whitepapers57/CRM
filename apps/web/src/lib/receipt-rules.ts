import { windowStartFor } from "./today";

export type DateProblem = "before" | "closed" | "future" | null;

/**
 * Why a receipt cannot be given this date (the API refuses the same cases).
 * Closed months stay selectable in pickers so they can be looked at; only saving into one is refused.
 */
export function dateProblem(day: string, closedMonths: Set<string>, today: string): DateProblem {
  if (day < windowStartFor()) return "before";
  if (day > today) return "future";
  if (closedMonths.has(day.slice(0, 7))) return "closed";
  return null;
}

/** Decimal places as typed ("12,50" → 1; trailing zeros do not count, the API sees a number). */
export function decimals(v: string): number {
  const frac = v.trim().replace(",", ".").split(".")[1] ?? "";
  return frac.replace(/0+$/, "").length;
}
