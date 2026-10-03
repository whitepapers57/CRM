import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService, monthOf } from '../months/months.service.js';
import { SalesdocClient } from '../salesdoc/salesdoc.client.js';

@Injectable()
export class PurchaseEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesdoc: SalesdocClient,
    private readonly months: MonthsService,
    private readonly audit: AuditService,
  ) {}

  private async find(sdId: string) {
    const p = await this.prisma.purchase.findUnique({ where: { sdId }, include: { lines: { orderBy: { id: 'asc' } } } });
    if (!p) throw new NotFoundException('Накладная не найдена');
    return p;
  }

  /** Hides the receipt in our app; Salesdoc's API cannot delete it. */
  async remove(sdId: string, reason: string, user: AuthUser): Promise<void> {
    const why = reason?.trim();
    if (!why) throw new BadRequestException('Укажите причину');
    const p = await this.find(sdId);
    await this.months.assertOpen(monthOf(p.date));
    if (await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } })) {
      throw new ConflictException('Накладная уже удалена');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseHidden.create({ data: { purchaseSdId: sdId, hiddenById: user.id, hiddenByName: user.name, reason: why } });
      await this.audit.record(tx, {
        user,
        action: 'purchase.delete',
        target: sdId,
        reason: why,
        before: { date: p.date.toISOString(), warehouseSdId: p.warehouseSdId, supplierSdId: p.supplierSdId, total: p.total.toFixed(2) },
      });
    });
  }

  async restore(sdId: string, user: AuthUser): Promise<void> {
    const p = await this.find(sdId);
    await this.months.assertOpen(monthOf(p.date));
    const hidden = await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } });
    if (!hidden) throw new ConflictException('Накладная не удалена');
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseHidden.delete({ where: { purchaseSdId: sdId } });
      await this.audit.record(tx, { user, action: 'purchase.restore', target: sdId });
    });
  }

  history(sdId: string) {
    return this.audit.list({ target: sdId, actionPrefix: 'purchase.' });
  }
}
