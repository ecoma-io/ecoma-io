import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  cacheDir: '../../../node_modules/.vite/tools/auth-usercase',
  resolve: {
    alias: {
      '@ecoma-io/auth-domain': fileURLToPath(new URL('../domain/src/index.ts', import.meta.url)),
      '@ecoma-io/domain-primitives': fileURLToPath(
        new URL('../../../kernels/domain-primitives/src/index.ts', import.meta.url),
      ),
      '@ecoma-io/usecase-primitives': fileURLToPath(
        new URL('../../../kernels/usecase-primitives/src/index.ts', import.meta.url),
      ),
    },
  },
  root: import.meta.dirname,
  test: {
    coverage: {
      enabled: true,
      reportsDirectory: './coverage',
      provider: 'v8' as const,
      // Testing helpers không phải production code — loại khỏi coverage thresholds.
      exclude: ['src/testing/**'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    environment: 'node',
    globals: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    name: '@ecoma-io/auth-usercase',
    reporters: ['default'],
    testTimeout: 120_000,
    watch: false,
  },
}));
