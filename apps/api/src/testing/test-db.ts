import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';

/** A PrismaService on DATABASE_URL_TEST. Never points at the dev database. */
export function createTestDb(): PrismaService {
  try {
    process.loadEnvFile();
  } catch {
    // CI provides the env directly
  }
  const url = process.env.DATABASE_URL_TEST;
  if (!url?.includes('_test')) {
    throw new Error('DATABASE_URL_TEST must point at a *_test database');
  }
  const config = { getOrThrow: () => url } as unknown as ConfigService;
  return new PrismaService(config);
}

/** Empties every application table. Test database only. */
export async function truncateAll(db: PrismaService): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
