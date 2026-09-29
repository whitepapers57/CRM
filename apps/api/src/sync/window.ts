import { tashkentDay } from './salesdoc-date.js';

export interface SyncWindow {
  /** First day kept: the 1st of the month two months back (spec §4). */
  start: string;
  /**
   * First day fetched: a week earlier, because Salesdoc filters orders by
   * order date while we date them by document date, which can be later.
   */
  fetchFrom: string;
  /** Today. */
  to: string;
}

const MARGIN_DAYS = 7;

/** The stored window for the Tashkent calendar day of `now`, as YYYY-MM-DD strings. */
export function syncWindow(now: Date): SyncWindow {
  const to = tashkentDay(now);
  const [y, m] = to.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - 2, 1));
  const start = first.toISOString().slice(0, 10);
  const fetchFrom = new Date(first.getTime() - MARGIN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { start, fetchFrom, to };
}
