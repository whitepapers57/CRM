import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { tashkentDay } from '../sync/salesdoc-date.js';
import { DATA_START } from '../sync/window.js';

/** Month of a stored (Tashkent wall-clock) date, as YYYY-MM. */
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

@Injectable()
export class MonthsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async isOpen(month: string): Promise<boolean> {
    const row = await this.prisma.month.findUnique({ where: { month } });
    return !row?.closed;
  }

  async assertOpen(month: string): Promise<void> {
    if (!(await this.isOpen(month))) throw new ConflictException('Месяц закрыт');
  }

  async list() {
    const all = monthsBetween(DATA_START.slice(0, 7), tashkentDay(new Date()).slice(0, 7));
    const rows = new Map((await this.prisma.month.findMany()).map((r) => [r.month, r]));
    const ids = [...new Set([...rows.values()].map((r) => r.changedById).filter(Boolean))] as string[];
    const users = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    return all.map((month) => {
      const r = rows.get(month);
      return {
        month,
        closed: r?.closed ?? false,
        changedBy: r?.changedById ? (users.get(r.changedById) ?? null) : null,
        changedAt: r?.changedAt?.toISOString() ?? null,
      };
    });
  }

  async setClosed(month: string, closed: boolean, user: AuthUser): Promise<void> {
    const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= DATA_START.slice(0, 7);
    if (!valid) throw new BadRequestException('Неверный месяц');
    await this.prisma.$transaction(async (tx) => {
      await tx.month.upsert({
        where: { month },
        create: { month, closed, changedById: user.id, changedAt: new Date() },
        update: { closed, changedById: user.id, changedAt: new Date() },
      });
      await this.audit.record(tx, { user, action: closed ? 'month.close' : 'month.open', target: month });
    });
  }

  history() {
    return this.audit.list({ actionPrefix: 'month.' });
  }
}
