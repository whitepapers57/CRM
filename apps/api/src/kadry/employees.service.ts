import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';
import { cleanDiploma, cleanEmployee, cleanRelative, type EmployeeInput } from './employee-rules.js';

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
type Data = ReturnType<typeof cleanEmployee>;
/** What history stores for an employee: the editable fields, dates as days. */
const snapshot = (e: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(e)
      .filter(([k]) => !['id', 'createdAt', 'createdById', 'name'].includes(k))
      .map(([k, v]) => [k, v instanceof Date ? (k === 'terminatedAt' ? v.toISOString() : ymd(v)) : v instanceof Prisma.Decimal ? v.toFixed(2) : v]),
  );

/** Every Employee field (dates YYYY-MM-DD, terminatedAt ISO, rate string) plus names, schedule, children and canDelete. */
export interface EmployeeCard extends Record<string, unknown> {
  id: string; name: string; status: string; terminatedAt: string | null; terminationReason: string | null; createdAt: string;
  departmentName: string | null; positionName: string | null;
  positionSchedule: { startTime: string | null; workdays: number[] } | null;
  relatives: Array<Record<string, unknown>>; diplomas: Array<Record<string, unknown>>;
  accounts: Array<{ kind: string; sdId: string }>; canDelete: boolean;
}

/** Кадры: employee cards, relatives, diplomas and status changes (spec §2–3). */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async find(id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    return e;
  }

  private async checkRefs(d: Data) {
    if (d.departmentId && !(await this.prisma.department.findUnique({ where: { id: d.departmentId } }))) throw new BadRequestException('Отдел не найден');
    if (d.positionId && !(await this.prisma.position.findUnique({ where: { id: d.positionId } }))) throw new BadRequestException('Должность не найдена');
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Сотрудник с таким ПИНФЛ уже есть');
      throw e;
    }
  }

  async list(q: { status?: string; departmentId?: string; positionId?: string; search?: string } = {}) {
    const status = q.status === 'terminated' ? ['terminated'] : q.status === 'all' ? undefined : ['intern', 'active'];
    const s = typeof q.search === 'string' ? q.search.trim() : undefined;
    // Phones are stored as typed; match the search's digits against the phone's digits (only from 3 digits, so '+' or spaces never matter).
    const searchDigits = s ? s.replace(/\D/g, '') : '';
    const byPhone = searchDigits.length >= 3
      ? (await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Employee" WHERE regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + searchDigits + '%'}`).map((r) => r.id)
      : [];
    const rows = await this.prisma.employee.findMany({
      where: {
        ...(status ? { status: { in: status } } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId === 'none' ? null : q.departmentId } : {}),
        ...(q.positionId ? { positionId: q.positionId } : {}),
        ...(s
          ? {
              OR: [
                { name: { contains: s, mode: 'insensitive' as const } },
                { pinfl: { contains: s.replace(/\s+/g, '') } },
                { phone: { contains: s } },
                ...(byPhone.length ? [{ id: { in: byPhone } }] : []),
                { position: { name: { contains: s, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: { position: { select: { name: true } }, department: { select: { name: true } }, salesdocAccounts: { select: { kind: true, sdId: true } } },
    });
    return rows
      .map((e) => ({
        id: e.id, name: e.name, lastName: e.lastName, firstName: e.firstName, middleName: e.middleName,
        positionName: e.position?.name ?? null, departmentName: e.department?.name ?? null, status: e.status,
        employmentType: e.employmentType, hiredAt: ymd(e.hiredAt), accounts: e.salesdocAccounts,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  async get(id: string) {
    const e = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        position: true, department: { select: { name: true } },
        relatives: { orderBy: { createdAt: 'asc' } }, diplomas: { orderBy: { createdAt: 'asc' } },
        salesdocAccounts: { select: { kind: true, sdId: true } },
      },
    });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    const { position, department, relatives, diplomas, salesdocAccounts, ...rest } = e;
    return {
      ...snapshot(rest),
      id: e.id, name: e.name, createdAt: e.createdAt.toISOString(),
      departmentName: department?.name ?? null, positionName: position?.name ?? null,
      positionSchedule: position ? { startTime: position.startTime, workdays: [...position.workdays].sort((a, b) => a - b) } : null,
      relatives: relatives.map((r) => ({ ...r, birthDate: ymd(r.birthDate), createdAt: r.createdAt.toISOString() })),
      diplomas: diplomas.map((d) => ({ ...d, issuedDate: ymd(d.issuedDate), createdAt: d.createdAt.toISOString() })),
      accounts: salesdocAccounts,
      canDelete: salesdocAccounts.length === 0,
    } as unknown as EmployeeCard;
  }

  async create(input: EmployeeInput, user: AuthUser) {
    const d = cleanEmployee(input ?? {}, tashkentDay(new Date()));
    await this.checkRefs(d);
    return this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const e = await tx.employee.create({ data: { ...d, workSchedule: d.workSchedule ?? Prisma.DbNull, createdById: user.id } });
        await this.audit.record(tx, { user, action: 'hr.emp.create', target: e.id, after: snapshot(e) });
        return { id: e.id };
      }),
    );
  }

  /** Replaces the editable fields; status stays as it is (changed only by the status actions). */
  async update(id: string, input: EmployeeInput, user: AuthUser) {
    const before = await this.find(id);
    const { status: _status, ...d } = cleanEmployee({ ...(input ?? {}), status: undefined }, tashkentDay(new Date()));
    await this.checkRefs({ ...d, status: 'active' });
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const after = await tx.employee.update({ where: { id }, data: { ...d, workSchedule: d.workSchedule ?? Prisma.DbNull } });
        await this.audit.record(tx, { user, action: 'hr.emp.edit', target: id, before: snapshot(before), after: snapshot(after) });
      }),
    );
  }

  async dismiss(id: string, reasonId: string, user: AuthUser) {
    const e = await this.find(id);
    if (e.status === 'terminated') throw new ConflictException('Сотрудник уже уволен');
    const reason = typeof reasonId === 'string' && reasonId ? await this.prisma.terminationReason.findUnique({ where: { id: reasonId } }) : null;
    if (!reason || !reason.active) throw new BadRequestException('Выберите причину увольнения');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({ where: { id, status: { not: 'terminated' } }, data: { status: 'terminated', terminatedAt: new Date(), terminationReason: reason.label } });
      if (!r.count) throw new ConflictException('Сотрудник уже уволен');
      await this.audit.record(tx, { user, action: 'hr.emp.dismiss', target: id, reason: reason.label });
    });
  }

  async restore(id: string, user: AuthUser) {
    await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({ where: { id, status: 'terminated' }, data: { status: 'active', terminatedAt: null, terminationReason: null } });
      if (!r.count) throw new ConflictException('Сотрудник не уволен');
      await this.audit.record(tx, { user, action: 'hr.emp.restore', target: id });
    });
  }

  async makePermanent(id: string, user: AuthUser) {
    await this.find(id);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employee.updateMany({ where: { id, status: 'intern' }, data: { status: 'active' } });
      if (!r.count) throw new ConflictException('Сотрудник не стажёр');
      await this.audit.record(tx, { user, action: 'hr.emp.make_permanent', target: id });
    });
  }

  async remove(id: string, user: AuthUser) {
    const e = await this.find(id);
    if (await this.prisma.employeeSalesdocAccount.count({ where: { employeeId: id } })) {
      throw new ConflictException('Нельзя удалить — за сотрудником есть связанные записи. Уволь его вместо удаления, чтобы сохранить историю.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.delete({ where: { id } });
      await this.audit.record(tx, { user, action: 'hr.emp.delete', target: id, before: snapshot(e) });
    });
  }

  async saveRelative(employeeId: string, relativeId: string | null, input: Record<string, unknown>, user: AuthUser) {
    await this.find(employeeId);
    const data = cleanRelative(input ?? {});
    return this.prisma.$transaction(async (tx) => {
      if (relativeId && !(await tx.employeeRelative.findFirst({ where: { id: relativeId, employeeId } }))) throw new NotFoundException('Запись не найдена');
      const r = relativeId ? await tx.employeeRelative.update({ where: { id: relativeId }, data }) : await tx.employeeRelative.create({ data: { ...data, employeeId } });
      await this.audit.record(tx, { user, action: 'hr.emp.relative.save', target: employeeId, after: { ...data, birthDate: ymd(data.birthDate) } });
      return { id: r.id };
    });
  }

  async deleteRelative(employeeId: string, relativeId: string, user: AuthUser) {
    const r = await this.prisma.employeeRelative.findFirst({ where: { id: relativeId, employeeId } });
    if (!r) throw new NotFoundException('Запись не найдена');
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeRelative.delete({ where: { id: relativeId } });
      await this.audit.record(tx, { user, action: 'hr.emp.relative.delete', target: employeeId, before: { relation: r.relation, fullName: r.fullName } });
    });
  }

  async saveDiploma(employeeId: string, diplomaId: string | null, input: Record<string, unknown>, user: AuthUser) {
    await this.find(employeeId);
    const data = cleanDiploma(input ?? {});
    return this.prisma.$transaction(async (tx) => {
      if (diplomaId && !(await tx.employeeDiploma.findFirst({ where: { id: diplomaId, employeeId } }))) throw new NotFoundException('Запись не найдена');
      const d = diplomaId ? await tx.employeeDiploma.update({ where: { id: diplomaId }, data }) : await tx.employeeDiploma.create({ data: { ...data, employeeId } });
      await this.audit.record(tx, { user, action: 'hr.emp.diploma.save', target: employeeId, after: { ...data, issuedDate: ymd(data.issuedDate) } });
      return { id: d.id };
    });
  }

  async deleteDiploma(employeeId: string, diplomaId: string, user: AuthUser) {
    const d = await this.prisma.employeeDiploma.findFirst({ where: { id: diplomaId, employeeId } });
    if (!d) throw new NotFoundException('Запись не найдена');
    await this.prisma.$transaction(async (tx) => {
      await tx.employeeDiploma.delete({ where: { id: diplomaId } });
      await this.audit.record(tx, { user, action: 'hr.emp.diploma.delete', target: employeeId, before: { degree: d.degree, institution: d.institution } });
    });
  }

  history(id: string) {
    return this.audit.list({ target: id });
  }
}
