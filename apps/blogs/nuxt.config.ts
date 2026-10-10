import { createResolver } from '@nuxt/kit';
import { defineNuxtConfig } from 'nuxt/config';
import tailwindcss from '@tailwindcss/vite';

// `createResolver` (thay vì `fileURLToPath(new URL(...))`): app có tag
// `runtime:edge` và oxlint cấm import Node.js builtin (`node:url`) trong
// `apps/**`. Resolver của `@nuxt/kit` cho ra **đúng cùng đường dẫn tuyệt đối**
// mà không cần builtin nào.
const { resolve } = createResolver(import.meta.url);

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-05',
  workspaceDir: '../../',
  devtools: { enabled: true },
  devServer: {
    host: 'localhost',
    port: 4206,
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
  // `alias` (không phải `vite.resolve.alias`) là đường đi đúng cho workspace
  // package: Nuxt đưa alias vào **cả** bốn file `.nuxt/tsconfig*.json` (dưới
  // dạng `paths`) **và** Vite `resolve.alias`, nên TypeScript và bundler luôn
  // trỏ về cùng một file.
  //
  // Không thể dựa vào `paths` của `tsconfig.base.json`: Nuxt sinh `paths` riêng
  // trong `.nuxt/tsconfig*.json` để trỏ tới từng package trong pnpm store, và
  // TypeScript **thay thế** chứ không merge `paths` của tsconfig cha — mapping
  // `@ecoma-io/*` ở base bị che hoàn toàn (lỗi TS2307, kèm build Vite cũng
  // không resolve được).
  alias: {
    '@ecoma-io/i18n-public': resolve('../../libs/i18n-public/src/index.ts'),
    '@ecoma-io/layout-public': resolve('../../libs/layout-public/src/index.ts'),
    // `PublicHeader` của `layout-public` import `@ecoma-io/logo`; không alias
    // thì lần sinh `.nuxt/tsconfig*.json` có `paths` riêng sẽ che mất mapping
    // `@ecoma-io/*` của tsconfig base và `nuxt build` ở runner sạch báo
    // TS2307 (local còn pass nhờ base paths chảy qua — determinism phải đến
    // từ alias tường minh, cùng pattern với hai lib ở trên).
    '@ecoma-io/logo': resolve('../../libs/logo/src/index.ts'),
  },
  modules: ['@nuxt/fonts', 'nuxt-content-assets', '@nuxt/content'],
  css: ['~/assets/css/styles.css'],
  vite: {
    resolve: { tsconfigPaths: true },
    plugins: [tailwindcss()],
  },
});
