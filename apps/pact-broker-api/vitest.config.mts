import { defineConfig } from 'vitest/config';

/**
 * Config của target `test` — chỉ spec colocated với subject (06-testing.md §4:
 * `test` = colocated unit/component của project sở hữu).
 *
 * ⚠️ Suite integration nằm ở `integration-specs/` và chạy qua target
 * `test-integration` với config riêng (`vitest.integration.config.mts`). Nhét
 * `integration-specs` vào include ở đây là chạy suite đó hai lần (cả `test` lẫn
 * `test-integration`).
 */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/pact-broker-api',
  test: {
    name: '@ecoma-io/pact-broker-api',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
