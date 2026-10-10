/// <reference types='vitest' />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/home',
  // `nxViteTsPaths()` resolve alias `@ecoma-io/*` từ `tsconfig.base.json`;
  // `vue()` transform component `.vue` (nuxt.config.ts cũng khai alias này cho
  // runtime — hai nơi phải khớp, xem `apps/home/nuxt.config.ts`).
  plugins: [nxViteTsPaths(), vue()],
  resolve: {
    // Nuxt alias không tồn tại ngoài Nuxt runtime: `#shared` là output của
    // Nuxt, ở đây phải tự trỏ, còn `~`/`~/` map vào `app/` theo convention
    // Nuxt 4 (`srcDir: app/`).
    alias: {
      '#shared': new URL('./shared', import.meta.url).pathname,
      '~': new URL('./app', import.meta.url).pathname,
      '~/': new URL('./app/', import.meta.url).pathname,
    },
  },
  test: {
    name: '@ecoma-io/home',
    watch: false,
    globals: true,
    environment: 'jsdom',
    // Nuxt dùng `app/` (pages, domain) và `shared/`, không dùng `src/`;
    // giữ `src`/`tests` để không phá project được generate. `deploy/` là
    // tooling CI-side chạy trên Node runner (không thuộc runtime:edge của
    // app) nhưng vẫn thuộc sở hữu của project `home`, nên spec của nó được
    // chạy cùng vitest của project.
    include: [
      '{src,tests,app,shared,server}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
      'deploy/pipeline/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
