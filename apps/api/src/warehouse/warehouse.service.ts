import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Period } from '../settlements/period.js';

type HiddenRow = { hiddenByName: string; hiddenAt: Date; reason: string };
const hiddenInfo = (h?: HiddenRow | null) => (h ? { by: h.hiddenByName, at: h.hiddenAt.toISOString(), reason: h.reason } : null);

const s2 = (v: Prisma.Decimal) => v.toFixed(2);
const s3 = (v: Prisma.Decimal) => v.toFixed(3);

@Injectable()
export class WarehouseService {
  constructor(private readonly prisma: PrismaService) {}

  private async names() {
    const [warehouses, suppliers] = await Promise.all([
      this.prisma.warehouse.findMany({ orderBy: { name: 'asc' }, select: { sdId: true, name: true } }),
      this.prisma.supplier.findMany({ select: { sdId: true, name: true } }),
    ]);
    return {
      warehouses,
      warehouse: new Map(warehouses.map((w) => [w.sdId, w.name])),
      supplier: new Map(suppliers.map((x) => [x.sdId, x.name])),
    };
  }

  async stock(q: { warehouse?: string; search?: string; includeZero?: boolean }) {
    const n = await this.names();
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        ...(q.warehouse ? { warehouseSdId: q.warehouse } : {}),
        ...(q.search ? { productName: { contains: q.search, mode: 'insensitive' } } : {}),
        ...(q.includeZero ? {} : { quantity: { not: 0 } }),
      },
    });
    const rows = levels
      .map((l) => ({
        warehouseSdId: l.warehouseSdId,
        warehouseName: n.warehouse.get(l.warehouseSdId) ?? l.warehouseSdId,
        productSdId: l.productSdId,
        productName: l.productName,
        quantity: s3(l.quantity),
      }))
      .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, 'ru') || a.productName.localeCompare(b.productName, 'ru'));
    return { warehouses: n.warehouses, rows };
  }

  async purchases(p: Period, q: { supplier?: string; warehouse?: string; search?: string; includeHidden?: boolean } = {}) {
    const n = await this.names();
    const hidden = new Map((await this.prisma.purchaseHidden.findMany()).map((h) => [h.purchaseSdId, h]));
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: { sdId: true, name: true },
    });
    // Escape LIKE wildcards so a typed % or _ matches itself.
    const search = q.search?.replace(/[\\%_]/g, (c) => `\\${c}`);
    const list = await this.prisma.purchase.findMany({
      where: {
        date: { gte: p.from, lt: p.toExclusive },
        ...(q.supplier ? { supplierSdId: q.supplier } : {}),
        ...(q.warehouse ? { warehouseSdId: q.warehouse } : {}),
        sdId: {
          ...(search ? { contains: search, mode: 'insensitive' as const } : {}),
          // Deleted (hidden) receipts stay out unless asked for.
          ...(q.includeHidden ? {} : { notIn: [...hidden.keys()] }),
        },
      },
      orderBy: [{ date: 'desc' }, { sdId: 'desc' }],
      include: { _count: { select: { lines: true } } },
    });
    const total = list
      .filter((x) => !hidden.has(x.sdId))
      .reduce((sum, x) => sum.plus(x.total), new Prisma.Decimal(0));
    return {
      total: s2(total),
      filters: { suppliers, warehouses: n.warehouses },
      rows: list.map((x) => ({
        sdId: x.sdId,
        date: x.date.toISOString(),
        warehouseSdId: x.warehouseSdId,
        warehouseName: x.warehouseSdId ? (n.warehouse.get(x.warehouseSdId) ?? null) : null,
        supplierSdId: x.supplierSdId,
        supplierName: x.supplierSdId ? (n.supplier.get(x.supplierSdId) ?? null) : null,
        lineCount: x._count.lines,
        total: s2(x.total),
        hidden: hiddenInfo(hidden.get(x.sdId)),
      })),
    };
  }

  async purchase(sdId: string) {
    const x = await this.prisma.purchase.findUnique({
      where: { sdId },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    if (!x) throw new NotFoundException(`Purchase ${sdId} not found`);
    const n = await this.names();
    const [hidden, month] = await Promise.all([
      this.prisma.purchaseHidden.findUnique({ where: { purchaseSdId: sdId } }),
      this.prisma.month.findUnique({ where: { month: x.date.toISOString().slice(0, 7) } }),
    ]);
    return {
      sdId: x.sdId,
      date: x.date.toISOString(),
      warehouseSdId: x.warehouseSdId,
      supplierSdId: x.supplierSdId,
      monthOpen: !month?.closed,
      hidden: hiddenInfo(hidden),
      warehouseName: x.warehouseSdId ? (n.warehouse.get(x.warehouseSdId) ?? null) : null,
      supplierName: x.supplierSdId ? (n.supplier.get(x.supplierSdId) ?? null) : null,
      total: s2(x.total),
      lines: x.lines.map((l) => ({
        productSdId: l.productSdId,
        productName: l.productName,
        quantity: s3(l.quantity),
        price: s2(l.price),
        amount: s2(l.amount),
      })),
    };
  }

  async formOptions() {
    const [warehouses, suppliers, products] = await Promise.all([
      this.prisma.warehouse.findMany({ select: { sdId: true, name: true } }),
      this.prisma.supplier.findMany({ select: { sdId: true, name: true } }),
      this.prisma.product.findMany({ select: { sdId: true, name: true, active: true } }),
    ]);
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru');
    return {
      warehouses: warehouses.sort(byName),
      suppliers: suppliers.sort(byName),
      products: products
        .sort((a, b) => Number(b.active) - Number(a.active) || byName(a, b))
        .map(({ sdId, name }) => ({ sdId, name })),
    };
  }
}
