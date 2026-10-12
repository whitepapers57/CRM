import { ConflictException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesService } from './employees.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const svc = new EmployeesService(db, audit);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const base = { lastName: 'Нишонов', firstName: 'Шоядбек' };

describe('EmployeesService', () => {
  let dept = '';
  let pos = '';
  let reason = '';
  beforeEach(async () => {
    await truncateAll(db);
    dept = (await db.department.create({ data: { name: 'Доставка', nameKey: 'доставка' } })).id;
    pos = (await db.position.create({ data: { name: 'Экспедитор', nameKey: 'экспедитор', groupKey: dept, departmentId: dept, startTime: '08:00', workdays: [1, 2, 3, 4, 5, 6] } })).id;
    reason = (await db.terminationReason.create({ data: { label: 'По собственному желанию', labelKey: 'по собственному желанию' } })).id;
  });
  afterAll(() => db.$disconnect());

  it('creates a card, shows it with names and the position schedule, and records it', async () => {
    const { id } = await svc.create({ ...base, middleName: 'Абдуллаевич', departmentId: dept, positionId: pos, employmentType: 'TD', salary: 6000000, hiredAt: '2026-09-01', status: 'intern', pinfl: '30101990123456' }, user);
    const c = await svc.get(id);
    expect(c).toMatchObject({ name: 'Нишонов Шоядбек Абдуллаевич', departmentName: 'Доставка', positionName: 'Экспедитор', status: 'intern', hiredAt: '2026-09-01', rate: '1.00', salary: 6000000, canDelete: true });
    expect(c.positionSchedule).toEqual({ startTime: '08:00', workdays: [1, 2, 3, 4, 5, 6] });
    expect((await svc.history(id)).map((e) => e.action)).toEqual(['hr.emp.create']);
  });

  it('edits with before and after, and refuses a duplicate PINFL or unknown department', async () => {
    const a = await svc.create({ ...base, pinfl: '30101990123456' }, user);
    const b = await svc.create({ lastName: 'Нурдинов', firstName: 'Илхомжон' }, user);
    await expect(svc.update(b.id, { lastName: 'Нурдинов', firstName: 'Илхомжон', pinfl: '30101990123456' }, user)).rejects.toThrow('Сотрудник с таким ПИНФЛ уже есть');
    await expect(svc.create({ ...base, pinfl: '30101990123456' }, user)).rejects.toThrow('Сотрудник с таким ПИНФЛ уже есть');
    await expect(svc.update(b.id, { ...base, departmentId: 'nope' }, user)).rejects.toThrow('Отдел не найден');
    await expect(svc.update(b.id, { ...base, positionId: 'nope' }, user)).rejects.toThrow('Должность не найдена');
    await svc.update(a.id, { ...base, pinfl: '30101990123456', salary: 7000000 }, user);
    const edit = (await svc.history(a.id)).find((e) => e.action === 'hr.emp.edit')!;
    expect(edit.before).toMatchObject({ salary: null });
    expect(edit.after).toMatchObject({ salary: 7000000 });
    await expect(svc.update('nope', base, user)).rejects.toThrow('Сотрудник не найден');
  });

  it('dismisses with a reason, restores, and makes an intern permanent', async () => {
    const { id } = await svc.create({ ...base, status: 'intern' }, user);
    await svc.makePermanent(id, user);
    expect((await svc.get(id)).status).toBe('active');
    await expect(svc.dismiss(id, '', user)).rejects.toThrow('Выберите причину увольнения');
    await svc.dismiss(id, reason, user);
    const fired = await svc.get(id);
    expect(fired).toMatchObject({ status: 'terminated', terminationReason: 'По собственному желанию' });
    expect(fired.terminatedAt).toBeTruthy();
    await svc.restore(id, user);
    expect(await svc.get(id)).toMatchObject({ status: 'active', terminatedAt: null, terminationReason: null });
    expect((await svc.history(id)).map((e) => e.action).sort()).toEqual(['hr.emp.create', 'hr.emp.dismiss', 'hr.emp.make_permanent', 'hr.emp.restore']);
  });

  it('refuses status changes that do not apply', async () => {
    const { id } = await svc.create(base, user);
    await expect(svc.restore(id, user)).rejects.toThrow('Сотрудник не уволен');
    await expect(svc.makePermanent(id, user)).rejects.toThrow('Сотрудник не стажёр');
    await svc.dismiss(id, reason, user);
    const first = (await svc.get(id)).terminatedAt;
    await expect(svc.dismiss(id, reason, user)).rejects.toBeInstanceOf(ConflictException);
    expect((await svc.get(id)).terminatedAt).toBe(first);
    await db.terminationReason.update({ where: { id: reason }, data: { active: false } });
    await svc.restore(id, user);
    await expect(svc.dismiss(id, reason, user)).rejects.toThrow('Выберите причину увольнения');
  });

  it('deletes only while nothing refers to the employee', async () => {
    const { id } = await svc.create(base, user);
    await db.employeeSalesdocAccount.create({ data: { kind: 'agent', sdId: 'd0_1', employeeId: id, linkedById: 'u1' } });
    expect((await svc.get(id)).canDelete).toBe(false);
    await expect(svc.remove(id, user)).rejects.toThrow('Нельзя удалить — за сотрудником есть связанные записи');
    await db.employeeSalesdocAccount.deleteMany({});
    await svc.remove(id, user);
    await expect(svc.get(id)).rejects.toThrow('Сотрудник не найден');
    expect((await audit.list({ target: id })).map((e) => e.action)).toContain('hr.emp.delete');
  });

  it('lists working staff by default, filters and searches', async () => {
    const a = await svc.create({ ...base, departmentId: dept, positionId: pos, phone: '+998 90 123 45 67' }, user);
    await svc.create({ lastName: 'Абдуллаев', firstName: 'Бобур', pinfl: '12345678901234' }, user);
    const c = await svc.create({ lastName: 'Каримов', firstName: 'Жасур' }, user);
    await svc.dismiss(c.id, reason, user);
    expect((await svc.list({})).map((r) => r.lastName)).toEqual(['Абдуллаев', 'Нишонов']);
    expect((await svc.list({ status: 'terminated' })).map((r) => r.lastName)).toEqual(['Каримов']);
    expect(await svc.list({ status: 'all' })).toHaveLength(3);
    expect((await svc.list({ departmentId: 'none' })).map((r) => r.lastName)).toEqual(['Абдуллаев']);
    expect((await svc.list({ positionId: pos })).map((r) => r.id)).toEqual([a.id]);
    expect((await svc.list({ search: 'экспед' })).map((r) => r.id)).toEqual([a.id]);
    expect((await svc.list({ search: '1234567890' })).map((r) => r.lastName)).toEqual(['Абдуллаев']);
    expect((await svc.list({ search: '+998 90' })).map((r) => r.id)).toEqual([a.id]); // phone; a PINFL never holds '+'
  });

  it('keeps relatives and diplomas on the card, only for their own employee', async () => {
    const a = await svc.create(base, user);
    const b = await svc.create({ lastName: 'Каримов', firstName: 'Жасур' }, user);
    const r = await svc.saveRelative(a.id, null, { relation: 'mother', fullName: 'Нишонова Мухаббат', birthDate: '1970-05-01' }, user);
    await svc.saveRelative(a.id, r.id, { relation: 'mother', fullName: 'Нишонова Мухаббат Х.' }, user);
    const d = await svc.saveDiploma(a.id, null, { degree: 'Бакалавр', institution: 'АндГУ', graduatedYear: 2019 }, user);
    expect((await svc.get(a.id)).relatives).toEqual([expect.objectContaining({ fullName: 'Нишонова Мухаббат Х.', birthDate: null })]);
    expect((await svc.get(a.id)).diplomas).toEqual([expect.objectContaining({ institution: 'АндГУ', graduatedYear: 2019 })]);
    await expect(svc.deleteRelative(b.id, r.id, user)).rejects.toThrow('Запись не найдена');
    await svc.deleteRelative(a.id, r.id, user);
    await svc.deleteDiploma(a.id, d.id, user);
    expect((await svc.get(a.id)).relatives).toEqual([]);
    expect((await svc.history(a.id)).map((e) => e.action)).toEqual(expect.arrayContaining(['hr.emp.relative.save', 'hr.emp.relative.delete', 'hr.emp.diploma.save', 'hr.emp.diploma.delete']));
  });
});
