import { createTestDb, truncateAll } from '../testing/test-db.js';
import { RESOURCES } from './resources.js';

const db = createTestDb();
const byName = (n: string) => RESOURCES.find((r) => r.name === n)!;
const t1 = new Date('2026-09-29T10:00:00Z');
const t2 = new Date('2026-09-29T11:00:00Z');

const order = (sdId: string, status: number, summa: number) => ({
  SD_id: sdId, status, dateDocument: '2026-09-01 10:00:00', totalSummaAfterDiscount: summa,
  client: { SD_id: 'o1' },
  orderProducts: [{ product: { SD_id: 'p1' }, quantity: 1, price: summa, summa }],
});

describe('resources', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('syncs supervisors from getSupervisor before documents', () => {
    expect(byName('supervisors')).toMatchObject({ method: 'getSupervisor', resultKey: 'supervisor', mode: 'replace' });
    const names = RESOURCES.map((r) => r.name);
    expect(names.indexOf('supervisors')).toBeLessThan(names.indexOf('purchases'));
  });

  it('syncs product categories from getProductCategory before products', () => {
    expect(byName('productCategories')).toMatchObject({ method: 'getProductCategory', resultKey: 'productCategory', mode: 'replace' });
    expect(byName('productCategories').dated).toBeUndefined();
    const names = RESOURCES.map((r) => r.name);
    expect(names.indexOf('productCategories')).toBeLessThan(names.indexOf('products'));
  });

  it('saves a product category and the category of each product', async () => {
    await db.$transaction(async (tx) => {
      await byName('productCategories').save(tx, [{ SD_id: 'd0_3', name: 'Вода', active: 'Y' }], t1);
      await byName('products').save(tx, [{ SD_id: 'p1', name: 'Вода 0.5', active: 'Y', category: { SD_id: 'd0_3' } }], t1);
    });
    expect((await db.productCategory.findUniqueOrThrow({ where: { sdId: 'd0_3' } })).name).toBe('Вода');
    expect((await db.product.findUniqueOrThrow({ where: { sdId: 'p1' } })).categorySdId).toBe('d0_3');
  });

  it('lists resources with reference data before documents', () => {
    const names = RESOURCES.map((r) => r.name);
    expect(names.indexOf('outlets')).toBeLessThan(names.indexOf('orders'));
    expect(names).toEqual(
      expect.arrayContaining(['paymentTypes', 'cashboxes', 'warehouses', 'suppliers', 'agents',
        'expeditors', 'supervisors', 'products', 'stock', 'outlets', 'balances', 'purchases', 'orders', 'returns', 'payments']),
    );
  });

  it('asks Salesdoc for every order status and agent', () => {
    expect(byName('orders').filter).toEqual({ status: [1, 2, 3, 4, 5], agent: 'all' });
    expect(byName('returns').filter).toEqual({ status: [1, 2, 3, 4, 5] });
    expect(byName('payments').filter).toBeUndefined();
  });

  it('limits documents to a date window, and nothing else', () => {
    for (const n of ['purchases', 'orders', 'returns', 'payments']) {
      expect(byName(n).dated?.('2026-06-24', '2026-09-29')).toEqual({
        period: { date: { from: '2026-06-24', to: '2026-09-29' } },
      });
    }
    for (const n of ['outlets', 'balances', 'products', 'stock']) {
      expect(byName(n).dated).toBeUndefined();
    }
  });

  it('replaces the whole balance snapshot on every run', async () => {
    const balances = byName('balances');
    expect(balances.mode).toBe('replace');
    await db.$transaction((tx) =>
      balances.save(tx, [{ SD_id: 'o1', name: 'Star Shop', balance: -2500000 }], t1),
    );
    const row = await db.outletBalance.findUniqueOrThrow({ where: { sdId: 'o1' } });
    expect(row.debt.toString()).toBe('2500000');
  });

  it('replaces an order and its lines when it arrives again', async () => {
    const orders = byName('orders');
    await db.$transaction((tx) => orders.save(tx, [order('d0_1', 2, 100)], t1));
    await db.$transaction((tx) => orders.save(tx, [order('d0_1', 3, 120)], t2));

    const saved = await db.order.findUniqueOrThrow({ where: { sdId: 'd0_1' }, include: { lines: true } });
    expect(saved.status).toBe(3);
    expect(saved.totalAfterDiscount.toString()).toBe('120');
    expect(saved.lines).toHaveLength(1);
    expect(saved.seenAt).toEqual(t2);
  });

  it('keeps the last copy when one page repeats a record', async () => {
    const orders = byName('orders');
    const n = await db.$transaction((tx) =>
      orders.save(tx, [order('d0_1', 2, 100), order('d0_1', 3, 150)], t1),
    );
    expect(n).toBe(1);
    const saved = await db.order.findUniqueOrThrow({ where: { sdId: 'd0_1' } });
    expect(saved.totalAfterDiscount.toString()).toBe('150');
  });

  it('prunes only rows not seen since the given time', async () => {
    const orders = byName('orders');
    await db.$transaction((tx) => orders.save(tx, [order('old', 3, 1)], t1));
    await db.$transaction((tx) => orders.save(tx, [order('new', 3, 1)], t2));
    const pruned = await db.$transaction((tx) => orders.prune(tx, t2));
    expect(pruned).toBe(1);
    expect((await db.order.findMany()).map((o) => o.sdId)).toEqual(['new']);
  });

  it('saves stock as one row per warehouse and product', async () => {
    await db.$transaction((tx) =>
      byName('stock').save(
        tx,
        [{ SD_id: 'w1', products: [{ SD_id: 'p1', name: 'A', quantity: 5 }, { SD_id: 'p2', name: 'B', quantity: 0 }] }],
        t1,
      ),
    );
    expect(await db.stockLevel.count()).toBe(2);
  });
});
