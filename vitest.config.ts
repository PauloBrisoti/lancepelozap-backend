import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    exclude: ['dist/**', 'node_modules/**'],
  },
});
