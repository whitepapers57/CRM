import type { Prisma } from '../generated/prisma/client.js';
import {
  mapAgent,
  mapBalance,
  mapCashbox,
  mapExpeditor,
  mapOrder,
  mapOutlet,
  mapPayment,
  mapPaymentType,
  mapProduct,
  mapPurchase,
  mapReturn,
  mapStock,
  mapSupplier,
  mapWarehouse,
  type Raw,
} from './mappers.js';

export type Tx = Prisma.TransactionClient;

export interface ResourceDef {
  name: string;
  method: string;
  resultKey: string;
  mode: 'replace' | 'incremental';
  filter?: Record<string, unknown>;
  updatedBetween?: (from: string, to: string) => Record<string, unknown>;
  /** Full passes only: limit documents to those dated in the stored window. */
  dated?: (from: string, to: string) => Record<string, unknown>;
  save(tx: Tx, rows: Raw[], seenAt: Date): Promise<number>;
  prune(tx: Tx, before: Date): Promise<number>;
  /** Rows seen since `since` (this pass) and rows a prune at `since` would delete. */
  seen(tx: Tx, since: Date): Promise<{ seen: number; stale: number }>;
}

/** The subset of a Prisma model delegate the savers use. */
interface FlatModel {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/** Last copy of each sdId wins: Salesdoc can repeat a record while data shifts. */
function lastBySdId<T extends { sdId: string }>(items: T[]): T[] {
  return [...new Map(items.map((i) => [i.sdId, i])).values()];
}

async function replaceFlat(model: FlatModel, data: Array<{ sdId: string }>): Promise<number> {
  const unique = lastBySdId(data);
  if (unique.length === 0) return 0;
  await model.deleteMany({ where: { sdId: { in: unique.map((d) => d.sdId) } } });
  return (await model.createMany({ data: unique })).count;
}

/** Parent rows plus child lines; deleting the parent cascades to the old lines. */
async function replaceWithLines<L>(
  parent: FlatModel,
  child: FlatModel,
  parentKey: string,
  mapped: Array<{ row: { sdId: string }; lines: L[] }>,
): Promise<number> {
  const unique = lastBySdId(mapped.map((m) => ({ sdId: m.row.sdId, m }))).map((u) => u.m);
  if (unique.length === 0) return 0;
  await parent.deleteMany({ where: { sdId: { in: unique.map((u) => u.row.sdId) } } });
  const count = (await parent.createMany({ data: unique.map((u) => u.row) })).count;
  const lines = unique.flatMap((u) =>
    u.lines.map((l) => ({ ...(l as Record<string, unknown>), [parentKey]: u.row.sdId })),
  );
  if (lines.length) await child.createMany({ data: lines });
  return count;
}

const pruneModel = (model: FlatModel, before: Date) =>
  model.deleteMany({ where: { seenAt: { lt: before } } }).then((r) => r.count);

const seenModel = async (model: FlatModel, since: Date) => ({
  seen: await model.count({ where: { seenAt: { gte: since } } }),
  stale: await model.count({ where: { seenAt: { lt: since } } }),
});

const m = (tx: Tx) => ({
  paymentType: tx.paymentType as unknown as FlatModel,
  cashbox: tx.cashbox as unknown as FlatModel,
  warehouse: tx.warehouse as unknown as FlatModel,
  supplier: tx.supplier as unknown as FlatModel,
  agent: tx.agent as unknown as FlatModel,
  expeditor: tx.expeditor as unknown as FlatModel,
  product: tx.product as unknown as FlatModel,
  stockLevel: tx.stockLevel as unknown as FlatModel,
  outlet: tx.outlet as unknown as FlatModel,
  outletBalance: tx.outletBalance as unknown as FlatModel,
  purchase: tx.purchase as unknown as FlatModel,
  purchaseLine: tx.purchaseLine as unknown as FlatModel,
  order: tx.order as unknown as FlatModel,
  orderLine: tx.orderLine as unknown as FlatModel,
  ret: tx.outletReturn as unknown as FlatModel,
  returnLine: tx.returnLine as unknown as FlatModel,
  payment: tx.payment as unknown as FlatModel,
  allocation: tx.paymentAllocation as unknown as FlatModel,
});

type Models = ReturnType<typeof m>;

function flat(
  name: string,
  method: string,
  resultKey: string,
  model: keyof Models,
  map: (r: Raw, seenAt: Date) => { sdId: string },
): ResourceDef {
  return {
    name,
    method,
    resultKey,
    mode: 'replace',
    save: (tx, rows, seenAt) => replaceFlat(m(tx)[model], rows.map((r) => map(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx)[model], before),
    seen: (tx, since) => seenModel(m(tx)[model], since),
  };
}

const updatePeriod = (key: string) => (from: string, to: string) => ({
  period: { [key]: { from, to } },
});
const dated = updatePeriod('date');

/** In sync order: reference data first, then documents. */
export const RESOURCES: ResourceDef[] = [
  flat('paymentTypes', 'getPaymentType', 'currency', 'paymentType', mapPaymentType),
  flat('cashboxes', 'getCashbox', 'cashbox', 'cashbox', mapCashbox),
  flat('warehouses', 'getWarehouse', 'warehouse', 'warehouse', mapWarehouse),
  flat('suppliers', 'getShipper', 'shipper', 'supplier', mapSupplier),
  flat('agents', 'getAgent', 'agent', 'agent', mapAgent),
  flat('expeditors', 'getExpeditor', 'expeditor', 'expeditor', mapExpeditor),
  flat('products', 'getProduct', 'product', 'product', mapProduct),
  {
    name: 'stock',
    method: 'getStock',
    resultKey: 'warehouse',
    mode: 'replace',
    save: (tx, rows, seenAt) =>
      replaceFlat(m(tx).stockLevel, rows.flatMap((r) => mapStock(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).stockLevel, before),
    seen: (tx, since) => seenModel(m(tx).stockLevel, since),
  },
  {
    name: 'outlets',
    method: 'getClient',
    resultKey: 'client',
    mode: 'incremental',
    updatedBetween: updatePeriod('update'),
    save: (tx, rows, seenAt) => replaceFlat(m(tx).outlet, rows.map((r) => mapOutlet(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).outlet, before),
    seen: (tx, since) => seenModel(m(tx).outlet, since),
  },
  {
    name: 'purchases',
    method: 'getPurchase',
    resultKey: 'warehouse',
    mode: 'incremental',
    dated,
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).purchase, m(tx).purchaseLine, 'purchaseSdId', rows.map((r) => mapPurchase(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).purchase, before),
    seen: (tx, since) => seenModel(m(tx).purchase, since),
  },
  {
    name: 'orders',
    method: 'getOrder',
    resultKey: 'order',
    mode: 'incremental',
    filter: { status: [1, 2, 3, 4, 5], agent: 'all' },
    dated,
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).order, m(tx).orderLine, 'orderSdId', rows.map((r) => mapOrder(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).order, before),
    seen: (tx, since) => seenModel(m(tx).order, since),
  },
  {
    name: 'returns',
    method: 'getOrderDefect',
    resultKey: 'order',
    mode: 'incremental',
    filter: { status: [1, 2, 3, 4, 5] },
    dated,
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).ret, m(tx).returnLine, 'returnSdId', rows.map((r) => mapReturn(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).ret, before),
    seen: (tx, since) => seenModel(m(tx).ret, since),
  },
  {
    name: 'payments',
    method: 'getPayment',
    resultKey: 'payment',
    mode: 'incremental',
    // Never filter by transactionType: Salesdoc applies it after paging.
    dated,
    updatedBetween: updatePeriod('dateUpdate'),
    save: (tx, rows, seenAt) =>
      replaceWithLines(m(tx).payment, m(tx).allocation, 'paymentSdId', rows.map((r) => mapPayment(r, seenAt))),
    prune: (tx, before) => pruneModel(m(tx).payment, before),
    seen: (tx, since) => seenModel(m(tx).payment, since),
  },
  // Last, so the anchor is read after the movements it anchors (spec §4.1).
  flat('balances', 'getBalance', 'balance', 'outletBalance', mapBalance),
];
