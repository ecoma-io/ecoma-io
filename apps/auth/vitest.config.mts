import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/auth',
  test: {
    name: '@ecoma-io/auth',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,integration-specs}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Probe Docker một lần mỗi lần chạy (trước khi worker khởi động); xem
    // `integration-specs/docker-probe.global-setup.ts`. Không có đó thì mỗi
    // spec file tự probe — mỗi probe là một container PostgreSQL thật.
    globalSetup: ['./integration-specs/docker-probe.global-setup.ts'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
