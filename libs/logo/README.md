# logo

Thư viện **brand logo** của ecoma.io: artwork SVG nguồn sống trong repo và được phân phối qua một Vue component dùng chung, thay vì để mỗi app giữ bản copy SVG riêng.

## Library làm gì

- Lưu **primary horizontal logo** (SVG nguồn, giữ nguyên byte — artwork, hình học, tỷ lệ và màu sắc là bất biến) tại `src/assets/ecoma-logo-horizontal.svg`.
- Render logo qua component [`EcomaLogo`](#ecomalogo) — `<img>` trỏ tới URL asset do bundler resolve.
- Export [`ECOMA_LOGO_HORIZONTAL_SVG_URL`](#ecoma_logo_horizontal_svg_url) cho consumer cần phần tử ảnh tự quản (favicon, Open Graph image…).

## Library không làm gì

- Không tạo biến thể chưa có thiết kế chính thức: hiện **chỉ có primary horizontal logo**; stacked, symbol, wordmark riêng, colorway … chưa có ở đây và không được tự vẽ.
- Không chỉnh sửa SVG bằng code — không recolor, không crop, không tween; thay đổi artwork là thay đổi file nguồn, không phải component.
- Không bọc logo trong link, không đọc router, không áp margin/spacing — brand link và layout là việc của consumer.
- Không phụ thuộc library nào khác trong workspace (không cần locale, không cần layout) — chỉ `vue` và plugin bundler đã có sẵn.
- Không biết Nx project, Worker name hay deployment unit.

## `EcomaLogo`

```vue
<script setup lang="ts">
import { EcomaLogo } from '@ecoma-io/logo';
</script>

<template>
  <!-- Kích thước mặc định: intrinsic của SVG (160×46, qua width/height
       attribute — browser reserve không gian trước khi artwork tải xong,
       không CLS) -->
  <EcomaLogo />

  <!-- Consumer đổi kích thước bằng CSS (CSS thắng width/height attribute);
       `height: auto` giữ tỷ lệ gốc -->
  <EcomaLogo class="h-6 w-auto" />

  <!-- Văn bản thay thế theo ngữ cảnh sử dụng -->
  <EcomaLogo alt="Về trang chủ ecoma.io" />
</template>
```

- `alt` (mặc định `'ecoma.io'`) là prop duy nhất — đủ cho accessibility (`<img alt>`); ngữ nghĩa "logo của brand" là đủ, phần mô tả thêm thuộc ngữ cảnh dùng.
- Kích thước và style tùy chỉnh đi qua **CSS** (`class`/`style` fallthrough, CSS thắng `width`/`height` attribute). `width`/`height` mặc định là kích thước intrinsic của artwork (160×46) — browser reserve không gian trước khi artwork tải xong, không CLS.
- **Attribute bị filter khỏi fallthrough** (cố ý, có test): nhóm nguồn ảnh `src`/`srcset`/`imagesrcset` (artwork là source of truth, không thay thế ngầm; browser ưu tiên `srcset` hơn `src` nên cả ba chặn cùng nhau) và `width`/`height` (override một mình một trong hai làm browser bóp méo artwork — sizing chỉ qua CSS). Các attr khác (`class`, `style`, `aria-*`, `data-*`…) đi thẳng vào `<img>`.
- Render thuần server-compatible: không lifecycle hook, không `window`, không fetch — tương thích SSR/SSG, không client-only state, không hydration dependency.
- Style của artwork nằm trong tài liệu SVG riêng (component render qua `<img>`) nên không leak class generic (`.a`/`.b` của file nguồn) ra trang consumer.

### Consumer Nuxt: khai báo type cho asset `.svg`

Type của `import … from '*.svg'` đến từ ambient declaration trong **program TypeScript của consumer** — tsconfig paths chỉ resolve đường dẫn, không kéo shim của lib vào program app. App Nuxt tiêu thụ `@ecoma-io/logo` cần một trong hai:

- thêm `"vite/client"` vào `types` của tsconfig tương ứng (app Nuxt đã có sẵn ở phần lớn cấu hình mặc định), hoặc
- khai `declare module '*.svg'` trong `.d.ts` của chính app.

Thiếu khai báo này, `vue-tsc`/`tsc` của app báo `TS2307: Cannot find module '*.svg'` khi nạp source của lib qua tsconfig paths (khác với `.vue` — `vue-tsc` resolve native).

## `ECOMA_LOGO_HORIZONTAL_SVG_URL`

```ts
import { ECOMA_LOGO_HORIZONTAL_SVG_URL } from '@ecoma-io/logo';
```

URL của SVG nguồn, đã được bundler resolve (dev server path hoặc hashed URL ở build). Dùng khi consumer cần phần tử ảnh tự quản thay vì component; không hard-code URL này ở bất kỳ đâu. **Lưu ý**: URL là đường dẫn tương đối với origin và đổi theo mỗi build (hash) — use case cần URL tuyệt đối ổn định (Open Graph image, schema.org logo…) phải do consumer tự prefix origin hoặc copy asset, không dựng `<meta>` trực tiếp từ URL này.

## Đặt trong workspace

```text
apps (home · blogs · docs · api-reference …)
  ↓                    ← tiêu thụ
logo                   ← artwork brand, không phụ thuộc gì
layout-public          ← shell · global navigation · mount topology
  ↓
i18n-public            ← locale dimension
```

Tags: `type:application` (UI component — cùng hàng với `layout-public`), `scope:shared` (mọi bounded context được phụ thuộc `scope:shared`), `runtime:universal`.

## Chạy unit test

```bash
pnpm exec nx test logo
```

## Kiểm type (component `.vue`)

`tsc` gốc không parse SFC — target `typecheck` của project dùng `vue-tsc` để kiểm type component:

```bash
pnpm exec nx typecheck logo
```

## Giới hạn hiện tại

- Chỉ có **primary horizontal logo** từ SVG nguồn. Các biến thể khác (stacked, symbol, wordmark riêng, colorway) cần thiết kế chính thức trước khi thêm vào library.
- Chưa tích hợp vào bất kỳ app hay library consumer nào — việc đó thuộc các PR riêng.
