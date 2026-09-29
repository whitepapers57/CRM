import type { SalesdocClient } from '../salesdoc/salesdoc.client.js';
import { createTestDb, truncateAll } from '../testing/test-db.js';
import { RESOURCES } from './resources.js';
import { SyncService } from './sync.service.js';

const db = createTestDb();
const orders = RESOURCES.filter((r) => r.name === 'orders');

const order = (sdId: string, status: number, summa = 100) => ({
  SD_id: sdId, status, dateDocument: '2026-09-01 10:00:00', totalSummaAfterDiscount: summa,
  client: { SD_id: 'o1' }, orderProducts: [],
});

type Call = { method: string; params: Record<string, any> };

/** Pages keyed by page number; a thrown Error in place of a page simulates a failure. */
function fakeClient(pages: Record<number, unknown[] | Error>, calls: Call[] = []) {
  return {
    async *pages(method: string, _key: string, params: Record<string, any> = {}) {
      for (let page = params.page ?? 1; ; page++) {
        calls.push({ method, params: { ...params, page } });
        const rows = pages[page];
        if (rows instanceof Error) throw rows;
        yield { page, rows: rows ?? [], total: 0 };
        if (!rows || rows.length === 0) return;
      }
    },
  } as unknown as SalesdocClient;
}

describe('SyncService', () => {
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$disconnect());

  it('does a full pass first, saves every page and records the run', async () => {
    const svc = new SyncService(db, fakeClient({ 1: [order('a', 3)], 2: [order('b', 3)] }), orders);
    const report = await svc.run('incremental');

    expect(report).toMatchObject({ results: [{ resource: 'orders', status: 'succeeded', records: 2 }] });
    expect(await db.order.count()).toBe(2);
    const cursor = await db.syncCursor.findUniqueOrThrow({ where: { resource: 'orders' } });
    expect(cursor.lastSuccessAt).not.toBeNull();
    expect(cursor.nextPage).toBeNull();
    expect(await db.syncRun.count({ where: { method: 'orders', status: 'succeeded' } })).toBe(1);
  });

  it('keeps saved pages when a full pass fails and resumes at the failed page', async () => {
    const calls: Call[] = [];
    const failing = new SyncService(
      db, fakeClient({ 1: [order('a', 3)], 2: new Error('Salesdoc down') }, calls), orders,
    );
    const first = await failing.run('full');
    expect(first).toMatchObject({ results: [{ status: 'failed', error: 'Salesdoc down' }] });
    expect(await db.order.count()).toBe(1);
    expect((await db.syncCursor.findUniqueOrThrow({ where: { resource: 'orders' } })).nextPage).toBe(2);

    const resumeCalls: Call[] = [];
    const ok = new SyncService(db, fakeClient({ 2: [order('b', 3)] }, resumeCalls), orders);
    await ok.run('incremental');
    expect(resumeCalls[0].params.page).toBe(2);
    expect((await db.order.findMany({ orderBy: { sdId: 'asc' } })).map((o) => o.sdId)).toEqual(['a', 'b']);
  });

  it('limits a full pass to documents dated in the window, with a week of margin', async () => {
    const calls: Call[] = [];
    const now = new Date('2026-09-29T08:00:00Z');
    await new SyncService(db, fakeClient({ 1: [] }, calls), orders, () => now).run('full');
    expect(calls[0].params.filter).toEqual({
      status: [1, 2, 3, 4, 5], agent: 'all',
      period: { date: { from: '2026-06-24', to: '2026-09-29' } },
    });
  });

  it('asks only for changes since the last success, with a day of overlap', async () => {
    const t0 = new Date('2026-09-28T20:00:00Z'); // 29 Sep in Tashkent
    await new SyncService(db, fakeClient({ 1: [order('a', 2)] }), orders, () => t0).run('full');

    const calls: Call[] = [];
    const later = new Date('2026-09-29T08:00:00Z');
    await new SyncService(db, fakeClient({ 1: [order('a', 3)] }, calls), orders, () => later).run('incremental');

    expect(calls[0].params.filter).toEqual({
      status: [1, 2, 3, 4, 5], agent: 'all',
      period: { dateUpdate: { from: '2026-09-28', to: '2026-09-29' } },
    });
    expect((await db.order.findUniqueOrThrow({ where: { sdId: 'a' } })).status).toBe(3);
  });

  it('removes rows a completed full pass no longer sees, but never after an incremental pass', async () => {
    await new SyncService(db, fakeClient({ 1: [order('a', 3), order('gone', 3)] }), orders).run('full');
    await new SyncService(db, fakeClient({ 1: [order('a', 3)] }), orders).run('incremental');
    expect(await db.order.count()).toBe(2);

    await new SyncService(db, fakeClient({ 1: [order('a', 3)] }), orders).run('full');
    expect((await db.order.findMany()).map((o) => o.sdId)).toEqual(['a']);
  });

  it("gives a slow page more than Prisma's default 5-second transaction", async () => {
    // A real page of 1,000 orders with their lines took 8.6 s to save.
    const slow = {
      ...orders[0],
      save: async (...args: Parameters<(typeof orders)[0]['save']>) => {
        await new Promise((r) => setTimeout(r, 5500));
        return orders[0].save(...args);
      },
    };
    const report = await new SyncService(db, fakeClient({ 1: [order('a', 3)] }), [slow]).run('full');
    expect(report).toMatchObject({ results: [{ status: 'succeeded', records: 1 }] });
  }, 20_000);

  it('refuses to prune a table when Salesdoc suddenly returns nothing', async () => {
    // Review finding: an empty page 1 counted as a completed pass and pruned everything.
    await new SyncService(db, fakeClient({ 1: [order('a', 3), order('b', 3)] }), orders).run('full');
    const report = await new SyncService(db, fakeClient({ 1: [] }), orders).run('full');
    expect(report).toMatchObject({ results: [{ status: 'failed', error: expect.stringContaining('no rows') }] });
    expect(await db.order.count()).toBe(2);
  });

  it('keeps the old balance anchor when a movement resource failed in the same run', async () => {
    // Review finding: a new anchor with stale movements gives wrong openings.
    const balances = RESOURCES.find((r) => r.name === 'balances')!;
    const client = {
      async *pages(method: string) {
        if (method === 'getOrder') throw new Error('Salesdoc 502');
        yield { page: 1, rows: [{ SD_id: 'o1', balance: -700 }], total: 1 };
      },
    } as unknown as SalesdocClient;
    const report = await new SyncService(db, client, [orders[0], balances]).run('incremental');
    expect(report).toMatchObject({
      results: [
        { resource: 'orders', status: 'failed' },
        { resource: 'balances', status: 'failed', error: expect.stringContaining('orders failed') },
      ],
    });
    expect(await db.outletBalance.count()).toBe(0);
  });

  it('refuses to start a second run while one is going', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      async *pages() {
        await gate;
        yield { page: 1, rows: [], total: 0 };
      },
    } as unknown as SalesdocClient;
    const svc = new SyncService(db, slow, orders);
    const first = svc.run('incremental');
    expect(await svc.run('incremental')).toEqual({ alreadyRunning: true });
    release();
    await first;
  });

  it('queues a full run behind a running incremental one instead of dropping it', async () => {
    // Review finding: both crons fire at 03:00 and the nightly full pass was dropped.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = {
      async *pages() {
        await gate;
        yield { page: 1, rows: [], total: 0 };
      },
    } as unknown as SalesdocClient;
    const svc = new SyncService(db, slow, orders);
    const incremental = svc.run('incremental');
    const full = svc.run('full');
    release();
    await incremental;
    expect(await full).toMatchObject({ kind: 'full', results: [{ resource: 'orders', status: 'succeeded' }] });
  });

  it('reports data as of the oldest successful resource', async () => {
    const t = new Date('2026-09-29T09:30:00Z');
    await new SyncService(db, fakeClient({ 1: [] }), orders, () => t).run('incremental');
    const status = await new SyncService(db, fakeClient({}), orders).status();
    expect(status.dataAsOf).toBe(t.toISOString());
    expect(status.resources[0]).toMatchObject({ resource: 'orders', resumePage: null });
  });
});
