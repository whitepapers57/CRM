const WALL = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2}))?$/;

/**
 * Salesdoc sends Tashkent wall-clock strings. We store that wall time as if
 * it were UTC and never convert zones, so "15:52" stays "15:52" everywhere.
 */
export function parseSdDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = WALL.exec(s.trim());
  if (!m) throw new Error(`Bad Salesdoc date: ${s}`);
  if (m[1] === '1970-01-01') return null;
  const d = new Date(`${m[1]}T${m[2] ?? '00:00:00'}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad Salesdoc date: ${s}`);
  return d;
}

/** Like parseSdDate, for fields Salesdoc always fills. */
export function requireSdDate(s: string | null | undefined, field: string): Date {
  const d = parseSdDate(s);
  if (!d) throw new Error(`Salesdoc row has no ${field}`);
  return d;
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tashkent',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Tashkent calendar day of a real instant, as YYYY-MM-DD. */
export function tashkentDay(d: Date): string {
  return dayFormat.format(d);
}
