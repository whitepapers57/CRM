import { createTestDb, truncateAll } from '../testing/test-db.js';
import { parsePeriod } from '../settlements/period.js';
import { SalesService } from './sales.service.js';

const db = createTestDb();
const svc = new SalesService(db);
const seenAt = new Date();
const oct = parsePeriod('2026-10-01', '2026-10-31', '2026-10-05');

async function order(sdId: string, day: string, status: number, total: number, outlet = 'o1', extra: Record<string, unknown> = {}) {
  await db.order.create({
    data: {
      sdId, status, dateDocument: new Date(`${day}T12:00:00Z`), totalSumma: total, discountSumma: 0, totalAfterDiscount: total,
      totalReturnsSumma: 0, outletSdId: outlet, agentSdId: 'a1', expeditorSdId: 'e1', warehouseSdId: 'w1', raw: {}, seenAt, ...extra,
    },
  });
}

describe('SalesService — расходные накладные', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.warehouse.createMany({ data: [{ sdId: 'w1', name: 'склад Жохон бозор', active: true, raw: {}, seenAt }, { sdId: 'w2', name: 'Нич склад', active: true, raw: {}, seenAt }] });
    await db.outlet.createMany({ data: [{ sdId: 'o1', name: 'Агентлар (черноголовка)', active: true, raw: {}, seenAt }, { sdId: 'o2', name: 'Бонусларга', active: true, raw: {}, seenAt }] });
    await db.agent.create({ data: { sdId: 'a1', name: 'Азиз', active: true, raw: {}, seenAt } });
    await db.expeditor.create({ data: { sdId: 'e1', name: 'Шерзод', active: true, raw: {}, seenAt } });
    await order('d0_337', '2026-10-02', 3, 52904587.46);
    await order('d0_338', '2026-10-03', 4, 1000, 'o2');
    await order('d0_339', '2026-10-04', 5, 999); // cancelled
    await order('d0_300', '2026-09-30', 3, 7); // outside the period
  });
  afterAll(() => db.$disconnect());

  it('lists the period newest first with names, status, and a total without cancelled orders', async () => {
    const r = await svc.orders(oct);
    expect(r.rows.map((x) => [x.sdId, x.outletName, x.warehouseName, x.agentName, x.status, x.total])).toEqual([
      ['d0_339', 'Агентлар (черноголовка)', 'склад Жохон бозор', 'Азиз', 5, '999.00'],
      ['d0_338', 'Бонусларга', 'склад Жохон бозор', 'Азиз', 4, '1000.00'],
      ['d0_337', 'Агентлар (черноголовка)', 'склад Жохон бозор', 'Азиз', 3, '52904587.46'],
    ]);
    expect(r.total).toBe('52905587.46');
    expect(r.filters.warehouses.map((w) => w.name)).toEqual(['Нич склад', 'склад Жохон бозор']);
    expect(r.filters.agents.map((a) => a.name)).toEqual(['Азиз']);
  });

  it('filters by status, warehouse, agent, and searches number or buyer', async () => {
    expect((await svc.orders(oct, { status: 4 })).rows.map((x) => x.sdId)).toEqual(['d0_338']);
    expect((await svc.orders(oct, { warehouse: 'w2' })).rows).toEqual([]);
    expect((await svc.orders(oct, { agent: 'a1' })).rows).toHaveLength(3);
    expect((await svc.orders(oct, { search: '337' })).rows.map((x) => x.sdId)).toEqual(['d0_337']);
    expect((await svc.orders(oct, { search: 'бонус' })).rows.map((x) => x.sdId)).toEqual(['d0_338']);
    expect((await svc.orders(oct, { search: '50%' })).rows).toEqual([]);
  });

  it('opens one накладная with its lines', async () => {
    await db.orderLine.createMany({
      data: [
        { orderSdId: 'd0_337', productSdId: 'p1', productName: 'Черноголовка, Дюшес New', quantity: 1074, price: 10833.76, discount: 0, summa: 11635558.24, returned: 0 },
        { orderSdId: 'd0_337', productSdId: 'p2', productName: 'Лимонад оригинальный', quantity: 2, price: 10, discount: 1, summa: 19, returned: 1 },
      ],
    });
    const o = await svc.order('d0_337');
    expect(o).toMatchObject({ sdId: 'd0_337', outletSdId: 'o1', outletName: 'Агентлар (черноголовка)', warehouseName: 'склад Жохон бозор', agentName: 'Азиз', expeditorName: 'Шерзод', status: 3, total: '52904587.46' });
    expect(o.lines.map((l) => [l.productName, l.quantity, l.price, l.discount, l.amount, l.returned])).toEqual([
      ['Черноголовка, Дюшес New', '1074.000', '10833.76', '0.00', '11635558.24', '0.000'],
      ['Лимонад оригинальный', '2.000', '10.00', '1.00', '19.00', '1.000'],
    ]);
    await expect(svc.order('nope')).rejects.toThrow('Накладная не найдена');
  });
});
