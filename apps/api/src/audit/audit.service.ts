import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth.service.js';

export type AuditAction = 'purchase.edit' | 'purchase.delete' | 'purchase.restore' | 'month.close' | 'month.open';
type Db = PrismaService | Prisma.TransactionClient;
const json = (v: unknown) => (v === undefined ? undefined : (v as Prisma.InputJsonValue));

/** Append-only: there is no update or delete here, on purpose. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    db: Db,
    e: { user: AuthUser; action: AuditAction; target: string; reason?: string; before?: unknown; after?: unknown },
  ) {
    return db.auditLog.create({
      data: {
        userId: e.user.id,
        userName: e.user.name,
        action: e.action,
        target: e.target,
        reason: e.reason ?? null,
        before: json(e.before),
        after: json(e.after),
      },
    });
  }

  async list(where: { target?: string; actionPrefix?: string }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(where.target ? { target: where.target } : {}),
        ...(where.actionPrefix ? { action: { startsWith: where.actionPrefix } } : {}),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      userName: r.userName,
      action: r.action,
      target: r.target,
      reason: r.reason,
      before: r.before,
      after: r.after,
    }));
  }
}
