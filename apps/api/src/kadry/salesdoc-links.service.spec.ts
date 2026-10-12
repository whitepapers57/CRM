import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { SalesdocLinksService } from './salesdoc-links.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const svc = new SalesdocLinksService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();

describe('SalesdocLinksService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.agent.createMany({ data: [
      { sdId: 'a1', name: 'AND-AP-BEV-03 GOROD 1', active: true, raw: {}, seenAt },
      { sdId: 'a2', name: 'AND-AP-BEV-02 RAYON 1', active: false, raw: {}, seenAt },
    ] });
    await db.expeditor.create({ data: { sdId: 'x1', name: 'Нишонов Шоядбек (60)', active: true, raw: {}, seenAt } });
    await db.supervisor.create({ data: { sdId: 's1', name: 'Супервайзер', active: true, raw: {}, seenAt } });
    for (const [id, last] of [['e1', 'Иванов'], ['e2', 'Петров']]) {
      await db.employee.create({ data: { id, lastName: last, firstName: 'И', name: `${last} И`, createdById: 'u1' } });
    }
  });
  afterAll(() => db.$disconnect());

  it('lists every account with its person, sorted by kind and name', async () => {
    await svc.link('e1', 'agent', 'a1', user);
    const rows = await svc.accounts();
    expect(rows.map((r) => [r.kind, r.name, r.active, r.employee?.name ?? null])).toEqual([
      ['agent', 'AND-AP-BEV-02 RAYON 1', false, null],
      ['agent', 'AND-AP-BEV-03 GOROD 1', true, 'Иванов И'],
      ['expeditor', 'Нишонов Шоядбек (60)', true, null],
      ['supervisor', 'Супервайзер', true, null],
    ]);
  });

  it('one account belongs to one person at a time', async () => {
    await svc.link('e1', 'agent', 'a1', user);
    await expect(svc.link('e2', 'agent', 'a1', user)).rejects.toThrow('Эта учётная запись уже привязана к Иванов И');
    await expect(svc.link('e1', 'agent', 'a1', user)).rejects.toThrow('Уже привязана к этому сотруднику');
    await svc.link('e1', 'expeditor', 'x1', user); // a person may hold several
    await svc.unlink('e1', 'agent', 'a1', user);
    await svc.link('e2', 'agent', 'a1', user);
    expect((await svc.accounts()).find((r) => r.sdId === 'a1')?.employee?.name).toBe('Петров И');
    expect((await audit.list({ target: 'e1' })).map((e) => e.action).sort()).toEqual(['hr.emp.salesdoc.link', 'hr.emp.salesdoc.link', 'hr.emp.salesdoc.unlink']);
  });

  it('checks the kind, the account and the person', async () => {
    await expect(svc.link('e1', 'boss', 'a1', user)).rejects.toThrow('Неверный вид учётной записи');
    await expect(svc.link('e1', 'agent', 'zz', user)).rejects.toThrow('Учётная запись не найдена в Salesdoc');
    await expect(svc.link('nope', 'agent', 'a1', user)).rejects.toThrow('Сотрудник не найден');
    await expect(svc.unlink('e1', 'agent', 'a1', user)).rejects.toThrow('Привязка не найдена');
  });

  it('keeps a link to an account that left Salesdoc and marks it', async () => {
    await svc.link('e1', 'supervisor', 's1', user);
    await db.supervisor.deleteMany({});
    expect((await svc.accounts()).find((r) => r.sdId === 's1')).toMatchObject({ exists: false, name: 's1', employee: { id: 'e1' } });
  });
});
