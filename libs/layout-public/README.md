# layout-public

Thư viện **shared public-web layer** cho bề mặt public của `ecoma.io`: public shell dùng chung (Header/Footer), global navigation và public mount topology. Tiêu thụ contract locale của [`i18n-public`](../i18n-public/README.md) — không tự quyết định gì về locale — và artwork brand qua [`logo`](../logo/README.md).

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
  resolveLocaleContext,
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
  type PublicLocaleContext,
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
buildPublicPath({ locale: 'en', mount: 'docs', path: '/guide' }); // → /en/docs/guide
buildPublicPath({ locale: 'en', mount: 'docs/api' }); // → /en/docs/api
```

- `path` mặc định `''`; phải bắt đầu bằng `/` hoặc là `''` — `not_a_pathname`, `trailing_slash`, `empty_segment` trả typed reason.
- **Topology boundary**: `PublicMount` là ranh giới topology, không phải tiền tố string. Nếu mount + path ghép lại mà parser resolve ra mount **khác** mount đã yêu cầu, builder trả `unknown_mount` thay vì reinterpret — `{ mount: 'docs', path: '/api' }` bị từ chối (thuộc topology của `docs/api`); caller muốn address `docs/api` phải dựng `{ mount: 'docs/api' }`. Rule tổng quát cho mọi mount lồng nhau, không hard-code segment.
- Kết quả luôn là chính kết quả parse của URL đã dựng (canonical).
- Invariant: `parsePublicLayoutPath(buildPublicPath(x).path)` **≡** `buildPublicPath(x)` — và parse trả lại nguyên vẹn `locale` / `mount` / `remainder` của input (semantic topology, không chỉ path string) — được test.

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

### Locale availability

App (blogs, docs, public app tương lai…) báo cho library locale nào **thực sự tồn tại** của resource hiện tại — input resource-level, truyền qua prop `availableLocales` của `PublicShell`/`PublicHeader`:

```vue
<PublicShell :path="path" :available-locales="['en']">
  <!-- chỉ resource tiếng Anh: switcher không đề xuất vi -->
</PublicShell>
```

- `resolveLocaleContext(current, availableLocales?)` resolve thành `PublicLocaleContext = { current, availableLocales }` — library **không tự suy ra** availability từ content, filesystem hay application.
- Không truyền `availableLocales` → toàn bộ registry của `i18n-public` (behavior mặc định, không đổi so với trước).
- Truyền → so khớp exact qua `isPublicLocale` (giá trị ngoài registry bị loại, không throw — kế thừa contract `i18n-public`), khử trùng lặp, trả theo thứ tự registry, frozen.
- Invariant: `current` **luôn** nằm trong `availableLocales` của context — app không liệt kê locale hiện tại (hoặc truyền mảng rỗng) thì locale đó vẫn được render.
- Locale switcher chỉ render locale nằm trong context và **không bao giờ** dựng link tới locale ngoài context; global navigation và brand không bị availability ảnh hưởng.
- Không có routing abstraction thứ hai: link switch vẫn dựng qua `switchLocale` của `i18n-public`.

## Components

```vue
<script setup lang="ts">
import { PublicShell } from '@ecoma-io/layout-public';

// pathname thuần (không `?`/`#`), giống hệt trên server và client —
// trong Nuxt: `useRoute().path`, không dùng `fullPath`.
const path = useRoute().path;
</script>

<template>
  <PublicShell :path="path">
    <!-- nội dung trang của app -->
  </PublicShell>
</template>
```

- `path` phải là **pathname thuần** — không query (`?`), không hash (`#`), vì `parsePublicLayoutPath` từ chối chúng là `not_a_pathname` — và phải **giống hệt trên server với client** (vd. `useRoute().path`, không phải `fullPath` hay `location.pathname`). Hai thuộc tính này giữ HTML server/client byte-identical, tránh hydration mismatch.
- `PublicShell` nhận `path` (pathname hiện tại), parse **một lần** cho layout state rồi truyền state đã parse vào `PublicHeader`/`PublicFooter` — component không tự parse pathname lần thứ hai, không tự resolve locale. (Helper `buildPublicPath`/`switchLocale` có tự nội suy lại khi dựng href — thuần pure, nằm trong `computed`.)
- Cấu trúc: `<header>` → `<main>` (slot nội dung app) → `<footer>`; link là `<a href>` thường (crawlable, không phụ thuộc client router).
- Shell là **multi-root**: Vue không fallthrough attribute từ app xuống component nhiều root — không truyền `class`/`id` vào `<PublicShell>`; styling dùng chính các landmark (`header nav[aria-label="Global"]`, `footer` …), library không đóng vai design system.
- Header: brand (artwork logo qua `EcomaLogo` — kích thước đặt bằng CSS, `h-9 w-auto`; accessible name là `alt` mặc định `ecoma.io` của logo lib) → locale-root, global navigation, locale switcher (đổi locale qua `switchLocale` của `i18n-public`, không reimplement), active mount qua `aria-current`. Switcher hạn chế bởi `availableLocales` của resource nếu được truyền — locale hiện tại luôn được render.
- Footer **giữ brand chữ** (`ecoma.io`), không dùng logo: footer nền `slate-950` còn wordmark của artwork là màu `#161616` — không đọc được trên nền đó, mà artwork cấm recolor/variant (invariant của `logo`). Khi cần logo trên nền sậm, phải có variant sáng từ chủ sở hữu artwork trước.
- Render tĩnh, deterministic: không `Date`, không `window`, không fetch — tương thích SSR/SSG, không client-only state, không hydration dependency.
- Khi `path` là `root` hoặc `invalid`: render shell không kèm locale-aware link (brand trỏ `/`); không tự đoán locale.

## Boundary

```text
apps (home · blogs · docs · api-reference)
  ↓                       ← nội dung, app-specific navigation
layout-public             ← shell · global navigation · mount topology
  ↓        ↓
i18n-public  logo        ← locale dimension · brand artwork
```

```text
Public Web  ≠  Identity · Payment · Checkout · Customer Console · Seller Console
```

Các hệ thống ngoài Public Web không nằm trong dependency graph của thư viện này; trang public chỉ có thể **link tới** chúng, không import, không gọi API của chúng.

## Chạy unit test

```bash
pnpm exec nx test layout-public
```

## Kiểm type (component `.vue`)

`tsc` gốc không parse SFC — target `typecheck` của project dùng `vue-tsc` để kiểm type cả ba component (đây là lib duy nhất trong `libs/` xuất component):

```bash
pnpm exec nx typecheck layout-public
```
