/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/blogs',
  // nxViteTsPaths resolve alias `@ecoma-io/*` trong test, vue() transform
  // component `.vue` — đặt sau vì transform pipeline đọc theo thứ tự.
  plugins: [nxViteTsPaths(), vue()],
  resolve: {
    // Nuxt alias không tồn tại ngoài Nuxt runtime: `~`/`~/` map vào `app/`
    // theo convention Nuxt 4 (`srcDir: app/`) — component test import helper
    // qua `~/utils/*` cần mapping này (giống `apps/home`).
    alias: {
      '~': new URL('./app', import.meta.url).pathname,
      '~/': new URL('./app/', import.meta.url).pathname,
    },
  },
  test: {
    name: '@ecoma-io/blogs',
    watch: false,
    globals: true,
    environment: 'jsdom',
    // `app/` là thư mục source của blogs app (Nuxt 4 `srcDir`), nên phải có trong
    // glob — các test đặt cạnh component để review dễ thấy test của tầng nào.
    // `tests/` chứa content-contract test chạy trên file content thật.
    include: ['{app,src,tests,server}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
