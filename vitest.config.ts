import { defineConfig } from 'vitest/config';

// Domain tests are pure TypeScript: no HTTP, no DB, no special setup needed.
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
});
