import { defineConfig } from 'vitest/config';

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
    // Probe Docker một lần mỗi lần chạy (trước khi worker khởi động); xem
    // `tests/integration/docker-probe.global-setup.ts`. Không có đó thì mỗi
    // spec file tự probe — mỗi probe là một container PostgreSQL thật.
    globalSetup: ['./tests/integration/docker-probe.global-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
