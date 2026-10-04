import { defineNuxtConfig } from 'nuxt/config';
import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-05',
  workspaceDir: '../../',
  devtools: { enabled: true },
  devServer: {
    host: 'localhost',
    port: 4203,
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
  modules: ['@nuxt/fonts', 'nuxt-content-assets', '@nuxt/content'],
  css: ['~/assets/css/styles.css'],
  vite: {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss()],
  },
});
