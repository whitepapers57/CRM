import { BadRequestException } from '@nestjs/common';
import { tashkentDay } from '../sync/salesdoc-date.js';

export interface Period {
  /** For Prisma client queries. */
  from: Date;
  toExclusive: Date;
  /** For raw SQL, cast with ::timestamp so no session time zone can shift them. */
  fromDay: string;
  toDay: string;
  toExclusiveDay: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string, field: string): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (!DAY_RE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a date in YYYY-MM-DD`);
  }
  return d;
}

/** Inclusive `from`..`to` days (wall time); defaults to this month so far. */
export function parsePeriod(from?: string, to?: string, today = tashkentDay(new Date())): Period {
  const toDay = to || today;
  const fromDay = from || `${toDay.slice(0, 7)}-01`;
  const start = day(fromDay, 'from');
  const end = day(toDay, 'to');
  if (start > end) throw new BadRequestException('from must not be after to');
  const toExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return { from: start, toExclusive, fromDay, toDay, toExclusiveDay: toExclusive.toISOString().slice(0, 10) };
}
