import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env for the CLI; Node 22 can.
try {
  process.loadEnvFile();
} catch {
  // no .env — rely on the real environment
}

/**
 * Only the CLI (migrate, studio) reads this. The app connects through the
 * driver adapter in src/database/prisma.service.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL as string,
  },
});
