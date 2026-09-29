import { createTestDb, truncateAll } from '../testing/test-db.js';
import type { SyncService } from '../sync/sync.service.js';
import { parsePeriod } from './period.js';
import { SettlementsService } from './settlements.service.js';

const db = createTestDb();
const seenAt = new Date();
const sync = { status: async () => ({ running: false, dataAsOf: null, resources: [] }) } as unknown as SyncService;
const svc = new SettlementsService(db, sync);
const sept = parsePeriod('2026-09-01', '2026-09-30', '2026-09-29');

async function outlet(sdId: string, name: string) {
  await db.outlet.create({ data: { sdId, name, active: true, raw: {}, seenAt } });
}
/** Salesdoc's current balance for the outlet: the anchor (spec §4.1). */
async function anchor(sdId: string, debt: number) {
  await db.outletBalance.create({ data: { sdId, debt, raw: {}, seenAt } });
}
async function order(sdId: string, outletSdId: string, status: number, amount: number, day: string, time = '10:00:00') {
  await db.order.create({
    data: {
      sdId, status, outletSdId, dateDocument: new Date(`${day}T${time}Z`),
      totalSumma: amount, discountSumma: 0, totalAfterDiscount: amount, totalReturnsSumma: 0, raw: {}, seenAt,
    },
  });
}
async function ret(sdId: string, outletSdId: string, status: number, amount: number, day: string) {
  await db.outletReturn.create({
    data: { sdId, status, outletSdId, amount, dateDocument: new Date(`${day}T10:00:00Z`), raw: {}, seenAt },
  });
}
async function payment(sdId: string, outletSdId: string, type: number, amount: number, day: string) {
  await db.payment.create({
    data: { sdId, outletSdId, transactionType: type, amount, paymentDate: new Date(`${day}T10:00:00Z`), raw: {}, seenAt },
  });
}

describe('SettlementsService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('balances an outlet from its Salesdoc anchor: delivered orders minus returns minus payments', async () => {
    await outlet('o1', 'Star Shop');
    await anchor('o1', 1000); // what Salesdoc says the outlet owes now
    await order('before', 'o1', 3, 1000, '2026-08-20');     // before the period: no effect
    await order('del', 'o1', 3, 500, '2026-09-05');
    await order('closed', 'o1', 4, 300, '2026-09-06');
    await order('sent', 'o1', 2, 999, '2026-09-07');        // not delivered yet
    await order('cancel', 'o1', 5, 999, '2026-09-08');      // never counts
    await order('late', 'o1', 3, 50, '2026-09-30', '23:30:00');   // last evening of the period
    await order('after', 'o1', 3, 777, '2026-10-01', '00:00:00'); // first second after it
    await ret('r1', 'o1', 3, 200, '2026-09-10');
    await ret('r-cancel', 'o1', 5, 999, '2026-09-10');
    await payment('p-old', 'o1', 3, 400, '2026-08-25');     // before the period: no effect
    await payment('p1', 'o1', 3, 250, '2026-09-12');
    await payment('shelf', 'o1', 9, 200, '2026-09-10');     // mirrors r1, must not count

    const { rows, total } = await svc.outletBalances(sept, {});
    expect(total).toBe(1);
    expect(rows[0]).toEqual({
      outletSdId: 'o1', name: 'Star Shop', firmName: null, inn: null,
      // opening = 1000 - (500 + 300 + 50 + 777 - 200 - 250); closing = 1000 - 777
      opening: '-177.00', delivered: '850.00', returned: '200.00', paid: '250.00', closing: '223.00',
    });
  });

  it('keeps an outlet Salesdoc no longer lists, named by its id, anchored at zero', async () => {
    await order('x', 'ghost', 3, 100, '2026-09-05');
    const { rows } = await svc.outletBalances(sept, {});
    expect(rows[0]).toMatchObject({ outletSdId: 'ghost', name: 'ghost', opening: '-100.00', closing: '0.00' });
  });

  it('lists an outlet that only has a Salesdoc balance', async () => {
    await anchor('quiet', 5000);
    const { rows } = await svc.outletBalances(sept, {});
    expect(rows[0]).toMatchObject({ outletSdId: 'quiet', opening: '5000.00', delivered: '0.00', closing: '5000.00' });
  });

  it('filters by search and hides zero balances on request', async () => {
    await outlet('o1', 'Star Shop');
    await outlet('o2', 'Moon Market');
    await order('a', 'o1', 3, 100, '2026-09-05');
    await order('b', 'o2', 3, 100, '2026-09-05');
    await payment('p', 'o2', 3, 100, '2026-09-06');
    await anchor('o1', 100);

    expect((await svc.outletBalances(sept, { search: 'moon' })).rows.map((r) => r.outletSdId)).toEqual(['o2']);
    expect((await svc.outletBalances(sept, { nonZero: true })).rows.map((r) => r.outletSdId)).toEqual(['o1']);
  });

  it('builds an outlet statement with a running balance ending at the anchor', async () => {
    await outlet('o1', 'Star Shop');
    await anchor('o1', 1050);
    await order('before', 'o1', 3, 1000, '2026-08-20');
    await order('del', 'o1', 3, 500, '2026-09-05');
    await ret('r1', 'o1', 3, 200, '2026-09-10');
    await payment('p1', 'o1', 3, 250, '2026-09-12');

    const s = await svc.outletStatement('o1', sept);
    expect(s.opening).toBe('1000.00');
    expect(s.rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['order', '500.00', '1500.00'],
      ['return', '-200.00', '1300.00'],
      ['payment', '-250.00', '1050.00'],
    ]);
    expect(s.closing).toBe('1050.00');
  });

  it('owes the supplier every receipt while no payments exist yet', async () => {
    await db.warehouse.create({ data: { sdId: 'w1', name: 'Нич склад', active: true, raw: {}, seenAt } });
    // 'margin' was fetched only because of the 7-day margin before the window start (1 Jul).
    for (const [sdId, day, total] of [['margin', '2026-06-28', 999], ['a', '2026-08-01', 1000], ['b', '2026-09-03', 500]] as const) {
      await db.purchase.create({ data: { sdId, date: new Date(`${day}T09:00:00Z`), total, warehouseSdId: 'w1', raw: {}, seenAt } });
    }
    const s = await svc.supplierStatement(sept);
    expect(s).toMatchObject({ opening: '1000.00', received: '500.00', paid: '0.00', closing: '1500.00' });
    expect(s.rows[0]).toMatchObject({ sdId: 'b', warehouseName: 'Нич склад', balance: '1500.00' });
  });

  it('summarises both sides of the diagram', async () => {
    await order('a', 'o1', 3, 500, '2026-09-05');
    await order('b', 'o2', 3, 100, '2026-09-05');
    await payment('p', 'o2', 3, 300, '2026-09-06');
    await anchor('o1', 500);
    await anchor('o2', -200);
    await db.purchase.create({ data: { sdId: 'pu', date: new Date('2026-09-02T09:00:00Z'), total: 700, raw: {}, seenAt } });

    const s = await svc.summary(sept);
    expect(s.outlets).toEqual({ receivable: '500.00', prepaid: '200.00', delivered: '600.00', returned: '0.00', paid: '300.00' });
    expect(s.supplier).toEqual({ received: '700.00', paid: '0.00', owed: '700.00' });
    expect(s.windowStart).toBe('2026-07-01');
  });
});
