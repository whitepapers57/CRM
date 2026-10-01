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
});
