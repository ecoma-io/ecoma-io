import { defineNuxtConfig } from 'nuxt/config';
import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-05',
  workspaceDir: '../../',
  devtools: { enabled: true },
  devServer: {
    host: 'localhost',
    port: 4200,
  },
  typescript: {
    typeCheck: true,
    tsConfig: {
      extends: '../../../tsconfig.base.json', // Nuxt chép nguyên văn chuỗi này sang `./.nuxt/tsconfig.json`, nên nó phải là đường dẫn tương đối so với thư mục đó
    },
  },
  imports: {
    autoImport: true,
  },
  alias: {
    // Nuxt **thay thế** (không merge) `paths` của tsconfig nền khi sinh
    // `.nuxt/tsconfig.*.json`; nó chỉ dựng `paths` từ `nuxt.options.alias` và
    // `typescript.hoist`. Không khai ở đây thì `@ecoma-io/*` trong
    // `tsconfig.base.json` vô hình với app, và `nuxt build` fail TS2307.
    // `new URL(..., import.meta.url).pathname` thay cho `fileURLToPath` vì
    // `runtime:edge` cấm import Node.js builtin (`node:url`).
    '@ecoma-io/i18n-public': new URL('../../libs/i18n-public/src/index.ts', import.meta.url)
      .pathname,
    '@ecoma-io/layout-public': new URL('../../libs/layout-public/src/index.ts', import.meta.url)
      .pathname,
  },
  css: ['~/assets/css/styles.css'],
  modules: ['@nuxt/fonts'],

  vite: {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss()],
  },
});
