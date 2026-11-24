import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  cacheDir: '../../node_modules/.vite/tools/domain-primitives',
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
    name: '@ecoma-io/domain-primitives',
    reporters: ['default'],
    testTimeout: 120_000,
    watch: false,
  },
}));
