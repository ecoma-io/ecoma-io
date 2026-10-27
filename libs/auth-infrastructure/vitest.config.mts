/// <reference types='vitest' />
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/auth-infrastructure',
  test: {
    name: '@ecoma-io/auth-infrastructure',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Probe Docker một lần mỗi lần chạy (trước khi worker khởi động) — harness
    // PostgreSQL thật mà spec colocated import nằm trong app sở hữu database
    // đó (`apps/auth/tests/integrations/harness.ts`); probe của lib là một
    // shell mỏng gọi đúng pattern đó. Không có đó thì mỗi spec file tự probe —
    // mỗi probe là một container PostgreSQL thật.
    globalSetup: ['./src/docker-probe.global-setup.ts'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
