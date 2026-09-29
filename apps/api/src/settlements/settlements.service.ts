import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { SyncService } from '../sync/sync.service.js';
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

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /** One row per outlet with opening, period movements and closing. */
  private balancesSql(p: Period) {
    return Prisma.sql`
      WITH mv AS (${MOVEMENTS}),
      agg AS (
        SELECT outlet,
          SUM(CASE WHEN d < ${p.fromDay}::timestamp THEN amount ELSE 0 END) AS opening,
          SUM(CASE WHEN d >= ${p.fromDay}::timestamp AND kind = 'order' THEN amount ELSE 0 END) AS delivered,
          SUM(CASE WHEN d >= ${p.fromDay}::timestamp AND kind = 'return' THEN -amount ELSE 0 END) AS returned,
          SUM(CASE WHEN d >= ${p.fromDay}::timestamp AND kind = 'payment' THEN -amount ELSE 0 END) AS paid,
          SUM(amount) AS closing
        FROM mv WHERE d < ${p.toExclusiveDay}::timestamp
        GROUP BY outlet
      )
      SELECT agg.*, COALESCE(o.name, agg.outlet) AS name, o."firmName", o.inn, o."expeditorSdId"
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
      SELECT SUM(amount) AS opening FROM (${MOVEMENTS}) mv
      WHERE outlet = ${outletSdId} AND d < ${p.fromDay}::timestamp`;
    const moves = await this.prisma.$queryRaw<Array<{ kind: 'order' | 'return' | 'payment'; sdId: string; d: Date; amount: Dec }>>`
      SELECT kind, "sdId", d, amount FROM (${MOVEMENTS}) mv
      WHERE outlet = ${outletSdId} AND d >= ${p.fromDay}::timestamp AND d < ${p.toExclusiveDay}::timestamp
      ORDER BY d, kind, "sdId"`;
    if (!outlet && moves.length === 0 && opening === null) {
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

  /** §4.2 goods side; supplier payments arrive with the cash-entries plan. */
  async supplierStatement(p: Period) {
    const [{ opening }] = await this.prisma.$queryRaw<Array<{ opening: Dec | null }>>`
      SELECT SUM(total) AS opening FROM "Purchase" WHERE date < ${p.fromDay}::timestamp`;
    const purchases = await this.prisma.purchase.findMany({
      where: { date: { gte: p.from, lt: p.toExclusive } },
      orderBy: [{ date: 'asc' }, { sdId: 'asc' }],
    });
    const warehouses = new Map(
      (await this.prisma.warehouse.findMany()).map((w) => [w.sdId, w.name]),
    );
    let balance = new Prisma.Decimal(opening ?? 0);
    let received = new Prisma.Decimal(0);
    const rows = purchases.map((pu) => {
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
    });
    return { opening: s(opening), received: s(received), paid: s(0), closing: s(balance), rows };
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
