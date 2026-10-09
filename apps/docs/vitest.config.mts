/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import vue from '@vitejs/plugin-vue';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/docs',
  // nxViteTsPaths resolve alias `@ecoma-io/*` trong test, vue() transform
  // component `.vue` — đặt sau vì transform pipeline đọc theo thứ tự.
  plugins: [nxViteTsPaths(), vue()],
  test: {
    name: '@ecoma-io/docs',
    watch: false,
    globals: true,
    environment: 'jsdom',
    // `app/` là thư mục source của docs app (Nuxt 4 `srcDir`), nên phải có trong
    // glob — các test đặt cạnh component để review dễ thấy test của tầng nào.
    include: ['{app,src,tests,server}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
