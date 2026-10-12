import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';

export const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');
const opt = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : null);
const byOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Кадры reference lists: departments, positions, dismissal reasons (spec §2–3). */
@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async structure() {
    const [departments, positions, counts] = await Promise.all([
      this.prisma.department.findMany({ include: { head: { select: { name: true } } } }),
      this.prisma.position.findMany({ include: { department: { select: { name: true } } } }),
      this.prisma.employee.findMany({ where: { status: { not: 'terminated' } }, select: { departmentId: true, positionId: true } }),
    ]);
    const count = (key: 'departmentId' | 'positionId', id: string) => counts.filter((c) => c[key] === id).length;
    return {
      departments: departments
        .map((d) => ({ id: d.id, name: d.name, sortOrder: d.sortOrder, headEmployeeId: d.headEmployeeId, headName: d.head?.name ?? null, employeeCount: count('departmentId', d.id) }))
        .sort(byOrder),
      positions: positions
        .map((p) => ({
          id: p.id, name: p.name, departmentId: p.departmentId, departmentName: p.department?.name ?? null, description: p.description,
          sortOrder: p.sortOrder, startTime: p.startTime, workdays: [...p.workdays].sort((a, b) => a - b), employeeCount: count('positionId', p.id),
        }))
        .sort(byOrder),
    };
  }

  async saveDepartment(id: string | null, input: { name?: string; sortOrder?: number; headEmployeeId?: string | null }, user: AuthUser) {
    const name = clean(input?.name);
    if (!name) throw new BadRequestException('Введите название');
    const headEmployeeId = opt(input?.headEmployeeId);
    if (headEmployeeId && !(await this.prisma.employee.findUnique({ where: { id: headEmployeeId } }))) throw new BadRequestException('Сотрудник не найден');
    const data = { name, nameKey: nameKey(name), sortOrder: Math.trunc(Number(input?.sortOrder) || 0), headEmployeeId };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.department.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('Не найдено');
        const d = id ? await tx.department.update({ where: { id }, data }) : await tx.department.create({ data });
        await this.audit.record(tx, { user, action: 'hr.struct.department.save', target: d.id, before: before ?? undefined, after: d });
        return { id: d.id };
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Отдел с таким названием уже есть');
      throw e;
    }
  }

  async deleteDepartment(id: string, user: AuthUser) {
    const d = await this.prisma.department.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Не найдено');
    const people = await this.prisma.employee.count({ where: { departmentId: id } });
    if (people) throw new ConflictException(`Нельзя удалить — в отделе ${people} сотрудник(ов). Переведите их в другой отдел или снимите назначение.`);
    const positions = await this.prisma.position.count({ where: { departmentId: id } });
    if (positions) throw new ConflictException(`Нельзя удалить — в отделе ${positions} должност(ей). Перенесите их в другой отдел или удалите.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.department.delete({ where: { id } });
      await this.audit.record(tx, { user, action: 'hr.struct.department.delete', target: id, before: d });
    });
  }

  async savePosition(
    id: string | null,
    input: { name?: string; departmentId?: string | null; description?: string | null; sortOrder?: number; startTime?: string | null; workdays?: number[] },
    user: AuthUser,
  ) {
    const name = clean(input?.name);
    if (!name) throw new BadRequestException('Введите название');
    const departmentId = opt(input?.departmentId);
    if (departmentId && !(await this.prisma.department.findUnique({ where: { id: departmentId } }))) throw new BadRequestException('Отдел не найден');
    const startTime = opt(input?.startTime);
    if (startTime && !TIME.test(startTime)) throw new BadRequestException('Неверное время');
    const workdays = input?.workdays ?? [];
    if (!Array.isArray(workdays) || workdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(workdays).size !== workdays.length) {
      throw new BadRequestException('Неверные рабочие дни');
    }
    const data = {
      name, nameKey: nameKey(name), departmentId, groupKey: departmentId ?? '-', description: opt(input?.description),
      sortOrder: Math.trunc(Number(input?.sortOrder) || 0), startTime, workdays: [...workdays].sort((a, b) => a - b),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.position.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('Не найдено');
        const p = id ? await tx.position.update({ where: { id }, data }) : await tx.position.create({ data });
        await this.audit.record(tx, { user, action: 'hr.struct.position.save', target: p.id, before: before ?? undefined, after: p });
        return { id: p.id };
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Такая должность в этом отделе уже есть');
      throw e;
    }
  }

  async deletePosition(id: string, user: AuthUser) {
    const p = await this.prisma.position.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Не найдено');
    const people = await this.prisma.employee.count({ where: { positionId: id } });
    if (people) throw new ConflictException(`Нельзя удалить — на этой должности ${people} сотрудник(ов). Переведите их на другую должность или снимите её.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.position.delete({ where: { id } });
      await this.audit.record(tx, { user, action: 'hr.struct.position.delete', target: id, before: p });
    });
  }

  async reasons() {
    const rows = await this.prisma.terminationReason.findMany({ select: { id: true, label: true, sortOrder: true, active: true } });
    return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ru'));
  }

  async saveReason(id: string | null, input: { label?: string; sortOrder?: number; active?: boolean }, user: AuthUser) {
    const label = clean(input?.label);
    if (!label) throw new BadRequestException('Введите название');
    const data = { label, labelKey: nameKey(label), sortOrder: Math.trunc(Number(input?.sortOrder) || 0), active: input?.active ?? true };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = id ? await tx.terminationReason.findUnique({ where: { id } }) : null;
        if (id && !before) throw new NotFoundException('Не найдено');
        const r = id ? await tx.terminationReason.update({ where: { id }, data }) : await tx.terminationReason.create({ data });
        await this.audit.record(tx, { user, action: 'hr.reason.save', target: r.id, before: before ?? undefined, after: r });
        return { id: r.id };
      });
    } catch (e) {
      if (isUnique(e)) throw new ConflictException('Такая причина уже есть');
      throw e;
    }
  }
}
