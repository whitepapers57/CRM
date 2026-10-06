import { createTestDb, truncateAll } from '../testing/test-db.js';
import { CashRefsService } from './cash-refs.service.js';

const db = createTestDb();
const refs = new CashRefsService(db);
const seenAt = new Date();

describe('CashRefsService', () => {
  beforeEach(async () => {
    await truncateAll(db);
    await db.paymentType.createMany({
      data: [
        { sdId: 'd0_1', name: 'Наличный', active: true, raw: {}, seenAt },
        { sdId: 'd0_2', name: 'Перечисление', active: true, raw: {}, seenAt },
        { sdId: 'd0_3', name: 'Терминал', active: true, raw: {}, seenAt },
        { sdId: 'd0_4', name: 'Click', active: true, raw: {}, seenAt },
      ],
    });
  });
  afterAll(() => db.$disconnect());

  it('adds, renames and deactivates bank accounts and статьи, sorted by name', async () => {
    const a = await refs.addBankAccount('  Ипотека банк  ');
    await refs.addBankAccount('Asaka');
    await refs.renameBankAccount(a.id, 'Ипотека банк (сум)');
    await refs.setBankAccountActive(a.id, false);
    expect(await refs.bankAccounts()).toEqual([
      expect.objectContaining({ name: 'Ипотека банк (сум)', active: false }),
      expect.objectContaining({ name: 'Asaka', active: true }),
    ]);
    await refs.addCategory('Транспорт', 'expense');
    await expect(refs.addCategory(' ', 'expense')).rejects.toThrow('Введите название');
    await expect(refs.addCategory('x', 'other')).rejects.toThrow('Неверный вид статьи');
    await expect(refs.renameCategory('nope', 'x')).rejects.toThrow('Не найдено');
    expect((await refs.categories()).map((c) => [c.name, c.kind])).toEqual([['Транспорт', 'expense']]);
  });

  it('defaults payment types by name (only «Перечисление» to bank) and lets the owner change one', async () => {
    expect((await refs.paymentTypeAccounts()).map((p) => [p.name, p.account])).toEqual([
      ['Наличный', 'cash'], ['Перечисление', 'bank'], ['Терминал', 'cash'], ['Click', 'cash'],
    ]);
    await refs.setPaymentTypeAccount('d0_4', 'bank');
    await expect(refs.setPaymentTypeAccount('d0_4', 'card')).rejects.toThrow('Неверный счёт');
    expect((await refs.accountOfPaymentType()).get('d0_4')).toBe('bank');
  });

  it('defaults an unknown payment type to cash', async () => {
    expect((await refs.accountOfPaymentType()).get('d0_4')).toBe('cash');
  });

  it('deactivated category stays on old operations', async () => {
    const c = await refs.addCategory('Аренда', 'expense');
    await refs.setCategoryActive(c.id, false);
    const all = await refs.categories();
    expect(all.find((x) => x.id === c.id)).toMatchObject({ name: 'Аренда', active: false });
  });
});
