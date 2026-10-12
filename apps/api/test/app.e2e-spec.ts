import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';
import { PrismaService } from './../src/database/prisma.service.js';

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

  it('refuses protected routes without a session', async () => {
    for (const path of ['/salesdoc/status', '/sync/status', '/reconciliation/summary', '/sales/orders', '/cash/categories', '/cash/pages/cash-in', '/kadry/structure', '/audit?actionPrefix=cash.', '/auth/me']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
  });

  it('refuses a wrong login with 401 and an empty one with 400', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ login: 'nobody-here', password: 'x' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
  });

  it('uses the test database, not the live one', () => {
    expect(process.env.DATABASE_URL).toBe(process.env.DATABASE_URL_TEST);
  });

  it('rejects a reversed period for a logged-in user', async () => {
    const db = app.get(PrismaService);
    await db.user.deleteMany({ where: { login: 'e2e-user' } });
    await app.get(AuthService).createUser('e2e-user', 'E2E', 'e2e-pass-123');
    try {
      const login = await request(app.getHttpServer()).post('/auth/login').send({ login: 'e2e-user', password: 'e2e-pass-123' }).expect(200);
      await request(app.getHttpServer())
        .get('/reconciliation/summary?from=2026-09-30&to=2026-09-01')
        .set('authorization', `Bearer ${login.body.token}`)
        .expect(400)
        .expect((res) => expect(res.body.message).toBe('from must not be after to'));
    } finally {
      await db.user.deleteMany({ where: { login: 'e2e-user' } });
    }
  });

  afterAll(async () => {
    await app.close();
  });
});
