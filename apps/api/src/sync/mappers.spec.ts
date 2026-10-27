import {
  mapBalance,
  mapOrder,
  mapOutlet,
  mapPayment,
  mapProduct,
  mapProductCategory,
  mapPurchase,
  mapReturn,
  mapStock,
  mapSupervisor,
  mapWarehouse,
} from './mappers.js';

const seenAt = new Date('2026-09-29T10:00:00Z');

describe('mappers', () => {
  it('maps a warehouse with Y/N active flag', () => {
    const w = mapWarehouse(
      { CS_id: 'f5-d0_3', SD_id: 'd0_3', code_1C: 'andimport', name: 'Склад Импорт', active: 'Y' },
      seenAt,
    );
    expect(w).toMatchObject({ sdId: 'd0_3', csId: 'f5-d0_3', code1c: 'andimport', name: 'Склад Импорт', active: true, seenAt });
  });

  it('maps a product with its category', () => {
    const p = mapProduct(
      { SD_id: 'd0_15', name: 'Вода 0.33 стекло газ', active: 'Y', packQuantity: 12, category: { CS_id: 'd0_3', SD_id: 'd0_3' } },
      seenAt,
    );
    expect(p).toMatchObject({ sdId: 'd0_15', packQuantity: 12, categorySdId: 'd0_3' });
    expect(mapProduct({ SD_id: 'd0_16', name: 'Без категории', active: 'Y' }, seenAt).categorySdId).toBeNull();
  });

  it('maps a product category', () => {
    const c = mapProductCategory({ CS_id: 'd0_3', SD_id: 'd0_3', code_1C: '000000003', name: 'Вода', active: 'N' }, seenAt);
    expect(c).toMatchObject({ sdId: 'd0_3', code1c: '000000003', name: 'Вода', active: false, seenAt });
  });

  it('maps an outlet', () => {
    const o = mapOutlet(
      {
        CS_id: 'f5-a0_1083', SD_id: 'a0_1083', code_1C: null, name: 'Икромов Улугбек Мед Колледж',
        firmName: 'Икромов Улугбек Ятт', address: 'Кургонтепа', active: 'N', inn: '605789431',
        updatedAt: '2025-02-28 12:30:36', expeditor: { CS_id: 'f5-d0_1', SD_id: 'd0_1', code_1C: 'aid1' },
      },
      seenAt,
    );
    expect(o).toMatchObject({
      sdId: 'a0_1083', name: 'Икромов Улугбек Мед Колледж', firmName: 'Икромов Улугбек Ятт',
      inn: '605789431', active: false, expeditorSdId: 'd0_1',
    });
    expect(o.updatedAtSd?.toISOString()).toBe('2025-02-28T12:30:36.000Z');
  });

  it('flattens stock into one row per warehouse and product', () => {
    const rows = mapStock(
      {
        SD_id: 'd0_3', name: 'Склад Импорт',
        products: [
          { SD_id: 'd0_99', name: 'Крутец 18*100', quantity: 65 },
          { SD_id: 'd0_95', name: 'Гренки', quantity: 0 },
        ],
      },
      seenAt,
    );
    expect(rows.map((r) => [r.sdId, r.productSdId, r.quantity.toString()])).toEqual([
      ['d0_3:d0_99', 'd0_99', '65'],
      ['d0_3:d0_95', 'd0_95', '0'],
    ]);
  });

  it('maps a purchase using purchase_id without the filial prefix', () => {
    const { row, lines } = mapPurchase(
      {
        SD_id: 'd0_6', name: 'Нич склад основной', date: '2026-09-28 15:52:51', updated: '2026-09-28 11:22:19',
        purchase_id: 'f5-d0_432', shipper: { SD_id: '1', name: 'Основной поставщик' },
        detail: [
          { SD_id: 'd0_12', name: 'Черноголовка ПЭТ 1.5 л (Буратино)', quantity: 2592, price: 9101.83, amount: 23591931.96 },
          { SD_id: 'd0_700', name: 'Тархун 1,5 л', quantity: 432, price: 9101.83, amount: 3931988.66 },
        ],
      },
      seenAt,
    );
    expect(row).toMatchObject({ sdId: 'd0_432', csId: 'f5-d0_432', warehouseSdId: 'd0_6', supplierSdId: '1' });
    expect(row.total.toString()).toBe('27523920.62');
    expect(lines[0]).toMatchObject({ productSdId: 'd0_12', productName: 'Черноголовка ПЭТ 1.5 л (Буратино)' });
    expect(lines[0].amount.toString()).toBe('23591931.96');
  });

  it('maps an order, its lines, and no due date for 1970-01-01', () => {
    const { row, lines } = mapOrder(
      {
        CS_id: 'f5-d0_111012', SD_id: 'd0_111012', code_1C: null, status: 3,
        dateCreate: '2026-09-29 09:40:28', dateDocument: '2026-09-30 09:40:28', dateDelivered: null,
        totalSumma: 65002.56, discountSumma: 14950.59, totalSummaAfterDiscount: 50051.97,
        totalReturnsSumma: 0, debtDateExp: '1970-01-01',
        client: { SD_id: 'a2_1800' }, agent: { SD_id: 'd0_5' }, expeditor: { SD_id: null },
        store: { SD_id: 'd0_6' }, paymentType: { SD_id: 'd0_2' },
        orderProducts: [
          { product: { SD_id: 'd0_11', name: 'Дюшес 1.5' }, quantity: 7, price: 8337.5, discount: 0, summa: 58362.5, returned: 0 },
        ],
      },
      seenAt,
    );
    expect(row).toMatchObject({
      sdId: 'd0_111012', status: 3, outletSdId: 'a2_1800', agentSdId: 'd0_5',
      expeditorSdId: null, warehouseSdId: 'd0_6', paymentTypeSdId: 'd0_2', debtDateExp: null,
    });
    expect(row.totalAfterDiscount.toString()).toBe('50051.97');
    expect(row.dateDocument.toISOString()).toBe('2026-09-30T09:40:28.000Z');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ productSdId: 'd0_11', productName: 'Дюшес 1.5' });
  });

  it('maps a return with a positive amount and the document date', () => {
    const { row, lines } = mapReturn(
      {
        CS_id: 'f5-d0_100235', SD_id: 'd0_100235', status: 3,
        date: '2026-06-10 15:02:00', dateLoad: '2026-06-10 09:00:00',
        totalSumma: -1105043.52, summa: -1105043.52,
        client: { SD_id: 'y7_131' }, agent: { SD_id: 'd0_2' }, expeditor: { SD_id: 'd0_3' },
        store: { SD_id: 'd0_1' }, reason: null,
        defectProducts: [{ product: { SD_id: 'd0_590' }, quantity: 102, price: 10833.76, summa: 1105043.52 }],
      },
      seenAt,
    );
    expect(row.amount.toString()).toBe('1105043.52');
    expect(row.dateDocument.toISOString()).toBe('2026-06-10T09:00:00.000Z');
    expect(row.outletSdId).toBe('y7_131');
    expect(lines[0].summa.toString()).toBe('1105043.52');
  });

  it('maps a payment and its order allocations', () => {
    const { row, lines } = mapPayment(
      {
        CS_id: 'f5-a0_20274', SD_id: 'a0_20274', code_1C: null, paymentDate: '2023-11-01 10:35:09',
        amount: 24978, comment: null, transactionType: 3, paymentType: { SD_id: 'd0_2' },
        client: { SD_id: 'v0_616' }, agent: { SD_id: 'd0_4' }, cashbox: { SD_id: '1' },
        orders: [{ SD_id: 'd0_1363', amount: 24978 }],
      },
      seenAt,
    );
    expect(row).toMatchObject({ sdId: 'a0_20274', transactionType: 3, outletSdId: 'v0_616', cashboxSdId: '1' });
    expect(row.amount.toString()).toBe('24978');
    expect(lines).toEqual([expect.objectContaining({ orderSdId: 'd0_1363' })]);
  });

  it('rounds float noise to two decimals', () => {
    const { row } = mapPayment(
      { SD_id: 'x', paymentDate: '2026-01-01', amount: -350985.54000000004, transactionType: 3, orders: [] },
      seenAt,
    );
    expect(row.amount.toString()).toBe('-350985.54');
  });

  it('turns a Salesdoc balance into our debt (negative balance = owes us)', () => {
    const b = mapBalance(
      { CS_id: 'f5-m4_386', SD_id: 'm4_386', name: 'BEХRUZ MARKET', active: true, balance: -350985.54000000004 },
      seenAt,
    );
    expect(b).toMatchObject({ sdId: 'm4_386', name: 'BEХRUZ MARKET', seenAt });
    expect(b.debt.toString()).toBe('350985.54');
  });

  it('maps a supervisor like an agent', () => {
    const s = mapSupervisor({ SD_id: 'd0_30', CS_id: 'F5-d0_30', code_1C: null, name: 'Супервайзер Андижан', active: 'Y', agents: [{ SD_id: 'd0_1' }] }, seenAt);
    expect(s).toMatchObject({ sdId: 'd0_30', csId: 'F5-d0_30', name: 'Супервайзер Андижан', active: true });
  });
});
