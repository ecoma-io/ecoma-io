# layout-public

Thư viện **shared public-web layer** cho bề mặt public của `ecoma.io`: public shell dùng chung (Header/Footer), global navigation và public mount topology. Tiêu thụ contract locale của [`i18n-public`](../i18n-public/README.md) — không tự quyết định gì về locale.

## Library làm gì

- **Public shell**: `PublicShell` / `PublicHeader` / `PublicFooter` dùng chung cho mọi public app — app không duplicate header/footer.
- **Public mount topology**: đọc và dựng pathname theo `/<locale>/<mount>/<resource-path>` trên một mount registry type-safe, immutable.
- **Global public navigation**: navigation cấp Public Web — type-safe, deterministic, locale-aware qua `i18n-public`, không runtime fetch.

## Library không làm gì

- Không sở hữu **locale**: locale registry, locale parsing, locale switching thuộc `i18n-public`; thư viện này chỉ tiêu thụ contract đó, không có dependency ngược.
- Không sở hữu **application content** hay **application-specific navigation** (sidebar của `docs`, category của `blogs`… thuộc app).
- Không phải CMS, page builder, analytics framework hay generic SEO framework — SEO chỉ là constraint kiến trúc (URL ổn định, link crawlable, SSR/SSG, semantic HTML).
- Không tích hợp Identity / Payment / Checkout / Customer Console / Seller Console; không gọi backend hay service API nào; Header/Footer render tĩnh, không runtime fetch.
- Không biết **Nx project**, Worker name hay deployment unit. Public mount là public URL topology và phải độc lập với topology triển khai — trong registry **không có** tên app/nhất là Nx project.
- Không normalize, không repair path hỏng — kế thừa strict canonicality từ `i18n-public`: input không hợp lệ trả typed reason, không throw, không sửa giúp.

## Phân tầng parse

```text
pathname
   │
   ▼
i18n-public ── parsePublicPath()
   ├── locale
   └── remainder
             │
             ▼
layout-public ── parsePublicLayoutPath()
             ├── mount
             └── resource path (phần còn lại sau mount)
```

`/en/docs/api` → `i18n-public` trả `locale = 'en'`, `remainder = '/docs/api'`; `layout-public` trả `mount = 'docs/api'`, `resource = ''`.

## Public mount registry

| Mount      | Ví dụ URL              |
| ---------- | ---------------------- |
| `blog`     | `/en/blog`, `/vi/blog` |
| `docs`     | `/en/docs`, `/vi/docs` |
| `docs/api` | `/en/docs/api`         |

- Registry là **dữ liệu duy nhất** khai báo topology; `PublicMount` suy ra từ registry (`keyof` của dữ liệu), không viết tay union. Thêm mount là thay đổi data, không thêm nhánh code, không bao giờ special-case một application.
- **Full segment boundary**: mount `blog` không bao giờ khớp `/blogging`.
- **Deepest-first**: mount lồng nhau resolve từ deepest trước — `/en/docs/api` khớp `docs/api`, không khớp `docs`.
- `PUBLIC_MOUNTS` sắp xếp theo thứ tự đúng cho matching; dùng `PUBLIC_MOUNTS_IN_DECLARATION_ORDER` khi hiển thị.
- Mount ≠ Nx project: `blogs` (Nx project) phục vụ mount `blog`; `api-reference` phục vụ mount `docs/api`. Quan hệ app ↔ mount là chuyện deployment, không nằm trong library.

## Root semantics

| URL         | Nghĩa                                                                   | Kết quả parse                      |
| ----------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `/`         | Locale-resolution entry point — **không serve content**, không redirect | `root`                             |
| `/en`,`/vi` | Locale-root surface (bề mặt root public, không mount)                   | `locale-root`                      |
| `/en/docs`  | Mounted surface + resource path                                         | `localized` (`mount`, `remainder`) |

`/` không bao giờ được coi là `locale = 'en'`. Chính sách resolve `/` → `/en` hay `/vi` thuộc về caller, không thuộc thư viện này.

## Public API

```ts
import {
  PUBLIC_MOUNTS,
  PUBLIC_MOUNTS_IN_DECLARATION_ORDER,
  PUBLIC_NAVIGATION,
  getMountDefinition,
  isPublicMount,
  parsePublicLayoutPath,
  buildPublicPath,
  buildPublicNavigation,
  PublicShell,
  PublicHeader,
  PublicFooter,
  type PublicMount,
  type PublicMountDefinition,
  type PublicLayoutPathInput,
  type PublicLayoutPathReason,
  type PublicLayoutPathResult,
  type PublicNavigationItem,
  type PublicNavigationLink,
} from '@ecoma-io/layout-public';
```

