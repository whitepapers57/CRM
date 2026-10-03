import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService } from '../months/months.service.js';
import { RESOURCES } from '../sync/resources.js';
import { parsePeriod } from '../settlements/period.js';
import { SettlementsService } from '../settlements/settlements.service.js';
import type { SyncService } from '../sync/sync.service.js';
import type { SalesdocClient } from '../salesdoc/salesdoc.client.js';
import { PurchaseEditService } from './purchase-edit.service.js';
import { WarehouseService } from './warehouse.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const salesdoc = { call: vi.fn() } as unknown as SalesdocClient;
const edit = new PurchaseEditService(db, salesdoc, months, audit);
const warehouse = new WarehouseService(db);
const sync = { status: async () => ({ running: false, dataAsOf: null, resources: [] }) } as unknown as SyncService;
const settlements = new SettlementsService(db, sync);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();
const sept = parsePeriod('2026-09-01', '2026-09-30', '2026-09-29');

async function purchase(sdId: string, day: string, total: number) {
  await db.purchase.create({
    data: { sdId, csId: `f5-${sdId}`, date: new Date(`${day}T10:00:00Z`), total, supplierSdId: '1', warehouseSdId: 'w1', raw: { priceType: { SD_id: 'd0_61' } }, seenAt },
  });
}

describe('PurchaseEditService — delete and restore', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
    await db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } });
    await purchase('d0_1', '2026-09-05', 100);
    await purchase('d0_2', '2026-09-06', 40);
  });
  afterAll(() => db.$disconnect());

  it('hides a deleted receipt from the list, suppliers, statement and summary', async () => {
    await edit.remove('d0_2', 'дубль', user);

    expect((await warehouse.purchases(sept, {})).rows.map((r) => r.sdId)).toEqual(['d0_1']);
    expect((await warehouse.purchases(sept, {})).total).toBe('100.00');
    expect((await settlements.suppliers(sept)).rows[0]).toMatchObject({ received: '100.00', debt: '-100.00' });
    expect((await settlements.supplierStatement(sept, '1')).closing).toBe('100.00');
    expect((await settlements.summary(sept)).supplier.received).toBe('100.00');

    const all = await warehouse.purchases(sept, { includeHidden: true });
    expect(all.rows.find((r) => r.sdId === 'd0_2')?.hidden).toMatchObject({ by: 'Сардорбек', reason: 'дубль' });
    expect((await warehouse.purchase('d0_2')).hidden).toMatchObject({ reason: 'дубль' });
  });

  it('keeps a deletion when the sync re-inserts the receipt row', async () => {
    await edit.remove('d0_2', 'дубль', user);
    const purchases = RESOURCES.find((r) => r.name === 'purchases')!;
    await db.$transaction((tx) =>
      purchases.save(tx, [{ SD_id: 'w1', date: '2026-09-06 10:00:00', purchase_id: 'f5-d0_2', shipper: { SD_id: '1' }, detail: [] }], new Date()),
    );
    expect((await warehouse.purchases(sept, {})).rows.map((r) => r.sdId)).toEqual(['d0_1']);
  });

  it('needs a reason, refuses twice, and refuses in a closed month', async () => {
    await expect(edit.remove('d0_1', '  ', user)).rejects.toThrow('Укажите причину');
    await edit.remove('d0_1', 'ошибка', user);
    await expect(edit.remove('d0_1', 'ещё раз', user)).rejects.toThrow('Накладная уже удалена');
    await months.setClosed('2026-09', true, user);
    await expect(edit.remove('d0_2', 'ошибка', user)).rejects.toThrow('Месяц закрыт');
    await expect(edit.restore('d0_1', user)).rejects.toThrow('Месяц закрыт');
  });

  it('restores while the month is open and records the whole story', async () => {
    await edit.remove('d0_2', 'дубль', user);
    await edit.restore('d0_2', user);
    expect((await warehouse.purchases(sept, {})).total).toBe('140.00');
    const h = await edit.history('d0_2');
    expect(h.map((e) => [e.action, e.userName, e.reason])).toEqual([
      ['purchase.restore', 'Сардорбек', null],
      ['purchase.delete', 'Сардорбек', 'дубль'],
    ]);
    await expect(edit.restore('d0_2', user)).rejects.toThrow('Накладная не удалена');
    await expect(edit.remove('nope', 'x', user)).rejects.toThrow('Накладная не найдена');
  });
});

