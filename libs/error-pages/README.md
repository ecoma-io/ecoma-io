# error-pages

Thư viện **shared UI cho HTTP error pages**: `NotFoundPage` (404) và `ForbiddenPage` (403) — hai component Vue trình bày trang lỗi, chia sẻ cùng stage visual nhưng giữ riêng danh tính ngữ nghĩa của từng mã.

## Library làm gì

- **Trình bày trang lỗi**: một `<h1>`, mô tả và CTA; `role="alert"` để screen reader đọc ngay khi trang lỗi thay thế nội dung thật. Component **không render** landmark `<main>` — consumer bọc trong shell đã sở hữu sẵn `<main>` (`PublicShell`), tránh hai landmark lồng nhau.
- **Stage visual dùng chung**: `ErrorPageStage` (private) cố định structure/a11y/kích thước mã status; hai page compose nó với mã hiển thị riêng (`aria-hidden` — mã số là chi tiết thị giác, không đọc to).
- **Hợp đồng nội dung thuần**: `ErrorPageContent` — tiêu đề, mô tả, primary action (bắt buộc) và secondary action (tùy chọn).

## Library không làm gì

- Không biết **HTTP status**: việc emit 404/403 thuộc seam của app (`validate`, `createError`, error handler, wrangler `not_found_handling`). Component render gì là chuyện của library; status trả ra là chuyện của app.
- Không biết **locale**: mọi chuỗi đến từ props, đã localize bởi consumer. Không import `i18n-public`, không tự parse pathname.
- Không biết **routing/Nuxt**: CTA là `<a href>` thuần; component chạy được ở bất kỳ nơi nào có Vue 3 (SSR, SSG, client).
- Không biết **auth/authorization**: 403 không tự render hint đăng nhập — đó là phạm vi của 401/auth flow, và hint auth trên 403 là lộ thông tin sai lớp.
- Không tự chạm `<head>`: muốn đặt `document.title` cho trang lỗi, consumer tự dùng `useHead`/seam tương ứng.

## Public API

```ts
import {
  ForbiddenPage,
  NotFoundPage,
  type ErrorPageContent,
  type ErrorPageAction,
} from '@ecoma-io/error-pages';
```

Mỗi component nhận đúng một prop `content: ErrorPageContent`:

```ts
type ErrorPageContent = {
  readonly title: string; // <h1> duy nhất của trang
  readonly description: string;
  readonly primaryAction: ErrorPageAction; // { label, href }
  readonly secondaryAction?: ErrorPageAction;
};
```

- `href` được đưa vào nguyên trạng — destination là chính sách điều hướng của consumer, library không kiểm tra hay biến đổi.
- Hai component **không gộp thành một** component điều khiển bằng prop `status`: ngữ nghĩa lỗi (điều hướng vs. quyền truy cập) là danh tính của từng page, không phải một biến cấu hình.

## Dùng trong Nuxt (seam `error.vue`)

```vue
<!-- apps/<app>/app/error.vue -->
<script setup lang="ts">
import { NotFoundPage } from '@ecoma-io/error-pages';
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();
// App tự quyết: lỗi nào map sang trang 404, nội dung theo locale nào.
// 401/500/unknown KHÔNG được map sang 404/403 — xử lý riêng.
</script>

<template>
  <NotFoundPage
    v-if="error.statusCode === 404"
    :content="{ title: '…', description: '…', primaryAction: { label: '…', href: '/en' } }"
  />
</template>
```

## Boundary

```text
apps (home · docs · blogs · …)   ← sở hữu HTTP status, locale, routing, CTA destination
  ↓
error-pages                       ← pure presenter, scope:shared
```

`scope:shared` (không phải `scope:public`): trang lỗi dùng được cho mọi bounded scope — console/backoffice tương lai không bị chặn bởi ranh giới public. `runtime:universal`: render thuần, không Node builtin, không browser-only API.

## Chạy unit test

```bash
pnpm exec nx test error-pages
```

## Kiểm type (component `.vue`)

`tsc` gốc không parse SFC — target `typecheck` của project dùng `vue-tsc` (cùng cách với `layout-public`):

```bash
pnpm exec nx typecheck error-pages
```
