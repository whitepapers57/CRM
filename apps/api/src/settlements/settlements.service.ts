import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SyncService } from '../sync/sync.service.js';
import { cashNumber } from '../cash/operations.js';
import type { Period } from './period.js';

type Dec = Prisma.Decimal;
const s = (v: Dec | number | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);

export interface OutletBalance {
  outletSdId: string;
  name: string;
  firmName: string | null;
  inn: string | null;
  opening: string;
  delivered: string;
  returned: string;
  paid: string;
  closing: string;
}

export interface BalanceQuery {
  search?: string;
  expeditor?: string;
  agent?: string;
  nonZero?: boolean;
  page?: number;
  pageSize?: number;
}

/** Outlet movements: §4.1 of the spec. Orders and returns count at status 3 or 4, payments at type 3. */
const MOVEMENTS = Prisma.sql`
  SELECT "outletSdId" AS outlet, "dateDocument" AS d, 'order' AS kind, "sdId", "totalAfterDiscount" AS amount
    FROM "Order" WHERE status IN (3, 4) AND "outletSdId" IS NOT NULL
  UNION ALL
  SELECT "outletSdId", "dateDocument", 'return', "sdId", -amount
    FROM "OutletReturn" WHERE status IN (3, 4) AND "outletSdId" IS NOT NULL
  UNION ALL
  SELECT "outletSdId", "paymentDate", 'payment', "sdId", -amount
    FROM "Payment" WHERE "transactionType" = 3 AND "outletSdId" IS NOT NULL`;

