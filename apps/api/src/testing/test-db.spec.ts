import { createTestDb, truncateAll } from './test-db.js';

describe('test database', () => {
  const db = createTestDb();
  afterAll(() => db.$disconnect());

  it('is migrated and truncatable', async () => {
    await db.warehouse.create({
      data: { sdId: 'd0_1', name: 'W', active: true, raw: {}, seenAt: new Date() },
    });
    await truncateAll(db);
    expect(await db.warehouse.count()).toBe(0);
  });
});
