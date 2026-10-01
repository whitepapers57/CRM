import { tashkentDay } from './salesdoc-date.js';

/** First day of stored data (owner's decision 1 Oct 2026): kept from here on, never trimmed. */
export const DATA_START = '2026-09-01';

export interface SyncWindow {
  /** First day kept. */
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
  const first = new Date(`${DATA_START}T00:00:00Z`);
  const fetchFrom = new Date(first.getTime() - MARGIN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { start: DATA_START, fetchFrom, to: tashkentDay(now) };
}