/** Supplier key for receipts that have none, so the supplier rows add up to all receipts. */
export const NO_SUPPLIER = '-';

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /**
   * One row per outlet with opening, period movements and closing. Only a
   * window of history is stored, so balances are anchored on Salesdoc's
   * current balance (spec §4.1): balance at t = anchor − Σ movements dated ≥ t.
   */
  private balancesSql(p: Period) {
    return Prisma.sql`
      WITH mv AS (${MOVEMENTS}),
      ids AS (SELECT outlet FROM mv UNION SELECT "sdId" FROM "OutletBalance"),
      agg AS (
        SELECT ids.outlet,
          COALESCE(MAX(b.debt), 0) AS anchor,
          COALESCE(SUM(CASE WHEN mv.d >= ${p.fromDay}::timestamp THEN mv.amount END), 0) AS after_from,
          COALESCE(SUM(CASE WHEN mv.d >= ${p.toExclusiveDay}::timestamp THEN mv.amount END), 0) AS after_to,
          COALESCE(SUM(CASE WHEN mv.d >= ${p.fromDay}::timestamp AND mv.d < ${p.toExclusiveDay}::timestamp AND mv.kind = 'order' THEN mv.amount END), 0) AS delivered,
          COALESCE(SUM(CASE WHEN mv.d >= ${p.fromDay}::timestamp AND mv.d < ${p.toExclusiveDay}::timestamp AND mv.kind = 'return' THEN -mv.amount END), 0) AS returned,
          COALESCE(SUM(CASE WHEN mv.d >= ${p.fromDay}::timestamp AND mv.d < ${p.toExclusiveDay}::timestamp AND mv.kind = 'payment' THEN -mv.amount END), 0) AS paid
        FROM ids
        LEFT JOIN mv ON mv.outlet = ids.outlet
        LEFT JOIN "OutletBalance" b ON b."sdId" = ids.outlet
        GROUP BY ids.outlet
      )
      SELECT agg.outlet, agg.delivered, agg.returned, agg.paid,
        agg.anchor - agg.after_from AS opening,
        agg.anchor - agg.after_to AS closing,
        COALESCE(o.name, agg.outlet) AS name, o."firmName", o.inn, o."expeditorSdId"
      FROM agg LEFT JOIN "Outlet" o ON o."sdId" = agg.outlet`;
  }

  async outletBalances(p: Period, q: BalanceQuery): Promise<{ total: number; rows: OutletBalance[] }> {
    const where: Prisma.Sql[] = [];
    if (q.search) {
      const like = `%${q.search}%`;
      where.push(Prisma.sql`(b.name ILIKE ${like} OR b."firmName" ILIKE ${like} OR b.inn ILIKE ${like})`);
    }
    if (q.expeditor) where.push(Prisma.sql`b."expeditorSdId" = ${q.expeditor}`);
    if (q.agent) {
      where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Order" x WHERE x."outletSdId" = b.outlet AND x."agentSdId" = ${q.agent})`);
    }
    if (q.nonZero) where.push(Prisma.sql`b.closing <> 0`);
    const filter = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const pageSize = Math.min(q.pageSize ?? 50, 200);
    const offset = ((q.page ?? 1) - 1) * pageSize;

    const rows = await this.prisma.$queryRaw<Array<Record<string, any>>>`
      SELECT b.*, COUNT(*) OVER () AS total
      FROM (${this.balancesSql(p)}) b ${filter}
      ORDER BY b.closing DESC, b.outlet
      LIMIT ${pageSize} OFFSET ${offset}`;

    return {
      total: rows.length ? Number(rows[0].total) : 0,
      rows: rows.map((r) => ({
        outletSdId: r.outlet,
        name: r.name,
        firmName: r.firmName ?? null,
        inn: r.inn ?? null,
        opening: s(r.opening),
        delivered: s(r.delivered),
        returned: s(r.returned),
        paid: s(r.paid),
        closing: s(r.closing),
      })),
    };
  }

  async outletStatement(outletSdId: string, p: Period) {
    const outlet = await this.prisma.outlet.findUnique({ where: { sdId: outletSdId } });
    const [{ opening }] = await this.prisma.$queryRaw<Array<{ opening: Dec | null }>>`
      SELECT COALESCE((SELECT debt FROM "OutletBalance" WHERE "sdId" = ${outletSdId}), 0)
        - COALESCE((SELECT SUM(amount) FROM (${MOVEMENTS}) mv
                    WHERE outlet = ${outletSdId} AND d >= ${p.fromDay}::timestamp), 0) AS opening`;
    const moves = await this.prisma.$queryRaw<Array<{ kind: 'order' | 'return' | 'payment'; sdId: string; d: Date; amount: Dec }>>`
      SELECT kind, "sdId", d, amount FROM (${MOVEMENTS}) mv
      WHERE outlet = ${outletSdId} AND d >= ${p.fromDay}::timestamp AND d < ${p.toExclusiveDay}::timestamp
      ORDER BY d, kind, "sdId"`;
    const anchored = await this.prisma.outletBalance.findUnique({ where: { sdId: outletSdId } });
    if (!outlet && !anchored && moves.length === 0) {
      throw new NotFoundException(`Outlet ${outletSdId} not found`);
    }

    let balance = new Prisma.Decimal(opening ?? 0);
    const rows = moves.map((m) => {
      balance = balance.plus(m.amount);
      return { kind: m.kind, sdId: m.sdId, date: m.d.toISOString(), amount: s(m.amount), balance: s(balance) };
    });
    return {
      outlet: {
        sdId: outletSdId,
        name: outlet?.name ?? outletSdId,
        firmName: outlet?.firmName ?? null,
        inn: outlet?.inn ?? null,
      },
      opening: s(opening),
      closing: s(balance),
      rows,
    };
  }

  /** §4.2: receipts plus supplier payments from the cash module (statement sign: we owe = positive). */
  async supplierStatement(p: Period, supplierSdId?: string) {
    // NO_SUPPLIER selects receipts Salesdoc sent without a supplier.
    const only =
      supplierSdId === NO_SUPPLIER
        ? Prisma.sql`AND "supplierSdId" IS NULL`
        : supplierSdId
          ? Prisma.sql`AND "supplierSdId" = ${supplierSdId}`
          : Prisma.empty;
    const [{ opening }] = await this.prisma.$queryRaw<Array<{ opening: Dec | null }>>`
      SELECT SUM(total) AS opening FROM "Purchase"
      WHERE date >= ${p.windowStart}::timestamp AND date < ${p.fromDay}::timestamp ${only}
        AND "sdId" NOT IN (SELECT "purchaseSdId" FROM "PurchaseHidden")`;
    const purchases = await this.prisma.purchase.findMany({
      where: {
        date: { gte: p.from, lt: p.toExclusive },
        ...(supplierSdId ? { supplierSdId: supplierSdId === NO_SUPPLIER ? null : supplierSdId } : {}),
        sdId: { notIn: (await this.prisma.purchaseHidden.findMany({ select: { purchaseSdId: true } })).map((h) => h.purchaseSdId) },
      },
      orderBy: [{ date: 'asc' }, { sdId: 'asc' }],
    });
    const warehouses = new Map(
      (await this.prisma.warehouse.findMany()).map((w) => [w.sdId, w.name]),
    );
    // Supplier payments/refunds from the cash module (cancelled ones never count).
    const supplierFilter =
      supplierSdId === NO_SUPPLIER ? { supplierSdId: '__none__' } : supplierSdId ? { supplierSdId } : { supplierSdId: { not: null } };
    const payOps = await this.prisma.cashOperation.findMany({
      where: {
        operation: { in: ['supplier_payment', 'supplier_refund'] },
        cancelledAt: null,
        date: { gte: new Date(`${p.windowStart}T00:00:00Z`), lt: p.toExclusive },
        ...supplierFilter,
      },
      orderBy: [{ date: 'asc' }, { seq: 'asc' }],
    });
    const signed = (o: (typeof payOps)[number]) => (o.operation === 'supplier_refund' ? o.amount.neg() : o.amount);
    const paidBefore = payOps.filter((o) => o.date < p.from).reduce((sum, o) => sum.plus(signed(o)), new Prisma.Decimal(0));
    const paidIn = payOps.filter((o) => o.date >= p.from);

    const openingBal = new Prisma.Decimal(opening ?? 0).minus(paidBefore);
    let balance = openingBal;
    let received = new Prisma.Decimal(0);
    let paid = new Prisma.Decimal(0);
    // Timeline: by day, purchases before payments on the same day, payments by seq.
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const timeline = [
      ...purchases.map((pu) => ({ day: day(pu.date), order: 0, pu })),
      ...paidIn.map((op) => ({ day: day(op.date), order: 1, op })),
    ]
      .map((e, i) => ({ e, i }))
      .sort((x, y) => (x.e.day < y.e.day ? -1 : x.e.day > y.e.day ? 1 : x.e.order - y.e.order || x.i - y.i))
      .map((x) => x.e);
    const rows = timeline.map((e) => {
      if ('pu' in e) {
        const pu = e.pu;
        balance = balance.plus(pu.total);
        received = received.plus(pu.total);
        return {
          kind: 'purchase' as const,
          sdId: pu.sdId,
          date: pu.date.toISOString(),
          warehouseName: pu.warehouseSdId ? (warehouses.get(pu.warehouseSdId) ?? null) : null,
          amount: s(pu.total),
          balance: s(balance),
        };
      }
      const amt = signed(e.op);
      balance = balance.minus(amt);
      paid = paid.plus(amt);
      return {
        kind: 'payment' as const,
        sdId: cashNumber(e.op.seq),
        date: e.op.date.toISOString(),
        warehouseName: null,
        amount: s(amt),
        balance: s(balance),
      };
    });
    return { opening: s(openingBal), received: s(received), paid: s(paid), closing: s(balance), rows };
  }

  /**
   * One row per supplier (Salesdoc's list plus any supplier id found on a
   * receipt). debt follows 1C «Долг (+ нам, − мы)»: what we owe is negative.
   */
  async suppliers(p: Period) {
    const [listed, sums, pays] = await Promise.all([
      this.prisma.supplier.findMany({ select: { sdId: true, name: true } }),
      this.prisma.$queryRaw<Array<{ supplier: string; received: Dec; balance: Dec }>>`
        SELECT COALESCE("supplierSdId", ${NO_SUPPLIER}) AS supplier,
          SUM(CASE WHEN date >= ${p.fromDay}::timestamp THEN total ELSE 0 END) AS received,
          SUM(total) AS balance
        FROM "Purchase"
        WHERE date >= ${p.windowStart}::timestamp AND date < ${p.toExclusiveDay}::timestamp
          AND "sdId" NOT IN (SELECT "purchaseSdId" FROM "PurchaseHidden")
        GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ supplier: string; paid: Dec; paidAll: Dec }>>`
        SELECT "supplierSdId" AS supplier,
          SUM(CASE WHEN date >= ${p.fromDay}::date THEN (CASE WHEN operation = 'supplier_refund' THEN -amount ELSE amount END) ELSE 0 END) AS paid,
          SUM(CASE WHEN operation = 'supplier_refund' THEN -amount ELSE amount END) AS "paidAll"
        FROM "CashOperation"
        WHERE operation IN ('supplier_payment', 'supplier_refund') AND "cancelledAt" IS NULL AND "supplierSdId" IS NOT NULL
          AND date >= ${p.windowStart}::date AND date < ${p.toExclusiveDay}::date
        GROUP BY 1`,
    ]);
    const names = new Map(listed.map((x) => [x.sdId, x.name]));
    const bySupplier = new Map(sums.map((r) => [r.supplier, r]));
    const paidBy = new Map(pays.map((r) => [r.supplier, r]));
    const ids = new Set([...names.keys(), ...bySupplier.keys(), ...paidBy.keys()]);
    const rows = [...ids].map((sdId) => {
      const r = bySupplier.get(sdId);
      const pay = paidBy.get(sdId);
      const paid = new Prisma.Decimal(pay?.paid ?? 0);
      const paidAll = new Prisma.Decimal(pay?.paidAll ?? 0);
      // 1C sign: we owe = negative. owed = receipts − payments; opening/debt are its negation.
      const owedAll = new Prisma.Decimal(r?.balance ?? 0).minus(paidAll);
      const owedBefore = new Prisma.Decimal(r?.balance ?? 0).minus(r?.received ?? 0).minus(paidAll.minus(paid));
      const z = (v: Dec) => (v.isZero() ? s(0) : s(v.neg()));
      return {
        sdId,
        name: names.get(sdId) ?? sdId,
        opening: z(owedBefore),
        received: s(r?.received),
        paid: s(paid),
        debt: z(owedAll),
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return { rows };
  }

  async summary(p: Period) {
    const [o] = await this.prisma.$queryRaw<Array<Record<string, Dec | null>>>`
      SELECT
        SUM(CASE WHEN closing > 0 THEN closing ELSE 0 END) AS receivable,
        SUM(CASE WHEN closing < 0 THEN -closing ELSE 0 END) AS prepaid,
        SUM(delivered) AS delivered, SUM(returned) AS returned, SUM(paid) AS paid
      FROM (${this.balancesSql(p)}) b`;
    const supplier = await this.supplierStatement(p);
    const { dataAsOf } = await this.sync.status();
    return {
      period: { from: p.fromDay, to: p.toDay },
      windowStart: p.windowStart,
      dataAsOf,
      outlets: {
        receivable: s(o.receivable),
        prepaid: s(o.prepaid),
        delivered: s(o.delivered),
        returned: s(o.returned),
        paid: s(o.paid),
      },
      supplier: { received: supplier.received, paid: supplier.paid, owed: supplier.closing },
    };
  }

  async outletFilters() {
    const [agents, expeditors] = await Promise.all([
      this.prisma.agent.findMany({ orderBy: { name: 'asc' }, select: { sdId: true, name: true } }),
      this.prisma.expeditor.findMany({ orderBy: { name: 'asc' }, select: { sdId: true, name: true } }),
    ]);
    return { agents, expeditors };
  }
}
