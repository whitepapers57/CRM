import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
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
/** A real calendar day: "2026-02-31" matches DAY but is not one. */
const isDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const snapshot = (p: { date: Date; warehouseSdId: string | null; supplierSdId: string | null; lines: Array<{ productSdId: string | null; quantity: Prisma.Decimal | number; price: Prisma.Decimal | number }> }) => ({
  date: p.date.toISOString(),
  warehouseSdId: p.warehouseSdId,
  supplierSdId: p.supplierSdId,
  lines: p.lines.map((l) => ({ productSdId: l.productSdId, quantity: String(l.quantity), price: String(l.price) })),
});

@Injectable()
export class PurchaseEditService {
  private readonly log = new Logger(PurchaseEditService.name);

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
    if (!isDay(input.date ?? '')) throw new BadRequestException('Неверная дата');
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
    // Leaving `shipper` out of setPurchase may not clear it in Salesdoc, so our copy would disagree.
    if (p.supplierSdId && p.supplierSdId !== '-' && !input.supplierSdId) throw new BadRequestException('Поставщика нельзя убрать');
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
    // Salesdoc keeps unit prices beyond 2 decimals but shows them rounded; a line whose shown price
    // is left as it was keeps the exact one (stored amount ÷ quantity), so re-sending changes nothing.
    const exact = new Map<string, Prisma.Decimal>();
    for (const l of p.lines) {
      if (!l.productSdId || !l.quantity.gt(0)) continue;
      const unit = l.amount.div(l.quantity);
      // Only an amount that really is quantity × (shown price, unrounded) gives the exact price.
      if (unit.minus(l.price).abs().lt(0.005)) exact.set(`${l.productSdId}|${l.price.toFixed(2)}`, unit);
    }
    const lines = input.lines.map((l) => {
      const quantity = new Prisma.Decimal(l.quantity).toDecimalPlaces(3);
      const shown = new Prisma.Decimal(l.price).toDecimalPlaces(2);
      const unit = exact.get(`${l.productSdId}|${shown.toFixed(2)}`) ?? shown;
      return { productSdId: l.productSdId, productName: products.get(l.productSdId)!, quantity, price: shown, unit, amount: quantity.times(unit).toDecimalPlaces(2) };
    });
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
            products: lines.map((l) => ({ SD_id: l.productSdId, quantity: l.quantity.toNumber(), price: l.unit.toDecimalPlaces(10).toNumber() })),
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

    const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
    const date = new Date(`${input.date}T${time}Z`);
    const stored = lines.map(({ unit: _unit, ...l }) => l);
    // Salesdoc has accepted: the history entry is written first and on its own, so a failure
    // updating our copy can never leave a Salesdoc change unrecorded.
    await this.audit.record(this.prisma, {
      user,
      action: 'purchase.edit',
      target: sdId,
      before: snapshot(p),
      after: snapshot({ date, warehouseSdId: input.warehouseSdId, supplierSdId: input.supplierSdId ?? null, lines: stored }),
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.purchase.updateMany({
          where: { sdId },
          data: { date, warehouseSdId: input.warehouseSdId, supplierSdId: input.supplierSdId ?? null, total },
        });
        if (count === 0) return; // the sync replaced the row meanwhile; its next pass brings Salesdoc's version
        await tx.purchaseLine.deleteMany({ where: { purchaseSdId: sdId } });
        await tx.purchaseLine.createMany({ data: stored.map((l) => ({ ...l, purchaseSdId: sdId })) });
      });
    } catch (e) {
      // Salesdoc already holds the change and the history has it; the next sync refreshes our copy.
      this.log.warn(`Salesdoc accepted ${sdId} but our copy was not updated: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