### `parsePublicLayoutPath(pathname)`

Discriminated result, không throw, không normalize — kế thừa toàn bộ kiểm tra cấu trúc của `parsePublicPath` (trailing slash, `//`, `?`/`#`, so khớp locale chính xác), sau đó match mount:

```ts
type PublicLayoutPathResult =
  | { kind: 'root'; path: '/' }
  | { kind: 'locale-root'; locale: PublicLocale; path: string }
  | { kind: 'localized'; locale: PublicLocale; mount: PublicMount; path: string; remainder: string }
  | { kind: 'invalid'; reason: PublicLayoutPathReason };
```

- `remainder` là phần **sau mount** (`/en/docs/api/guide` → `mount = 'docs/api'`, `remainder = '/guide'`); khác với `remainder` sau locale của `i18n-public`.
- Không khớp mount nào → `invalid` với reason `unknown_mount` (`/en/unknown`, `/en/blogging`).
- Resource path **sau mount** là opaque — thư viện không kiểm tra nội dung đó; `/en/docs/unknown` hợp lệ (`mount = 'docs'`, `remainder = '/unknown'`), app quyết định 404.

### `buildPublicPath(input)`

Canonical constructor — mọi URL dựng qua library, **không** string concatenation ở caller:

```ts
buildPublicPath({ locale: 'en' }); // → /en
buildPublicPath({ locale: 'vi', mount: 'docs' }); // → /vi/docs
buildPublicPath({ locale: 'en', mount: 'docs', path: '/api' }); // → /en/docs/api
```

- `path` mặc định `''`; phải bắt đầu bằng `/` hoặc là `''` — `not_a_pathname`, `trailing_slash`, `empty_segment` trả typed reason.
- Kết quả luôn là chính kết quả parse của URL đã dựng (canonical); ví dụ `{ mount: 'docs', path: '/api' }` dựng `/en/docs/api` và parse trả `mount = 'docs/api'`.
- Invariant: `parsePublicLayoutPath(buildPublicPath(x).path)` **≡** `buildPublicPath(x)` — được test.

### Registry helpers

```ts
isPublicMount('docs/api'); // true — so khớp chính xác, '/docs' hay 'docs/' là false
getMountDefinition('blog'); // { path: 'blog' } | undefined
```

### Global navigation

```ts
buildPublicNavigation('vi');
// → [{ mount: 'blog', label: 'Blog', href: '/vi/blog' }, …]
```

- `PUBLIC_NAVIGATION` là dữ liệu tĩnh, frozen; label là `Record<PublicLocale, string>` nên thiếu locale là lỗi type.
- Application-specific navigation không nằm trong model này.

## Components

```vue
<script setup lang="ts">
import { PublicShell } from '@ecoma-io/layout-public';
</script>

<template>
  <PublicShell :path="path">
    <!-- nội dung trang của app -->
  </PublicShell>
</template>
```

- `PublicShell` nhận `path` (pathname hiện tại), parse **một lần** rồi truyền state đã parse vào `PublicHeader`/`PublicFooter` — component không tự parse pathname lần thứ hai, không tự resolve locale.
- Cấu trúc: `<header>` → `<main>` (slot nội dung app) → `<footer>`; link là `<a href>` thường (crawlable, không phụ thuộc client router).
- Header: brand → locale-root, global navigation, locale switcher (đổi locale qua `switchLocale` của `i18n-public`, không reimplement), active mount qua `aria-current`.
- Render tĩnh, deterministic: không `Date`, không `window`, không fetch — tương thích SSR/SSG, không client-only state, không hydration dependency.
- Khi `path` là `root` hoặc `invalid`: render shell không kèm locale-aware link (brand trỏ `/`); không tự đoán locale.

## Boundary

```text
apps (home · blogs · docs · api-reference)
  ↓                       ← nội dung, app-specific navigation
layout-public             ← shell · global navigation · mount topology
  ↓
i18n-public               ← locale dimension
```

```text
Public Web  ≠  Identity · Payment · Checkout · Customer Console · Seller Console
```

Các hệ thống ngoài Public Web không nằm trong dependency graph của thư viện này; trang public chỉ có thể **link tới** chúng, không import, không gọi API của chúng.

## Chạy unit test

```bash
pnpm exec nx test layout-public
```
