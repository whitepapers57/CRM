import { createTestDb, truncateAll } from '../testing/test-db.js';
import { parsePeriod } from '../settlements/period.js';
import { WarehouseService } from './warehouse.service.js';

const db = createTestDb();
const svc = new WarehouseService(db);
const seenAt = new Date();

describe('WarehouseService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.warehouse.createMany({
      data: [
        { sdId: 'w1', name: 'Нич склад основной', active: true, raw: {}, seenAt },
        { sdId: 'w2', name: 'Склад Импорт', active: true, raw: {}, seenAt },
      ],
    });
    await db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } });
    await db.stockLevel.createMany({
      data: [
        { sdId: 'w1:p1', warehouseSdId: 'w1', productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 65, seenAt },
        { sdId: 'w1:p2', warehouseSdId: 'w1', productSdId: 'p2', productName: 'Байкал', quantity: 0, seenAt },
        { sdId: 'w2:p1', warehouseSdId: 'w2', productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 10, seenAt },
      ],
    });
  });
  afterAll(() => db.$disconnect());

  it('lists non-zero stock with warehouse names', async () => {
    const { rows, warehouses } = await svc.stock({});
    expect(warehouses.map((w) => w.name)).toEqual(['Нич склад основной', 'Склад Импорт']);
    expect(rows.map((r) => [r.warehouseName, r.productName, r.quantity])).toEqual([
      ['Нич склад основной', 'Дюшес 1.5', '65.000'],
      ['Склад Импорт', 'Дюшес 1.5', '10.000'],
    ]);
  });

  it('filters stock by warehouse, search, and can include zeros', async () => {
    expect((await svc.stock({ warehouse: 'w1', includeZero: true })).rows).toHaveLength(2);
    expect((await svc.stock({ search: 'байкал', includeZero: true })).rows.map((r) => r.productSdId)).toEqual(['p2']);
  });

  it('shows the category of each product, sorts by it and filters by it', async () => {
    await db.productCategory.createMany({
      data: [
        { sdId: 'c1', name: 'Лимонады', active: true, raw: {}, seenAt },
        { sdId: 'c2', name: 'Вода', active: true, raw: {}, seenAt },
        { sdId: 'c3', name: 'Чипсы', active: true, raw: {}, seenAt },
      ],
    });
    await db.product.createMany({
      data: [
        { sdId: 'p1', name: 'Дюшес 1.5', active: true, categorySdId: 'c1', raw: {}, seenAt },
        { sdId: 'p2', name: 'Байкал', active: true, categorySdId: 'c1', raw: {}, seenAt },
        { sdId: 'p4', name: 'Вода 1 л', active: true, categorySdId: 'c2', raw: {}, seenAt },
      ],
    });
    await db.stockLevel.createMany({
      data: [
        { sdId: 'w1:p3', warehouseSdId: 'w1', productSdId: 'p3', productName: 'Вода 0.5', quantity: 7, seenAt },
        { sdId: 'w2:p4', warehouseSdId: 'w2', productSdId: 'p4', productName: 'Вода 1 л', quantity: 3, seenAt },
      ],
    });

    const { rows, categories, uncategorized } = await svc.stock({ includeZero: true });
    // Only categories that have stock are offered; c3 has none.
    expect(categories).toEqual([{ sdId: 'c2', name: 'Вода' }, { sdId: 'c1', name: 'Лимонады' }]);
    expect(uncategorized).toBe(true);
    expect(rows.map((r) => [r.categoryName, r.productName, r.warehouseName])).toEqual([
      ['Вода', 'Вода 1 л', 'Склад Импорт'],
      ['Лимонады', 'Байкал', 'Нич склад основной'],
      ['Лимонады', 'Дюшес 1.5', 'Нич склад основной'],
      ['Лимонады', 'Дюшес 1.5', 'Склад Импорт'],
      [null, 'Вода 0.5', 'Нич склад основной'],
    ]);
    const key = (r: { warehouseSdId: string; productSdId: string }) => `${r.warehouseSdId}:${r.productSdId}`;
    expect((await svc.stock({ category: 'c1' })).rows.map(key)).toEqual(['w1:p1', 'w2:p1']);
    expect((await svc.stock({ category: '-' })).rows.map(key)).toEqual(['w1:p3']);
  });

  it('shows the category code until Salesdoc has sent its name', async () => {
    await db.product.create({ data: { sdId: 'p1', name: 'Дюшес 1.5', active: true, categorySdId: 'd0_9', raw: {}, seenAt } });
    const { rows, categories, uncategorized } = await svc.stock({ warehouse: 'w1' });
    expect(rows.map((r) => [r.categorySdId, r.categoryName])).toEqual([['d0_9', 'd0_9']]);
    expect(categories).toEqual([{ sdId: 'd0_9', name: 'd0_9' }]);
    expect(uncategorized).toBe(false);
  });

  it('lists purchases in the period with totals, and opens one with its lines', async () => {
    await db.purchase.create({
      data: {
        sdId: 'd0_432', date: new Date('2026-09-28T15:52:51Z'), total: 1500, warehouseSdId: 'w1', supplierSdId: '1',
        raw: {}, seenAt,
        lines: { create: [{ productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 100, price: 15, amount: 1500 }] },
      },
    });
    const list = await svc.purchases(parsePeriod('2026-09-01', '2026-09-30', '2026-09-29'));
    expect(list.total).toBe('1500.00');
    expect(list.rows[0]).toMatchObject({ sdId: 'd0_432', warehouseName: 'Нич склад основной', supplierName: 'Основной поставщик', lineCount: 1 });

    const one = await svc.purchase('d0_432');
    expect(one.lines[0]).toMatchObject({ productName: 'Дюшес 1.5', quantity: '100.000', price: '15.00', amount: '1500.00' });
    await expect(svc.purchase('nope')).rejects.toThrow('Purchase nope not found');
  });
  it('filters receipts by supplier, warehouse and number, and totals only what it shows', async () => {
    await db.supplier.create({ data: { sdId: '2', name: 'AQUA', active: true, raw: {}, seenAt } });
    for (const [sdId, wh, sup, total] of [['d0_431', 'w1', '1', 100], ['d0_432', 'w2', '1', 200], ['d0_440', 'w1', '2', 400]] as const) {
      await db.purchase.create({ data: { sdId, date: new Date('2026-09-10T10:00:00Z'), total, warehouseSdId: wh, supplierSdId: sup, raw: {}, seenAt } });
    }
    const p = parsePeriod('2026-09-01', '2026-09-30', '2026-09-29');

    const all = await svc.purchases(p, {});
    expect(all.total).toBe('700.00');
    expect(all.filters.suppliers.map((s) => s.name)).toEqual(['AQUA', 'Основной поставщик']);
    expect(all.rows[0]).toMatchObject({ sdId: 'd0_440', supplierSdId: '2', warehouseSdId: 'w1' });

    expect((await svc.purchases(p, { supplier: '1' })).rows.map((r) => r.sdId)).toEqual(['d0_432', 'd0_431']);
    expect((await svc.purchases(p, { warehouse: 'w1' })).total).toBe('500.00');
    expect((await svc.purchases(p, { search: 'D0_44' })).rows.map((r) => r.sdId)).toEqual(['d0_440']);
  });

  it('treats % and _ in the number search as plain characters', async () => {
    for (const sdId of ['d0_431', 'd0x431']) {
      await db.purchase.create({ data: { sdId, date: new Date('2026-09-10T10:00:00Z'), total: 1, raw: {}, seenAt } });
    }
    const p = parsePeriod('2026-09-01', '2026-09-30', '2026-09-29');
    expect((await svc.purchases(p, { search: 'd0_4' })).rows.map((r) => r.sdId)).toEqual(['d0_431']);
    expect((await svc.purchases(p, { search: '%' })).rows).toEqual([]);
  });
});
