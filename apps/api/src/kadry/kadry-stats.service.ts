import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';

const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Whole years / months between two "YYYY-MM-DD" days (from ≤ to). */
function fullYears(from: string, to: string) {
  const [fy, fm, fd] = parts(from); const [ty, tm, td] = parts(to);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}
function fullMonths(from: string, to: string) {
  const [fy, fm, fd] = parts(from); const [ty, tm, td] = parts(to);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}
/** The day 12 months before `today` (31 Mar → 31 Mar of the previous year; 29 Feb → 28 Feb). */
function yearAgo(today: string) {
  const [y, m, d] = parts(today);
  const day = m === 2 && d === 29 && !isLeap(y - 1) ? 28 : d;
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Metrics bar and birthdays widget (spec §3–4). */
@Injectable()
export class KadryStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(today = tashkentDay(new Date())) {
    const all = await this.prisma.employee.findMany({ select: { status: true, gender: true, birthDate: true, hiredAt: true, terminatedAt: true } });
    const working = all.filter((e) => e.status !== 'terminated');
    const ages = working.filter((e) => e.birthDate && ymd(e.birthDate) <= today).map((e) => fullYears(ymd(e.birthDate!), today));
    const tenures = working.filter((e) => e.hiredAt && ymd(e.hiredAt) <= today).map((e) => fullMonths(ymd(e.hiredAt!), today));
    const since = yearAgo(today);
    const inWindow = (d: string | null) => d != null && d > since && d <= today;
    const hired12m = all.filter((e) => inWindow(e.hiredAt ? ymd(e.hiredAt) : null)).length;
    const dismissed12m = all.filter((e) => inWindow(e.terminatedAt ? tashkentDay(e.terminatedAt) : null)).length;
    const headcount = working.length;
    const begin = Math.max(0, headcount - hired12m + dismissed12m);
    const denominator = (begin + headcount) / 2;
    const averageAge = avg(ages);
    const averageTenure = avg(tenures);
    return {
      headcount,
      averageAge: averageAge == null ? null : Math.round(averageAge * 10) / 10,
      male: working.filter((e) => e.gender === 'male').length,
      female: working.filter((e) => e.gender === 'female').length,
      averageTenureMonths: averageTenure == null ? null : Math.round(averageTenure),
      dismissed12m,
      turnoverPercent: denominator > 0 ? Math.min(100, Math.round((dismissed12m / denominator) * 1000) / 10) : null,
    };
  }

  async birthdays(today = tashkentDay(new Date())) {
    const [y, m, d] = parts(today);
    const people = await this.prisma.employee.findMany({ where: { status: { not: 'terminated' }, birthDate: { not: null } }, select: { id: true, name: true, birthDate: true } });
    return people
      .map((p) => {
        const [by, bm, bd] = parts(ymd(p.birthDate!));
        const day = bm === 2 && bd === 29 && !isLeap(y) ? 28 : bd;
        return { id: p.id, name: p.name, month: bm, day, daysLeft: day - d, turnsAge: by > 1900 ? y - by : null };
      })
      .filter((p) => p.month === m && p.day >= d)
      .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'ru'))
      .map(({ month: _m, ...p }) => p);
  }
}
