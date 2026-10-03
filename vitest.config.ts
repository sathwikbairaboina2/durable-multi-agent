import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'infra/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