describe('PurchaseEditService — edit through Salesdoc', () => {
  const call = salesdoc.call as unknown as ReturnType<typeof vi.fn>;
  const ok = { status: true, result: { completed: 1, error: 0, data: { purchase: [{ CS_id: 'f5-d0_1' }] } } };

  beforeEach(async () => {
    await truncateAll(db);
    call.mockReset();
    await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
    await db.warehouse.createMany({ data: [{ sdId: 'w1', name: 'Нич', active: true, raw: {}, seenAt }, { sdId: 'w2', name: 'Импорт', active: true, raw: {}, seenAt }] });
    await db.product.createMany({ data: [{ sdId: 'p1', name: 'Дюшес 1.5', active: true, raw: {}, seenAt }, { sdId: 'p2', name: 'Тархун 1.5', active: true, raw: {}, seenAt }] });
    await db.purchase.create({
      data: {
        sdId: 'd0_1', csId: 'f5-d0_1', date: new Date('2026-10-02T15:52:51Z'), total: 100, warehouseSdId: 'w1', supplierSdId: '1',
        raw: { priceType: { SD_id: 'd0_61' } }, seenAt,
        lines: { create: [{ productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 10, price: 10, amount: 100 }] },
      },
    });
  });

  const input = { date: '2026-10-03', warehouseSdId: 'w2', supplierSdId: '1', lines: [{ productSdId: 'p2', quantity: 3, price: 12.5 }] };

  it('sends setPurchase to Salesdoc, then updates our copy and records before/after', async () => {
    call.mockResolvedValue(ok);
    await edit.update('d0_1', input, user);

    expect(call).toHaveBeenCalledWith('setPurchase', {
      data: {
        purchase: [{
          CS_id: 'f5-d0_1',
          date: '2026-10-03 15:52:51',
          priceType: { SD_id: 'd0_61' },
          store: { SD_id: 'w2' },
          shipper: { SD_id: '1' },
          products: [{ SD_id: 'p2', quantity: 3, price: 12.5 }],
        }],
      },
    });
    const p = await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' }, include: { lines: true } });
    expect(p.warehouseSdId).toBe('w2');
    expect(p.total.toString()).toBe('37.5');
    expect(p.date.toISOString()).toBe('2026-10-03T15:52:51.000Z');
    expect(p.lines.map((l) => [l.productName, l.quantity.toString(), l.amount.toString()])).toEqual([['Тархун 1.5', '3', '37.5']]);

    const [entry] = await edit.history('d0_1');
    expect(entry).toMatchObject({ action: 'purchase.edit', userName: 'Сардорбек' });
    expect(entry.before).toMatchObject({ warehouseSdId: 'w1', lines: [{ productSdId: 'p1', quantity: '10', price: '10' }] });
    expect(entry.after).toMatchObject({ warehouseSdId: 'w2', lines: [{ productSdId: 'p2', quantity: '3', price: '12.5' }] });
  });

  it("keeps Salesdoc's unrounded price when the shown price was not changed", async () => {
    // Salesdoc stores 9101.8256…; its API (and our copy) only show 9101.83. Re-sending 9101.83 would
    // change 3 931 988.66 into 3 931 990.56.
    await db.purchaseLine.deleteMany({});
    await db.purchaseLine.create({ data: { purchaseSdId: 'd0_1', productSdId: 'p1', productName: 'Дюшес 1.5', quantity: 432, price: 9101.83, amount: 3931988.66 } });
    call.mockResolvedValue(ok);
    await edit.update('d0_1', { ...input, lines: [{ productSdId: 'p1', quantity: 432, price: 9101.83 }, { productSdId: 'p2', quantity: 2, price: 9101.83 }] }, user);

    const sent = call.mock.calls[0][1].data.purchase[0].products;
    expect(sent[0].price).toBeCloseTo(3931988.66 / 432, 10);
    expect(sent[1].price).toBe(9101.83); // another product: no stored exact price
    const p = await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' }, include: { lines: { orderBy: { id: 'asc' } } } });
    expect(p.lines.map((l) => [l.price.toString(), l.amount.toString()])).toEqual([['9101.83', '3931988.66'], ['9101.83', '18203.66']]);
    expect(p.total.toString()).toBe('3950192.32');
  });

  it('changes nothing when Salesdoc reports an error without throwing', async () => {
    call.mockResolvedValue({ status: true, result: { completed: 0, error: 1, data: { purchase: [{ errors: ['Склад не найден'] }] } } });
    await expect(edit.update('d0_1', input, user)).rejects.toThrow('Склад не найден');
    expect((await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' } })).warehouseSdId).toBe('w1');
    expect(await edit.history('d0_1')).toEqual([]);
  });

  it('changes nothing when the Salesdoc call throws', async () => {
    call.mockRejectedValue(new Error('fetch failed'));
    await expect(edit.update('d0_1', input, user)).rejects.toThrow('fetch failed');
    expect((await db.purchase.findUniqueOrThrow({ where: { sdId: 'd0_1' } })).total.toString()).toBe('100');
  });

  it('refuses a move into a closed month even from an open one', async () => {
    await months.setClosed('2026-09', true, user);
    await expect(edit.update('d0_1', { ...input, date: '2026-09-30' }, user)).rejects.toThrow('Месяц закрыт');
    expect(call).not.toHaveBeenCalled();
  });

  it('validates the input before calling Salesdoc', async () => {
    await expect(edit.update('d0_1', { ...input, lines: [] }, user)).rejects.toThrow('Добавьте хотя бы одну строку');
    await expect(edit.update('d0_1', { ...input, lines: [{ productSdId: 'p2', quantity: 0, price: 1 }] }, user)).rejects.toThrow('Количество должно быть больше нуля');
    await expect(edit.update('d0_1', { ...input, lines: [{ productSdId: 'zz', quantity: 1, price: 1 }] }, user)).rejects.toThrow('Товар не найден');
    await expect(edit.update('d0_1', { ...input, warehouseSdId: 'zz' }, user)).rejects.toThrow('Склад не найден');
    await expect(edit.update('d0_1', { ...input, date: '2026-08-20' }, user)).rejects.toThrow('Дата раньше 01.09.2026');
    await edit.remove('d0_1', 'x', user);
    await expect(edit.update('d0_1', input, user)).rejects.toThrow('Накладная удалена');
    expect(call).not.toHaveBeenCalled();
  });
});
