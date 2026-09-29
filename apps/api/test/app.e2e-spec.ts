import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  afterAll(async () => {
    await app.close();
  });
});
