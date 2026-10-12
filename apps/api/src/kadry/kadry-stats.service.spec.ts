import { createTestDb, truncateAll } from '../testing/test-db.js';
import { KadryStatsService } from './kadry-stats.service.js';

const db = createTestDb();
const svc = new KadryStatsService(db);
const person = (id: string, d: { gender?: string; birthDate?: string; hiredAt?: string; status?: string; terminatedAt?: string }) =>
  db.employee.create({
    data: {
      id, lastName: id, firstName: 'И', name: `${id} И`, createdById: 'u1', gender: d.gender ?? null, status: d.status ?? 'active',
      birthDate: d.birthDate ? new Date(`${d.birthDate}T00:00:00Z`) : null, hiredAt: d.hiredAt ? new Date(`${d.hiredAt}T00:00:00Z`) : null,
      terminatedAt: d.terminatedAt ? new Date(`${d.terminatedAt}T10:00:00Z`) : null,
    },
  });

describe('KadryStatsService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('computes headcount, age, gender, tenure and turnover', async () => {
    await person('a', { gender: 'male', birthDate: '1990-10-12', hiredAt: '2025-10-12' });  // 36 y, 12 months
    await person('b', { gender: 'female', birthDate: '2000-10-13', hiredAt: '2026-09-12' }); // 25 y, 1 month
    await person('c', { gender: 'male', status: 'intern', hiredAt: '2026-10-01' });          // 0 months
    await person('d', { status: 'terminated', hiredAt: '2024-01-01', terminatedAt: '2026-03-01' });
    expect(await svc.metrics('2026-10-12')).toEqual({
      headcount: 3, averageAge: 30.5, male: 2, female: 1, averageTenureMonths: 4, dismissed12m: 1,
      // hired12m = b, c (a hired exactly 12 months ago is outside the window) = 2; begin = 3 − 2 + 1 = 2; 1 / 2.5 = 40 %
      turnoverPercent: 40,
    });
  });

  it('turnover stays within 0–100 for small staff', async () => {
    await person('a', { hiredAt: '2026-05-01' });
    await person('b', { status: 'terminated', hiredAt: '2026-02-01', terminatedAt: '2026-04-01' });
    await person('c', { status: 'terminated', hiredAt: '2026-02-01', terminatedAt: '2026-06-01' });
    const m = await svc.metrics('2026-10-12');
    expect(m.turnoverPercent).not.toBeNull();
    expect(m.turnoverPercent!).toBeGreaterThanOrEqual(0);
    expect(m.turnoverPercent!).toBeLessThanOrEqual(100);
    await db.employee.deleteMany({});
    expect(await svc.metrics('2026-10-12')).toMatchObject({ headcount: 0, averageAge: null, averageTenureMonths: null, turnoverPercent: null });
  });

  it('lists birthdays later this month, including 29 February in a non-leap year', async () => {
    await person('today', { birthDate: '1990-02-28' });
    await person('leap', { birthDate: '2000-02-29' });
    await person('later', { birthDate: '1985-02-28' });
    await person('past', { birthDate: '1990-02-27' });
    await person('gone', { birthDate: '1990-02-28', status: 'terminated' });
    const b = await svc.birthdays('2027-02-28');
    expect(b.map((x) => [x.name, x.daysLeft, x.turnsAge])).toEqual([['later И', 0, 42], ['leap И', 0, 27], ['today И', 0, 37]]);
    expect(await svc.birthdays('2026-12-31')).toEqual([]);
  });

  it('birthdays respect month ends: only this month, only from today on', async () => {
    await person('last', { birthDate: '1990-10-31' });
    await person('nov', { birthDate: '1991-11-01' });
    await person('sep', { birthDate: '1992-09-30' });
    expect((await svc.birthdays('2026-10-31')).map((x) => [x.name, x.daysLeft, x.turnsAge])).toEqual([['last И', 0, 36]]);
    await person('five', { birthDate: '1980-10-05' });
    await person('twenty', { birthDate: '1970-10-20' });
    expect((await svc.birthdays('2026-10-01')).map((x) => [x.name, x.daysLeft, x.turnsAge])).toEqual([['five И', 4, 46], ['twenty И', 19, 56], ['last И', 30, 36]]);
  });

  it('reads terminatedAt as a Tashkent day (20:00 UTC is already the next day)', async () => {
    await person('stay', { hiredAt: '2020-01-01' });
    await db.employee.create({
      data: { id: 'gone', lastName: 'gone', firstName: 'И', name: 'gone И', createdById: 'u1', status: 'terminated', hiredAt: new Date('2020-01-01T00:00:00Z'), terminatedAt: new Date('2025-10-12T20:00:00Z') },
    });
    // 13 Oct 2025 in Tashkent is inside (12 Oct 2025, 12 Oct 2026]; begin = 1 − 0 + 1 = 2; 1 / 1.5 = 66.7 %
    expect(await svc.metrics('2026-10-12')).toMatchObject({ headcount: 1, dismissed12m: 1, turnoverPercent: 66.7 });
  });

  it('counts whole months only: the day of the month matters', async () => {
    await person('a', { hiredAt: '2026-08-20' });
    expect((await svc.metrics('2026-10-12')).averageTenureMonths).toBe(1);
    await truncateAll(db);
    await person('b', { hiredAt: '2026-08-12' });
    expect((await svc.metrics('2026-10-12')).averageTenureMonths).toBe(2);
  });
});
