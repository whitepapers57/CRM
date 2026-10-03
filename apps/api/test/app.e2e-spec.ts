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

  it('refuses protected routes without a session', async () => {
    for (const path of ['/salesdoc/status', '/sync/status', '/reconciliation/summary', '/auth/me']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
  });

  it('refuses a wrong login with 401 and an empty one with 400', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({ login: 'nobody-here', password: 'x' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
  });

  afterAll(async () => {
    await app.close();
  });
});
