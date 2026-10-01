import { Prisma } from '../generated/prisma/client.js';
import { money, qty } from './money.js';
import { parseSdDate, requireSdDate } from './salesdoc-date.js';

/** A Salesdoc row: loosely typed, read defensively. */
export type Raw = Record<string, any>;

const ref = (o: Raw | null | undefined): string | null => o?.SD_id ?? null;
const active = (v: unknown) => v === true || v === 'Y' || v === 1;
const json = (r: Raw) => r as Prisma.InputJsonValue;

function base(r: Raw, seenAt: Date) {
  return {
    sdId: String(r.SD_id),
    csId: r.CS_id ?? null,
    code1c: r.code_1C ?? null,
    name: String(r.name ?? r.SD_id),
    active: active(r.active),
    raw: json(r),
    seenAt,
  };
}

export const mapPaymentType = (r: Raw, seenAt: Date) => ({ ...base(r, seenAt), short: r.short ?? null });
export const mapCashbox = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapWarehouse = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapSupplier = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapAgent = (r: Raw, seenAt: Date) => base(r, seenAt);
export const mapExpeditor = (r: Raw, seenAt: Date) => base(r, seenAt);

export const mapProduct = (r: Raw, seenAt: Date) => ({
  ...base(r, seenAt),
  packQuantity: r.packQuantity == null ? null : Number(r.packQuantity),
});

export const mapOutlet = (r: Raw, seenAt: Date) => ({
  ...base(r, seenAt),
  firmName: r.firmName ?? null,
  inn: r.inn ?? null,
  address: r.address ?? null,
  expeditorSdId: ref(r.expeditor),
  updatedAtSd: parseSdDate(r.updatedAt),
});

/** Salesdoc reports debt as a negative balance; we store the debt itself. */
export const mapBalance = (r: Raw, seenAt: Date) => ({
  sdId: String(r.SD_id),
  name: r.name ?? null,
  debt: money(r.balance).neg(),
  raw: json(r),
  seenAt,
});

/** getStock returns one row per warehouse with its products inside. */
export function mapStock(r: Raw, seenAt: Date) {
  const warehouseSdId = String(r.SD_id);
  return ((r.products ?? []) as Raw[]).map((p) => ({
    sdId: `${warehouseSdId}:${p.SD_id}`,
    warehouseSdId,
    productSdId: String(p.SD_id),
    productName: String(p.name ?? p.SD_id),
    quantity: qty(p.quantity),
    seenAt,
  }));
}

/** getPurchase returns the warehouse fields at top level and the receipt in purchase_id/detail. */
export function mapPurchase(r: Raw, seenAt: Date) {
  const csId = String(r.purchase_id);
  const lines = ((r.detail ?? []) as Raw[]).map((l) => ({
    productSdId: ref(l),
    productName: String(l.name ?? l.SD_id ?? ''),
    quantity: qty(l.quantity),
    price: money(l.price),
    amount: money(l.amount),
  }));
  const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
  return {
    row: {
      sdId: csId.replace(/^f\d+-/, ''),
      csId,
      date: requireSdDate(r.date, 'purchase date'),
      updatedAtSd: parseSdDate(r.updated),
      warehouseSdId: r.SD_id ?? null,
      supplierSdId: ref(r.shipper),
      total,
      raw: json(r),
      seenAt,
    },
    lines,
  };
}

export function mapOrder(r: Raw, seenAt: Date) {
  return {
    row: {
      sdId: String(r.SD_id),
      csId: r.CS_id ?? null,
      code1c: r.code_1C ?? null,
      status: Number(r.status),
      dateDocument: requireSdDate(r.dateDocument ?? r.dateCreate, 'order date'),
      dateCreate: parseSdDate(r.dateCreate),
      dateDelivered: parseSdDate(r.dateDelivered),
      totalSumma: money(r.totalSumma),
      discountSumma: money(r.discountSumma),
      totalAfterDiscount: money(r.totalSummaAfterDiscount),
      totalReturnsSumma: money(r.totalReturnsSumma),
      debtDateExp: parseSdDate(r.debtDateExp),
      outletSdId: ref(r.client),
      agentSdId: ref(r.agent),
      expeditorSdId: ref(r.expeditor),
      warehouseSdId: ref(r.store),
      paymentTypeSdId: ref(r.paymentType),
      raw: json(r),
      seenAt,
    },
    lines: ((r.orderProducts ?? []) as Raw[]).map((l) => ({
      productSdId: ref(l.product),
      productName: l.product?.name ?? null,
      quantity: qty(l.quantity),
      price: money(l.price),
      discount: money(l.discount),
      summa: money(l.summa),
      returned: qty(l.returned),
    })),
  };
}

/** Salesdoc sends return totals as negative numbers; we store the positive amount. */
export function mapReturn(r: Raw, seenAt: Date) {
  return {
    row: {
      sdId: String(r.SD_id),
      csId: r.CS_id ?? null,
      status: Number(r.status),
      dateDocument: requireSdDate(r.dateLoad ?? r.date, 'return date'),
      amount: money(r.summa ?? r.totalSumma).abs(),
      outletSdId: ref(r.client),
      agentSdId: ref(r.agent),
      expeditorSdId: ref(r.expeditor),
      warehouseSdId: ref(r.store),
      reason: r.reason == null ? null : String(r.reason),
      raw: json(r),
      seenAt,
    },
    lines: ((r.defectProducts ?? []) as Raw[]).map((l) => ({
      productSdId: ref(l.product),
      quantity: qty(l.quantity),
      price: money(l.price),
      summa: money(l.summa).abs(),
    })),
  };
}

export function mapPayment(r: Raw, seenAt: Date) {
  return {
    row: {
      sdId: String(r.SD_id),
      csId: r.CS_id ?? null,
      code1c: r.code_1C ?? null,
      paymentDate: requireSdDate(r.paymentDate, 'payment date'),
      amount: money(r.amount),
      transactionType: Number(r.transactionType),
      paymentTypeSdId: ref(r.paymentType),
      outletSdId: ref(r.client),
      agentSdId: ref(r.agent),
      cashboxSdId: ref(r.cashbox),
      comment: r.comment ?? null,
      raw: json(r),
      seenAt,
    },
    lines: ((r.orders ?? []) as Raw[])
      .filter((o) => o.SD_id)
      .map((o) => ({ orderSdId: String(o.SD_id), amount: money(o.amount) })),
  };
}
