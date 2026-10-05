import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Period } from '../settlements/period.js';

/** Salesdoc order statuses (getOrder): 1 New, 2 Sent, 3 Delivered, 4 Closed, 5 Cancelled. */
export const CANCELLED = 5;

const s2 = (v: Prisma.Decimal) => v.toFixed(2);
const s3 = (v: Prisma.Decimal) => v.toFixed(3);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');

/** Продажи: расходные накладные are Salesdoc orders (amount = total after discount). */
@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  private async names() {
    const pick = { select: { sdId: true, name: true } } as const;
    const [warehouses, agents, expeditors] = await Promise.all([
      this.prisma.warehouse.findMany(pick),
      this.prisma.agent.findMany(pick),
      this.prisma.expeditor.findMany(pick),
    ]);
    const map = (xs: Array<{ sdId: string; name: string }>) => new Map(xs.map((x) => [x.sdId, x.name]));
    return {
      warehouses: warehouses.sort(byName),
      agents: agents.sort(byName),
      warehouse: map(warehouses),
      agent: map(agents),
      expeditor: map(expeditors),
    };
  }

  private async outletNames(ids: Array<string | null>) {
    const sdIds = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = await this.prisma.outlet.findMany({ where: { sdId: { in: sdIds } }, select: { sdId: true, name: true } });
    return new Map(rows.map((x) => [x.sdId, x.name]));
  }

  async orders(p: Period, q: { status?: number; warehouse?: string; agent?: string; search?: string } = {}) {
    const n = await this.names();
    // Escape LIKE wildcards so a typed % or _ matches itself.
    const search = q.search?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    const buyers = search
      ? (await this.prisma.outlet.findMany({ where: { name: { contains: search, mode: 'insensitive' } }, select: { sdId: true } })).map((x) => x.sdId)
      : [];
    const list = await this.prisma.order.findMany({
      where: {
        dateDocument: { gte: p.from, lt: p.toExclusive },
        ...(q.status ? { status: q.status } : {}),
        ...(q.warehouse ? { warehouseSdId: q.warehouse } : {}),
        ...(q.agent ? { agentSdId: q.agent } : {}),
        ...(search ? { OR: [{ sdId: { contains: search, mode: 'insensitive' as const } }, { outletSdId: { in: buyers } }] } : {}),
      },
      orderBy: [{ dateDocument: 'desc' }, { sdId: 'desc' }],
      include: { _count: { select: { lines: true } } },
    });
    const outlets = await this.outletNames(list.map((x) => x.outletSdId));
    const total = list.filter((x) => x.status !== CANCELLED).reduce((s, x) => s.plus(x.totalAfterDiscount), new Prisma.Decimal(0));
    return {
      total: s2(total),
      filters: { warehouses: n.warehouses, agents: n.agents },
      rows: list.map((x) => ({
        sdId: x.sdId,
        date: x.dateDocument.toISOString(),
        status: x.status,
        outletSdId: x.outletSdId,
        outletName: x.outletSdId ? (outlets.get(x.outletSdId) ?? null) : null,
        warehouseName: x.warehouseSdId ? (n.warehouse.get(x.warehouseSdId) ?? null) : null,
        agentName: x.agentSdId ? (n.agent.get(x.agentSdId) ?? null) : null,
        lineCount: x._count.lines,
        total: s2(x.totalAfterDiscount),
      })),
    };
  }

  async order(sdId: string) {
    const x = await this.prisma.order.findUnique({ where: { sdId }, include: { lines: { orderBy: { id: 'asc' } } } });
    if (!x) throw new NotFoundException('Накладная не найдена');
    const [n, outlets] = await Promise.all([this.names(), this.outletNames([x.outletSdId])]);
    return {
      sdId: x.sdId,
      date: x.dateDocument.toISOString(),
      status: x.status,
      outletSdId: x.outletSdId,
      outletName: x.outletSdId ? (outlets.get(x.outletSdId) ?? null) : null,
      warehouseName: x.warehouseSdId ? (n.warehouse.get(x.warehouseSdId) ?? null) : null,
      agentName: x.agentSdId ? (n.agent.get(x.agentSdId) ?? null) : null,
      expeditorName: x.expeditorSdId ? (n.expeditor.get(x.expeditorSdId) ?? null) : null,
      totalBeforeDiscount: s2(x.totalSumma),
      discount: s2(x.discountSumma),
      returns: s2(x.totalReturnsSumma),
      total: s2(x.totalAfterDiscount),
      lines: x.lines.map((l) => ({
        productSdId: l.productSdId,
        productName: l.productName ?? l.productSdId ?? '',
        quantity: s3(l.quantity),
        price: s2(l.price),
        discount: s2(l.discount),
        amount: s2(l.summa),
        returned: s3(l.returned),
      })),
    };
  }
}
