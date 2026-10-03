import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// e2e runs the whole app: point it at the test database, never at Supabase.
process.loadEnvFile();
if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is not set in apps/api/.env');

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: process.env.DATABASE_URL_TEST },
  },
});
