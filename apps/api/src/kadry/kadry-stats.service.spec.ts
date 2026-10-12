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
});
