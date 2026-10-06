import { ConflictException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { AuditService } from '../audit/audit.service.js';
import { MonthsService } from '../months/months.service.js';
import { CashRefsService } from './cash-refs.service.js';
import { CashService } from './cash.service.js';
import { opsForPage } from './operations.js';

const db = createTestDb();
const audit = new AuditService(db);
const months = new MonthsService(db, audit);
const refs = new CashRefsService(db);
const cash = new CashService(db, months, audit, refs);
const user = { id: 'u1', login: 'sardor', name: 'Сардорбек' };
const seenAt = new Date();
let bank = '';
let expenseCat = '';
let incomeCat = '';

beforeEach(async () => {
  await truncateAll(db);
  await db.user.create({ data: { id: 'u1', login: 'sardor', name: 'Сардорбек', passwordHash: 'x' } });
  await db.cashbox.create({ data: { sdId: '1', name: 'Основная касса', active: true, raw: {}, seenAt } });
  await db.supplier.create({ data: { sdId: '1', name: 'Основной поставщик', active: true, raw: {}, seenAt } });
  await db.outlet.create({ data: { sdId: 'o1', name: 'Агентлар (черноголовка)', active: true, raw: {}, seenAt } });
  bank = (await refs.addBankAccount('Основной счёт')).id;
  expenseCat = (await refs.addCategory('Транспорт', 'expense')).id;
  incomeCat = (await refs.addCategory('Прочие доходы', 'income')).id;
});
afterAll(() => db.$disconnect());

// A function: `bank` is only known once beforeEach has run (ruling R1).
const pay = () => ({ operation: 'supplier_payment', account: 'bank', bankAccountId: bank, date: '2026-10-02', amount: 10500000, supplierSdId: '1' }) as const;

describe('CashService — create', () => {
  it('builds each page menu from the catalogue', () => {
    expect(opsForPage('cash-out')).toContain('cash_to_bank');
    expect(opsForPage('bank-out')).not.toContain('cash_to_bank');
    expect(opsForPage('bank-in')).toEqual(['from_buyer', 'supplier_refund', 'employee_loan_return', 'credit_received', 'other_income']);
  });

  it('creates a numbered supplier payment and records it', async () => {
    const a = await cash.create(pay(), user);
    const b = await cash.create({ operation: 'expense', account: 'cash', cashboxSdId: '1', date: '2026-10-03', amount: '30800.5', categoryId: expenseCat, comment: 'услуга банка' }, user);
    expect([a.number, b.number]).toEqual(['ДД-000001', 'ДД-000002']);
    const op = await cash.get(a.id);
    expect(op).toMatchObject({ number: 'ДД-000001', operation: 'supplier_payment', amount: '10500000.00', supplierName: 'Основной поставщик', bankAccountName: 'Основной счёт', cancelled: null, monthOpen: true });
    const [entry] = await audit.list({ target: a.id });
    expect(entry).toMatchObject({ action: 'cash.create', userName: 'Сардорбек' });
  });

  it('asks for the one field each operation needs', async () => {
    const base = { account: 'cash', cashboxSdId: '1', date: '2026-10-02', amount: 1 } as const;
    await expect(cash.create({ ...base, operation: 'supplier_payment' }, user)).rejects.toThrow('Выберите поставщика');
    await expect(cash.create({ ...base, operation: 'buyer_refund' }, user)).rejects.toThrow('Выберите покупателя');
    await expect(cash.create({ ...base, operation: 'expense' }, user)).rejects.toThrow('Выберите статью');
    await expect(cash.create({ ...base, operation: 'expense', categoryId: incomeCat }, user)).rejects.toThrow('Выберите статью');
    await expect(cash.create({ ...base, operation: 'salary', counterpartyName: '  ' }, user)).rejects.toThrow('Укажите кому / от кого');
    await expect(cash.create({ ...base, operation: 'cash_to_bank' }, user)).rejects.toThrow('Выберите счёт для взноса');
    await expect(cash.create({ ...base, operation: 'supplier_payment', supplierSdId: 'zz' }, user)).rejects.toThrow('Поставщик не найден');
    await expect(cash.create({ ...base, operation: 'from_buyer', outletSdId: 'zz' }, user)).rejects.toThrow('Покупатель не найден');
    await expect(cash.create({ ...base, operation: 'payroll' }, user)).resolves.toMatchObject({ number: 'ДД-000001' });
  });

  it('checks account, date and amount', async () => {
    await expect(cash.create({ ...pay(), operation: 'nope' as never }, user)).rejects.toThrow('Неверная операция');
    await expect(cash.create({ ...pay(), operation: 'cash_to_bank', account: 'bank' }, user)).rejects.toThrow('Операция недоступна для этого счёта');
    await expect(cash.create({ ...pay(), bankAccountId: null }, user)).rejects.toThrow('Выберите счёт');
    await expect(cash.create({ ...pay(), account: 'cash', bankAccountId: null }, user)).rejects.toThrow('Выберите кассу');
    await expect(cash.create({ ...pay(), account: 'cash', bankAccountId: null, cashboxSdId: 'zz' }, user)).rejects.toThrow('Касса не найдена');
    await expect(cash.create({ ...pay(), date: '2026-02-31' }, user)).rejects.toThrow('Неверная дата');
    await expect(cash.create({ ...pay(), date: '2026-08-31' }, user)).rejects.toThrow('Дата раньше 01.09.2026');
    await expect(cash.create({ ...pay(), date: '2099-01-01' }, user)).rejects.toThrow('Дата в будущем');
    await expect(cash.create({ ...pay(), amount: 0 }, user)).rejects.toThrow('Сумма должна быть больше нуля');
    await expect(cash.create({ ...pay(), amount: '1.234' }, user)).rejects.toThrow('Сумма: не больше 2 знаков после запятой');
  });

  it('refuses a closed month', async () => {
    await months.setClosed('2026-09', true, user);
    await expect(cash.create({ ...pay(), date: '2026-09-30' }, user)).rejects.toThrow('Месяц закрыт');
  });
});

describe('CashService — edit, cancel, restore', () => {
  it('edits fields but not the operation, with before/after in history', async () => {
    const { id } = await cash.create(pay(), user);
    await cash.update(id, { ...pay(), amount: 12000000, comment: 'исправлено' }, user);
    expect(await cash.get(id)).toMatchObject({ amount: '12000000.00', comment: 'исправлено' });
    await expect(cash.update(id, { ...pay(), operation: 'expense', categoryId: expenseCat }, user)).rejects.toThrow('Вид операции не меняется');
    const [edit] = await audit.list({ target: id });
    expect(edit).toMatchObject({ action: 'cash.edit' });
    expect(edit.before).toMatchObject({ amount: '10500000.00' });
    expect(edit.after).toMatchObject({ amount: '12000000.00' });
  });

  it('refuses moving into a closed month', async () => {
    const { id } = await cash.create(pay(), user);
    await months.setClosed('2026-09', true, user);
    await expect(cash.update(id, { ...pay(), date: '2026-09-15' }, user)).rejects.toThrow('Месяц закрыт');
  });

  it('cancels with a reason, refuses edits while cancelled, restores', async () => {
    const { id } = await cash.create(pay(), user);
    await expect(cash.cancel(id, ' ', user)).rejects.toThrow('Укажите причину');
    await cash.cancel(id, 'дубль', user);
    expect((await cash.get(id)).cancelled).toMatchObject({ by: 'Сардорбек', reason: 'дубль' });
    await expect(cash.cancel(id, 'ещё', user)).rejects.toBeInstanceOf(ConflictException);
    await expect(cash.update(id, pay(), user)).rejects.toThrow('Операция отменена');
    await cash.restore(id, user);
    expect((await cash.get(id)).cancelled).toBeNull();
    await expect(cash.restore(id, user)).rejects.toThrow('Операция не отменена');
    // Sorted, not ordered: audit rows can tie within a millisecond (ruling R2).
    expect((await audit.list({ target: id })).map((e) => e.action).sort()).toEqual(['cash.cancel', 'cash.create', 'cash.restore']);
  });

  it('refuses cancel and restore in a closed month, and an unknown id', async () => {
    const { id } = await cash.create(pay(), user);
    await months.setClosed('2026-10', true, user);
    await expect(cash.cancel(id, 'x', user)).rejects.toThrow('Месяц закрыт');
    await expect(cash.get('nope')).rejects.toThrow('Операция не найдена');
  });
});
