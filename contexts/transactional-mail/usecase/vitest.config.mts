import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  cacheDir: '../../../node_modules/.vite/tools/transactional-mail-usecase',
  resolve: {
    alias: {
      '@ecoma-io/domain-primitives': fileURLToPath(
        new URL('../../../kernels/domain-primitives/src/index.ts', import.meta.url),
      ),
      '@ecoma-io/usecase-primitives': fileURLToPath(
        new URL('../../../kernels/usecase-primitives/src/index.ts', import.meta.url),
      ),
      '@ecoma-io/transactional-mail-domain': fileURLToPath(
        new URL('../domain/src/index.ts', import.meta.url),
      ),
    },
  },
  root: import.meta.dirname,
  test: {
    coverage: {
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './coverage',
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
    name: '@ecoma-io/transactional-mail-usecase',
    reporters: ['default'],
    testTimeout: 120_000,
    watch: false,
  },
}));
