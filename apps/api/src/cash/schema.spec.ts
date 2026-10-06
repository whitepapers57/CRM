import { createTestDb, truncateAll } from '../testing/test-db.js';

const db = createTestDb();

describe('cash schema', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('numbers operations in order and stores days and amounts exactly', async () => {
    const acc = await db.bankAccount.create({ data: { name: 'Основной счёт' } });
    const a = await db.cashOperation.create({
      data: { direction: 'out', account: 'bank', bankAccountId: acc.id, date: new Date('2026-10-02'), amount: '10500000.25', operation: 'supplier_payment', supplierSdId: '1', createdById: 'u1', createdByName: 'Сардор' },
    });
    const b = await db.cashOperation.create({
      data: { direction: 'in', account: 'cash', cashboxSdId: '1', date: new Date('2026-10-03'), amount: 5, operation: 'other_income', counterpartyName: 'x', createdById: 'u1', createdByName: 'Сардор' },
    });
    expect(b.seq).toBe(a.seq + 1);
    expect(a.amount.toString()).toBe('10500000.25');
    expect(a.date.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(a.cancelledAt).toBeNull();
  });

  it('keeps one account per payment type', async () => {
    await db.paymentTypeAccount.create({ data: { paymentTypeSdId: 'd0_1', account: 'cash' } });
    await expect(db.paymentTypeAccount.create({ data: { paymentTypeSdId: 'd0_1', account: 'bank' } })).rejects.toThrow();
  });
});
