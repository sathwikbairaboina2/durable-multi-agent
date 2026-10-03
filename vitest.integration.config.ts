import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    fileParallelism: false,          // all files share port 5331 (SFN Local's LAMBDA_ENDPOINT)
    testTimeout: 180_000,
    hookTimeout: 120_000,
    env: { DMA_INTEGRATION: '1' },
  },
});
