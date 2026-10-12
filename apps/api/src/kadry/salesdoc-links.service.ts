import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';

export const ACCOUNT_KINDS = ['agent', 'expeditor', 'supervisor'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
const isKind = (v: unknown): v is AccountKind => typeof v === 'string' && (ACCOUNT_KINDS as readonly string[]).includes(v);

/** People ↔ the Salesdoc accounts they work under (spec §2–3). */
@Injectable()
export class SalesdocLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async synced() {
    const pick = { select: { sdId: true, name: true, active: true } } as const;
    const [agent, expeditor, supervisor] = await Promise.all([
      this.prisma.agent.findMany(pick), this.prisma.expeditor.findMany(pick), this.prisma.supervisor.findMany(pick),
    ]);
    return { agent, expeditor, supervisor };
  }

  /** "kind:sdId" → account name, for the accounts given (or all). */
  async namesFor(accounts?: Array<{ kind: string; sdId: string }>) {
    const s = await this.synced();
    const names = new Map<string, string>();
    for (const kind of ACCOUNT_KINDS) for (const a of s[kind]) names.set(`${kind}:${a.sdId}`, a.name);
    if (accounts) for (const a of accounts) if (!names.has(`${a.kind}:${a.sdId}`)) names.set(`${a.kind}:${a.sdId}`, a.sdId);
    return names;
  }

  async accounts() {
    const [s, links] = await Promise.all([
      this.synced(),
      this.prisma.employeeSalesdocAccount.findMany({ include: { employee: { select: { id: true, name: true } } } }),
    ]);
    const linked = new Map(links.map((l) => [`${l.kind}:${l.sdId}`, l.employee]));
    const rows = ACCOUNT_KINDS.flatMap((kind) =>
      s[kind].map((a) => ({ kind, sdId: a.sdId, name: a.name, active: a.active, exists: true, employee: linked.get(`${kind}:${a.sdId}`) ?? null })),
    );
    const seen = new Set(rows.map((r) => `${r.kind}:${r.sdId}`));
    for (const l of links) {
      if (!seen.has(`${l.kind}:${l.sdId}`) && isKind(l.kind)) rows.push({ kind: l.kind, sdId: l.sdId, name: l.sdId, active: false, exists: false, employee: l.employee });
    }
    const order = (k: AccountKind) => ACCOUNT_KINDS.indexOf(k);
    return rows.sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name, 'ru'));
  }

  async link(employeeId: string, kind: string, sdId: string, user: AuthUser) {
    if (!isKind(kind)) throw new BadRequestException('Неверный вид учётной записи');
    if (!(await this.prisma.employee.findUnique({ where: { id: employeeId } }))) throw new NotFoundException('Сотрудник не найден');
    const s = await this.synced();
    if (!s[kind].some((a) => a.sdId === sdId)) throw new NotFoundException('Учётная запись не найдена в Salesdoc');
    const holder = await this.prisma.employeeSalesdocAccount.findUnique({ where: { kind_sdId: { kind, sdId } }, include: { employee: { select: { name: true } } } });
    if (holder?.employeeId === employeeId) throw new ConflictException('Уже привязана к этому сотруднику');
    if (holder) throw new ConflictException(`Эта учётная запись уже привязана к ${holder.employee.name}`);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employeeSalesdocAccount.create({ data: { kind, sdId, employeeId, linkedById: user.id } });
        await this.audit.record(tx, { user, action: 'hr.emp.salesdoc.link', target: employeeId, after: { kind, sdId } });
      });
    } catch (e) {
      // Two links at once: the second loses on the primary key.
      const again = await this.prisma.employeeSalesdocAccount.findUnique({ where: { kind_sdId: { kind, sdId } }, include: { employee: { select: { name: true } } } });
      if (again) throw new ConflictException(`Эта учётная запись уже привязана к ${again.employee.name}`);
      throw e;
    }
  }

  async unlink(employeeId: string, kind: string, sdId: string, user: AuthUser) {
    if (!isKind(kind)) throw new BadRequestException('Неверный вид учётной записи');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.employeeSalesdocAccount.deleteMany({ where: { kind, sdId, employeeId } });
      if (!r.count) throw new NotFoundException('Привязка не найдена');
      await this.audit.record(tx, { user, action: 'hr.emp.salesdoc.unlink', target: employeeId, before: { kind, sdId } });
    });
  }
}
