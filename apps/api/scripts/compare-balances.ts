/**
 * SUPERSEDED 29 Sep 2026 by the three-month window: outlet balances are now anchored
 * on Salesdoc getBalance, so ours equal Salesdoc by construction. Kept for reference.
 *
 * One-off check (spec §4.7): our computed outlet closing balance vs
 * Salesdoc's getBalance (negative there = debt, so compare ours with -balance).
 * Run: cd apps/api && npx tsx scripts/compare-balances.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client.js';
import { SalesdocClient } from '../src/salesdoc/salesdoc.client.js';
import { SalesdocCredentialsStore } from '../src/salesdoc/salesdoc-credentials.store.js';

process.loadEnvFile();
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const client = new SalesdocClient(new SalesdocCredentialsStore());

const ours = await prisma.$queryRaw<Array<{ outlet: string; closing: Prisma.Decimal }>>`
  SELECT outlet, SUM(amount) AS closing FROM (
    SELECT "outletSdId" AS outlet, "totalAfterDiscount" AS amount FROM "Order" WHERE status IN (3,4)
    UNION ALL SELECT "outletSdId", -amount FROM "OutletReturn" WHERE status IN (3,4)
    UNION ALL SELECT "outletSdId", -amount FROM "Payment" WHERE "transactionType" = 3
  ) mv WHERE outlet IS NOT NULL GROUP BY outlet`;
const mine = new Map(ours.map((r) => [r.outlet, new Prisma.Decimal(r.closing)]));

const theirs = await client.fetchAll<{ SD_id: string; name: string; balance: number }>('getBalance', 'balance');
let equal = 0;
const diffs: Array<{ sdId: string; name: string; ours: string; salesdoc: string; diff: string }> = [];
for (const b of theirs) {
  const sd = new Prisma.Decimal(-b.balance).toDecimalPlaces(2);
  const o = (mine.get(b.SD_id) ?? new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (o.minus(sd).abs().lte(1)) equal++;
  else diffs.push({ sdId: b.SD_id, name: b.name, ours: o.toFixed(2), salesdoc: sd.toFixed(2), diff: o.minus(sd).toFixed(2) });
}
diffs.sort((a, b) => Math.abs(Number(b.diff)) - Math.abs(Number(a.diff)));
console.log(`Outlets compared: ${theirs.length}; equal within 1 UZS: ${equal}; different: ${diffs.length}`);
console.table(diffs.slice(0, 20));
await prisma.$disconnect();
