import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Specs that touch the test database must not run concurrently.
    fileParallelism: false,
  },
});
