import { defineNuxtConfig } from 'nuxt/config';
import tailwindcss from '@tailwindcss/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-05',
  workspaceDir: '../../',
  devtools: { enabled: true },
  devServer: {
    host: 'localhost',
    port: 4205,
  },
  typescript: {
    typeCheck: true,
    tsConfig: {
      extends: '../../../tsconfig.base.json',
    },
  },
  imports: {
    autoImport: true,
  },
  css: ['~/assets/css/styles.css'],
  vite: {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss()],
  },
  modules: ['@vite-pwa/nuxt', '@nuxt/fonts'],
  pwa: {
    registerType: 'prompt',
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      runtimeCaching: [
        {
          urlPattern: /^\/api\/.*/iu,
          handler: 'NetworkOnly',
        },
        {
          urlPattern: /^https:\/\/.*\.api\..*/iu,
          handler: 'NetworkOnly',
        },
        {
          urlPattern: /\/_nuxt\/.*\.(js|css)/iu,
          handler: 'CacheFirst',
          options: {
            cacheName: 'nuxt-assets',
            expiration: {
              maxEntries: 100,
              maxAgeSeconds: 60 * 60 * 24 * 30,
            },
          },
        },
      ],
    },
    manifest: {
      name: 'Ecoma LLM Seller',
      short_name: 'LLM Seller',
      description: 'Ecoma LLM seller application',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#111827',
      icons: [
        {
          src: '/favicon.ico',
          sizes: '48x48',
          type: 'image/x-icon',
        },
      ],
    },
    devOptions: {
      enabled: false,
    },
  },
});
