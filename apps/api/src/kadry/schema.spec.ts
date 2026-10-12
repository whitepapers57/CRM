import { createTestDb, truncateAll } from '../testing/test-db.js';

const db = createTestDb();

describe('kadry schema', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('keeps department names unique by key and links people, relatives, diplomas and accounts', async () => {
    const d = await db.department.create({ data: { name: 'Склад', nameKey: 'склад' } });
    await expect(db.department.create({ data: { name: 'склад', nameKey: 'склад' } })).rejects.toThrow();
    const p = await db.position.create({ data: { name: 'Кладовщик', nameKey: 'кладовщик', groupKey: d.id, departmentId: d.id, workdays: [1, 2, 3, 4, 5, 6] } });
    const e = await db.employee.create({
      data: { lastName: 'Нишонов', firstName: 'Шоядбек', name: 'Нишонов Шоядбек', departmentId: d.id, positionId: p.id, createdById: 'u1', rate: '1.00', salary: 6000000, hiredAt: new Date('2026-09-01') },
    });
    expect(e.status).toBe('active');
    expect(e.remote).toBe(false);
    await db.employeeRelative.create({ data: { employeeId: e.id, relation: 'mother', fullName: 'Нишонова Мухаббат' } });
    await db.employeeDiploma.create({ data: { employeeId: e.id, degree: 'Бакалавр', institution: 'АндГУ' } });
    await db.employeeSalesdocAccount.create({ data: { kind: 'expeditor', sdId: 'd0_5', employeeId: e.id, linkedById: 'u1' } });
    await expect(db.employeeSalesdocAccount.create({ data: { kind: 'expeditor', sdId: 'd0_5', employeeId: e.id, linkedById: 'u1' } })).rejects.toThrow();
    await db.employee.delete({ where: { id: e.id } });
    expect(await db.employeeRelative.count()).toBe(0);
    expect(await db.employeeDiploma.count()).toBe(0);
    expect(await db.employeeSalesdocAccount.count()).toBe(0);
  });

  it('allows one PINFL per person and many people without one', async () => {
    const base = { createdById: 'u1' };
    await db.employee.create({ data: { ...base, lastName: 'А', firstName: 'Б', name: 'А Б', pinfl: '12345678901234' } });
    await expect(db.employee.create({ data: { ...base, lastName: 'В', firstName: 'Г', name: 'В Г', pinfl: '12345678901234' } })).rejects.toThrow();
    await db.employee.create({ data: { ...base, lastName: 'Д', firstName: 'Е', name: 'Д Е' } });
    await db.employee.create({ data: { ...base, lastName: 'Ж', firstName: 'З', name: 'Ж З' } });
    expect(await db.employee.count()).toBe(3);
  });
});
