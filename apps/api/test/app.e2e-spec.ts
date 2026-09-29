import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SYNC_SCHEDULE = 'off';
    process.env.SALESDOC_CREDENTIALS_FILE = 'data/__missing__.json';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('GET /health reaches the database', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ ok: true, database: 'up' });
  });

  it('GET /salesdoc/status reports missing credentials', () => {
    return request(app.getHttpServer())
      .get('/salesdoc/status')
      .expect(200)
      .expect({ configured: false, connected: false });
  });

  it('GET /sync/status lists every resource', async () => {
    const res = await request(app.getHttpServer()).get('/sync/status').expect(200);
    expect(res.body.resources.map((r: { resource: string }) => r.resource)).toContain('payments');
  });

  it('GET /reconciliation/summary rejects a reversed period', () => {
    return request(app.getHttpServer())
      .get('/reconciliation/summary?from=2026-09-30&to=2026-09-01')
      .expect(400)
      .expect((res) => expect(res.body.message).toBe('from must not be after to'));
  });

  afterAll(async () => {
    await app.close();
  });
});
