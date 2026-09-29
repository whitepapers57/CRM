import { execSync } from 'node:child_process';

/** Brings the test database up to the current migrations before any spec runs. */
export default function setup() {
  process.loadEnvFile();
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set in apps/api/.env');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
