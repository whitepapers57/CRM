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
