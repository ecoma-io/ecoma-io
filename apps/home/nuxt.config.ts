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
      include: [
        '../app/**/*',
        '../shared/**/*',
        '../test/**/*',
        '../modules/**/*.ts',
        './nuxt.d.ts',
        '../types/*.d.ts',
      ],
    },
  },
  imports: {
    autoImport: true,
  },
  // Không còn alias `@ecoma-io/*`: sau khi hợp nhất, i18n/layout/brand/
  // error-pages là **module app-local** dưới `app/` — import relative trực
  // tiếp (`app/layout` → `../i18n/index`), Nuxt/Vite resolve như mọi file
  // thường của app. Không alias nghĩa là không có khái niệm "package dùng
  // chung" nào sót lại sau khi libs đã biến mất khỏi workspace.
  modules: [
    '@nuxt/fonts',
    'nuxt-content-assets',
    '@nuxt/content',
    './modules/prerendered-content-manifest',
  ],
  css: ['~/assets/css/styles.css'],

  vite: {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss()],
  },
});
