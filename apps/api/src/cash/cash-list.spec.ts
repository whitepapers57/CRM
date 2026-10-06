import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService } from '../months/months.service.js';
import { parsePeriod } from '../settlements/period.js';
import { CashRefsService } from './cash-refs.service.js';
import { CashService } from './cash.service.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const refs = new CashRefsService(db);
const cash = new CashService(db, months, audit, refs);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();
const oct = parsePeriod('2026-10-01', '2026-10-31', '2026-10-06');
let bank = '';

beforeEach(async () => {
  await truncateAll(db);
  await db.cashbox.create({ data: { sdId: '1', name: 'Основная касса', active: true, raw: {}, seenAt } });
  await db.supplier.create({ data: { sdId: '1', name: 'AQUA-PRODUCTS', active: true, raw: {}, seenAt } });
  await db.outlet.create({ data: { sdId: 'o1', name: 'Агентлар (черноголовка)', active: true, raw: {}, seenAt } });
  await db.paymentType.createMany({ data: [
    { sdId: 'd0_1', name: 'Наличный', active: true, raw: {}, seenAt },
    { sdId: 'd0_2', name: 'Перечисление', active: true, raw: {}, seenAt },
  ] });
  await db.payment.createMany({ data: [
    { sdId: 'p1', paymentDate: new Date('2026-10-02T10:00:00Z'), amount: 9472000, transactionType: 3, paymentTypeSdId: 'd0_1', outletSdId: 'o1', cashboxSdId: '1', raw: {}, seenAt },
    { sdId: 'p2', paymentDate: new Date('2026-10-03T10:00:00Z'), amount: 1488000, transactionType: 3, paymentTypeSdId: 'd0_2', outletSdId: 'o1', cashboxSdId: '1', raw: {}, seenAt },
    { sdId: 'p9', paymentDate: new Date('2026-10-03T10:00:00Z'), amount: -1488000, transactionType: 9, paymentTypeSdId: 'd0_2', outletSdId: 'o1', cashboxSdId: '1', raw: {}, seenAt },
  ] });
  bank = (await refs.addBankAccount('Основной счёт')).id;
});
afterAll(() => db.$disconnect());

describe('CashService — pages', () => {
  it('puts Salesdoc buyer payments on cash or bank by payment type, read-only', async () => {
    const cashIn = await cash.list('cash-in', oct, {});
    expect(cashIn.rows.map((r) => [r.source, r.number, r.operation, r.party, r.amount])).toEqual([['salesdoc', 'p1', 'from_buyer', 'Агентлар (черноголовка)', '9472000.00']]);
    const bankIn = await cash.list('bank-in', oct, {});
    expect(bankIn.rows.map((r) => r.number)).toEqual(['p2']);
    expect(bankIn.total).toBe('1488000.00');
  });

  it('cash-to-bank shows on both pages and cancels on both', async () => {
    const { id } = await cash.create({ operation: 'cash_to_bank', account: 'cash', cashboxSdId: '1', targetBankAccountId: bank, date: '2026-10-04', amount: 79153000 }, user);
    expect((await cash.list('cash-out', oct, {})).total).toBe('79153000.00');
    const bankIn = await cash.list('bank-in', oct, {});
    expect(bankIn.rows.find((r) => r.id === id)).toMatchObject({ mirrored: true, operation: 'cash_to_bank' });
    expect(bankIn.total).toBe('80641000.00');
    await cash.cancel(id, 'ошибка', user);
    expect((await cash.list('cash-out', oct, {})).total).toBe('0.00');
    expect((await cash.list('bank-in', oct, {})).total).toBe('1488000.00');
  });

  it('cancelled rows stay listed but do not count', async () => {
    const a = await cash.create({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-02', amount: 100, supplierSdId: '1' }, user);
    await cash.create({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-03', amount: 50, supplierSdId: '1', comment: 'аванс' }, user);
    await cash.cancel(a.id, 'дубль', user);
    expect((await cash.list('bank-out', oct, {})).rows.map((r) => r.amount)).toEqual(['50.00']);
    const all = await cash.list('bank-out', oct, { includeCancelled: true });
    expect(all.rows.map((r) => [r.amount, !!r.cancelled])).toEqual([['50.00', false], ['100.00', true]]);
    expect(all.total).toBe('50.00');
  });

  it('filters by operation, box and search (number, party, comment), newest first', async () => {
    await cash.create({ operation: 'supplier_payment', account: 'cash', cashboxSdId: '1', date: '2026-10-02', amount: 10, supplierSdId: '1' }, user);
    await cash.create({ operation: 'salary', account: 'cash', cashboxSdId: '1', date: '2026-10-03', amount: 20, counterpartyName: 'Туланов Достонбек', comment: 'узига' }, user);
    expect((await cash.list('cash-out', oct, { operation: 'salary' })).rows.map((r) => r.amount)).toEqual(['20.00']);
    expect((await cash.list('cash-out', oct, { search: 'aqua' })).rows.map((r) => r.amount)).toEqual(['10.00']);
    expect((await cash.list('cash-out', oct, { search: 'узига' })).rows.map((r) => r.amount)).toEqual(['20.00']);
    expect((await cash.list('cash-out', oct, { search: 'ДД-000001' })).rows.map((r) => r.amount)).toEqual(['10.00']);
    expect((await cash.list('cash-out', oct, { box: 'zz' })).rows).toEqual([]);
    expect((await cash.list('cash-out', oct, {})).rows.map((r) => r.date)).toEqual(['2026-10-03', '2026-10-02']);
  });

  it('lists the history of one page only', async () => {
    const a = await cash.create({ operation: 'salary', account: 'cash', cashboxSdId: '1', date: '2026-10-02', amount: 20, counterpartyName: 'Шоядбек' }, user);
    await cash.create({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-02', amount: 10, supplierSdId: '1' }, user);
    expect((await cash.history('cash-out')).map((e) => e.target)).toEqual([a.id]);
  });

  it('offers only active статьи and bank accounts in forms, sorted in Russian order', async () => {
    const off = await refs.addBankAccount('Старый счёт');
    await refs.setBankAccountActive(off.id, false);
    const cat = await refs.addCategory('Аренда', 'expense');
    const gone = await refs.addCategory('Закрытая', 'expense');
    await refs.setCategoryActive(gone.id, false);
    await refs.addCategory('Прочий приход', 'income');
    await db.supplier.create({ data: { sdId: '2', name: 'Бета', active: true, raw: {}, seenAt } });
    const o = await cash.formOptions();
    expect(o.bankAccounts.map((b) => b.name)).toEqual(['Основной счёт']);
    expect(o.expenseCategories).toEqual([{ id: cat.id, name: 'Аренда' }]);
    expect(o.incomeCategories.map((c) => c.name)).toEqual(['Прочий приход']);
    expect(o.suppliers.map((s) => s.name)).toEqual(['Бета', 'AQUA-PRODUCTS']);
    expect(o.cashboxes).toEqual([{ id: '1', name: 'Основная касса' }]);
    expect(o.outlets.map((x) => x.id)).toEqual(['o1']);
  });
});
