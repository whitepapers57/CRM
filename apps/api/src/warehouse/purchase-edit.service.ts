import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.service.js';
import { MonthsService, monthOf } from '../months/months.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SalesdocClient, type SalesdocResponse } from '../salesdoc/salesdoc.client.js';
import { DATA_START } from '../sync/window.js';

export interface PurchaseEditInput {
  date: string;
  warehouseSdId: string;
  supplierSdId?: string | null;
  lines: Array<{ productSdId: string; quantity: number; price: number }>;
}

/** What Salesdoc's setPurchase answers in `result`. */
type SetPurchaseResult = { completed?: number; data?: { purchase?: Array<{ errors?: string[] }> } };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const snapshot = (p: { date: Date; warehouseSdId: string | null; supplierSdId: string | null; lines: Array<{ productSdId: string | null; quantity: Prisma.Decimal | number; price: Prisma.Decimal | number }> }) => ({
  date: p.date.toISOString(),
  warehouseSdId: p.warehouseSdId,
  supplierSdId: p.supplierSdId,
  lines: p.lines.map((l) => ({ productSdId: l.productSdId, quantity: String(l.quantity), price: String(l.price) })),
});

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

  /** Writes the change to Salesdoc (setPurchase); our copy changes only after Salesdoc accepts it. */
  async update(sdId: string, input: PurchaseEditInput, user: AuthUser): Promise<void> {
    if (!DAY.test(input.date ?? '')) throw new BadRequestException('Неверная дата');
    if (input.date < DATA_START) throw new BadRequestException('Дата раньше 01.09.2026');
    if (!input.lines?.length) throw new BadRequestException('Добавьте хотя бы одну строку');
    for (const l of input.lines) {
      if (!(Number(l.quantity) > 0)) throw new BadRequestException('Количество должно быть больше нуля');
      if (!(Number(l.price) >= 0)) throw new BadRequestException('Цена не может быть отрицательной');
    }
    const p = await this.find(sdId);
    if (await this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } })) {
      throw new ConflictException('Накладная удалена');
    }
    if (!(await this.prisma.warehouse.findUnique({ where: { sdId: input.warehouseSdId } }))) {
      throw new BadRequestException('Склад не найден');
    }
    const products = new Map(
      (await this.prisma.product.findMany({ where: { sdId: { in: input.lines.map((l) => l.productSdId) } } })).map((x) => [x.sdId, x.name]),
    );
    if (input.lines.some((l) => !products.has(l.productSdId))) throw new BadRequestException('Товар не найден');
    await this.months.assertOpen(monthOf(p.date));
    await this.months.assertOpen(input.date.slice(0, 7));

    const priceType = (p.raw as { priceType?: { SD_id?: string } } | null)?.priceType?.SD_id;
    if (!priceType) throw new ConflictException('У накладной нет типа цены из Salesdoc');
    const time = p.date.toISOString().slice(11, 19);
    let res: SalesdocResponse<SetPurchaseResult>;
    try {
      res = await this.salesdoc.call<SetPurchaseResult>('setPurchase', {
        data: {
          purchase: [{
            CS_id: p.csId,
            date: `${input.date} ${time}`,
            priceType: { SD_id: priceType },
            store: { SD_id: input.warehouseSdId },
            ...(input.supplierSdId ? { shipper: { SD_id: input.supplierSdId } } : {}),
            products: input.lines.map((l) => ({ SD_id: l.productSdId, quantity: Number(l.quantity), price: Number(l.price) })),
          }],
        },
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadGatewayException(e instanceof Error ? e.message : String(e));
    }
    if (res.result?.completed !== 1) {
      const errors = res.result?.data?.purchase?.flatMap((x) => x.errors ?? []) ?? [];
      throw new BadGatewayException(errors.join('; ') || 'Salesdoc не принял изменения');
    }

    const lines = input.lines.map((l) => {
      const quantity = new Prisma.Decimal(l.quantity).toDecimalPlaces(3);
      const price = new Prisma.Decimal(l.price).toDecimalPlaces(2);
      return { productSdId: l.productSdId, productName: products.get(l.productSdId)!, quantity, price, amount: quantity.times(price).toDecimalPlaces(2) };
    });
    const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
    const date = new Date(`${input.date}T${time}Z`);
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseLine.deleteMany({ where: { purchaseSdId: sdId } });
      await tx.purchase.update({
        where: { sdId },
        data: {
          date,
          warehouseSdId: input.warehouseSdId,
          supplierSdId: input.supplierSdId ?? null,
          total,
          lines: { create: lines },
        },
      });
      await this.audit.record(tx, {
        user,
        action: 'purchase.edit',
        target: sdId,
        before: snapshot(p),
        after: snapshot({ date, warehouseSdId: input.warehouseSdId, supplierSdId: input.supplierSdId ?? null, lines }),
      });
    });
  }
}
