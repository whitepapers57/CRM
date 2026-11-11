import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Period } from '../settlements/period.js';
import { addValued, valueStock, zeroValued, type Receipt, type Valued } from './fifo.js';

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

  /**
   * Current stock with each product's Salesdoc category. `category` is a category sdId,
   * or "-" for products without one. Categories (and "-", via `uncategorized`) are offered
   * only if some stock has them.
   */
  async stock(q: { warehouse?: string; search?: string; includeZero?: boolean; category?: string }) {
    const n = await this.names();
    const [levels, products, categories] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: {
          ...(q.warehouse ? { warehouseSdId: q.warehouse } : {}),
          ...(q.search ? { productName: { contains: q.search, mode: 'insensitive' } } : {}),
          ...(q.includeZero ? {} : { quantity: { not: 0 } }),
        },
      }),
      this.prisma.product.findMany({ where: { categorySdId: { not: null } }, select: { sdId: true, categorySdId: true } }),
      this.prisma.productCategory.findMany({ select: { sdId: true, name: true } }),
    ]);
    const categoryOf = new Map(products.map((p) => [p.sdId, p.categorySdId]));
    const categoryName = new Map(categories.map((c) => [c.sdId, c.name]));
    // A category Salesdoc has not named yet shows its code, like an unknown warehouse.
    const all = levels.map((l) => {
      const categorySdId = categoryOf.get(l.productSdId) ?? null;
      return {
        warehouseSdId: l.warehouseSdId,
        warehouseName: n.warehouse.get(l.warehouseSdId) ?? l.warehouseSdId,
        categorySdId,
        categoryName: categorySdId ? (categoryName.get(categorySdId) ?? categorySdId) : null,
        productSdId: l.productSdId,
        productName: l.productName,
        quantity: s3(l.quantity),
      };
    });
    const offered = new Map(all.flatMap((r) => (r.categorySdId ? [[r.categorySdId, r.categoryName!] as const] : [])));
    type Row = (typeof all)[number];
    const byCategoryThenProduct = (a: Row, b: Row) =>
      // Products without a category go last.
      Number(a.categoryName === null) - Number(b.categoryName === null) ||
      (a.categoryName ?? '').localeCompare(b.categoryName ?? '', 'ru') ||
      a.productName.localeCompare(b.productName, 'ru') ||
      a.warehouseName.localeCompare(b.warehouseName, 'ru');
    const inCategory = (r: Row) => !q.category || (r.categorySdId ?? '-') === q.category;
    const rows = all.filter(inCategory).sort(byCategoryThenProduct);

    // New orders for products the warehouse has none of still count: they are what
    // is oversold, so they show with 0 on hand and a negative «доступно».
    const ordered = await this.newOrders();
    const listed = new Set(rows.map((r) => `${r.warehouseSdId}:${r.productSdId}`));
    const missing = ordered.filter((o) => !listed.has(`${o.warehouse}:${o.product}`) && (!q.warehouse || o.warehouse === q.warehouse));
    const productName = new Map(
      (await this.prisma.product.findMany({ where: { sdId: { in: [...new Set(missing.map((o) => o.product))] } }, select: { sdId: true, name: true } }))
        .map((p) => [p.sdId, p.name]),
    );
    const search = q.search?.toLocaleLowerCase('ru');
    const orderedOnly = missing
      .map((o): Row => {
        const categorySdId = categoryOf.get(o.product) ?? null;
        return {
          warehouseSdId: o.warehouse,
          warehouseName: n.warehouse.get(o.warehouse) ?? o.warehouse,
          categorySdId,
          categoryName: categorySdId ? (categoryName.get(categorySdId) ?? categorySdId) : null,
          productSdId: o.product,
          productName: productName.get(o.product) ?? o.name ?? o.product,
          quantity: s3(new Prisma.Decimal(0)),
        };
      })
      .filter((r) => inCategory(r) && (!search || r.productName.toLocaleLowerCase('ru').includes(search)));

    return {
      warehouses: n.warehouses,
      categories: [...offered].map(([sdId, name]) => ({ sdId, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      uncategorized: all.some((r) => r.categorySdId === null),
      rows,
      ...(await this.valuation([...rows, ...orderedOnly].sort(byCategoryThenProduct), ordered)),
    };
  }

  /** Units in new orders (status 1: not sent yet) per warehouse and product. */
  private async newOrders() {
    const rows = await this.prisma.$queryRaw<Array<{ warehouse: string | null; product: string; name: string | null; quantity: Prisma.Decimal }>>`
      SELECT o."warehouseSdId" AS warehouse, l."productSdId" AS product, MAX(l."productName") AS name, SUM(l.quantity) AS quantity
      FROM "OrderLine" l JOIN "Order" o ON o."sdId" = l."orderSdId"
      WHERE o.status = 1 AND l."productSdId" IS NOT NULL
      GROUP BY 1, 2`;
    return rows.map((r) => ({ warehouse: r.warehouse ?? '', product: r.product, name: r.name, quantity: new Prisma.Decimal(r.quantity) }));
  }

  /**
   * Stock by category, then SKU, like Salesdoc's «Общее / Финансовое состояние склада»:
   * on hand, new orders (status 1, not shipped yet) and what is left to sell, each in
   * units and in so'm at receipt prices. FIFO per warehouse: new orders take the oldest
   * batch first (spec: «2 л Дюшес came at 11,200, then at 11,300 — 11,200 goes out first»).
   */
  private async valuation(
    rows: Array<{ warehouseSdId: string; productSdId: string; productName: string; categorySdId: string | null; categoryName: string | null; quantity: string }>,
    ordered: Array<{ warehouse: string; product: string; quantity: Prisma.Decimal }>,
  ) {
    const productIds = [...new Set(rows.map((r) => r.productSdId))];
    const hidden = (await this.prisma.purchaseHidden.findMany({ select: { purchaseSdId: true } })).map((h) => h.purchaseSdId);
    const [products, lines] = await Promise.all([
      this.prisma.product.findMany({ where: { sdId: { in: productIds } }, select: { sdId: true, code1c: true, raw: true } }),
      this.prisma.purchaseLine.findMany({
        where: { productSdId: { in: productIds }, purchaseSdId: { notIn: hidden } },
        select: { productSdId: true, quantity: true, price: true, purchase: { select: { date: true, warehouseSdId: true } } },
      }),
    ]);

    const receipts = new Map<string, Receipt[]>(); // "<warehouse>:<product>"
    const latest = new Map<string, { date: Date; price: Prisma.Decimal }>(); // product, any warehouse
    for (const l of lines) {
      const r = { date: l.purchase.date, quantity: l.quantity, price: l.price };
      const key = `${l.purchase.warehouseSdId ?? ''}:${l.productSdId}`;
      receipts.set(key, [...(receipts.get(key) ?? []), r]);
      const prev = latest.get(l.productSdId!);
      if (!prev || prev.date < r.date) latest.set(l.productSdId!, r);
    }
    const orderedQty = new Map(ordered.map((o) => [`${o.warehouse}:${o.product}`, o.quantity]));
    const info = new Map(products.map((p) => [p.sdId, p]));

    type Money = { actual: Valued; ordered: Valued; available: Valued };
    const zero = (): Money => ({ actual: zeroValued(), ordered: zeroValued(), available: zeroValued() });
    const add = (a: Money, b: Money): Money => ({
      actual: addValued(a.actual, b.actual),
      ordered: addValued(a.ordered, b.ordered),
      available: addValued(a.available, b.available),
    });
    const out = (m: Money) => {
      const v = (x: Valued) => ({ quantity: s3(x.quantity), sum: s2(x.sum), unpriced: s3(x.unpriced) });
      return { actual: v(m.actual), ordered: v(m.ordered), available: v(m.available) };
    };

    const groups = new Map<string, { categorySdId: string | null; categoryName: string | null; money: Money; items: Map<string, { productSdId: string; productName: string; money: Money }> }>();
    let total = zero();
    for (const r of rows) {
      const key = `${r.warehouseSdId}:${r.productSdId}`;
      const m = valueStock(
        new Prisma.Decimal(r.quantity),
        orderedQty.get(key) ?? new Prisma.Decimal(0),
        receipts.get(key) ?? [],
        latest.get(r.productSdId)?.price ?? null,
      );
      const gKey = r.categorySdId ?? '-';
      const g = groups.get(gKey) ?? { categorySdId: r.categorySdId, categoryName: r.categoryName, money: zero(), items: new Map() };
      const item = g.items.get(r.productSdId) ?? { productSdId: r.productSdId, productName: r.productName, money: zero() };
      item.money = add(item.money, m);
      g.items.set(r.productSdId, item);
      g.money = add(g.money, m);
      groups.set(gKey, g);
      total = add(total, m);
    }

    // Salesdoc's article is not in our schema; read it from the product as received.
    const article = (raw: unknown) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const v = r.article ?? r.artikul ?? r.sku;
      return v == null || v === '' ? null : String(v);
    };
    return {
      totals: out(total),
      groups: [...groups.values()].map((g) => ({
        categorySdId: g.categorySdId,
        categoryName: g.categoryName,
        ...out(g.money),
        items: [...g.items.values()].map((i) => ({
          productSdId: i.productSdId,
          productName: i.productName,
          article: article(info.get(i.productSdId)?.raw),
          code: info.get(i.productSdId)?.code1c ?? null,
          ...out(i.money),
        })),
      })),
    };
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
