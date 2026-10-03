import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService, monthOf } from './months.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };

describe('MonthsService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
  });
  afterAll(() => db.$disconnect());

  it('takes a receipt month from its stored wall-clock date', () => {
    expect(monthOf(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09');
    expect(monthOf(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10');
  });

  it('lists months from September 2026, all open until closed', async () => {
    const list = await months.list();
    expect(list[0]).toEqual({ month: '2026-09', closed: false, changedBy: null, changedAt: null });
    expect(list.map((m) => m.month)).toContain('2026-10');
  });

  it('closes and reopens a month, recording who did it', async () => {
    await months.setClosed('2026-09', true, user);
    expect(await months.isOpen('2026-09')).toBe(false);
    await expect(months.assertOpen('2026-09')).rejects.toThrow('Месяц закрыт');
    expect((await months.list())[0]).toMatchObject({ month: '2026-09', closed: true, changedBy: 'Сардорбек' });

    await months.setClosed('2026-09', false, user);
    expect(await months.isOpen('2026-09')).toBe(true);
    const h = await months.history();
    expect(h.map((e) => [e.action, e.target, e.userName])).toEqual([
      ['month.open', '2026-09', 'Сардорбек'],
      ['month.close', '2026-09', 'Сардорбек'],
    ]);
  });

  it('refuses a malformed month or one before the data start', async () => {
    await expect(months.setClosed('2026-13', true, user)).rejects.toThrow('Неверный месяц');
    await expect(months.setClosed('2026-08', true, user)).rejects.toThrow('Неверный месяц');
  });
});
