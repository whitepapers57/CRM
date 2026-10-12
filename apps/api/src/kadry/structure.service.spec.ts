import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { StructureService } from './structure.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const svc = new StructureService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const emp = (id: string, departmentId: string | null, positionId: string | null, status = 'active') =>
  db.employee.create({ data: { id, lastName: id, firstName: 'И', name: `${id} И`, departmentId, positionId, status, createdById: 'u1' } });

describe('StructureService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('creates departments and positions, counts working staff and shows the head', async () => {
    const sklad = await svc.saveDepartment(null, { name: '  Склад ', sortOrder: 2 }, user);
    const ofis = await svc.saveDepartment(null, { name: 'Офис', sortOrder: 1 }, user);
    const kl = await svc.savePosition(null, { name: 'Кладовщик', departmentId: sklad.id, startTime: '08:00', workdays: [6, 1, 2, 3, 4, 5] }, user);
    await emp('e1', sklad.id, kl.id);
    await emp('e2', sklad.id, kl.id, 'terminated');
    await svc.saveDepartment(sklad.id, { name: 'Склад', sortOrder: 2, headEmployeeId: 'e1' }, user);
    const s = await svc.structure();
    expect(s.departments.map((d) => [d.name, d.employeeCount, d.headName])).toEqual([['Офис', 0, null], ['Склад', 1, 'e1 И']]);
    expect(s.positions).toEqual([expect.objectContaining({ name: 'Кладовщик', departmentName: 'Склад', startTime: '08:00', workdays: [1, 2, 3, 4, 5, 6], employeeCount: 1 })]);
    expect(ofis.id).toBeTruthy();
  });

  it('refuses duplicate names regardless of case and spaces', async () => {
    const a = await svc.saveDepartment(null, { name: 'Склад' }, user);
    await expect(svc.saveDepartment(null, { name: '  склад ' }, user)).rejects.toThrow('Отдел с таким названием уже есть');
    await svc.savePosition(null, { name: 'Водитель', departmentId: a.id }, user);
    await expect(svc.savePosition(null, { name: 'водитель', departmentId: a.id }, user)).rejects.toThrow('Такая должность в этом отделе уже есть');
    await expect(svc.savePosition(null, { name: 'Водитель' }, user)).resolves.toBeTruthy(); // another group: no department
    await svc.saveReason(null, { label: 'Переезд' }, user);
    await expect(svc.saveReason(null, { label: 'ПЕРЕЕЗД' }, user)).rejects.toThrow('Такая причина уже есть');
  });

  it('validates names, times and weekdays', async () => {
    await expect(svc.saveDepartment(null, { name: ' ' }, user)).rejects.toThrow('Введите название');
    await expect(svc.savePosition(null, { name: 'X', startTime: '25:00' }, user)).rejects.toThrow('Неверное время');
    await expect(svc.savePosition(null, { name: 'X', workdays: [0] }, user)).rejects.toThrow('Неверные рабочие дни');
    await expect(svc.savePosition(null, { name: 'X', workdays: [1, 1] }, user)).rejects.toThrow('Неверные рабочие дни');
    await expect(svc.savePosition(null, { name: 'X', departmentId: 'nope' }, user)).rejects.toThrow('Отдел не найден');
    await expect(svc.saveDepartment(null, { name: 'Y', headEmployeeId: 'nope' }, user)).rejects.toThrow('Сотрудник не найден');
  });

  it('refuses deleting what is in use', async () => {
    const d = await svc.saveDepartment(null, { name: 'Склад' }, user);
    const p = await svc.savePosition(null, { name: 'Кладовщик', departmentId: d.id }, user);
    await expect(svc.deleteDepartment(d.id, user)).rejects.toThrow('в отделе 1 должност');
    await emp('e1', null, p.id, 'terminated');
    await expect(svc.deletePosition(p.id, user)).rejects.toThrow('на этой должности 1 сотрудник');
    await db.employee.update({ where: { id: 'e1' }, data: { positionId: null, departmentId: d.id } });
    await svc.deletePosition(p.id, user);
    await expect(svc.deleteDepartment(d.id, user)).rejects.toThrow('в отделе 1 сотрудник');
    await db.employee.update({ where: { id: 'e1' }, data: { departmentId: null } });
    await svc.deleteDepartment(d.id, user);
    expect((await svc.structure()).departments).toEqual([]);
    await expect(svc.deleteDepartment(d.id, user)).rejects.toThrow('Не найдено');
  });

  it('hides and renames reasons, sorted, with history', async () => {
    const r = await svc.saveReason(null, { label: 'Переезд', sortOrder: 9 }, user);
    await svc.saveReason(r.id, { label: 'Переезд в другой город', sortOrder: 9, active: false }, user);
    expect(await svc.reasons()).toEqual([expect.objectContaining({ label: 'Переезд в другой город', active: false })]);
    expect((await audit.list({ target: r.id })).map((e) => e.action)).toEqual(['hr.reason.save', 'hr.reason.save']);
  });
});
