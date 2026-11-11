import { Prisma } from '../generated/prisma/client.js';
import { onHandLayers, valueStock, type Receipt } from './fifo.js';

const D = (v: number) => new Prisma.Decimal(v);
const r = (day: number, quantity: number, price: number): Receipt => ({
  date: new Date(Date.UTC(2026, 10, day)),
  quantity: D(quantity),
  price: D(price),
});
const plain = (v: { quantity: Prisma.Decimal; sum: Prisma.Decimal; unpriced: Prisma.Decimal }) => [
  v.quantity.toNumber(),
  v.sum.toNumber(),
  v.unpriced.toNumber(),
];

describe('FIFO stock valuation', () => {
  it('keeps the newest receipts on hand', () => {
    // 100 at 11,200 then 50 at 11,300; 120 left → 50 @ 11,300 + 70 @ 11,200.
    const layers = onHandLayers(D(120), [r(2, 50, 11300), r(1, 100, 11200)], null);
    expect(layers.map((l) => [l.quantity.toNumber(), l.price?.toNumber()])).toEqual([
      [70, 11200],
      [50, 11300],
    ]);
  });

  it('new orders take the oldest batch first', () => {
    const v = valueStock(D(120), D(80), [r(1, 100, 11200), r(2, 50, 11300)], null);
    expect(plain(v.actual)).toEqual([120, 70 * 11200 + 50 * 11300, 0]);
    expect(plain(v.ordered)).toEqual([80, 70 * 11200 + 10 * 11300, 0]);
    expect(plain(v.available)).toEqual([40, 40 * 11300, 0]);
  });

  it('prices stock older than the stored receipts at the oldest receipt, else the fallback', () => {
    expect(plain(valueStock(D(30), D(0), [r(5, 10, 9000), r(3, 10, 8000)], null).actual)).toEqual([30, 10 * 9000 + 20 * 8000, 0]);
    expect(plain(valueStock(D(30), D(0), [], D(7000)).actual)).toEqual([30, 30 * 7000, 0]);
    expect(plain(valueStock(D(30), D(10), [], null).available)).toEqual([20, 0, 20]);
  });

  it('handles orders above stock and negative stock', () => {
    const over = valueStock(D(10), D(15), [r(1, 10, 1000)], null);
    expect(plain(over.ordered)).toEqual([15, 15000, 0]);
    expect(plain(over.available)).toEqual([-5, -5000, 0]);
    const negative = valueStock(D(-4), D(0), [r(1, 10, 1000)], null);
    expect(plain(negative.actual)).toEqual([-4, 0, 0]);
    expect(plain(negative.available)).toEqual([-4, 0, 0]);
  });
});
