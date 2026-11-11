import { Prisma } from '../generated/prisma/client.js';

type Dec = Prisma.Decimal;
const D = (v: number | string | Dec) => new Prisma.Decimal(v);

export interface Receipt {
  date: Date;
  quantity: Dec;
  price: Dec;
}

/** A batch still in stock; price null = no receipt tells us what it cost. */
export interface Layer {
  quantity: Dec;
  price: Dec | null;
}

export interface Valued {
  quantity: Dec;
  /** Sum of the priced units. */
  sum: Dec;
  /** Units no receipt prices; they are left out of `sum`. */
  unpriced: Dec;
}

/**
 * What is on hand under FIFO, oldest batch first. Goods leave oldest first, so
 * what is left are the newest receipts: walk receipts from the newest back
 * until they cover `onHand`. Stock older than the stored receipts is priced at
 * the oldest receipt we have (the closest in time), else at `fallbackPrice`.
 */
export function onHandLayers(onHand: Dec, receipts: Receipt[], fallbackPrice: Dec | null): Layer[] {
  if (onHand.lte(0)) return [];
  const newestFirst = [...receipts]
    .filter((r) => r.quantity.gt(0))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const layers: Layer[] = [];
  let left = onHand;
  for (const r of newestFirst) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(left, r.quantity);
    layers.push({ quantity: take, price: r.price });
    left = left.minus(take);
  }
  if (left.gt(0)) {
    const oldest = newestFirst.at(-1)?.price ?? fallbackPrice;
    layers.push({ quantity: left, price: oldest });
  }
  return layers.reverse();
}

const value = (layers: Layer[]): Valued =>
  layers.reduce<Valued>(
    (v, l) => ({
      quantity: v.quantity.plus(l.quantity),
      sum: l.price ? v.sum.plus(l.quantity.times(l.price)) : v.sum,
      unpriced: l.price ? v.unpriced : v.unpriced.plus(l.quantity),
    }),
    { quantity: D(0), sum: D(0), unpriced: D(0) },
  );

/**
 * Splits stock into what new orders will take (the oldest batches, FIFO) and
 * what is left to sell. `onHand` may be negative or below `ordered`; then the
 * shortfall is priced at the newest known price and `available` goes negative.
 */
export function valueStock(onHand: Dec, ordered: Dec, receipts: Receipt[], fallbackPrice: Dec | null) {
  const layers = onHandLayers(onHand, receipts, fallbackPrice);
  const taken: Layer[] = [];
  const kept: Layer[] = [];
  let want = Prisma.Decimal.max(ordered, 0);
  for (const l of layers) {
    const take = Prisma.Decimal.min(want, l.quantity);
    if (take.gt(0)) taken.push({ quantity: take, price: l.price });
    if (l.quantity.gt(take)) kept.push({ quantity: l.quantity.minus(take), price: l.price });
    want = want.minus(take);
  }
  const newest =
    layers.at(-1)?.price ??
    [...receipts].sort((a, b) => b.date.getTime() - a.date.getTime())[0]?.price ??
    fallbackPrice;
  if (want.gt(0)) taken.push({ quantity: want, price: newest });

  const actual = value(layers);
  const reserved = value(taken);
  // Negative stock has no batches; show the quantity, value nothing.
  if (onHand.lt(0)) actual.quantity = onHand;
  const available: Valued = {
    quantity: onHand.minus(Prisma.Decimal.max(ordered, 0)),
    sum: actual.sum.minus(reserved.sum),
    unpriced: Prisma.Decimal.max(actual.unpriced.minus(reserved.unpriced), 0),
  };
  return { actual, ordered: reserved, available };
}

export const addValued = (a: Valued, b: Valued): Valued => ({
  quantity: a.quantity.plus(b.quantity),
  sum: a.sum.plus(b.sum),
  unpriced: a.unpriced.plus(b.unpriced),
});

export const zeroValued = (): Valued => ({ quantity: D(0), sum: D(0), unpriced: D(0) });
